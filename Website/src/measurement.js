// One module per document. No visitor ID, storage, text or arbitrary properties.
(() => {
  const doc = document;
  if (location.hostname !== "arrivewithin.com" || doc.prerendering
      || doc.body?.dataset.siteMeasurement !== "allowed" || window.p0sMeasurementStarted) return;
  const allowed = () => navigator.doNotTrack !== "1" && window.doNotTrack !== "1"
    && !navigator.globalPrivacyControl && doc.body?.dataset.siteMeasurement === "allowed";
  if (!allowed()) return;
  window.p0sMeasurementStarted = true;
  let original = new URL(location.href);
  try {
    const navigation = new URL(performance.getEntriesByType("navigation")[0].name);
    if (navigation.origin === original.origin) original = navigation;
  } catch { /* Current document URL is the fallback without navigation timing. */ }
  const path = original.pathname, qa = original.searchParams.get("measurement_qa") === "1";
  const sent = new Set();
  let interacted = false, visibleMs = 0, timer;
  let visibleSince = doc.visibilityState === "visible" ? performance.now() : null;
  const elapsed = () => visibleMs + (visibleSince === null ? 0 : performance.now() - visibleSince);
  function send(name, action) {
    const key = action || name;
    if (!allowed() || sent.has(key)) return;
    sent.add(key);
    void fetch("/analytics/signal", {
      method: "POST", mode: "cors", credentials: "same-origin", keepalive: true,
      cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "x-analytics-signal": name, "x-analytics-path": path,
        ...(action ? { "x-analytics-action": action } : {}), ...(qa ? { "x-measurement-qa": "1" } : {}) },
    }).catch(() => {});
  }
  function stop() {
    clearTimeout(timer);
    for (const type of ["click", "keydown", "scroll"]) doc.removeEventListener(type, input);
    doc.removeEventListener("visibilitychange", visibility);
  }
  function check() {
    if (!allowed()) { stop(); return; }
    if (sent.has("engaged") || doc.visibilityState !== "visible") return;
    const remaining = 10000 - elapsed();
    if (remaining > 0) { clearTimeout(timer); timer = setTimeout(check, remaining); return; }
    send("visible");
    if (interacted) { send("engaged"); stop(); }
  }
  function input(event) {
    if (!event.isTrusted || doc.visibilityState !== "visible"
        || (event.type === "keydown" && ["Shift", "Control", "Alt", "Meta"].includes(event.key))) return;
    interacted = true; check();
  }
  function sourceLink(event) {
    if (!event.isTrusted || doc.visibilityState !== "visible") return;
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor) return;
    try {
      const target = new URL(anchor.href, original);
      if (target.href === "https://github.com/p0s/arrive-within") send("action", "source_repo_open");
    } catch { /* Invalid or unrelated links do not create actions. */ }
  }
  function visibility() {
    if (visibleSince !== null) visibleMs += performance.now() - visibleSince;
    visibleSince = doc.visibilityState === "visible" ? performance.now() : null;
    clearTimeout(timer); check();
  }
  for (const type of ["click", "keydown", "scroll"]) doc.addEventListener(type, input, { passive: true });
  doc.addEventListener("click", sourceLink, { passive: true });
  doc.addEventListener("visibilitychange", visibility);
  send("bootstrap"); check();
})();
