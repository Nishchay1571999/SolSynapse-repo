// app/page.tsx (replace existing)
"use client";

import React, { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

type Agent = {
  id: string;
  name: string;
  url: string;
  side: "left" | "right";
  keypairPath: string;
};

const AGENTS: Agent[] = [
  {
    id: "agent-A",
    name: "Agent A",
    url: "http://localhost:3001",
    side: "left",
    keypairPath: "~/.config/solana/agents/agentA.json", // replace if needed
  },
  {
    id: "agent-B",
    name: "Agent B",
    url: "http://localhost:3002",
    side: "right",
    keypairPath: "~/.config/solana/agents/agentB.json", // replace if needed
  },
];

function nowIso() {
  return new Date().toISOString();
}

type ChatMsg = {
  id: string;
  fromUrl: string;
  toUrl: string;
  text: string;
  ts: string;
  status: "sending" | "sent" | "waiting" | "received" | "error";
  meta?: any;
};

export default function Page() {
  const [fromAgentUrl, setFromAgentUrl] = useState<string>(AGENTS[0].url);
  const [toAgentUrl, setToAgentUrl] = useState<string>(AGENTS[1].url);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [sending, setSending] = useState(false);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // default receiving SOL fallback
  const DEFAULT_RECEIVING_SOL = 0.09;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // fetch balances for both agents on mount
  useEffect(() => {
    void Promise.all(AGENTS.map((a) => fetchAndSetBalanceForUrl(a.url)));
  }, []);

  function pushMessage(m: ChatMsg) {
    setMessages((s) => [...s, m]);
  }

  function agentByUrl(url: string) {
    return AGENTS.find((x) => x.url === url);
  }

  function agentName(url: string) {
    const a = agentByUrl(url);
    return a ? a.name : url;
  }

  // ---- Loading dots component (small animated indicator) ----
  function LoadingDots({ size = 10 }: { size?: number }) {
    const [dots, setDots] = useState("");
    useEffect(() => {
      const iv = setInterval(() => setDots((d) => (d.length < 3 ? d + "." : "")), 400);
      return () => clearInterval(iv);
    }, []);
    return (
      <span style={{ color: "#999", fontStyle: "italic", display: "inline-block", width: size * 3 }}>
        {dots}
      </span>
    );
  }

  // ---- Robust normalizer (extracts result/text deeply and returns best string) ----
  function extractBestText(raw: any): { display: string; raw: any } {
    if (raw === null || raw === undefined) return { display: "", raw };

    if (typeof raw === "string") {
      const s = raw.trim();
      if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
        try {
          return extractBestText(JSON.parse(s));
        } catch {
          return { display: raw, raw };
        }
      }
      return { display: raw, raw };
    }

    if (typeof raw === "object") {
      const deepPaths = [
        ["response", "responsePayload", "result"],
        ["response", "responsePayload", "text"],
        ["response", "responsePayload"],
        ["response", "result"],
        ["response", "text"],
        ["responsePayload", "result"],
        ["responsePayload", "text"],
        ["responsePayload"],
        ["result"],
        ["text"],
        ["response"],
      ];

      for (const path of deepPaths) {
        let cur: any = raw;
        let ok = true;
        for (const p of path) {
          if (cur && typeof cur === "object" && p in cur) {
            cur = cur[p];
          } else {
            ok = false;
            break;
          }
        }
        if (ok && cur !== undefined && cur !== null) {
          if (typeof cur === "string" || typeof cur === "number" || typeof cur === "boolean") {
            return { display: String(cur), raw };
          }
          if (typeof cur === "object") {
            if (cur.result || cur.text) return extractBestText(cur);
            try {
              return { display: JSON.stringify(cur, null, 2), raw };
            } catch {
              return { display: String(cur), raw };
            }
          }
        }
      }

      try {
        return { display: JSON.stringify(raw, null, 2), raw };
      } catch {
        return { display: String(raw), raw };
      }
    }

    return { display: String(raw), raw };
  }

  // ---- Polling (explicitly extract nested response shapes) ----
  async function pollForResponse(senderUrl: string, intentId: string, maxMs = 20000, intervalMs = 700) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        const res = await fetch(`${senderUrl.replace(/\/$/, "")}/status/${intentId}`);
        if (res.status === 404) {
          // not ready yet
        } else {
          const json = await res.json();
          let candidate: any = null;
          if (json && typeof json === "object") {
            if (json.response && json.response.responsePayload) candidate = json.response.responsePayload;
            else if (json.response_payload) candidate = json.response_payload;
            else if ((json as any).responsePayload) candidate = (json as any).responsePayload;
            else if (json.response) candidate = json.response;
            else candidate = json;
          } else {
            candidate = json;
          }

          if (candidate && (typeof candidate !== "object" || Object.keys(candidate).length > 0)) {
            return candidate;
          }
        }
      } catch (err) {
        // ignore transient fetch errors
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error("poll timeout");
  }

  // fetch balance helper: POST to agent's /balance with { keypairPath }
  async function fetchBalanceForAgent(agent: Agent): Promise<number> {
    try {
      const res = await fetch(`${agent.url.replace(/\/$/, "")}/balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keypairPath: agent.keypairPath }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      // expect { sol: number, tokens: [...] } — adapt if backend differs
      if (json && typeof json === "object" && typeof json.sol === "number") {
        return json.sol;
      }
      // attempt to extract sol from other shapes
      if (json && typeof json.sol === "string") {
        const n = Number(json.sol);
        if (!Number.isNaN(n)) return n;
      }
      // fallback if backend returned a number directly
      if (typeof json === "number") return json;
      return DEFAULT_RECEIVING_SOL;
    } catch (err) {
      // on error, return fallback
      return DEFAULT_RECEIVING_SOL;
    }
  }

  async function fetchAndSetBalanceForUrl(url: string) {
    const agent = agentByUrl(url);
    if (!agent) return;
    const sol = await fetchBalanceForAgent(agent);
    setBalances((s) => ({ ...s, [agent.url]: sol }));
  }

  // Main send flow: call send-request on sender, then poll the sender for a response written by receive-response
  async function handleSend() {
    if (!text.trim()) return;
    setSending(true);
    const localId = uuidv4();
    const outgoing: ChatMsg = {
      id: localId,
      fromUrl: fromAgentUrl,
      toUrl: toAgentUrl,
      text,
      ts: nowIso(),
      status: "sending",
    };
    pushMessage(outgoing);
    const payload = { receiverUrl: toAgentUrl, receiverSolPubkey: agentByUrl(toAgentUrl)?.keypairPath ?? "", amountSol: DEFAULT_RECEIVING_SOL, payload: { text } };
    setText("");

    try {
      const sendUrl = `${fromAgentUrl.replace(/\/$/, "")}/send-request`;
      const res = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const txt = await res.text();
      let parsed: any;
      try {
        parsed = JSON.parse(txt);
      } catch {
        parsed = txt;
      }

      // Update outgoing message status -> sent
      setMessages((m) =>
        m.map((msg) =>
          msg.id === localId ? { ...msg, status: "sent", meta: { proxied_status: res.status, proxied_body: parsed } } : msg
        )
      );

      const intentId: string | null =
        parsed && typeof parsed === "object" && (parsed.intent_id || parsed.intentId) ? parsed.intent_id || parsed.intentId : null;

      if (intentId) {
        // set to waiting while we poll for response
        setMessages((m) => m.map((msg) => (msg.id === localId ? { ...msg, status: "waiting" } : msg)));

        try {
          const rawPayload = await pollForResponse(fromAgentUrl, intentId, 30000, 700); // wait up to 30s
          const normalized = extractBestText(rawPayload);
          const incomingText = normalized.display;

          const incoming: ChatMsg = {
            id: uuidv4(),
            fromUrl: toAgentUrl,
            toUrl: fromAgentUrl,
            text: incomingText,
            ts: nowIso(),
            status: "received",
            meta: { intentId, raw: normalized.raw },
          };
          pushMessage(incoming);

          // refetch balance for the responder (the agent that produced the reply)
          void fetchAndSetBalanceForUrl(incoming.fromUrl);

          // set outgoing back to 'sent'
          setMessages((m) => m.map((msg) => (msg.id === localId ? { ...msg, status: "sent" } : msg)));
        } catch (err: any) {
          // timed out — show helpful message
          pushMessage({
            id: uuidv4(),
            fromUrl: "system",
            toUrl: fromAgentUrl,
            text: `No response available yet for intent ${intentId} (timeout).`,
            ts: nowIso(),
            status: "error",
            meta: { intentId },
          });

          // mark outgoing as error/waiting-failed
          setMessages((m) => m.map((msg) => (msg.id === localId ? { ...msg, status: "error" } : msg)));
        }
      } else {
        // fallback: use whatever was returned directly by send-request
        const normalized = extractBestText(parsed);
        pushMessage({
          id: uuidv4(),
          fromUrl: toAgentUrl,
          toUrl: fromAgentUrl,
          text: normalized.display,
          ts: nowIso(),
          status: "received",
          meta: { raw: normalized.raw },
        });

        // refetch balance for the responder (best-effort)
        void fetchAndSetBalanceForUrl(toAgentUrl);
      }
    } catch (err: any) {
      setMessages((m) => m.map((msg) => (msg.id === localId ? { ...msg, status: "error", meta: { error: String(err) } } : msg)));
      pushMessage({
        id: uuidv4(),
        fromUrl: "system",
        toUrl: fromAgentUrl,
        text: `Error sending: ${String(err.message || err)}`,
        ts: nowIso(),
        status: "error",
      });
    } finally {
      setSending(false);
    }
  }

  // Render bubble
  function renderBubble(m: ChatMsg) {
    if (m.fromUrl === "system") {
      return (
        <div key={m.id} style={{ textAlign: "center", color: "#666", margin: "12px 0" }}>
          <small>{m.text}</small>
        </div>
      );
    }
    const alignLeft = agentByUrl(m.fromUrl)?.side === "left";
    const container = { display: "flex", justifyContent: alignLeft ? "flex-start" : "flex-end", marginBottom: 8 };
    const bubble = {
      maxWidth: "72%",
      padding: "10px 14px",
      borderRadius: 12,
      background: "#111",
      color: "#fff",
      whiteSpace: "pre-wrap",
      fontFamily: "monospace",
      fontSize: 14,
      lineHeight: 1.35,
      position: "relative" as "relative",
    };
    const metaStyle = { fontSize: 11, color: "#999", marginTop: 6, textAlign: alignLeft ? "left" : "right" };

    const waitingIndicator = (
      <div
        style={{
          position: "absolute",
          right: alignLeft ? undefined : -36,
          left: alignLeft ? -36 : undefined,
          top: 8,
          width: 28,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            background: "#222",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
          }}
        >
          <LoadingDots />
        </div>
      </div>
    );

    return (
      <div key={m.id} style={container}>
        <div style={bubble}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{agentName(m.fromUrl)}</div>
          <div>
            {m.text}
            {m.status === "waiting" && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#999", display: "flex", alignItems: "center", gap: 8 }}>
                <span>Waiting for response</span>
                <LoadingDots />
              </div>
            )}
          </div>

          {m.status === "waiting" && waitingIndicator}

          <div style={metaStyle}>
            <span>{new Date(m.ts).toLocaleTimeString()}</span>
            {" • "}
            <em>{m.status}</em>
          </div>
        </div>
      </div>
    );
  }

  // helper to display balance tile
  function BalanceTile({ url }: { url: string }) {
    const agent = agentByUrl(url);
    const sol = balances[url] ?? DEFAULT_RECEIVING_SOL;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontWeight: 700 }}>{agent?.name}</div>
        <div style={{ fontFamily: "monospace", background: "#111", color: "#fff", padding: "6px 10px", borderRadius: 8 }}>
          {sol} SOL
        </div>
        <div style={{ fontSize: 12, color: "#666" }}>{agent?.keypairPath ? <small style={{ display: "block", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>{agent.keypairPath}</small> : null}</div>
        <button
          onClick={() => void fetchAndSetBalanceForUrl(url)}
          style={{ marginLeft: "auto", padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer" }}
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", padding: 20, boxSizing: "border-box" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>AI Agent Chat — Balances shown</div>
        <div style={{ fontSize: 13, color: "#666" }}>
          {agentName(fromAgentUrl)} → {agentName(toAgentUrl)}
        </div>
      </header>

      {/* Top balance row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ padding: 10, borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", flex: 1 }}>
          <BalanceTile url={AGENTS[0].url} />
        </div>
        <div style={{ padding: 10, borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", flex: 1 }}>
          <BalanceTile url={AGENTS[1].url} />
        </div>
      </div>

      <main style={{ flex: 1, display: "flex", gap: 20 }}>
        <section style={{ flex: 1, display: "flex", flexDirection: "column", borderRadius: 8, padding: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div ref={scrollRef} style={{ overflowY: "auto", padding: "6px 8px", flex: 1 }}>
            {messages.length === 0 && <div style={{ textAlign: "center", color: "#888", marginTop: 40 }}>No messages yet — send one.</div>}
            {messages.map((m) => renderBubble(m))}
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, color: "#444" }}>From</label>
              <select value={fromAgentUrl} onChange={(e) => setFromAgentUrl(e.target.value)} style={{ padding: "8px 10px", borderRadius: 6 }}>
                {AGENTS.map((a) => (
                  <option key={a.url} value={a.url}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, color: "#444" }}>To</label>
              <select value={toAgentUrl} onChange={(e) => setToAgentUrl(e.target.value)} style={{ padding: "8px 10px", borderRadius: 6 }}>
                {AGENTS.map((a) => (
                  <option key={a.url} value={a.url}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <label style={{ fontSize: 12, color: "#444" }}>Message</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder='Type "Hello" and press Enter'
                style={{ width: "100%", padding: 10, borderRadius: 8, resize: "none", fontFamily: "monospace" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <button onClick={() => void handleSend()} disabled={sending} style={{ padding: "10px 14px", borderRadius: 8, color: "#fff", background: "#111", border: "none", cursor: "pointer" }}>
                {sending ? "Sending…" : "Send"}
              </button>

              <button
                onClick={() => {
                  setMessages([]);
                }}
                style={{ marginTop: 8, padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer" }}
              >
                Clear
              </button>
            </div>
          </div>
        </section>

        <aside style={{ width: 320, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: 12, borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Agents</div>
            {AGENTS.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed #eee" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>{a.url}</div>
                </div>
                <div style={{ alignSelf: "center" }}>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(a.url);
                    }}
                    style={{ padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer" }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: 12, borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent activity</div>
            <div style={{ fontSize: 13, color: "#444" }}>
              {messages.slice().reverse().slice(0, 8).map((m) => (
                <div key={m.id} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: "#666" }}>{new Date(m.ts).toLocaleTimeString()} — <strong>{m.fromUrl === "system" ? "System" : agentName(m.fromUrl)}</strong></div>
                  <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>{m.text}</div>
                </div>
              ))}
              {messages.length === 0 && <div style={{ color: "#888" }}>No activity yet.</div>}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
