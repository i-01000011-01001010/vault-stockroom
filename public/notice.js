/* First-visit notice. Shown once per browser until acknowledged.
   Override the wording or turn it off in data/config.json:
     "notice": { "enabled": true, "title": "...", "text": "..." } */
(function () {
  var KEY = "vs_notice_ok";
  var DEFAULT_TITLE = "IN-GAME TRADING ONLY";
  var DEFAULT_TEXT =
    "This site is for trading inside Fallout 76 with caps and items. " +
    "It never handles real money, and it is not affiliated with Bethesda.";

  var memoryOk = false;

  function acknowledged() {
    if (memoryOk) return true;
    try { if (localStorage.getItem(KEY) === "1") return true; } catch (e) { /* ignore */ }
    try { if (sessionStorage.getItem(KEY) === "1") return true; } catch (e) { /* ignore */ }
    return false;
  }
  function remember() {
    memoryOk = true;
    try { localStorage.setItem(KEY, "1"); return; } catch (e) { /* fall through */ }
    try { sessionStorage.setItem(KEY, "1"); } catch (e) { /* in-memory only */ }
  }

  window.showNoticeIfNeeded = function (config) {
    var cfg = (config && config.notice) || {};
    if (cfg.enabled === false) return;
    if (acknowledged()) return;

    var overlay = document.createElement("div");
    overlay.className = "notice-overlay";

    var box = document.createElement("div");
    box.className = "notice-box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "noticeTitle");
    box.setAttribute("aria-describedby", "noticeText");

    var title = document.createElement("div");
    title.className = "notice-title";
    title.id = "noticeTitle";
    title.textContent = cfg.title || DEFAULT_TITLE;

    var text = document.createElement("p");
    text.className = "notice-text";
    text.id = "noticeText";
    text.textContent = cfg.text || DEFAULT_TEXT;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notice-btn";
    btn.textContent = "I UNDERSTAND";
    btn.addEventListener("click", function () {
      remember();
      overlay.remove();
    });

    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    btn.focus();
  };
})();
