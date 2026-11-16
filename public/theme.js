/* Theme + display switcher.
   Loaded in <head> (no defer) so the saved theme is applied before first paint.

   Themes:
     auto            clean look that follows the visitor's light/dark device setting
     daybreak        clean, light
     gunmetal        clean, dark
     amber-phosphor  terminal look, amber text
     green-phosphor  terminal look, green text

   To change the default for first-time visitors, edit DEFAULT_THEME below. */
(function () {
  var DEFAULT_THEME = "auto";
  var THEME_KEY = "vs_theme";
  var FX_KEY = "vs_crt_fx";

  var THEMES = [
    { id: "auto", label: "Auto (clean)", family: "clean" },
    { id: "daybreak", label: "Daybreak (light)", family: "clean" },
    { id: "gunmetal", label: "Gunmetal (dark)", family: "clean" },
    { id: "amber-phosphor", label: "Amber Phosphor", family: "terminal" },
    { id: "green-phosphor", label: "Green Phosphor", family: "terminal" },
  ];

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* storage blocked, ignore */ }
  }
  function find(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return null;
  }

  var darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function apply(choice) {
    var theme = find(choice) || find(DEFAULT_THEME) || THEMES[0];
    var resolved = theme.id;
    if (resolved === "auto") resolved = darkQuery && darkQuery.matches ? "gunmetal" : "daybreak";
    var root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.setAttribute("data-family", theme.family);
    root.setAttribute("data-fx", read(FX_KEY) === "off" ? "off" : "on");
    return theme;
  }

  var current = apply(read(THEME_KEY) || DEFAULT_THEME);

  if (darkQuery && darkQuery.addEventListener) {
    darkQuery.addEventListener("change", function () {
      if (current.id === "auto") apply("auto");
    });
  }

  function buildSwitcher(slot) {
    var wrap = document.createElement("span");
    wrap.className = "theme-switcher";

    var lab = document.createElement("label");
    lab.className = "theme-label";
    lab.htmlFor = "themeSelect";
    lab.textContent = "THEME";

    var sel = document.createElement("select");
    sel.id = "themeSelect";
    sel.className = "theme-select";
    THEMES.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      if (t.id === current.id) opt.selected = true;
      sel.appendChild(opt);
    });

    var fxLabel = document.createElement("label");
    fxLabel.className = "theme-fx";
    var fx = document.createElement("input");
    fx.type = "checkbox";
    fx.checked = document.documentElement.getAttribute("data-fx") !== "off";
    fxLabel.appendChild(fx);
    fxLabel.appendChild(document.createTextNode(" CRT EFFECTS"));

    function syncFx() {
      fxLabel.style.display = current.family === "terminal" ? "" : "none";
    }
    syncFx();

    sel.addEventListener("change", function () {
      write(THEME_KEY, sel.value);
      current = apply(sel.value);
      syncFx();
    });
    fx.addEventListener("change", function () {
      write(FX_KEY, fx.checked ? "on" : "off");
      document.documentElement.setAttribute("data-fx", fx.checked ? "on" : "off");
    });

    wrap.appendChild(lab);
    wrap.appendChild(sel);
    wrap.appendChild(fxLabel);
    slot.appendChild(wrap);
  }

  window.VS_THEME = {
    family: function () { return document.documentElement.getAttribute("data-family"); },
  };

  document.addEventListener("DOMContentLoaded", function () {
    var slot = document.getElementById("themeSlot");
    if (slot) buildSwitcher(slot);
  });
})();
