// FAA tfr.faa.gov adapter (unofficial endpoints: no key, no SLA, may change). Swap this file for another
// source (NASA NOTAMs API, FAA NMS/SWIM) that returns the same shapes; store.js and check.js stay as they are.
// Polite: identifying User-Agent, 10 s timeouts, one list fetch per refresh, few detail fetches at a time,
// back off on 429 / 5xx.
const { parseList, parseShapes, parseDetail, detailFile } = require("./parse");

const VERSION = "1.0";
const UA = "SkyClear/" + VERSION + " (drone pre-flight app; https://skyclear-preflight.vercel.app; supportprojectsai@gmail.com)";
const BASE = "https://tfr.faa.gov";
const LIST_URL = BASE + "/tfrapi/exportTfrList";
const SHAPES_URL = BASE + "/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json";
const detailUrl = (notamId) => BASE + "/download/" + detailFile(notamId);
const pageUrl = (notamId) => BASE + "/tfr3/?page=" + detailFile(notamId).replace(/\.xml$/, "");

let backoffUntil = 0, backoffMs = 0;
class FaaError extends Error {}
async function get(url, type) {
  if (Date.now() < backoffUntil) throw new FaaError("backing off after an FAA error (retry in " + Math.ceil((backoffUntil - Date.now()) / 1000) + " s)");
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: type === "text" ? "application/xml,text/xml" : "application/json" }, signal: ctl.signal });
    if (r.status === 429 || r.status >= 500) {
      backoffMs = Math.min(backoffMs ? backoffMs * 2 : 30000, 600000); backoffUntil = Date.now() + backoffMs;
      throw new FaaError("FAA TFR server HTTP " + r.status);
    }
    if (!r.ok) throw new FaaError("FAA TFR server HTTP " + r.status);
    backoffMs = 0;
    return type === "text" ? await r.text() : await r.json();
  } catch (e) {
    if (e && e.name === "AbortError") throw new FaaError("FAA TFR server timed out");
    throw e;
  } finally { clearTimeout(t); }
}
async function fetchList() { return parseList(await get(LIST_URL)); }
async function fetchShapes() { return parseShapes(await get(SHAPES_URL)); }
async function fetchDetail(notamId) { return parseDetail(await get(detailUrl(notamId), "text")); }
// run fn over items with at most `n` at a time
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })); } }));
  return out;
}
module.exports = { fetchList, fetchShapes, fetchDetail, detailUrl, pageUrl, pool, UA, FaaError };
