(function (window, document) {
  "use strict";
  /*
   * Shared application components remain independent from individual warehouse
   * tool business logic. Tool modules use the services exposed by this shell.
   */
  const appShell = document.getElementById("app-shell");
  const mainContent = document.getElementById("main-content");
  const sectionTitle = document.getElementById("section-title");
  const themeToggle = document.getElementById("theme-toggle");
  const collapseButton = document.getElementById("collapse-button");
  const menuButton = document.getElementById("menu-button");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  let activeToolModule = null;

  const icons = {
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
    match: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7h11M5 7h.01M8 12h11M5 12h.01M8 17h11M5 17h.01"/></svg>',
    sort: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11M4 12h8M4 17h5M18 5v14m0 0-3-3m3 3 3-3"/></svg>',
    count: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5zM8 9h8M8 13h5"/></svg>',
    data: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/><circle cx="7" cy="6" r="1"/></svg>',
    calculator: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2m4 0h2m-8 4h2m4 0h2"/></svg>',
    warehouse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V8l9-5 9 5v13M7 21v-8h10v8"/></svg>'
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function pageHeader(title, description) {
    return `<div class="page-header"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></div>`;
  }

  function getSettings() {
    const stored = window.MkiteStorage.get("settings", null);
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : { theme: "dark", sidebarCollapsed: false };
  }

  function toolCard(tool, variant) {
    const active = tool.status === "active";
    const variantClass = variant ? ` ${variant}` : "";
    return `<button class="tool-card${variantClass}" type="button" data-tool-id="${escapeHtml(tool.id)}" data-tool-theme="${escapeHtml(tool.theme || tool.id)}" aria-label="${escapeHtml(tool.name)}${active ? "" : ", coming soon"}"${active ? "" : " disabled"}>
      <span class="tool-icon">${icons[tool.icon] || icons.warehouse}</span>
      ${active ? "" : '<span class="badge badge-muted tool-status">Coming Soon</span>'}
      <span class="tool-copy"><h4>${escapeHtml(tool.name)}</h4><p>${escapeHtml(tool.description)}</p></span><span class="tool-arrow">${icons.arrow}</span>
    </button>`;
  }

  function searchView(options) {
    const tools = options.tools;
    mainContent.innerHTML = `<div class="library-view">${pageHeader(options.title, options.description)}
      <div class="search-hero"><div class="search-field">${icons.search}<label class="sr-only" for="tool-search">Search tools</label><input id="tool-search" type="search" placeholder="Search tools..." autocomplete="off"><button class="icon-button search-clear" id="search-clear" type="button" aria-label="Clear search">×</button></div></div>
      <div class="section-header"><h3>${escapeHtml(options.sectionTitle)}</h3><span id="search-count"></span></div><div class="tool-grid" id="tool-grid"></div></div>`;
    const input = document.getElementById("tool-search"); const clear = document.getElementById("search-clear"); const grid = document.getElementById("tool-grid"); const count = document.getElementById("search-count");
    function update() {
      const query = input.value.trim();
      const matches = query ? window.MkiteToolRegistry.search(query).filter((item) => options.includeAll || item.status === "active") : tools;
      clear.classList.toggle("is-visible", Boolean(query)); count.textContent = `${matches.length} ${matches.length === 1 ? "tool" : "tools"}`;
      grid.innerHTML = matches.length ? matches.map(toolCard).join("") : `<div class="empty-state">${icons.search}<h3>No tools found</h3><p>Try another name or category.</p></div>`;
    }
    input.addEventListener("input", update); clear.addEventListener("click", () => { input.value = ""; update(); input.focus(); }); update();
  }

  function renderDashboard() {
    const allTools = window.MkiteToolRegistry.all();
    const featured = allTools.filter((tool) => tool.status === "active");
    const planned = allTools.filter((tool) => tool.status !== "active").slice(0, 2);
    mainContent.innerHTML = `<div class="dashboard-view">
      <section class="dashboard-intro" aria-labelledby="dashboard-title">
        <span class="dashboard-eyebrow">Operations workspace</span>
        <div class="dashboard-intro-copy"><div><h2 id="dashboard-title">Warehouse Tools</h2><p>Fast utilities for daily warehouse operations.</p></div><span class="dashboard-availability"><i></i>${featured.length} tools ready</span></div>
        <div class="dashboard-search"><div class="search-field">${icons.search}<label class="sr-only" for="tool-search">Search tools</label><input id="tool-search" type="search" placeholder="What do you need to do?" autocomplete="off"><button class="icon-button search-clear" id="search-clear" type="button" aria-label="Clear search">×</button></div><kbd>/</kbd></div>
      </section>
      <div id="dashboard-catalog">
        <section class="featured-section"><div class="section-header"><h3>Featured tools</h3><span>Ready to use</span></div><div class="featured-tools">${featured.map((tool, index) => toolCard(tool, `tool-card-featured featured-${index + 1}`)).join("")}</div></section>
        <section class="planned-section"><div class="section-header"><h3>Expanding the toolbox</h3><span>${planned.length} planned</span></div><div class="planned-tools">${planned.map((tool) => toolCard(tool, "tool-card-planned")).join("")}</div></section>
      </div>
    </div>`;
    const input = document.getElementById("tool-search"); const clear = document.getElementById("search-clear"); const catalog = document.getElementById("dashboard-catalog");
    const defaultCatalog = catalog.innerHTML;
    function updateDashboardSearch() {
      const query = input.value.trim(); clear.classList.toggle("is-visible", Boolean(query));
      if (!query) { catalog.innerHTML = defaultCatalog; return; }
      const matches = window.MkiteToolRegistry.search(query);
      catalog.innerHTML = `<section class="dashboard-results"><div class="section-header"><h3>Search results</h3><span>${matches.length} ${matches.length === 1 ? "tool" : "tools"}</span></div><div class="tool-grid">${matches.length ? matches.map((tool) => toolCard(tool)).join("") : `<div class="empty-state">${icons.search}<h3>No tools found</h3><p>Try another name or category.</p></div>`}</div></section>`;
    }
    input.addEventListener("input", updateDashboardSearch); clear.addEventListener("click", () => { input.value = ""; updateDashboardSearch(); input.focus(); });
  }

  function renderTools() {
    searchView({ title: "Tools", description: "Utilities for warehouse operations and data processing.", sectionTitle: "Tool Library", tools: window.MkiteToolRegistry.all(), includeAll: true });
  }

  function renderSettings() {
    const settings = getSettings();
    mainContent.innerHTML = `${pageHeader("Settings", "Application preferences and information.")}
      <div class="workspace-stack"><section class="panel"><div class="panel-header"><div><h3>Appearance</h3><p>Preferences are stored in this browser.</p></div></div><div class="form-control"><label for="settings-theme">Theme</label><select class="select" id="settings-theme"><option value="dark"${settings.theme === "dark" ? " selected" : ""}>Dark</option><option value="light"${settings.theme === "light" ? " selected" : ""}>Light</option></select></div></section>
      <section class="panel"><div class="panel-header"><div><h3>Application Information</h3><p>MKITE Warehouse Tools</p></div><span class="badge">UI Color System v0.7</span></div><p class="placeholder-block">A modular, browser-based collection of warehouse operations utilities.</p></section></div>`;
    document.getElementById("settings-theme").addEventListener("change", (event) => setTheme(event.target.value));
  }

  function renderTool(toolId) {
    const tool = window.MkiteToolRegistry.get(toolId);
    if (!tool) { window.MkiteRouter.navigate({ view: "tools" }); return; }
    if (tool.status !== "active" || !tool.module || !window.MkiteTools[tool.module]) { window.MkiteRouter.navigate({ view: "tools" }); window.MkiteToast.show(`${tool.name} is coming soon`); return; }
    activeToolModule = window.MkiteTools[tool.module]; mainContent.innerHTML = activeToolModule.render(); activeToolModule.init({ root: mainContent, storage: window.MkiteStorage, toast: window.MkiteToast, audio: window.MkiteAudio });
  }

  function setTheme(theme) {
    const safeTheme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = safeTheme; themeToggle.setAttribute("aria-label", `Switch to ${safeTheme === "dark" ? "light" : "dark"} mode`);
    const settings = getSettings(); settings.theme = safeTheme; window.MkiteStorage.set("settings", settings);
  }

  function setCollapsed(collapsed) {
    appShell.classList.toggle("is-collapsed", collapsed); collapseButton.setAttribute("aria-expanded", String(!collapsed)); collapseButton.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    const settings = getSettings(); settings.sidebarCollapsed = collapsed; window.MkiteStorage.set("settings", settings);
  }

  function closeMobileMenu() { appShell.classList.remove("is-mobile-open"); menuButton.setAttribute("aria-expanded", "false"); }
  function onRoute(route) {
    if (activeToolModule && activeToolModule.cleanup) activeToolModule.cleanup(); activeToolModule = null;
    const title = route.view === "tool" ? (window.MkiteToolRegistry.get(route.toolId)?.name || "Tools") : route.view.charAt(0).toUpperCase() + route.view.slice(1);
    sectionTitle.textContent = title; document.title = `${title} | MKITE Warehouse Tools`;
    document.querySelectorAll(".nav-item").forEach((item) => { const active = item.dataset.route === (route.view === "tool" ? "tools" : route.view); item.classList.toggle("is-active", active); if (active) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current"); });
    if (route.view === "dashboard") renderDashboard(); else if (route.view === "tools") renderTools(); else if (route.view === "settings") renderSettings(); else renderTool(route.toolId);
    closeMobileMenu(); mainContent.focus({ preventScroll: true });
  }

  document.addEventListener("click", (event) => {
    const routeButton = event.target.closest("[data-route]"); if (routeButton) window.MkiteRouter.navigate({ view: routeButton.dataset.route });
    const toolButton = event.target.closest("[data-tool-id]"); if (toolButton) { const tool = window.MkiteToolRegistry.get(toolButton.dataset.toolId); if (tool.status === "active") window.MkiteRouter.navigate({ view: "tool", toolId: tool.id }); else window.MkiteToast.show(`${tool.name} is coming soon`); }
  });
  themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  collapseButton.addEventListener("click", () => setCollapsed(!appShell.classList.contains("is-collapsed")));
  menuButton.addEventListener("click", () => { const open = appShell.classList.toggle("is-mobile-open"); menuButton.setAttribute("aria-expanded", String(open)); });
  sidebarBackdrop.addEventListener("click", closeMobileMenu);
  document.getElementById("topbar-search").addEventListener("click", () => { window.MkiteRouter.navigate({ view: "tools" }); window.setTimeout(() => document.getElementById("tool-search")?.focus(), 0); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMobileMenu(); if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) { event.preventDefault(); window.MkiteRouter.navigate({ view: "tools" }); window.setTimeout(() => document.getElementById("tool-search")?.focus(), 0); } });

  const logo = document.querySelector(".brand-logo");
  const brand = logo.closest(".brand");
  logo.addEventListener("error", () => {
    if (!brand.classList.contains("uses-legacy-logo")) { brand.classList.add("uses-legacy-logo"); logo.src = "assets/images/mkite-logo.png"; }
    else logo.alt = "MKITE International logo unavailable";
  });
  const settings = getSettings(); setTheme(settings.theme); setCollapsed(Boolean(settings.sidebarCollapsed));
  window.MkiteRouter.start(onRoute);
}(window, document));
