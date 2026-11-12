/* ================================================================== wiring and start-up */
const scheduleCompare = debounce(() => renderCompare(), 500);
function onBuildChanged() {
  recompute(); syncRail(); renderBench(); Scene.rebuild(); renderCoverage(); renderShot(); schedulePerf(); scheduleCompare();
  if (S.libTab !== "threat") renderLibGrid();
  if (!TRADE.running) updateTradeCount();
  persist();
}
function onShotChanged(rebuildScene) {
  if (rebuildScene) Scene.rebuild(); else Scene.buildTrail();
  renderShot(); renderCoverage(); persist();
}
function onScenChanged() {
  recompute(); syncScenRail(); renderBench(); renderCoverage(); renderShot(); schedulePerf(); scheduleCompare();
  if (!TRADE.running) updateTradeCount();
  persist();
}
function onLibraryChanged() {
  rebuildLibrary(); cmpCache.clear(); recompute();
  renderRail(); syncShotRail(); syncScenRail(); renderTradeRail(); renderLibrary();
  onBuildChanged();
}

rebuildLibrary(); recompute();
renderRail(); wireRail();
renderShotRail(); syncShotRail();
renderScenRail(); syncScenRail(); wirePerfTable();
wireCoverage(); wireCompare();
renderTradeRail(); wireTradeRail(); wireTradeOutput();
initLibrary(); renderLibrary(); initVerify();

$("btnFire").addEventListener("click", () => { renderShot(); Scene.play(); });
$("btnFov").addEventListener("click", (e) => { const on = Scene.toggleFov(); e.currentTarget.textContent = on ? "Hide fields of view" : "Show fields of view"; e.currentTarget.setAttribute("aria-pressed", String(on)); });
$("btnView").addEventListener("click", (e) => { e.currentTarget.textContent = Scene.toggleView() ? "Orbit view" : "Top view"; });
$("btnResetBuild").addEventListener("click", () => { S.build = clone(CAT.DEFAULT_BUILD); onBuildChanged(); });

function onTheme() { Scene.applyTheme(); renderCoverage(); }
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onTheme);
new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
new ResizeObserver(debounce(renderCoverage, 80)).observe($("covCanvas").parentElement);

Scene.applyTheme();
renderBench(); renderCoverage(); renderShot(); renderPerf(); drawTrade();
setTimeout(renderCompare, 50);
