// Last good TFR dataset, kept in this function instance's memory (no database: Ky chose "no storage for
// now", 2026-11-26). Vercel's edge cache in front of /api/tfr also spreads one fetch across many users.
// Rules from the brief: refresh at most every REFRESH_MS; on failure keep serving the last good copy and
// flag stale; never let an error or a suspicious response (empty, or a sudden >50% drop) look like
// "no TFRs"; fetch detail XML only for new or changed TFRs; drop TFRs no longer on the list.
const REFRESH_MS = 5 * 60 * 1000;
const state = { list: null, shapes: null, fetchedAt: 0, lastTryAt: 0, error: null, details: new Map(), lastCount: null };

function makeStore(source, now = () => Date.now()) {
  async function refresh() {
    state.lastTryAt = now();
    try {
      const [list, shapes] = await Promise.all([source.fetchList(), source.fetchShapes()]);
      console.log("[tfr] list count", list.length, "shapes", shapes.features.length);
      if (!list.length) throw new Error("the FAA TFR list came back empty");
      if (state.lastCount && list.length < state.lastCount * 0.5) throw new Error("the FAA TFR list dropped from " + state.lastCount + " to " + list.length + " (more than half); treating it as a bad response");
      const ids = new Set(list.map((x) => x.notam_id));
      for (const k of [...state.details.keys()]) if (!ids.has(k)) state.details.delete(k); // expired / removed
      state.list = list; state.shapes = shapes; state.fetchedAt = now(); state.error = null; state.lastCount = list.length;
    } catch (e) {
      state.error = String((e && e.message) || e).slice(0, 200);
      console.warn("[tfr] refresh failed:", state.error);
    }
  }
  // detail for one TFR, cached until its list entry changes (creation_date)
  async function detailFor(item) {
    const c = state.details.get(item.notam_id);
    if (c && c.version === item.creation_date) return c;
    const out = { version: item.creation_date, detail: null, error: null };
    try { out.detail = await source.fetchDetail(item.notam_id); } catch (e) { out.error = String((e && e.message) || e).slice(0, 160); }
    if (out.detail || !c) state.details.set(item.notam_id, out);
    return out.detail ? out : c && c.detail ? c : out;
  }
  async function dataset() {
    if (!state.list || now() - state.fetchedAt > REFRESH_MS) {
      if (now() - state.lastTryAt > 20000 || !state.list) await refresh(); // don't hammer the FAA after a failure
    }
    return { list: state.list, shapes: state.shapes, fetchedAt: state.fetchedAt || null, error: state.error,
      stale: !state.list || !!state.error || now() - state.fetchedAt > 15 * 60 * 1000 };
  }
  return { dataset, detailFor, refresh, _state: state };
}
function resetForTests() { state.list = null; state.shapes = null; state.fetchedAt = 0; state.lastTryAt = 0; state.error = null; state.details = new Map(); state.lastCount = null; }
module.exports = { makeStore, resetForTests, REFRESH_MS };
