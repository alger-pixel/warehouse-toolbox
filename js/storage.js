(function (window) {
  "use strict";
  const PREFIX = "mkite.toolbox.";
  function keyFor(namespace) { return namespace.startsWith(PREFIX) ? namespace : PREFIX + namespace; }
  window.MkiteStorage = {
    get(namespace, fallback) {
      try { const value = window.localStorage.getItem(keyFor(namespace)); return value === null ? fallback : JSON.parse(value); }
      catch (error) { return fallback; }
    },
    set(namespace, value) {
      try { window.localStorage.setItem(keyFor(namespace), JSON.stringify(value)); return true; }
      catch (error) { return false; }
    },
    remove(namespace) {
      try { window.localStorage.removeItem(keyFor(namespace)); return true; }
      catch (error) { return false; }
    }
  };
}(window));
