import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import nacl from "tweetnacl";
import util from "tweetnacl-util";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";
import cors from "cors";
import crypto from "crypto";
import os from "os";


// ---------- NEW imports for Solana ----------
import {
  Connection,
  Keypair as SolKeypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Notes:
 * - This file supports both KEYPAIR_PATH and KEYFILE_PATH env vars (backwards compatible).
 * - If either is provided, that path is used for the agent keyfile; otherwise a per-agent
 *   default in agent_data is used.
 * - Paths beginning with "~/" are expanded to the user's home directory.
 */

/* ---------- helpers ---------- */
function expandHome(p) {
  if (!p) return p;
  // expand leading ~/
  if (typeof p === "string" && p.startsWith("~/")) {
    p = path.join(os.homedir(), p.slice(2));
  }
  return path.resolve(p);
}


/* ---------- basic config ---------- */
const PORT = process.env.PORT || 3001;
const AGENT_ID = process.env.AGENT_ID || `agent-${PORT}`;

const DATA_DIR = path.resolve(process.cwd(), "agent_data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Default keyfile path: per-agent file inside DATA_DIR so multiple agents can coexist
const DEFAULT_KEYFILE = path.join(DATA_DIR, `${AGENT_ID}-ed25519.json`);

// Accept either KEYPAIR_PATH or KEYFILE_PATH (KEYPAIR_PATH takes precedence)
const RAW_KEYPATH = process.env.KEYPAIR_PATH || process.env.KEYFILE_PATH || DEFAULT_KEYFILE;
const KEYFILE = expandHome(path.resolve(RAW_KEYPATH));

// If you want to export a Solana-compatible keypair (array of 64 numbers), set SOLANA_EXPORT_PATH env
const SOLANA_EXPORT_PATH = process.env.SOLANA_EXPORT_PATH ? expandHome(process.env.SOLANA_EXPORT_PATH) : null;

// Solana RPC (local test-validator by default)
const SOLANA_RPC = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
const DEFAULT_RECEIVING_SOL = Number(process.env.DEFAULT_RECEIVING_SOL || 0.09);

/* ---------- keypair loading/creation ---------- */
let keypair; // { publicKey: Uint8Array, secretKey: Uint8Array }

function loadKeyfile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in keyfile ${filePath}: ${e.message}`);
  }

  // 1) Solana / "array of numbers" style secretKey (length 64)
  if (Array.isArray(parsed) && parsed.length >= 64) {
    const secret = Uint8Array.from(parsed.slice(0, 64));
    const kp = nacl.sign.keyPair.fromSecretKey(secret);
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
  }

  // 2) Object with base64 fields: { publicKey: "...", secretKey: "..." }
  if (parsed && (parsed.publicKey || parsed.secretKey)) {
    try {
      const publicKey = parsed.publicKey ? util.decodeBase64(parsed.publicKey) : null;
      const secretKey = parsed.secretKey ? util.decodeBase64(parsed.secretKey) : null;
      if (secretKey && secretKey.length === 64) {
        const kp = nacl.sign.keyPair.fromSecretKey(secretKey);
        return { publicKey: kp.publicKey, secretKey: kp.secretKey };
      }
      if (publicKey && secretKey) {
        return { publicKey, secretKey };
      }
    } catch (e) {
      throw new Error(`Failed to decode base64 keys in ${filePath}: ${e.message}`);
    }
  }

  // 3) Some other shape: maybe { secretKey: [numbers...] }
  if (parsed && parsed.secretKey && Array.isArray(parsed.secretKey)) {
    const secret = Uint8Array.from(parsed.secretKey.slice(0, 64));
    const kp = nacl.sign.keyPair.fromSecretKey(secret);
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
  }

  throw new Error(`Unsupported keyfile format for ${filePath}`);
}

function saveKeyfileBase64(filePath, kp) {
  const obj = {
    publicKey: util.encodeBase64(kp.publicKey),
    secretKey: util.encodeBase64(kp.secretKey),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function saveKeyfileSolanaArray(filePath, kp) {
  const arr = Array.from(kp.secretKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(arr), "utf8");
}

// Load or create keyfile
if (fs.existsSync(KEYFILE)) {
  try {
    keypair = loadKeyfile(KEYFILE);
    console.log(`Loaded keypair from ${KEYFILE}`);
  } catch (e) {
    console.error(`Failed to load keyfile ${KEYFILE}: ${e.message}`);
    console.log("Generating a new keypair because existing keyfile could not be parsed.");
    keypair = nacl.sign.keyPair();
    saveKeyfileBase64(KEYFILE, keypair);
    console.log(`Wrote new keypair to ${KEYFILE}`);
  }
} else {
  // create new keypair and save in base64 format
  keypair = nacl.sign.keyPair();
  saveKeyfileBase64(KEYFILE, keypair);
  console.log("Generated new keypair and saved to", KEYFILE);
}

// Optionally export Solana-compatible keyfile
if (SOLANA_EXPORT_PATH) {
  try {
    saveKeyfileSolanaArray(SOLANA_EXPORT_PATH, keypair);
    console.log(`Exported Solana-style keypair to ${SOLANA_EXPORT_PATH}`);
  } catch (e) {
    console.error(`Failed to export solana keyfile to ${SOLANA_EXPORT_PATH}: ${e.message}`);
  }
}

/* ---------- express app ---------- */
const app = express();
app.use(cors({ origin: "http://localhost:3000" })); // adjust if needed
app.use(bodyParser.json({ limit: "1mb" }));

/* ---------- DB and logging ---------- */
const DBFILE = path.join(DATA_DIR, "db.sqlite");
const db = new Database(DBFILE);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  role TEXT,
  counterparty TEXT,
  payload TEXT,
  payload_hash TEXT,
  status TEXT,
  created_at INTEGER,
  last_attempt_ts INTEGER,
  response_payload TEXT
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER,
  level TEXT,
  msg TEXT
);
`);

function log(level, msg) {
  const ts = Date.now();
  try {
    db.prepare("INSERT INTO logs (ts, level, msg) VALUES (?, ?, ?)").run(ts, level, String(msg));
  } catch (e) {
    // ignore logging write failures to avoid crashing the agent
  }
  const out = `[${new Date(ts).toISOString()}] ${level.toUpperCase()} - ${msg}`;
  if (level === "error") console.error(out);
  else console.log(out);
}

/* ---------- crypto helpers ---------- */
function signString(s) {
  const msgUint8 = util.decodeUTF8(s);
  const sig = nacl.sign.detached(msgUint8, keypair.secretKey);
  return util.encodeBase64(sig);
}
function verifyString(s, sigBase64, pubKeyBase64) {
  try {
    const msgUint8 = util.decodeUTF8(s);
    const sig = util.decodeBase64(sigBase64);
    const pub = util.decodeBase64(pubKeyBase64);
    return nacl.sign.detached.verify(msgUint8, sig, pub);
  } catch (e) {
    return false;
  }
}
function sha256hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/* ---------- Solana helpers (NEW) ---------- */

// connection
const solConnection = new Connection(SOLANA_RPC, "confirmed");

// Convert our tweetnacl keypair.secretKey (Uint8Array) to a Solana Keypair
function getSolanaKeypairFromTweetnacl() {
  return SolKeypair.fromSecretKey(Uint8Array.from(keypair.secretKey));
}

// Convert receiver key string (accept base58 or base64) to PublicKey
function pubkeyFromPossibleBase64OrBase58(s) {
  try {
    return new PublicKey(s);
  } catch (e) {
    try {
      const buf = Buffer.from(s, "base64");
      return new PublicKey(buf);
    } catch (e2) {
      throw new Error("Invalid pubkey format (not base58 or base64)");
    }
  }
}

// Improved transfer with richer logging on failure
async function sendSolTransferTo(receiverPubkeyStr, amountSol = 0.01) {
  const payer = getSolanaKeypairFromTweetnacl();
  const receiver = pubkeyFromPossibleBase64OrBase58(receiverPubkeyStr);
  const lamports = Math.floor(Number(amountSol) * LAMPORTS_PER_SOL);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: receiver,
      lamports,
    })
  );

  try {
    const sig = await sendAndConfirmTransaction(solConnection, tx, [payer], { commitment: "confirmed" });
    return sig;
  } catch (err) {
    log("error", `Solana transfer failed: ${err?.message || String(err)}`);
    if (err && err.logs) log("error", `Simulation logs:\n${err.logs.join("\n")}`);
    if (err && err.error && err.error.logs) log("error", `Inner error logs:\n${err.error.logs.join("\n")}`);
    throw new Error(`Solana transfer failed: ${err?.message || String(err)}`);
  }
}

/* ---------- simple LLM runner (same as before) ---------- */
async function runLocalAI(payloadStr) {
  const LLM_URL = process.env.LLM_URL || "http://127.0.0.1:8080/completion";
  const prompt = `You are a helpful AI agent. Process the following payload:\n\n${payloadStr}\n\nRespond clearly and briefly:`;

  try {
    const body = { prompt, n_predict: 128, temperature: 0.7 };
    const res = await fetch(LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();

    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }

    const reply = parsed?.content || parsed?.results?.[0]?.text || parsed?.text || text;
    return { text: reply.trim() };
  } catch (err) {
    console.error("runLocalAI error:", err.message);
    return { text: `LLM error: ${err.message}` };
  }
}

/* ---------- network helpers ---------- */
async function attemptPost(baseReceiverUrl, body, tries = 3, backoffMs = 400) {
  const target = new URL("/receive", baseReceiverUrl).toString();
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return { ok: true, status: res.status, body: text };
    } catch (err) {
      log("error", `attempt ${attempt} failed to POST ${target}: ${err.message}`);
      if (attempt < tries) await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }
  return { ok: false, error: "all attempts failed" };
}

/* ---------- routes ---------- */

app.get("/", (req, res) => {
  res.json({
    agent: AGENT_ID,
    port: PORT,
    publicKey: util.encodeBase64(keypair.publicKey),
    keyfile: KEYFILE,
  });
});

// Expose keypair info (public key + keyfile path). Do NOT expose secret key.
app.get("/keypair", (req, res) => {
  const solPubBase58 = (() => {
    try {
      const buf = Buffer.from(util.encodeBase64(keypair.publicKey), "base64");
      return bs58.encode(buf);
    } catch (e) {
      return null;
    }
  })();

  res.json({
    agent: AGENT_ID,
    publicKey_base64: util.encodeBase64(keypair.publicKey),
    publicKey_base58: solPubBase58,
    keyfile: KEYFILE,
    solana_export_path: SOLANA_EXPORT_PATH || null,
  });
});

app.post("/send-request", async (req, res) => {
  try {
    const { receiverUrl, payload, replyTo, receiverSolPubkey, amountSol } = req.body;
    if (!receiverUrl || !payload) return res.status(400).json({ error: "receiverUrl and payload required" });

    const id = uuidv4();
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
    const payload_hash = sha256hex(payloadStr);
    const timestamp = Date.now();
    const reply_to = replyTo || `http://localhost:${PORT}/receive-response`;

    const envelope = {
      intent_id: id,
      sender: AGENT_ID,
      sender_pubkey: util.encodeBase64(keypair.publicKey),
      reply_to,
      payload: payloadStr,
      payload_hash,
      timestamp,
    };

    const signBase = `${envelope.intent_id}|${envelope.payload_hash}|${envelope.timestamp}`;
    envelope.sig = signString(signBase);

    // optional direct SOL transfer
    if (receiverSolPubkey && amountSol) {
      try {
        const txSig = await sendSolTransferTo(receiverSolPubkey, amountSol);
        log("info", `Transferred ${amountSol} SOL to ${receiverSolPubkey}, tx: ${txSig}`);
        envelope.onchain = { type: "direct-transfer", amountSol: Number(amountSol), txSig };
      } catch (err) {
        log("error", `sol transfer failed: ${err.message}`);
        return res.status(502).json({ error: "sol transfer failed", detail: String(err) });
      }
    }

    db.prepare(
      `INSERT INTO intents (id, role, counterparty, payload, payload_hash, status, created_at, last_attempt_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, "outgoing", receiverUrl, payloadStr, payload_hash, "sending", timestamp, null);

    log("info", `Created outgoing intent ${id} -> ${receiverUrl} (reply_to=${reply_to})`);

    const result = await attemptPost(receiverUrl, envelope, 3, 500);
    const now = Date.now();
    if (result.ok && result.status >= 200 && result.status < 300) {
      db.prepare("UPDATE intents SET status = ?, last_attempt_ts = ?, response_payload = ? WHERE id = ?")
        .run("delivered", now, result.body, id);
      log("info", `Delivered intent ${id} to ${receiverUrl} - status ${result.status}`);
      return res.json({ intent_id: id, delivered: true, status: result.status, response: result.body });
    } else {
      db.prepare("UPDATE intents SET status = ?, last_attempt_ts = ? WHERE id = ?")
        .run("failed", now, id);
      log("error", `Failed to deliver intent ${id} to ${receiverUrl}`);
      return res.status(502).json({ intent_id: id, delivered: false, error: result.error || "bad response" });
    }
  } catch (err) {
    log("error", `send-request failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/receive", async (req, res) => {
  try {
    const env = req.body;
    if (!env || !env.intent_id || !env.payload_hash || !env.sender_pubkey || !env.sig) {
      log("error", "Invalid envelope received (missing fields)");
      return res.status(400).json({ error: "invalid envelope" });
    }

    const verifyBase = `${env.intent_id}|${env.payload_hash}|${env.timestamp}`;
    const ok = verifyString(verifyBase, env.sig, env.sender_pubkey);
    if (!ok) {
      log("error", `Signature verification failed for intent ${env.intent_id}`);
      return res.status(400).json({ error: "signature verification failed" });
    }

    const payloadStr = env.payload;
    const computed = sha256hex(payloadStr);
    if (computed !== env.payload_hash) {
      log("error", `Payload hash mismatch for intent ${env.intent_id}`);
      return res.status(400).json({ error: "payload hash mismatch" });
    }

    db.prepare(
      `INSERT OR REPLACE INTO intents (id, role, counterparty, payload, payload_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(env.intent_id, "incoming", env.sender || env.sender_pubkey, payloadStr, env.payload_hash, "received", Date.now());

    log("info", `Received intent ${env.intent_id} from ${env.sender || env.sender_pubkey}`);

    const aiResult = await runLocalAI(payloadStr);
    const responsePayload = {
      intent_id: env.intent_id,
      result: aiResult.text,
      responder: AGENT_ID,
      responder_pubkey: util.encodeBase64(keypair.publicKey),
      timestamp: Date.now(),
    };

    const respString = JSON.stringify(responsePayload);
    const respSig = signString(respString);
    const respEnvelope = { responsePayload, sig: respSig };

    if (env.reply_to) {
      try {
        const replyUrl = new URL("/receive-response", env.reply_to).toString();
        const r = await fetch(replyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(respEnvelope),
        });
        if (r.ok) {
          log("info", `Posted response for ${env.intent_id} to ${env.reply_to}`);
          db.prepare("UPDATE intents SET response_payload = ?, status = ? WHERE id = ?")
            .run(JSON.stringify(responsePayload), "responded", env.intent_id);
        } else {
          log("error", `Posting response for ${env.intent_id} to ${env.reply_to} returned ${r.status}`);
          db.prepare("UPDATE intents SET response_payload = ?, status = ? WHERE id = ?")
            .run(JSON.stringify(responsePayload), "responded_partial", env.intent_id);
        }
      } catch (err) {
        log("error", `Failed to POST response to ${env.reply_to}: ${err.message}`);
        db.prepare("UPDATE intents SET response_payload = ?, status = ? WHERE id = ?")
          .run(JSON.stringify(responsePayload), "responded_pending", env.intent_id);
      }
    } else {
      db.prepare("UPDATE intents SET response_payload = ?, status = ? WHERE id = ?")
        .run(JSON.stringify(responsePayload), "responded_no_replyto", env.intent_id);
    }

    return res.json({ status: "ok", response: respEnvelope });
  } catch (err) {
    log("error", `receive error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/receive-response", (req, res) => {
  try {
    const env = req.body;
    if (!env || !env.responsePayload || !env.sig) {
      log("error", "invalid response envelope");
      return res.status(400).json({ error: "invalid response envelope" });
    }

    const respJson = JSON.stringify(env.responsePayload);
    if (env.responsePayload.responder_pubkey && env.sig) {
      const ok = verifyString(respJson, env.sig, env.responsePayload.responder_pubkey);
      if (!ok) {
        log("error", `Response signature verification failed for ${env.responsePayload.intent_id}`);
        return res.status(400).json({ error: "response signature invalid" });
      }
    }

    const now = Date.now();
    db.prepare("UPDATE intents SET status = ?, response_payload = ?, last_attempt_ts = ? WHERE id = ?")
      .run("responded", JSON.stringify(env.responsePayload), now, env.responsePayload.intent_id);

    log("info", `Received response for intent ${env.responsePayload.intent_id}`);
    return res.json({ status: "ok" });
  } catch (err) {
    log("error", `receive-response error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/logs", (req, res) => {
  const rows = db.prepare("SELECT ts, level, msg FROM logs ORDER BY ts DESC LIMIT 200").all();
  res.json(rows.map(r => ({ ts: new Date(r.ts).toISOString(), level: r.level, msg: r.msg })));
});
app.get("/intents", (req, res) => {
  const rows = db.prepare("SELECT * FROM intents ORDER BY created_at DESC LIMIT 200").all();
  res.json(rows);
});
app.get("/status/:id", (req, res) => {
  const id = req.params.id;
  const row = db.prepare("SELECT * FROM intents WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});
// --- Balance endpoint ---
// POST /balance  { keypairPath?: string }
// GET  /balance  -> returns balance for this agent's loaded keypair
// --- Balance endpoint ---
// POST /balance  { keypairPath?: string, keyfileJson?: object }
// GET  /balance  -> returns balance for this agent's loaded keypair
app.all("/balance", async (req, res) => {
  try {
    const body = req.method === "POST" ? req.body || {} : {};
    const incomingPathRaw = body.keypairPath || body.keypair || null;
    const keyfileJson = body.keyfileJson || null;

    let usedKeyfilePath = KEYFILE; // default
    let targetPubkeyUint8 = null;

    if (keyfileJson) {
      // Caller supplied raw key JSON content (useful when frontend can't reach the file system)
      try {
        const tmpK = loadKeyfileFromObject(keyfileJson);
        targetPubkeyUint8 = tmpK.publicKey;
        usedKeyfilePath = null;
      } catch (err) {
        log("error", `balance: failed to parse keyfileJson: ${err.message}`);
        return res.status(400).json({ sol: DEFAULT_RECEIVING_SOL, publicKey_base58: null, publicKey_base64: null, keyfile: null, tokens: [], error: `failed to parse keyfileJson: ${err.message}` });
      }
    } else if (incomingPathRaw) {
      // Caller asked for a specific keyfile path
      try {
        const expanded = expandHome(String(incomingPathRaw));
        const resolved = path.resolve(expanded);
        if (!fs.existsSync(resolved)) {
          return res.status(404).json({
            sol: DEFAULT_RECEIVING_SOL,
            publicKey_base58: null,
            publicKey_base64: null,
            keyfile: resolved,
            tokens: [],
            error: "keyfile not found",
          });
        }
        const k = loadKeyfile(resolved);
        targetPubkeyUint8 = k.publicKey;
        usedKeyfilePath = resolved;
      } catch (err) {
        log("error", `balance: failed to parse requested keyfile ${incomingPathRaw}: ${err.message}`);
        return res.status(400).json({ sol: DEFAULT_RECEIVING_SOL, publicKey_base58: null, publicKey_base64: null, keyfile: incomingPathRaw, tokens: [], error: `failed to parse keyfile: ${err.message}` });
      }
    } else {
      // Use the currently loaded agent keypair
      targetPubkeyUint8 = keypair.publicKey;
      usedKeyfilePath = KEYFILE;
    }

    // Convert to PublicKey
    let pubkey;
    try {
      const buf = Buffer.from(util.encodeBase64(targetPubkeyUint8), "base64");
      pubkey = new PublicKey(buf);
    } catch (e) {
      log("error", `balance: failed to convert public key: ${e.message}`);
      return res.status(500).json({ sol: DEFAULT_RECEIVING_SOL, publicKey_base58: null, publicKey_base64: util.encodeBase64(targetPubkeyUint8), keyfile: usedKeyfilePath, tokens: [], error: "invalid public key" });
    }

    // Query balance
    let lamports = 0;
    try {
      lamports = await solConnection.getBalance(pubkey, "confirmed");
    } catch (err) {
      log("error", `balance: getBalance RPC failed for ${pubkey.toBase58()}: ${err.message}`);
      return res.status(502).json({ sol: DEFAULT_RECEIVING_SOL, publicKey_base58: pubkey.toBase58(), publicKey_base64: util.encodeBase64(targetPubkeyUint8), keyfile: usedKeyfilePath, tokens: [], error: `rpc error: ${String(err.message || err)}` });
    }

    const sol = Number(lamports) / Number(LAMPORTS_PER_SOL || 1e9);

    // Optionally fetch SPL token balances (lightweight)
    let tokens = [];
    try {
      const parsed = await solConnection.getParsedTokenAccountsByOwner(pubkey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
      tokens = parsed.value.map((acc) => {
        const info = acc.account.data.parsed.info;
        return {
          mint: info.mint,
          amount_raw: info.tokenAmount?.amount,
          decimals: info.tokenAmount?.decimals,
          uiAmount: info.tokenAmount?.uiAmount,
        };
      });
    } catch (err) {
      // Non-fatal: token query failed (keep tokens = [])
      log("error", `balance: token query failed for ${pubkey.toBase58()}: ${err.message}`);
    }

    return res.json({
      sol,
      publicKey_base58: pubkey.toBase58(),
      publicKey_base64: util.encodeBase64(targetPubkeyUint8),
      keyfile: usedKeyfilePath,
      tokens,
    });
  } catch (err) {
    log("error", `balance endpoint error: ${err.message}`);
    return res.status(500).json({ sol: DEFAULT_RECEIVING_SOL, publicKey_base58: null, publicKey_base64: null, keyfile: null, tokens: [], error: String(err.message) });
  }
});

/* ---------- start server ---------- */
app.listen(PORT, () => {
  log("info", `Agent ${AGENT_ID} starting on port ${PORT}`);
  console.log(`Agent identity: ${AGENT_ID}`);
  console.log("Public key (base64):", util.encodeBase64(keypair.publicKey));
  try {
    const buf = Buffer.from(util.encodeBase64(keypair.publicKey), "base64");
    console.log("Public key (base58):", bs58.encode(buf));
  } catch (e) { /* ignore */ }
  console.log("Keyfile path used:", KEYFILE);
  if (SOLANA_EXPORT_PATH) console.log("Solana-exported keyfile:", SOLANA_EXPORT_PATH);
  console.log("Solana RPC:", SOLANA_RPC);
});
