(function (window) {
  "use strict";
  let onChange = function () {}, beforeChange = () => true, acceptedHash = window.location.hash;
  function dispatch() { if (!beforeChange()) { window.history.replaceState(null, "", acceptedHash || "#dashboard"); return; } acceptedHash=window.location.hash; onChange(current()); }
  function parse(hash) {
    const value = String(hash || "").replace(/^#/, "");
    const projectMatch=value.match(/^projects\/project\/([^/]+)$/);
    if(projectMatch){try{return {view:"projects/project",projectId:decodeURIComponent(projectMatch[1])};}catch{return {view:"projects"};}}
    if (value === "projects/create-report") return { view: "projects/create-report" };
    if (value === "cases") return { view: "cases" };
    if (value === "cases/create") return { view: "cases/create" };
    if (value === "cases/report") return { view: "cases/report" };
    if (value === "cases/search") return { view: "cases/search" };
    const caseViewMatch=value.match(/^cases\/view\/([^/]+)$/);
    if(caseViewMatch){try{return {view:"cases/view",caseId:decodeURIComponent(caseViewMatch[1])};}catch{return {view:"cases/search"};}}
    if (value === "settings/users") return { view: "settings/users" };
    if (value === "settings/case-categories") return { view: "settings/case-categories" };
    const inHouseToolMatch = value.match(/^in-house-tool\/([^/]+)$/);
    if (inHouseToolMatch) return { view: "in-house-tool", toolId: inHouseToolMatch[1] };
    const warehouseToolMatch = value.match(/^client\/([^/]+)\/([^/]+)\/tool\/([^/]+)$/);
    if (warehouseToolMatch) return { view: "client-tool", warehouse: warehouseToolMatch[1], clientId: warehouseToolMatch[2], toolId: warehouseToolMatch[3] };
    const clientToolMatch = value.match(/^client\/([^/]+)\/tool\/([^/]+)$/);
    if (clientToolMatch) return { view: "client-tool", clientId: clientToolMatch[1], toolId: clientToolMatch[2] };
    const clientMatch = value.match(/^client\/([^/]+)$/);
    if (clientMatch) return { view: "client", clientId: clientMatch[1] };
    if (value.startsWith("tool/")) return { view: "tool", toolId: value.slice(5) };
    return { view: ["operating-dashboard", "dashboard", "projects", "tools", "client-tools", "in-house-tools", "settings"].includes(value) ? value : "operating-dashboard" };
  }
  function current() { return parse(window.location.hash); }
  function navigate(route) {
    let hash;
    if (route.view === "projects/project") hash = `#projects/project/${encodeURIComponent(route.projectId)}`;
    else if (route.view === "cases/view") hash = `#cases/view/${encodeURIComponent(route.caseId)}`;
    else if (route.view === "in-house-tool") hash = `#in-house-tool/${route.toolId}`;
    else if (route.view === "client-tool") hash = route.warehouse ? `#client/${route.warehouse}/${route.clientId}/tool/${route.toolId}` : `#client/${route.clientId}/tool/${route.toolId}`;
    else if (route.view === "client") hash = `#client/${route.clientId}`;
    else hash = route.view === "tool" ? `#tool/${route.toolId}` : `#${route.view}`;
    if (window.location.hash === hash) dispatch(); else window.location.hash = hash;
  }
  window.addEventListener("hashchange", dispatch);
  window.MkiteRouter = { start(callback) { onChange = callback; callback(current()); }, navigate, current, beforeChange(callback) { beforeChange=callback; } };
}(window));
