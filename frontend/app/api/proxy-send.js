// pages/api/proxy-send.js
// Proxy endpoint that forwards a "send-request" to a sender agent.
// Expects POST body: { fromAgentUrl, receiverUrl, payload }

function normalizeAgentUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  // If user passed something like "localhost:3001" make it a full URL
  if (!/^https?:\/\//i.test(raw)) raw = "http://" + raw;
  try {
    const u = new URL(raw);
    return u.origin; // strip path, use origin only
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { fromAgentUrl, receiverUrl, payload } = req.body ?? {};

    if (!fromAgentUrl || !receiverUrl || payload === undefined) {
      return res.status(400).json({ error: "fromAgentUrl, receiverUrl and payload required" });
    }

    const senderOrigin = normalizeAgentUrl(fromAgentUrl);
    if (!senderOrigin) return res.status(400).json({ error: "Invalid fromAgentUrl" });

    // receiverUrl could be an origin or a full url; try to normalize similarly
    const receiverOrigin = normalizeAgentUrl(receiverUrl) || receiverUrl;

    const body = { receiverUrl: receiverOrigin, payload };

    const agentSendUrl = `${senderOrigin}/send-request`;

    // Forward the POST to the agent's /send-request
    const agentResponse = await fetch(agentSendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(err => ({ __fetchError: err }));

    if (agentResponse && agentResponse.__fetchError) {
      console.error("proxy-send fetch error:", agentResponse.__fetchError);
      return res.status(502).json({ error: "Failed to reach agent", details: String(agentResponse.__fetchError) });
    }

    const status = agentResponse.status;
    const text = await agentResponse.text();

    // Try to parse JSON; fallback to raw text
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parsed = text;
    }

    // Return the upstream status and body so UI can show it
    return res.status(200).json({ proxied_status: status, proxied_body: parsed });
  } catch (err) {
    console.error("proxy-send error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}
