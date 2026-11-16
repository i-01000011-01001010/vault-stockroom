// Admin API. Every route here requires a verified Cloudflare Access token, and every
// write also passes a same-origin check. Writes go through mutate(), which records an
// audit entry and refreshes the public snapshot.

import { requireAdmin, requireSameOrigin } from "./auth.js";
import { HttpError, json, readJson, str, flag, count, nowIso } from "./util.js";
import { loadAll, buildSnapshot, storeSnapshot, auditStatements } from "./db.js";

const APPLIES = ["weapon", "armor", "powerArmor"];
const WEAPON_CATEGORIES = ["blunt", "fist", "power-tools", "sharp", "energy", "heavy", "launchers", "machine-guns", "pipe", "survival"];
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;

async function refreshPublic(env, origin) {
  await storeSnapshot(env.DB, await buildSnapshot(env.DB));
  await caches.default.delete(new Request(new URL("/api/catalog", origin)));
}

async function mutate(env, origin, actor, action, detail, statements) {
  await env.DB.batch([...statements, ...auditStatements(env.DB, actor, action, detail)]);
  await refreshPublic(env, origin);
}

async function runChunked(db, statements, size = 90) {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}

// ---------- validation ----------

function cleanSite(input) {
  if (!input || typeof input !== "object") throw new HttpError(400, "Site settings are missing.");
  const trade = input.trade && typeof input.trade === "object" ? input.trade : {};
  const notice = input.notice && typeof input.notice === "object" ? input.notice : {};
  return {
    campName: str(input.campName, 80, { label: "Camp name" }),
    inGameName: str(input.inGameName, 40, { label: "In-game name" }),
    discord: str(input.discord, 40, { label: "Discord" }),
    server: str(input.server, 40, { label: "Platform" }),
    tagline: str(input.tagline, 300, { label: "Tagline" }),
    note: str(input.note, 300, { label: "Note" }),
    modsNote: str(input.modsNote, 400, { label: "Mods note" }),
    trade: {
      acceptingCaps: trade.acceptingCaps !== false,
      note: str(trade.note, 300, { label: "Trade note" }),
    },
    notice: {
      enabled: notice.enabled !== false,
      title: str(notice.title, 60, { label: "Notice title" }),
      text: str(notice.text, 300, { label: "Notice text" }),
    },
  };
}

function cleanItemFields(body, sectionId) {
  const name = str(body.name, 80, { required: true, label: "Name" });
  const material = str(body.material, 120, { label: "Material" });
  const out = { name, material: material || null, tier: null, applies_to: null, effects: null, categories: null };

  if (sectionId === "mods") {
    const tier = Number(body.tier);
    if (![1, 2, 3, 4].includes(tier)) throw new HttpError(400, "Choose a star tier from 1 to 4.");
    const applies = Array.isArray(body.appliesTo) ? body.appliesTo.filter((a) => APPLIES.includes(a)) : [];
    if (!applies.length) throw new HttpError(400, "Choose at least one of weapon, armor, or power armor.");
    out.tier = tier;
    out.applies_to = JSON.stringify([...new Set(applies)]);
    const effect = str(body.effect, 200, { label: "Effect" });
    if (effect) out.effects = JSON.stringify(Object.fromEntries(applies.map((a) => [a, effect])));
  }
  if (sectionId === "weapons") {
    const cats = Array.isArray(body.categories) ? body.categories.filter((c) => WEAPON_CATEGORIES.includes(c)) : [];
    if (!cats.length) throw new HttpError(400, "Choose at least one weapon category.");
    out.categories = JSON.stringify([...new Set(cats)]);
  }
  return out;
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return "custom-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- handlers ----------

async function getData(env) {
  return json(await loadAll(env.DB));
}

async function saveState(request, env, actor, origin) {
  const body = await readJson(request);
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (!changes.length) throw new HttpError(400, "Nothing to save.");
  if (changes.length > 600) throw new HttpError(400, "Too many changes in one save.");

  const now = nowIso();
  const stmts = changes.map((c) => {
    if (!c || typeof c.id !== "string" || !ITEM_ID.test(c.id)) throw new HttpError(400, "Bad item id.");
    return env.DB
      .prepare(
        `INSERT INTO item_state (item_id, learned, offering, qty_have, qty_want, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET learned = excluded.learned, offering = excluded.offering,
           qty_have = excluded.qty_have, qty_want = excluded.qty_want, updated_at = excluded.updated_at`
      )
      .bind(c.id, flag(c.learned), flag(c.offering), count(c.qtyHave ?? 0), count(c.qtyWant ?? 0), now);
  });

  try {
    await mutate(env, origin, actor, "state.save", `${changes.length} item(s) updated`, stmts);
  } catch (err) {
    if (/FOREIGN KEY|constraint/i.test(String(err && err.message))) throw new HttpError(400, "One of the items does not exist.");
    throw err;
  }
  return json({ ok: true, saved: changes.length });
}

async function setSection(request, env, actor, origin) {
  const body = await readJson(request, 2000);
  const id = str(body.id, 32, { required: true, label: "Section" });
  const row = await env.DB.prepare("SELECT id FROM sections WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "Unknown section.");
  const enabled = flag(body.enabled);
  await mutate(env, origin, actor, "section.toggle", `${id} ${enabled ? "shown" : "hidden"}`, [
    env.DB.prepare("UPDATE sections SET enabled = ? WHERE id = ?").bind(enabled, id),
  ]);
  return json({ ok: true });
}

async function saveSite(request, env, actor, origin) {
  const body = await readJson(request, 20000);
  const site = cleanSite(body.site);
  await mutate(env, origin, actor, "site.save", "site settings updated", [
    env.DB
      .prepare("INSERT INTO settings (key, value) VALUES ('site', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(site)),
  ]);
  return json({ ok: true });
}

async function createItem(request, env, actor, origin) {
  const body = await readJson(request, 5000);
  const sectionId = str(body.section, 32, { required: true, label: "Section" });
  const sec = await env.DB.prepare("SELECT id FROM sections WHERE id = ?").bind(sectionId).first();
  if (!sec) throw new HttpError(404, "Unknown section.");
  const f = cleanItemFields(body, sectionId);
  const id = randomId();
  await mutate(env, origin, actor, "item.create", `${f.name} (${sectionId})`, [
    env.DB
      .prepare(
        `INSERT INTO items (id, section_id, source, name, tier, material, applies_to, effects, categories)
         VALUES (?, ?, 'custom', ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, sectionId, f.name, f.tier, f.material, f.applies_to, f.effects, f.categories),
    env.DB.prepare("INSERT INTO item_state (item_id, updated_at) VALUES (?, ?)").bind(id, nowIso()),
  ]);
  return json({ ok: true, id });
}

async function updateItem(request, env, actor, origin, id) {
  const row = await env.DB.prepare("SELECT id, section_id, source FROM items WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "Unknown item.");
  if (row.source !== "custom") throw new HttpError(403, "Only custom items can be edited. Catalog items change through catalog updates.");
  const body = await readJson(request, 5000);
  const f = cleanItemFields(body, row.section_id);
  await mutate(env, origin, actor, "item.update", `${f.name} (${id})`, [
    env.DB
      .prepare("UPDATE items SET name = ?, tier = ?, material = ?, applies_to = ?, effects = ?, categories = ? WHERE id = ?")
      .bind(f.name, f.tier, f.material, f.applies_to, f.effects, f.categories, id),
  ]);
  return json({ ok: true });
}

async function deleteItem(env, actor, origin, id) {
  const row = await env.DB.prepare("SELECT name, source FROM items WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "Unknown item.");
  if (row.source !== "custom") throw new HttpError(403, "Only custom items can be deleted.");
  await mutate(env, origin, actor, "item.delete", `${row.name} (${id})`, [
    env.DB.prepare("DELETE FROM item_state WHERE item_id = ?").bind(id),
    env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}

async function exportAll(env) {
  const all = await loadAll(env.DB);
  const data = {
    format: "vault-stockroom-export",
    version: 1,
    exportedAt: nowIso(),
    catalogVersion: all.catalogVersion,
    site: all.site,
    sections: all.sections.map((s) => ({ id: s.id, enabled: s.enabled })),
    state: all.items
      .filter((i) => i.learned || i.offering || i.qtyHave || i.qtyWant)
      .map((i) => ({ id: i.id, learned: i.learned, offering: i.offering, qtyHave: i.qtyHave, qtyWant: i.qtyWant })),
    custom: all.items
      .filter((i) => i.source === "custom")
      .map((i) => ({
        id: i.id,
        section: i.section,
        name: i.name,
        tier: i.tier ?? null,
        material: i.material || null,
        appliesTo: i.appliesTo || null,
        effects: i.effects || null,
        categories: i.categories || null,
      })),
  };
  const day = nowIso().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="vault-stockroom-export-${day}.json"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function importAll(request, env, actor, origin) {
  const body = await readJson(request, 1_500_000);
  if (!body || body.format !== "vault-stockroom-export" || body.version !== 1) {
    throw new HttpError(400, "This is not a Vault Stockroom export file.");
  }
  const site = cleanSite(body.site);
  const sectionRows = (await env.DB.prepare("SELECT id FROM sections").all()).results;
  const sectionIds = new Set(sectionRows.map((r) => r.id));
  const itemRows = (await env.DB.prepare("SELECT id FROM items").all()).results;
  const knownItems = new Set(itemRows.map((r) => r.id));
  const now = nowIso();
  const stmts = [];

  stmts.push(
    env.DB
      .prepare("INSERT INTO settings (key, value) VALUES ('site', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(site))
  );

  for (const s of Array.isArray(body.sections) ? body.sections : []) {
    if (s && sectionIds.has(s.id)) stmts.push(env.DB.prepare("UPDATE sections SET enabled = ? WHERE id = ?").bind(flag(s.enabled), s.id));
  }

  // Custom items first so their state rows have something to point at.
  let customCount = 0;
  for (const c of Array.isArray(body.custom) ? body.custom : []) {
    if (!c || typeof c.id !== "string" || !c.id.startsWith("custom-") || !ITEM_ID.test(c.id)) continue;
    if (!sectionIds.has(c.section)) continue;
    const f = cleanItemFields({ ...c, effect: c.effects ? Object.values(c.effects)[0] : "" }, c.section);
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO items (id, section_id, source, name, tier, material, applies_to, effects, categories)
           VALUES (?, ?, 'custom', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, tier = excluded.tier, material = excluded.material,
             applies_to = excluded.applies_to, effects = excluded.effects, categories = excluded.categories`
        )
        .bind(c.id, c.section, f.name, f.tier, f.material, f.applies_to, f.effects, f.categories)
    );
    knownItems.add(c.id);
    customCount++;
  }

  let stateCount = 0;
  let skipped = 0;
  for (const s of Array.isArray(body.state) ? body.state : []) {
    if (!s || typeof s.id !== "string" || !knownItems.has(s.id)) {
      skipped++;
      continue;
    }
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO item_state (item_id, learned, offering, qty_have, qty_want, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(item_id) DO UPDATE SET learned = excluded.learned, offering = excluded.offering,
             qty_have = excluded.qty_have, qty_want = excluded.qty_want, updated_at = excluded.updated_at`
        )
        .bind(s.id, flag(s.learned), flag(s.offering), count(s.qtyHave ?? 0), count(s.qtyWant ?? 0), now)
    );
    stateCount++;
  }

  await runChunked(env.DB, stmts);
  await env.DB.batch(auditStatements(env.DB, actor, "import", `${stateCount} state rows, ${customCount} custom items, ${skipped} skipped`));
  await refreshPublic(env, origin);
  return json({ ok: true, state: stateCount, custom: customCount, skipped });
}

async function getAudit(env) {
  const rows = (await env.DB.prepare("SELECT at, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT 100").all()).results;
  return json({ entries: rows });
}

// ---------- router ----------

export async function adminRoute(request, env, url) {
  const admin = await requireAdmin(request, env);
  const origin = url.origin;
  const method = request.method;
  const path = url.pathname;
  if (method !== "GET") requireSameOrigin(request);

  if (method === "GET" && path === "/api/admin/whoami") return json({ email: admin.email });
  if (method === "GET" && path === "/api/admin/data") return getData(env);
  if (method === "GET" && path === "/api/admin/export") return exportAll(env);
  if (method === "GET" && path === "/api/admin/audit") return getAudit(env);

  if (method === "POST" && path === "/api/admin/state") return saveState(request, env, admin.email, origin);
  if (method === "POST" && path === "/api/admin/sections") return setSection(request, env, admin.email, origin);
  if (method === "PUT" && path === "/api/admin/site") return saveSite(request, env, admin.email, origin);
  if (method === "POST" && path === "/api/admin/items") return createItem(request, env, admin.email, origin);
  if (method === "POST" && path === "/api/admin/import") return importAll(request, env, admin.email, origin);

  const m = path.match(/^\/api\/admin\/items\/([A-Za-z0-9_-]{1,64})$/);
  if (m && method === "PUT") return updateItem(request, env, admin.email, origin, m[1]);
  if (m && method === "DELETE") return deleteItem(env, admin.email, origin, m[1]);

  throw new HttpError(404, "Not found.");
}
