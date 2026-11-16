-- Vault Stockroom schema, version 1.
-- Catalog definitions (items) are kept apart from the owner's choices (item_state)
-- so a catalog update never overwrites what the owner has marked.

CREATE TABLE sections (
  id      TEXT PRIMARY KEY,
  title   TEXT NOT NULL,
  kind    TEXT NOT NULL DEFAULT 'craft',
  sort    INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE items (
  id              TEXT PRIMARY KEY,
  section_id      TEXT NOT NULL REFERENCES sections(id),
  source          TEXT NOT NULL DEFAULT 'catalog' CHECK (source IN ('catalog', 'custom')),
  name            TEXT NOT NULL,
  tier            INTEGER,
  material        TEXT,
  materials       TEXT,
  applies_to      TEXT,
  effects         TEXT,
  categories      TEXT,
  notes           TEXT,
  catalog_version TEXT,
  deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_section ON items(section_id);

CREATE TABLE item_state (
  item_id    TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  learned    INTEGER NOT NULL DEFAULT 0,
  offering   INTEGER NOT NULL DEFAULT 0,
  qty_have   INTEGER NOT NULL DEFAULT 0,
  qty_want   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     TEXT NOT NULL,
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);

INSERT INTO sections (id, title, kind, sort, enabled) VALUES
  ('mods',       'MODS',            'craft', 1, 1),
  ('weapons',    'WEAPONS',         'craft', 2, 1),
  ('armor',      'ARMOR',           'craft', 3, 1),
  ('underarmor', 'UNDER ARMOR',     'craft', 4, 1),
  ('apparel',    'APPAREL',         'craft', 5, 1),
  ('serums',     'MUTATION SERUMS', 'craft', 6, 1);

INSERT INTO settings (key, value) VALUES
  ('site', '{"campName":"YOUR CAMP NAME","inGameName":"YourPipBoyName","discord":"yourname","server":"PC / Xbox / PlayStation","tagline":"Legendary crafting, weapon and armor mods, and trade goods. Message me in-game or on Discord to arrange a swap.","note":"Everything listed is craftable at my C.A.M.P. or already in my stash for trade.","modsNote":"Legendary Modules are supplied by me. Some mods need an uncommon material, check the tag under each mod. Bring it, or we can try and work something out.","trade":{"acceptingCaps":true,"note":""},"notice":{"enabled":true,"title":"","text":""}}');
