// Tests for explainStatus, validateRequest and authState (src/core.js). Run: node tools/tests/status.test.js
const assert = require("assert");
const { explainStatus, validateRequest, authState } = require("../../src/core.js");

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };
const now = new Date("2026-11-26T18:00:00Z");
const LAX = { id: "LAX", name: "Los Angeles Intl" }, HHR = { id: "HHR", name: "Jack Northrop Fld/Hawthorne Muni" };
const base = { controlled: true, classes: ["B"], airports: [LAX, HHR], ceil: { k: "ok", ft: 200, src: "live" }, groundFt: 77, now, left: 0, fails: [], cautions: [] };

// ---- explainStatus ----
t("HOLD (LAANC needed) names Class B, the airports, AGL and MSL, and the link", () => {
  const r = explainStatus({ ...base, ov: { k: "hold", t: "Hold", d: "Authorization is needed before launch. Enter the LAANC authorization number below." }, auth: { state: "none" } });
  assert.equal(r.status, "Hold");
  assert.match(r.action, /Enter the LAANC authorization number/);
  assert.match(r.why, /Class B airspace near Los Angeles International \(LAX\) and Jack Northrop Field\/Hawthorne Municipal \(HHR\)/);
  assert.match(r.why, /Class B is the controlled airspace around the busiest airports/);
  assert.match(r.why, /200 ft above the ground \(AGL\), which is 277 ft above sea level \(MSL\)/);
  assert.match(r.why, /Enter your LAANC authorization number to change this to GO/);
  assert.equal(r.learnMoreAnchor, "#sec-airspace");
  assert.doesNotMatch(r.why, /\b(cleared|authorized)\b/i); // only the conditional "Once LAANC approves you" is allowed
});
t("saved data adds the saved-data sentence; live does not", () => {
  const ov = { k: "hold", t: "Hold", d: "x" };
  const live = explainStatus({ ...base, ov, auth: { state: "none" } });
  const saved = explainStatus({ ...base, ov, auth: { state: "none" }, ceil: { k: "saved", ft: 200, src: "saved", eff: "10/29/2026" } });
  assert.doesNotMatch(live.why, /saved FAA data/);
  assert.match(saved.why, /This uses saved FAA data from 10\/29\/2026\. Confirm in your LAANC app before you fly\./);
});
t("missing values are left out, never shown blank", () => {
  const r = explainStatus({ ...base, airports: [], groundFt: null, ov: { k: "hold", t: "Hold", d: "x" }, auth: { state: "none" } });
  assert.doesNotMatch(r.why, /undefined|null|NaN|\{|near \./);
  assert.match(r.why, /200 ft above the ground \(AGL\) at this spot/);
  assert.doesNotMatch(r.why, /above sea level/);
});
t("expired authorization says when it expired", () => {
  const to = new Date("2026-11-26T17:00:00Z");
  const r = explainStatus({ ...base, ov: { k: "hold", t: "Hold", d: "x" }, auth: { state: "expired", num: "ABC123", to } });
  assert.match(r.why, /Your authorization expired at/);
});
t("GO with a valid authorization explains what is allowed and its limits", () => {
  const to = new Date("2026-11-26T20:00:00Z");
  const r = explainStatus({ ...base, ov: { k: "go", t: "Go", d: "All checks passed." }, auth: { state: "ok", num: "ABC123", alt: 150, to } });
  assert.match(r.why, /authorization ABC123 covers this flight\. Fly no higher than 150 ft AGL \(227 ft MSL\)/);
});
t("GO without authorization (Class G) never claims approval", () => {
  const r = explainStatus({ ...base, controlled: false, classes: [], ceil: { k: "ok", ft: 400, src: "live" }, ov: { k: "go", t: "Go", d: "x" }, auth: { state: "none" } });
  assert.match(r.why, /No FAA airspace permission is needed here/);
  assert.doesNotMatch(r.why, /approved|cleared|authorized/i);
});
t("NO-GO explains a TFR and a 0 ft grid in plain words", () => {
  const r = explainStatus({ ...base, ceil: { k: "zero", ft: 0, src: "live" }, ov: { k: "stop", t: "No-go", d: "2 blocking conditions." }, fails: [{ id: "tfr", label: "TFR", value: "Inside" }, { id: "ceil", label: "Maximum legal altitude", value: "0 ft" }] });
  assert.match(r.why, /temporary flight restriction \(TFR\)/);
  assert.match(r.why, /LAANC grid is 0 ft here near Los Angeles International \(LAX\)/);
});
t("Incomplete and Go with cautions both give a why line", () => {
  assert.match(explainStatus({ ...base, left: 3, ov: { k: "info", t: "Incomplete", d: "x" }, auth: { state: "none" } }).why, /3 pilot confirmations/);
  assert.match(explainStatus({ ...base, ov: { k: "warn", t: "Go with cautions", d: "x" }, cautions: [{ label: "Wind", value: "15 kt" }], auth: { state: "none" } }).why, /wind \(15 kt\)/);
});

// ---- validateRequest ----
const ctx = { pilot: "Sample Pilot", cert: "1234567", certDate: "2026-01-02", model: "Quad", reg: "FA3TEST", ridType: "std", lat: 33.9, lon: -118.3, groundFt: 77, classes: ["B"], ceil: { k: "ok", ft: 200, src: "live" }, wxOk: true, now };
const req = { start: new Date(now.getTime() + 10 * 60000), durMin: 60, alt: 200, purpose: "Roof inspection", phone: "310 555 0100" };
t("a complete request at the ceiling is OK", () => { const v = validateRequest(req, ctx); assert.ok(v.ok, JSON.stringify(v)); assert.equal(v.fc, false); });
t("above the ceiling becomes Further Coordination (LAANC file), not instant, with the 48 h warning", () => {
  const v = validateRequest({ ...req, alt: 300 }, ctx);
  assert.ok(v.fc); assert.ok(v.ok);
  assert.ok(v.warnings.some(w => /Further Coordination request/.test(w) && /not instant/.test(w)));
  assert.ok(v.warnings.some(w => /48 hours/.test(w)));
});
t("0 ft grid: only Further Coordination applies", () => { const v = validateRequest({ ...req, alt: 100 }, { ...ctx, ceil: { k: "zero", ft: 0, src: "live" } }); assert.ok(v.fc); assert.ok(v.warnings.some(w => /only a Further Coordination request applies/.test(w))); });
t("over 400 ft is an error", () => { assert.ok(validateRequest({ ...req, alt: 450 }, ctx).errors.some(e => /400 ft/.test(e))); });
t("past start and more than 90 days ahead are errors", () => {
  assert.ok(validateRequest({ ...req, start: new Date(now.getTime() - 3600000) }, ctx).errors.some(e => /in the past/.test(e)));
  assert.ok(validateRequest({ ...req, start: new Date(now.getTime() + 91 * 86400000) }, ctx).errors.some(e => /90 days/.test(e)));
});
t("missing auto-filled fields are named with where to fix them", () => {
  const v = validateRequest(req, { ...ctx, pilot: "Sample", reg: "", groundFt: null });
  assert.equal(v.ok, false);
  const names = v.missing.map(m => m.field);
  assert.ok(names.includes("Pilot first and last name") && names.includes("FAA registration number") && names.includes("Ground elevation"));
});
t("saved ceiling adds the confirm-in-your-LAANC-app notice", () => { assert.ok(validateRequest(req, { ...ctx, ceil: { k: "saved", ft: 200, src: "saved", eff: "10/29/2026" } }).warnings.some(w => /saved FAA data/.test(w))); });
t("no grid in controlled airspace points to DroneZone", () => { assert.ok(validateRequest(req, { ...ctx, ceil: { k: "nogrid", ft: null } }).warnings.some(w => /DroneZone/.test(w))); });

// ---- authState ----
const a = { num: "ABC1234", alt: 200, from: new Date(now.getTime() - 3600000), to: new Date(now.getTime() + 3 * 3600000) };
t("authorization covering time and altitude is ok", () => assert.equal(authState(a, req, now).state, "ok"));
t("number without altitude/window is incomplete", () => assert.equal(authState({ num: "ABC1234" }, req, now).state, "incomplete"));
t("expired window", () => assert.equal(authState({ ...a, to: new Date(now.getTime() - 60000) }, req, now).state, "expired"));
t("window that doesn't cover the planned flight", () => assert.equal(authState(a, { ...req, start: new Date(now.getTime() + 2.5 * 3600000), durMin: 60 }, now).state, "window"));
t("approved altitude below planned", () => assert.equal(authState({ ...a, alt: 100 }, req, now).state, "low"));
t("no number = none", () => assert.equal(authState({ num: "" }, req, now).state, "none"));
t("airport names: abbreviations expanded, bracketed alternate name dropped", () => {
  const r = explainStatus({ ...base, airports: [{ id: "HHR", name: "Hawthorne Municipal (Jack Northrop Fld)" }], ov: { k: "hold", t: "Hold", d: "x" }, auth: { state: "none" } });
  assert.match(r.why, /near Hawthorne Municipal \(HHR\)\./);
});
t("classes listed in order; rough-circle estimate is labelled", () => {
  const r = explainStatus({ ...base, classes: ["D", "B"], approx: true, ov: { k: "hold", t: "Hold", d: "x" }, auth: { state: "none" } });
  assert.match(r.why, /rough airport circles \(the FAA airspace data didn't load\) put you in Class B and D airspace/);
});
t("cautions are explained in plain words, not raw values", () => {
  const r = explainStatus({ ...base, ov: { k: "warn", t: "Go with cautions", d: "x" }, cautions: [{ id: "gps", label: "Position", value: "33.9020, -118.3670" }, { id: "notam", label: "NOTAMs", value: "Not checked" }, { id: "sun", label: "Daylight", value: "Night" }], auth: { state: "none" } });
  assert.match(r.why, /not read from GPS; NOTAMs aren't checked by SkyClear, so check them yourself; it's dark/);
  assert.doesNotMatch(r.why, /33\.9020/);
});
t("sunTimes: afternoon in Los Angeles is daytime (old bug: jumped to tomorrow)", () => {
  const { sunTimes } = require("../../src/core.js");
  const now = new Date("2026-11-26T14:55:00-08:00"), s = sunTimes(33.902, -118.367, now);
  assert.ok(now >= s.sunrise && now <= s.sunset, s.sunrise.toISOString() + " " + s.sunset.toISOString());
});
// ---- Pilot tab: hash routing, badge/missing logic, fixLink ----
const { parseHash, tabHash, pilotIssues } = require("../../src/core.js");
t("hash routing: tabs, sections, old links and unknowns", () => {
  assert.deepEqual(parseHash("#pilot"), { tab: "pilot", section: null });
  assert.deepEqual(parseHash("#pilot:laanc"), { tab: "pilot", section: "laanc" });
  assert.deepEqual(parseHash("#laanc"), { tab: "pilot", section: "laanc" });
  assert.deepEqual(parseHash("#flight"), { tab: "pre", section: null });
  assert.deepEqual(parseHash("#preflight"), { tab: "pre", section: null });
  assert.deepEqual(parseHash(""), { tab: "pre", section: null });
  assert.deepEqual(parseHash("#resources"), { tab: "res", section: null });
  assert.deepEqual(parseHash("#pilot:nonsense"), { tab: "pilot", section: null });
  assert.deepEqual(parseHash("#garbage"), { tab: "pre", section: null });
  assert.equal(tabHash("pilot", "rid"), "#pilot:rid");
  assert.equal(tabHash("pre"), "#preflight");
});
const full = { pilot: "Sample Pilot", cert: "1234567", model: "Quad", reg: "FA3TEST", ridType: "std", ridId: "RID1" };
t("pilot issues: complete profile and no LAANC need = no dot", () => assert.deepEqual(pilotIssues(full, { needed: false }), []));
t("pilot issues: each missing item has a plain reason and its section", () => {
  const r = pilotIssues({ ...full, cert: "", reg: "", ridId: "" }, { needed: true, done: false });
  assert.deepEqual(r.map(x => x.id), ["cert", "reg", "rid", "laanc"]);
  assert.equal(r.find(x => x.id === "rid").msg, "Remote ID is missing.");
  assert.equal(r.find(x => x.id === "laanc").section, "laanc");
});
t("pilot issues: FRIA needs no Remote ID serial; finished LAANC request is fine", () => {
  assert.deepEqual(pilotIssues({ ...full, ridType: "fria", ridId: "" }, { needed: true, done: true }), []);
});
t("fixLink: HOLD for LAANC goes to the LAANC request", () => {
  const r = explainStatus({ ...base, ov: { k: "hold", t: "Hold", d: "x" }, auth: { state: "none" } });
  assert.deepEqual(r.fixLink, { label: "Go to LAANC request", tab: "pilot", section: "laanc" });
});
t("fixLink: missing certificate, then registration, then Remote ID, with a why sentence", () => {
  const ov = { k: "info", t: "Incomplete", d: "x" };
  let r = explainStatus({ ...base, left: 1, ov, auth: { state: "none" }, missing: { cert: true, reg: true, rid: true } });
  assert.deepEqual(r.fixLink, { label: "Add your pilot certificate", tab: "pilot", section: "pilot" });
  assert.match(r.why, /pilot certificate number is missing\. Add it on the Pilot & LAANC tab/);
  r = explainStatus({ ...base, left: 1, ov, auth: { state: "none" }, missing: { reg: true, rid: true } });
  assert.equal(r.fixLink.section, "aircraft");
  r = explainStatus({ ...base, left: 1, ov, auth: { state: "none" }, missing: { rid: true } });
  assert.deepEqual(r.fixLink, { label: "Add your Remote ID", tab: "pilot", section: "rid" });
  assert.deepEqual(explainStatus({ ...base, left: 1, ov, auth: { state: "none" }, missing: {} }).fixLink, { label: "Finish the pre-flight checklist", tab: "pilot", section: "checklist" });
  assert.equal(explainStatus({ ...base, left: 0, ov: { k: "go", t: "Go", d: "x" }, auth: { state: "none" }, missing: {} }).fixLink, null);
});
t("fixLink: none on NO-GO (the blocking reason comes first)", () => {
  assert.equal(explainStatus({ ...base, ov: { k: "stop", t: "No-go", d: "x" }, fails: [{ id: "tfr", label: "TFR", value: "Inside" }], missing: { cert: true } }).fixLink, null);
});
t("banner names a TFR within 5 miles; not when it is already the NO-GO reason", () => {
  const near = { name: "2026 Disneyland", mi: 1.49, inside: false };
  const r = explainStatus({ ...base, ov: { k: "hold", t: "Hold", d: "x" }, auth: { state: "none" }, tfrNear: near });
  assert.match(r.why, /A temporary flight restriction \(TFR\), 2026 Disneyland, is 1\.49 miles away\. Stay out of it\./);
  const go = explainStatus({ ...base, controlled: false, ov: { k: "warn", t: "Go with cautions", d: "x" }, cautions: [], auth: { state: "none" }, tfrNear: near });
  assert.match(go.why, /1\.49 miles away/);
  const stop = explainStatus({ ...base, ov: { k: "stop", t: "No-go", d: "x" }, fails: [{ id: "tfr", label: "TFR", value: "Inside" }], tfrNear: near });
  assert.doesNotMatch(stop.why, /miles away/);
  assert.equal(explainStatus({ ...base, ov: { k: "hold", t: "Hold", d: "x" }, auth: { state: "none" } }).why.includes("TFR"), false);
});
t("banner says when TFR data is stale, failed to refresh, or could not be checked", () => {
  const h = (ts) => explainStatus({ ...base, ov: { k: "hold", t: "Hold", d: "x" }, auth: { state: "none" }, tfrStale: ts }).why;
  assert.match(h({ min: 21, failed: false }), /TFR data is 21 min old\. Check tfr\.faa\.gov before flying\./);
  assert.match(h({ min: 3, failed: true }), /last FAA TFR update failed/);
  assert.match(h({ notChecked: true }), /TFRs could not be checked/);
  assert.doesNotMatch(h(null), /tfr\.faa\.gov before flying/);
});
t("checklist is a Pilot tab section in routing", () => assert.deepEqual(parseHash("#pilot:checklist"), { tab: "pilot", section: "checklist" }));
t("no two top-level functions in the app share a name (the clash that emptied the Requirements tab)", () => {
  const fs = require("fs"), path = require("path");
  const src = ["core.js", "ui.js"].map(f => fs.readFileSync(path.join(__dirname, "../../src", f), "utf8")).join("\n");
  const names = [...src.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map(m => m[1]);
  const dup = names.filter((x, i) => names.indexOf(x) !== i);
  assert.deepEqual(dup, [], "duplicate function names: " + dup.join(", "));
});
console.log("\n" + n + " tests passed");
