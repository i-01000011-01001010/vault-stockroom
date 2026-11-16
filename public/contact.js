// Builds a request message the visitor copies and sends themselves. Nothing is submitted to a server.
const BOOT_LINES = ["VAULT STOCKROOM TERMLINK PROTOCOL", "OPENING REQUEST BUILDER..."];

function typeBoot(cb) {
  if (window.VS_THEME && window.VS_THEME.family() !== "terminal") { cb(); return; }
  const el = document.getElementById("boot");
  let out = "", li = 0;
  (function nextLine() {
    if (li >= BOOT_LINES.length) {
      out += "\n> READY_";
      el.innerHTML = out.replace(/(READY_)/, '<span class="ready">$1</span>');
      setTimeout(cb, 200);
      return;
    }
    out += (li > 0 ? "\n" : "") + BOOT_LINES[li];
    el.textContent = out;
    li++;
    setTimeout(nextLine, 90);
  })();
}

function renderHeader(c) {
  document.getElementById("campName").textContent = c.campName || "CAMP NAME";
  document.getElementById("ign").textContent = c.inGameName || "-";
  document.getElementById("discord").textContent = c.discord || "-";
  document.getElementById("server").textContent = c.server || "-";
  document.getElementById("masthead").style.display = "";
  document.getElementById("navRow").style.display = "";
  document.getElementById("contactMain").style.display = "";
}

function buildMessage(f, c) {
  const owner = c.inGameName || c.discord || "";
  return [
    owner ? `Hi ${owner}, trade request from ${f.ign.value.trim() || "me"}:` : "Trade request:",
    "",
    "Looking for:",
    f.wants.value.trim() || "-",
    "",
    "Offering:",
    f.offering.value.trim() || "-",
    "",
    "Message:",
    f.message.value.trim() || "-",
  ].join("\n");
}

function setStatus(msg, kind) {
  const el = document.getElementById("formStatus");
  el.textContent = msg;
  el.className = "form-status " + (kind || "");
}

(function init() {
  typeBoot(async () => {
    try {
      const res = await fetch("/api/catalog");
      const site = res.ok ? (await res.json()).site || {} : {};
      renderHeader(site);
      if (window.showNoticeIfNeeded) window.showNoticeIfNeeded(site);
      const form = document.getElementById("contactForm");
      const cart = cartLoad();
      if (cart.length) form.wants.value = cart.map(i => i.name).join("\n");
      const preview = document.getElementById("fPreview");
      const refresh = () => { preview.value = buildMessage(form, site); };
      form.addEventListener("input", refresh);
      refresh();
      document.getElementById("copyBtn").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(preview.value);
          setStatus("Copied. Now paste it to " + (site.discord ? "the owner on Discord (" + site.discord + ")" : "the owner in-game or on Discord") + ".", "ok");
        } catch (e) {
          preview.select();
          setStatus("Select the text above and copy it.", "err");
        }
      });
    } catch (err) {
      const bootEl = document.getElementById("boot");
      bootEl.classList.add("show-error");
      bootEl.textContent += "\n\n!! ERROR LOADING DATA: " + err.message;
    }
  });
})();
