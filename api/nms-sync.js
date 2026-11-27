// POST /api/nms-sync   Called on a schedule by Upstash QStash (every 3 min). Pulls from the FAA NOTAM Management
// Service into SkyClear's store (api/_nms/store.js). Only requests signed by QStash are accepted: the
// Upstash-Signature JWT (HS256) is checked against QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY, and
// its body hash must match. The store also enforces the FAA rate limit, so extra calls are skipped.
const crypto = require("crypto");
const { makeSource, config } = require("./_nms/source");
const { makeKv, sync, status } = require("./_nms/store");

const b64u = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function verify(jwt, body, keys, nowS = Math.floor(Date.now() / 1000)) {
  const parts = String(jwt || "").split(".");
  if (parts.length !== 3) return false;
  for (const k of keys.filter(Boolean)) {
    const sig = b64u(crypto.createHmac("sha256", k).update(parts[0] + "." + parts[1]).digest());
    if (sig.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(parts[2]))) continue;
    let c; try { c = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch { return false; }
    if (c.iss !== "Upstash") return false;
    if (c.exp && nowS > c.exp + 30) return false;
    if (c.nbf && nowS < c.nbf - 30) return false;
    const want = b64u(crypto.createHash("sha256").update(body || "").digest());
    return String(c.body || "").replace(/=+$/, "") === want;
  }
  return false;
}
async function rawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  return await new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => ok(d)); req.on("error", () => ok("")); });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = await rawBody(req);
  const keys = [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY];
  if (!keys.some(Boolean)) return res.status(503).json({ error: "sync is not configured" });
  if (!verify(req.headers["upstash-signature"], body, keys)) return res.status(401).json({ error: "bad signature" });
  let source;
  try { source = makeSource(config()); } catch (e) { return res.status(503).json({ error: e.message }); }
  const { state, skipped } = await sync(makeKv(), source);
  const s = status(state);
  // 200 even on an NMS error, so QStash doesn't retry-storm the FAA; the error is stored and shown as stale.
  res.status(200).json({ env: state.env, skipped: skipped || null, ...s, counts: state.counts });
};
module.exports.verify = verify;
