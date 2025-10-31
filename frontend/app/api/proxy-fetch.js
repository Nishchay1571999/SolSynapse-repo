// pages/api/proxy-fetch.js
// Proxy endpoint to fetch /intents and /logs from a given agent.
// Called as: GET /api/proxy-fetch?agentUrl=http://localhost:3001

function normalizeAgentUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  if (!/^https?:\/\//i.test(raw)) raw = "http://" + raw;
  try {
    const u = new URL(raw);
    return u.origin;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    const raw = (req.query.agentUrl || "").toString();
    if (!raw) return res.status(400).json({ error: "agentUrl query parameter required" });

    const base = normalizeAgentUrl(raw);
    if (!base) return res.status(400).json({ error: "Invalid agentUrl" });

    // Fire both requests in parallel and handle network errors gracefully
    const intentsPromise = fetch(`${base}/intents`).catch(e => ({ ok: false, __error: e }));
    const logsPromise = fetch(`${base}/logs`).catch(e => ({ ok: false, __error: e }));

    const [intentsResp, logsResp] = await Promise.all([intentsPromise, logsPromise]);

    const results = {};

    // handle intentsResp
    if (intentsResp && intentsResp.__error) {
      console.error("proxy-fetch intents fetch error:", intentsResp.__error);
      results.intents = { error: "Network error", details: String(intentsResp.__error) };
    } else if (intentsResp && intentsResp.ok) {
      try {
        results.intents = await intentsResp.json();
      } catch (e) {
        results.intents = { error: "Failed to parse intents response", details: await intentsResp.text().catch(() => String(e)) };
      }
    } else {
      const st = intentsResp?.status ?? "unknown";
      const body = intentsResp ? await intentsResp.text().catch(() => "<no body>") : "<no response object>";
      results.intents = { error: `Upstream returned status ${st}`, body };
    }

    // handle logsResp
    if (logsResp && logsResp.__error) {
      console.error("proxy-fetch logs fetch error:", logsResp.__error);
      results.logs = { error: "Network error", details: String(logsResp.__error) };
    } else if (logsResp && logsResp.ok) {
      try {
        results.logs = await logsResp.json();
      } catch (e) {
        results.logs = { error: "Failed to parse logs response", details: await logsResp.text().catch(() => String(e)) };
      }
    } else {
      const st = logsResp?.status ?? "unknown";
      const body = logsResp ? await logsResp.text().catch(() => "<no body>") : "<no response object>";
      results.logs = { error: `Upstream returned status ${st}`, body };
    }

    return res.status(200).json(results);
  } catch (err) {
    console.error("proxy-fetch error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}
