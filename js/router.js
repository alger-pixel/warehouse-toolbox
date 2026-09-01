(function (window) {
  "use strict";
  let onChange = function () {};
  function parse(hash) {
    const value = String(hash || "").replace(/^#/, "");
    if (value.startsWith("tool/")) return { view: "tool", toolId: value.slice(5) };
    return { view: ["dashboard", "tools", "settings"].includes(value) ? value : "dashboard" };
  }
  function current() { return parse(window.location.hash); }
  function navigate(route) {
    const hash = route.view === "tool" ? `#tool/${route.toolId}` : `#${route.view}`;
    if (window.location.hash === hash) onChange(current()); else window.location.hash = hash;
  }
  window.addEventListener("hashchange", () => onChange(current()));
  window.MkiteRouter = { start(callback) { onChange = callback; callback(current()); }, navigate, current };
}(window));
