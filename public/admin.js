// Vault Stockroom admin. All text goes in through textContent, never innerHTML.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const WEAPON_CATS = ["blunt", "fist", "power-tools", "sharp", "energy", "heavy", "launchers", "machine-guns", "pipe", "survival"];
  const APPLIES = [["weapon", "Weapon"], ["armor", "Armor"], ["powerArmor", "Power armor"]];

  let DATA = null;            // last loaded server data
  let dirty = new Map();      // item id -> {learned, offering}
  let tab = "stock";
  let search = "";
  let openSections = new Set(["mods"]);

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids) if (kid) n.append(kid);
    return n;
  }

  function say(text, isErr) {
    const m = $("topMsg");
    m.textContent = text || "";
    m.className = "msg" + (isErr ? " err" : "");
  }

  async function api(path, method = "GET", body) {
    const opts = { method, headers: { "X-Requested-With": "vault-stockroom" }, credentials: "same-origin" };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, opts); } catch (e) { throw new Error("Could not reach the server."); }
    const type = res.headers.get("content-type") || "";
    if (!type.includes("application/json")) {
      // Cloudflare Access answers with a login page when the session has expired.
      throw new Error("Your sign-in expired. Reload the page to sign in again.");
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ").");
    return data;
  }

  async function reload() { DATA = await api("/api/admin/data"); }

  function effective(it) {
    const d = dirty.get(it.id);
    return { learned: d ? d.learned : it.learned, offering: d ? d.offering : it.offering };
  }
  function setFlag(it, key, val) {
    const cur = effective(it);
    const next = { ...cur, [key]: val };
    if (next.learned === it.learned && next.offering === it.offering) dirty.delete(it.id);
    else dirty.set(it.id, next);
    updateBar();
  }
  function updateBar() {
    const n = dirty.size;
    $("saveBar").classList.toggle("visible", n > 0);
    $("saveCount").textContent = n + (n === 1 ? " unsaved change" : " unsaved changes");
  }

  /* ---------------- Stock tab ---------------- */
  function itemRow(it, rerender) {
    const cur = effective(it);
    const learned = el("input", { type: "checkbox", "aria-label": "Learned: " + it.name });
    const offering = el("input", { type: "checkbox", "aria-label": "Offering: " + it.name });
    learned.checked = cur.learned; offering.checked = cur.offering;
    const warn = el("span", { class: "badge warn", text: "OFFERING, NOT LEARNED" });
    const sync = () => { warn.style.display = offering.checked && !learned.checked ? "" : "none"; };
    learned.addEventListener("change", () => { setFlag(it, "learned", learned.checked); sync(); });
    offering.addEventListener("change", () => { setFlag(it, "offering", offering.checked); sync(); });
    sync();

    const meta = [];
    if (it.tier) meta.push(it.tier + "-star");
    if (it.appliesTo) meta.push(it.appliesTo.map((a) => ({ weapon: "W", armor: "A", powerArmor: "PA" }[a] || a)).join("/"));
    const nm = el("div", { class: "nm", text: it.name });
    if (it.material) nm.append(el("small", { text: it.material }));
    const badges = el("div", { class: "badges" }, warn);
    if (meta.length) badges.append(el("span", { class: "badge", text: meta.join(" ") }));
    if (it.source === "custom") {
      badges.append(el("span", { class: "badge custom", text: "CUSTOM" }));
      badges.append(el("button", {
        type: "button", class: "badge badge-btn", text: "DELETE",
        onclick: async () => {
          if (!confirm("Delete custom item \"" + it.name + "\"?")) return;
          try { await api("/api/admin/items/" + it.id, "DELETE"); dirty.delete(it.id); await reload(); render(); say("Deleted."); }
          catch (e) { say(e.message, true); }
        },
      }));
    }
    return el("div", { class: "arow" }, learned, offering, nm, badges);
  }

  function renderStock(root) {
    const total = DATA.items.length;
    const learnedN = DATA.items.filter((i) => effective(i).learned).length;
    const offerN = DATA.items.filter((i) => effective(i).offering).length;
    const warnN = DATA.items.filter((i) => { const e = effective(i); return e.offering && !e.learned; }).length;

    root.append(el("p", { class: "hint", text: "LEARNED means you know the plan or recipe. OFFERING means visitors can see it on the public page. Offering something you have not learned is flagged so you can double check it." }));
    const searchBox = el("input", { type: "text", class: "search-box", placeholder: "SEARCH...", "aria-label": "Search items", value: search });
    const bar = el("div", { class: "toolbar" }, searchBox,
      el("span", { class: "summary" },
        el("strong", { text: String(learnedN) }), " learned, ",
        el("strong", { text: String(offerN) }), " offering, of " + total,
        warnN ? el("span", { class: "badge warn", text: warnN + " offering without learned" }) : null));
    root.append(bar);
    const listWrap = el("div");
    root.append(listWrap);

    const draw = () => {
      listWrap.textContent = "";
      const q = search.trim().toLowerCase();
      for (const sec of DATA.sections) {
        const all = DATA.items.filter((i) => i.section === sec.id);
        const shown = q ? all.filter((i) => i.name.toLowerCase().includes(q)) : all;
        if (q && !shown.length) continue;
        const det = el("details", { class: "sec-block" });
        if (openSections.has(sec.id) || q) det.open = true;
        det.addEventListener("toggle", () => { if (det.open) openSections.add(sec.id); else openSections.delete(sec.id); });
        const l = all.filter((i) => effective(i).learned).length;
        const o = all.filter((i) => effective(i).offering).length;
        det.append(el("summary", null,
          el("span", { text: sec.title.toUpperCase() + (sec.enabled ? "" : " (HIDDEN)") }),
          el("span", { class: "section-count", text: l + " learned / " + o + " offering / " + all.length })));
        const body = el("div", { class: "sec-body" });
        const bulk = (label, fn) => el("button", { type: "button", class: "btn", text: label, onclick: () => { shown.forEach(fn); draw(); } });
        body.append(el("div", { class: "sec-actions" },
          bulk("MARK SHOWN LEARNED", (i) => setFlag(i, "learned", true)),
          bulk("OFFER SHOWN LEARNED", (i) => { if (effective(i).learned) setFlag(i, "offering", true); }),
          bulk("CLEAR OFFERING", (i) => setFlag(i, "offering", false))));
        body.append(el("div", { class: "arow head" }, el("span", { text: "LEARNED" }), el("span", { text: "OFFER" }), el("span", { text: "ITEM" }), el("span")));
        let lastTier = null;
        for (const it of shown) {
          if (sec.id === "mods" && it.tier !== lastTier) {
            lastTier = it.tier;
            body.append(el("div", { class: "subhead", text: it.tier + "-STAR MODS" }));
          }
          body.append(itemRow(it));
        }
        det.append(body);
        listWrap.append(det);
      }
      if (!listWrap.children.length) listWrap.append(el("p", { class: "hint", text: "Nothing matches that search." }));
    };
    searchBox.addEventListener("input", () => { search = searchBox.value; draw(); });
    draw();
    root.append(customForm());
  }

  function customForm() {
    const secSel = el("select", { id: "cSection" }, ...DATA.sections.map((s) => el("option", { value: s.id, text: s.title })));
    const name = el("input", { type: "text", id: "cName", maxlength: "80" });
    const material = el("input", { type: "text", id: "cMaterial", maxlength: "120" });
    const tier = el("select", { id: "cTier" }, ...[1, 2, 3, 4].map((n) => el("option", { value: String(n), text: n + "-star" })));
    const effect = el("input", { type: "text", id: "cEffect", maxlength: "200" });
    const applies = el("div", { class: "checks" }, ...APPLIES.map(([v, l]) => el("label", null, el("input", { type: "checkbox", value: v }), l)));
    const cats = el("div", { class: "checks" }, ...WEAPON_CATS.map((c) => el("label", null, el("input", { type: "checkbox", value: c }), c)));
    const modBox = el("div", null, el("label", { class: "fl", text: "STAR TIER" }), tier, el("label", { class: "fl", text: "APPLIES TO" }), applies, el("label", { class: "fl", text: "EFFECT (OPTIONAL)" }), effect);
    const wBox = el("div", null, el("label", { class: "fl", text: "WEAPON CATEGORIES" }), cats);
    const msg = el("div", { class: "msg" });
    const sync = () => { modBox.style.display = secSel.value === "mods" ? "" : "none"; wBox.style.display = secSel.value === "weapons" ? "" : "none"; };
    secSel.addEventListener("change", sync);
    sync();
    const checked = (box) => [...box.querySelectorAll("input:checked")].map((i) => i.value);
    const add = el("button", {
      type: "button", class: "btn primary", text: "ADD CUSTOM ITEM",
      onclick: async () => {
        msg.className = "msg"; msg.textContent = "";
        try {
          await api("/api/admin/items", "POST", {
            section: secSel.value, name: name.value, material: material.value,
            tier: Number(tier.value), appliesTo: checked(applies), effect: effect.value, categories: checked(cats),
          });
          name.value = ""; material.value = ""; effect.value = "";
          await reload(); render(); say("Custom item added.");
        } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
      },
    });
    return el("div", { class: "panel" }, el("h3", { text: "ADD YOUR OWN ITEM" }),
      el("p", { class: "hint", text: "Custom items are yours alone. Catalog updates never touch them. If the catalog later adds the same item, you will see two entries and can delete your copy." }),
      el("label", { class: "fl", text: "SECTION" }), secSel,
      el("label", { class: "fl", text: "NAME" }), name,
      el("label", { class: "fl", text: "MATERIAL NEEDED (OPTIONAL)" }), material,
      modBox, wBox, el("div", { style: "margin-top:12px" }, add), msg);
  }

  /* ---------------- Sections tab ---------------- */
  function renderSections(root) {
    root.append(el("p", { class: "hint", text: "Hide a section to take it off the public page. Your learned and offering choices are kept, so turning it back on restores everything." }));
    const p = el("div", { class: "panel" });
    for (const s of DATA.sections) {
      const cb = el("input", { type: "checkbox" });
      cb.checked = s.enabled;
      cb.addEventListener("change", async () => {
        try { await api("/api/admin/sections", "POST", { id: s.id, enabled: cb.checked }); s.enabled = cb.checked; say(s.title + (cb.checked ? " is now shown." : " is now hidden.")); }
        catch (e) { cb.checked = !cb.checked; say(e.message, true); }
      });
      p.append(el("label", { class: "row-check" }, cb, el("span", { text: s.title })));
    }
    root.append(p);
  }

  /* ---------------- Site tab ---------------- */
  function renderSite(root) {
    const s = DATA.site || {};
    const t = s.trade || {};
    const n = s.notice || {};
    const fields = [
      ["campName", "CAMP NAME", s.campName, 80], ["inGameName", "IN-GAME NAME", s.inGameName, 40],
      ["discord", "DISCORD", s.discord, 40], ["server", "PLATFORM", s.server, 40],
      ["tagline", "TAGLINE", s.tagline, 800], ["note", "NOTE UNDER THE TAGLINE", s.note, 300],
      ["modsNote", "NOTE ON THE MODS SECTION", s.modsNote, 400],
    ];
    const inputs = {};
    const p = el("div", { class: "panel" });
    for (const [k, label, val, max] of fields) {
      inputs[k] = max > 100 ? el("textarea", { maxlength: String(max) }) : el("input", { type: "text", maxlength: String(max) });
      inputs[k].value = val || "";
      p.append(el("label", { class: "fl", text: label }), inputs[k]);
    }
    const caps = el("input", { type: "checkbox" }); caps.checked = t.acceptingCaps !== false;
    const tradeNote = el("input", { type: "text", maxlength: "300" }); tradeNote.value = t.note || "";
    const noticeOn = el("input", { type: "checkbox" }); noticeOn.checked = n.enabled !== false;
    const nTitle = el("input", { type: "text", maxlength: "60" }); nTitle.value = n.title || "";
    const nText = el("textarea", { maxlength: "300" }); nText.value = n.text || "";
    p.append(
      el("label", { class: "row-check" }, caps, el("span", { text: "Accepting caps" })),
      el("label", { class: "fl", text: "TRADE BANNER TEXT (OPTIONAL)" }), tradeNote,
      el("label", { class: "row-check" }, noticeOn, el("span", { text: "Show the first-visit notice" })),
      el("label", { class: "fl", text: "NOTICE TITLE (BLANK = DEFAULT)" }), nTitle,
      el("label", { class: "fl", text: "NOTICE TEXT (BLANK = DEFAULT)" }), nText);
    const msg = el("div", { class: "msg" });
    p.append(el("div", { style: "margin-top:12px" }, el("button", {
      type: "button", class: "btn primary", text: "SAVE SITE SETTINGS",
      onclick: async () => {
        const site = { trade: { acceptingCaps: caps.checked, note: tradeNote.value }, notice: { enabled: noticeOn.checked, title: nTitle.value, text: nText.value } };
        for (const k of Object.keys(inputs)) site[k] = inputs[k].value;
        try { await api("/api/admin/site", "PUT", { site }); DATA.site = site; msg.className = "msg"; msg.textContent = "Saved."; }
        catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
      },
    })), msg);
    root.append(p);
  }

  /* ---------------- Backup tab ---------------- */
  function renderBackup(root) {
    const file = el("input", { type: "file", accept: "application/json,.json" });
    const msg = el("div", { class: "msg" });
    root.append(el("div", { class: "panel" }, el("h3", { text: "EXPORT" }),
      el("p", { class: "hint", text: "Downloads your site settings, section switches, learned/offering choices and custom items as one file. Keep a copy somewhere safe. It is also how you move to a fresh deployment." }),
      el("a", { class: "btn", href: "/api/admin/export", download: true, text: "DOWNLOAD EXPORT" })));
    root.append(el("div", { class: "panel" }, el("h3", { text: "IMPORT" }),
      el("p", { class: "hint", text: "Restores an export file. This replaces your current settings and choices." }),
      file, el("div", { style: "margin-top:12px" }, el("button", {
        type: "button", class: "btn danger", text: "IMPORT FILE",
        onclick: async () => {
          const f = file.files[0];
          if (!f) { msg.className = "msg err"; msg.textContent = "Choose a file first."; return; }
          if (!confirm("Replace your current settings and choices with this file?")) return;
          try {
            const body = JSON.parse(await f.text());
            await api("/api/admin/import", "POST", body);
            dirty.clear(); updateBar(); await reload();
            msg.className = "msg"; msg.textContent = "Import complete.";
          } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
        },
      })), msg));
    root.append(el("p", { class: "hint", text: "Catalog version: " + (DATA.catalogVersion || "unknown") }));
  }

  /* ---------------- Activity tab ---------------- */
  async function renderActivity(root) {
    root.append(el("p", { class: "hint", text: "The last 100 changes made through the admin." }));
    try {
      const { entries } = await api("/api/admin/audit");
      const table = el("table", { class: "log" }, el("thead", null, el("tr", null, ...["WHEN", "WHO", "WHAT", "DETAIL"].map((h) => el("th", { text: h })))));
      const body = el("tbody");
      for (const e of entries) body.append(el("tr", null,
        el("td", { text: new Date(e.at).toLocaleString() }), el("td", { text: e.actor }), el("td", { text: e.action }), el("td", { text: e.detail || "" })));
      table.append(body);
      root.append(table);
      if (!entries.length) root.append(el("p", { class: "hint", text: "Nothing yet." }));
    } catch (e) { say(e.message, true); }
  }

  /* ---------------- shell ---------------- */
  function render() {
    const root = $("adminMain");
    root.textContent = "";
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    if (!DATA) return;
    if (tab === "stock") renderStock(root);
    else if (tab === "sections") renderSections(root);
    else if (tab === "site") renderSite(root);
    else if (tab === "backup") renderBackup(root);
    else renderActivity(root);
  }

  async function save() {
    if (!dirty.size) return;
    const changes = [...dirty].map(([id, v]) => {
      const it = DATA.items.find((i) => i.id === id);
      return { id, learned: v.learned, offering: v.offering, qtyHave: it ? it.qtyHave : 0, qtyWant: it ? it.qtyWant : 0 };
    });
    $("saveBtn").disabled = true;
    try {
      for (let i = 0; i < changes.length; i += 500) await api("/api/admin/state", "POST", { changes: changes.slice(i, i + 500) });
      for (const c of changes) { const it = DATA.items.find((x) => x.id === c.id); if (it) { it.learned = c.learned; it.offering = c.offering; } }
      dirty.clear(); updateBar(); render();
      say("Saved. The public page updates within about a minute.");
    } catch (e) { say(e.message, true); }
    $("saveBtn").disabled = false;
  }

  async function init() {
    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; say(""); render(); }));
    $("saveBtn").addEventListener("click", save);
    $("discardBtn").addEventListener("click", () => { dirty.clear(); updateBar(); render(); });
    window.addEventListener("beforeunload", (e) => { if (dirty.size) { e.preventDefault(); e.returnValue = ""; } });
    try {
      const who = await api("/api/admin/whoami");
      $("who").textContent = "Signed in as " + who.email;
      await reload();
      render();
    } catch (e) {
      $("who").textContent = "Not signed in";
      say(e.message, true);
    }
  }
  init();
})();
