(function (window) {
  "use strict";
  let onChange = function () {};
  function parse(hash) {
    const value = String(hash || "").replace(/^#/, "");
    const inHouseToolMatch = value.match(/^in-house-tool\/([^/]+)$/);
    if (inHouseToolMatch) return { view: "in-house-tool", toolId: inHouseToolMatch[1] };
    const clientToolMatch = value.match(/^client\/([^/]+)\/tool\/([^/]+)$/);
    if (clientToolMatch) return { view: "client-tool", clientId: clientToolMatch[1], toolId: clientToolMatch[2] };
    const clientMatch = value.match(/^client\/([^/]+)$/);
    if (clientMatch) return { view: "client", clientId: clientMatch[1] };
    if (value.startsWith("tool/")) return { view: "tool", toolId: value.slice(5) };
    return { view: ["dashboard", "tools", "client-tools", "in-house-tools", "settings"].includes(value) ? value : "dashboard" };
  }
  function current() { return parse(window.location.hash); }
  function navigate(route) {
    let hash;
    if (route.view === "in-house-tool") hash = `#in-house-tool/${route.toolId}`;
    else if (route.view === "client-tool") hash = `#client/${route.clientId}/tool/${route.toolId}`;
    else if (route.view === "client") hash = `#client/${route.clientId}`;
    else hash = route.view === "tool" ? `#tool/${route.toolId}` : `#${route.view}`;
    if (window.location.hash === hash) onChange(current()); else window.location.hash = hash;
  }
  window.addEventListener("hashchange", () => onChange(current()));
  window.MkiteRouter = { start(callback) { onChange = callback; callback(current()); }, navigate, current };
}(window));
