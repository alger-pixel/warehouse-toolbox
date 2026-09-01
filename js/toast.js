(function (window, document) {
  "use strict";
  let region;
  function show(message, options) {
    region = region || document.getElementById("toast-region");
    if (!region) return;
    const toast = document.createElement("div");
    toast.className = "toast"; toast.setAttribute("role", "status"); toast.textContent = message;
    region.appendChild(toast);
    const duration = options && options.duration ? options.duration : 2800;
    window.setTimeout(() => { toast.classList.add("is-leaving"); window.setTimeout(() => toast.remove(), 180); }, duration);
  }
  window.MkiteToast = { show };
}(window, document));
