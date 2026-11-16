const BOOT_LINES = [
  "VAULT STOCKROOM TERMLINK PROTOCOL",
  "INITIALIZING VENDOR DATABASE...",
  "LOADING CATALOG... OK",
  "CONNECTION ESTABLISHED",
];

let STATE = { site: null, sections: [], items: [], filterText: "", showUnavailable: false };

function typeBoot(cb) {
  if (window.VS_THEME && window.VS_THEME.family() !== "terminal") { cb(); return; }
  const el = document.getElementById("boot");
  let out = "", li = 0;
  (function nextLine() {
    if (li >= BOOT_LINES.length) {
      out += "\n> READY_";
      el.innerHTML = out.replace(/(READY_)/, '<span class="ready">$1</span>');
      setTimeout(cb, 250);
      return;
    }
    out += (li > 0 ? "\n" : "") + BOOT_LINES[li];
    el.textContent = out;
    li++;
    setTimeout(nextLine, 90);
  })();
}

async function loadData() {
  const res = await fetch("/api/catalog");
  if (!res.ok) throw new Error("catalog request failed (" + res.status + ")");
  const data = await res.json();
  STATE.site = data.site || {};
  STATE.sections = data.sections || [];
  STATE.items = data.items || [];
}

function renderHeader() {
  const c = STATE.site;
  document.getElementById("campName").textContent = c.campName || "CAMP NAME";
  document.getElementById("ign").textContent = c.inGameName || "-";
  document.getElementById("discord").textContent = c.discord || "-";
  document.getElementById("server").textContent = c.server || "-";
  document.getElementById("tagline").textContent = c.tagline || "";
  document.getElementById("note").textContent = c.note || "";
  document.getElementById("masthead").style.display = "";
  document.getElementById("navRow").style.display = "";
  document.getElementById("controls").style.display = "";
  document.getElementById("lastUpdated").textContent = "LOADED " + new Date().toLocaleString();
  const banner = document.getElementById("tradeBanner");
  if (c.trade) {
    if (c.trade.acceptingCaps === false) {
      banner.textContent = c.trade.note || "Not accepting caps right now, materials, items, or other trades only.";
      banner.className = "trade-banner";
      banner.style.display = "";
    } else if (c.trade.note) {
      banner.textContent = c.trade.note;
      banner.className = "trade-banner accepting";
      banner.style.display = "";
    }
  }
}

function updateCartBar() {
  const list = cartLoad();
  const bar = document.getElementById("cartBar");
  bar.classList.toggle("visible", list.length > 0);
  document.getElementById("cartCount").textContent = list.length + (list.length === 1 ? " ITEM SELECTED" : " ITEMS SELECTED");
}

function onSelectToggle(item, checked) {
  if (checked) cartAdd(item); else cartRemove(item.id);
  updateCartBar();
}

function sectionHead(idx, title, avail, total) {
  const head = document.createElement("div");
  head.className = "section-head";
  const i = document.createElement("span"); i.className = "idx"; i.textContent = String(idx).padStart(2, "0");
  const t = document.createElement("span"); t.className = "section-title"; t.textContent = title.toUpperCase();
  const c = document.createElement("span"); c.className = "section-count"; c.textContent = avail + " / " + total + " AVAILABLE";
  head.append(i, t, c);
  return head;
}

function subhead(text) {
  const d = document.createElement("div");
  d.className = "subhead";
  d.textContent = text;
  return d;
}

function renderCatalog() {
  const root = document.getElementById("catalog");
  root.innerHTML = "";
  const opts = {
    editable: false,
    showUnavailable: STATE.showUnavailable,
    filterText: STATE.filterText,
    selectable: true,
    selectedIds: cartIds(),
    onSelectToggle,
  };
  const show = STATE.showUnavailable;
  let idx = 0;

  for (const sec of STATE.sections) {
    const list = STATE.items.filter(it => it.section === sec.id);
    const avail = countAvailable(list);
    if (avail === 0 && !show) continue;
    const section = document.createElement("section");
    section.className = "section";

    if (sec.id === "mods") {
      const byTier = { "1": [], "2": [], "3": [], "4": [] };
      for (const it of list) if (byTier[it.tier]) byTier[it.tier].push({ ...it, appliesTo: it.appliesTo || [] });
      section.appendChild(sectionHead(++idx, sec.title, avail, list.length));
      if (STATE.site.modsNote) {
        const p = document.createElement("p");
        p.className = "note";
        p.textContent = STATE.site.modsNote;
        section.appendChild(p);
      }
      for (const mt of [
        { type: "weapon", label: "WEAPON MODS" },
        { type: "armor", label: "ARMOR MODS" },
        { type: "powerArmor", label: "POWER ARMOR MODS" },
      ]) {
        const counts = modCountForType(byTier, mt.type);
        if (counts.total === 0 || (counts.available === 0 && !show)) continue;
        section.appendChild(subhead(`${mt.label} (${counts.available}/${counts.total})`));
        const div = document.createElement("div");
        div.className = "mod-group";
        section.appendChild(div);
        renderModSection(div, byTier, { ...opts, modType: mt.type });
      }
    } else if (sec.id === "weapons") {
      section.appendChild(sectionHead(++idx, sec.title, avail, list.length));
      for (const cat of WEAPON_CATEGORIES) {
        const counts = categoryCount(list, cat.key);
        if (counts.total === 0 || (counts.available === 0 && !show)) continue;
        section.appendChild(subhead(`${cat.label} (${counts.available}/${counts.total})`));
        const grid = document.createElement("div");
        grid.className = "item-grid";
        section.appendChild(grid);
        renderItemGrid(grid, list.filter(it => (it.categories || []).includes(cat.key)), opts);
      }
    } else {
      section.appendChild(sectionHead(++idx, sec.title, avail, list.length));
      const grid = document.createElement("div");
      grid.className = "item-grid";
      section.appendChild(grid);
      renderItemGrid(grid, list, opts);
    }
    root.appendChild(section);
  }

  if (!root.children.length) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = show
      ? "// nothing in the catalog yet"
      : "// nothing currently marked available, toggle SHOW OUT-OF-STOCK to see the full catalog";
    root.appendChild(p);
  }
}

function attachControls() {
  document.getElementById("search").addEventListener("input", e => { STATE.filterText = e.target.value; renderCatalog(); });
  document.getElementById("showUnavailable").addEventListener("change", e => {
    STATE.showUnavailable = e.target.checked;
    document.getElementById("toggleLabel").classList.toggle("active", e.target.checked);
    renderCatalog();
  });
  document.getElementById("cartClearBtn").addEventListener("click", () => { cartClear(); updateCartBar(); renderCatalog(); });
  document.getElementById("cartReviewBtn").addEventListener("click", () => { window.location.href = "contact.html"; });
}

(function init() {
  typeBoot(async () => {
    try {
      await loadData();
      renderHeader();
      if (window.showNoticeIfNeeded) window.showNoticeIfNeeded(STATE.site);
      renderCatalog();
      attachControls();
      updateCartBar();
    } catch (err) {
      const bootEl = document.getElementById("boot");
      bootEl.classList.add("show-error");
      bootEl.textContent += "\n\n!! ERROR LOADING DATA: " + err.message;
      console.error(err);
    }
  });
})();
