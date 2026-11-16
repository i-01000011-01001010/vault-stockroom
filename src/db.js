// Database helpers: reading everything, and building the public snapshot.
//
// The public page never queries the item tables. Every admin save rebuilds one
// JSON snapshot stored in the settings table, and the public API serves that
// single row (also edge-cached). That keeps database reads per visitor near zero.

import { nowIso } from "./util.js";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function parseJson(value) {
  if (value === null || value === undefined || value === "") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function rowToItem(r) {
  const it = { id: r.id, section: r.section_id, name: r.name };
  if (r.tier !== null && r.tier !== undefined) it.tier = r.tier;
  if (r.material) it.material = r.material;
  const materials = parseJson(r.materials);
  if (materials) it.materials = materials;
  const appliesTo = parseJson(r.applies_to);
  if (appliesTo) it.appliesTo = appliesTo;
  const effects = parseJson(r.effects);
  if (effects) it.effects = effects;
  const categories = parseJson(r.categories);
  if (categories) it.categories = categories;
  if (r.notes) it.notes = r.notes;
  return it;
}

function sortItems(items, sectionOrder) {
  return items.sort(
    (a, b) =>
      (sectionOrder.get(a.section) ?? 99) - (sectionOrder.get(b.section) ?? 99) ||
      (a.tier ?? 0) - (b.tier ?? 0) ||
      collator.compare(a.name, b.name)
  );
}

/** Everything the admin needs: all sections, all items with the owner's state. */
export async function loadAll(db) {
  const [sections, site, items, version] = await db.batch([
    db.prepare("SELECT id, title, kind, sort, enabled FROM sections ORDER BY sort"),
    db.prepare("SELECT value FROM settings WHERE key = 'site'"),
    db.prepare(
      `SELECT i.*, s.learned, s.offering, s.qty_have, s.qty_want
         FROM items i LEFT JOIN item_state s ON s.item_id = i.id
        WHERE i.deleted = 0`
    ),
    db.prepare("SELECT value FROM settings WHERE key = 'catalog_version'"),
  ]);

  const secList = sections.results.map((s) => ({ id: s.id, title: s.title, kind: s.kind, enabled: !!s.enabled }));
  const order = new Map(secList.map((s, i) => [s.id, i]));
  const list = items.results.map((r) => ({
    ...rowToItem(r),
    source: r.source,
    learned: !!r.learned,
    offering: !!r.offering,
    qtyHave: r.qty_have || 0,
    qtyWant: r.qty_want || 0,
  }));
  sortItems(list, order);

  return {
    sections: secList,
    site: parseJson(site.results[0]?.value) || {},
    items: list,
    catalogVersion: version.results[0]?.value || "",
  };
}

/** What visitors see: only enabled sections, only the fields the page needs. */
export async function buildSnapshot(db) {
  const all = await loadAll(db);
  const enabled = all.sections.filter((s) => s.enabled);
  const enabledIds = new Set(enabled.map((s) => s.id));
  const items = all.items
    .filter((it) => enabledIds.has(it.section))
    .map((it) => {
      const { learned, offering, qtyHave, qtyWant, source, ...rest } = it;
      const out = { ...rest, available: offering };
      if (qtyHave) out.qtyHave = qtyHave;
      if (qtyWant) out.qtyWant = qtyWant;
      return out;
    });
  return {
    site: all.site,
    sections: enabled.map(({ id, title, kind }) => ({ id, title, kind })),
    items,
    updatedAt: nowIso(),
  };
}

export async function storeSnapshot(db, snapshot) {
  const text = JSON.stringify(snapshot);
  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('public_snapshot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(text)
    .run();
  return text;
}

/** One-row read for the public API; builds it on first use. */
export async function getSnapshotText(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'public_snapshot'").first();
  if (row && row.value) return row.value;
  return storeSnapshot(db, await buildSnapshot(db));
}

export function auditStatements(db, actor, action, detail) {
  return [
    db
      .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
      .bind(nowIso(), actor, action, detail ? String(detail).slice(0, 500) : null),
    // keep the log from growing without bound
    db.prepare("DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - 1000"),
  ];
}
