import type Database from 'better-sqlite3';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function addColumn(db: Database.Database, table: string, definition: string): void {
  const column = definition.trim().split(/\s+/)[0];
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

export const migration010 = {
  version: 10,
  name: 'multi-marketplace foundation',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS marketplaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'marketplace',
        website TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        default_currency TEXT NOT NULL DEFAULT 'EUR',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        marketplace_id INTEGER REFERENCES marketplaces(id) ON DELETE SET NULL,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        channel_type TEXT NOT NULL DEFAULT 'mixed',
        is_active INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        platform_id INTEGER REFERENCES marketplaces(id) ON DELETE SET NULL,
        supplier_type TEXT NOT NULL DEFAULT 'other',
        website TEXT,
        contact TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name, platform_id)
      );

      CREATE TABLE IF NOT EXISTS csv_mapping_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        platform_id INTEGER REFERENCES marketplaces(id) ON DELETE SET NULL,
        adapter_id TEXT,
        mapping_json TEXT NOT NULL,
        date_format TEXT,
        decimal_separator TEXT,
        delimiter TEXT,
        currency TEXT NOT NULL DEFAULT 'EUR',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_csv_mapping_templates_entity ON csv_mapping_templates(entity_type, platform_id);

      CREATE TABLE IF NOT EXISTS csv_mapping_template_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES csv_mapping_templates(id) ON DELETE CASCADE,
        import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL,
        used_at TEXT NOT NULL DEFAULT (datetime('now')),
        rows_imported INTEGER NOT NULL DEFAULT 0,
        rows_skipped INTEGER NOT NULL DEFAULT 0,
        rows_error INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_csv_mapping_usage_template ON csv_mapping_template_usage(template_id, used_at);
    `);

    const seedMarketplace = db.prepare(`
      INSERT INTO marketplaces (slug, name, type, website, default_currency, notes)
      VALUES (@slug, @name, @type, @website, @default_currency, @notes)
      ON CONFLICT(slug) DO UPDATE SET
        name=excluded.name,
        type=excluded.type,
        website=excluded.website,
        default_currency=excluded.default_currency,
        notes=COALESCE(marketplaces.notes, excluded.notes),
        updated_at=datetime('now')
    `);
    [
      { slug: 'vinted', name: 'Vinted', type: 'marketplace', website: 'https://www.vinted.fr', default_currency: 'EUR', notes: 'Marketplace de vente/achat. Vinteer reste un adaptateur/source d’export.' },
      { slug: 'vinteer', name: 'Vinteer', type: 'tool', website: null, default_currency: 'EUR', notes: 'Outil/source d’exports CSV, pas le marketplace final.' },
      { slug: 'whatnot', name: 'WhatNot', type: 'marketplace', website: 'https://www.whatnot.com', default_currency: 'EUR', notes: null },
      { slug: 'leboncoin', name: 'LeBonCoin', type: 'marketplace', website: 'https://www.leboncoin.fr', default_currency: 'EUR', notes: null },
      { slug: 'brocante', name: 'Brocante / vide-grenier', type: 'physical', website: null, default_currency: 'EUR', notes: 'Canal physique sans ID externe fiable.' },
      { slug: 'vente_directe', name: 'Vente directe', type: 'direct', website: null, default_currency: 'EUR', notes: null },
      { slug: 'instagram', name: 'Instagram / réseaux sociaux', type: 'social', website: 'https://www.instagram.com', default_currency: 'EUR', notes: null },
      { slug: 'aliexpress', name: 'AliExpress', type: 'marketplace', website: 'https://www.aliexpress.com', default_currency: 'EUR', notes: 'Justificatifs d’achats.' },
      { slug: 'autre', name: 'Autre', type: 'other', website: null, default_currency: 'EUR', notes: null }
    ].forEach((m) => seedMarketplace.run(m));

    const marketplaceId = (slug: string): number | null =>
      (db.prepare(`SELECT id FROM marketplaces WHERE slug=?`).get(slug) as { id: number } | undefined)?.id ?? null;

    const seedChannel = db.prepare(`
      INSERT INTO channels (marketplace_id, slug, name, channel_type, notes)
      VALUES (@marketplace_id, @slug, @name, @channel_type, @notes)
      ON CONFLICT(slug) DO UPDATE SET
        marketplace_id=excluded.marketplace_id,
        name=excluded.name,
        channel_type=excluded.channel_type,
        notes=COALESCE(channels.notes, excluded.notes),
        updated_at=datetime('now')
    `);
    [
      { marketplace_id: marketplaceId('vinted'), slug: 'vinted_personnel', name: 'Vinted personnel', channel_type: 'sale', notes: 'Ventes personnelles / hors activité possibles.' },
      { marketplace_id: marketplaceId('vinted'), slug: 'vinted_pro', name: 'Vinted Pro', channel_type: 'sale', notes: 'Ventes professionnelles.' },
      { marketplace_id: marketplaceId('whatnot'), slug: 'whatnot_achats', name: 'WhatNot achats', channel_type: 'purchase', notes: null },
      { marketplace_id: marketplaceId('brocante'), slug: 'brocante_physique', name: 'Brocante physique', channel_type: 'mixed', notes: null },
      { marketplace_id: marketplaceId('vente_directe'), slug: 'vente_directe', name: 'Vente directe', channel_type: 'sale', notes: null },
      { marketplace_id: marketplaceId('autre'), slug: 'csv_generique', name: 'CSV générique', channel_type: 'mixed', notes: 'Import flexible avec mapping.' }
    ].forEach((c) => seedChannel.run(c));

    const tables = ['sales', 'purchases', 'expenses', 'stock_items', 'boosts', 'documents'] as const;
    for (const table of tables) {
      addColumn(db, table, 'platform_id INTEGER REFERENCES marketplaces(id) ON DELETE SET NULL');
      addColumn(db, table, 'channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL');
      if (table !== 'sales' && table !== 'boosts') {
        addColumn(db, table, 'supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL');
      }
      addColumn(db, table, 'canonical_platform TEXT');
      addColumn(db, table, 'source_adapter_id TEXT');
      addColumn(db, table, 'dedup_key TEXT');
      addColumn(db, table, 'dedup_confidence TEXT');
      addColumn(db, table, 'raw_source TEXT');
      if (table !== 'documents') {
        addColumn(db, table, 'external_reference TEXT');
      }
    }

    addColumn(db, 'imports', 'source_adapter_id TEXT');
    addColumn(db, 'imports', 'platform_id INTEGER REFERENCES marketplaces(id) ON DELETE SET NULL');
    addColumn(db, 'imports', 'channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL');
    addColumn(db, 'imports', 'adapter_label TEXT');

    const vintedId = marketplaceId('vinted');
    const vinteerId = marketplaceId('vinteer');
    const whatnotId = marketplaceId('whatnot');
    const leboncoinId = marketplaceId('leboncoin');
    const brocanteId = marketplaceId('brocante');
    const directId = marketplaceId('vente_directe');
    const instagramId = marketplaceId('instagram');
    const aliexpressId = marketplaceId('aliexpress');
    const autreId = marketplaceId('autre');
    const csvChannelId = (db.prepare(`SELECT id FROM channels WHERE slug='csv_generique'`).get() as { id: number } | undefined)?.id ?? null;

    db.prepare(`
      UPDATE sales SET
        canonical_platform=COALESCE(canonical_platform, lower(COALESCE(platform, 'vinted'))),
        platform_id=COALESCE(platform_id,
          CASE
            WHEN lower(COALESCE(platform, source, '')) LIKE '%whatnot%' THEN ?
            WHEN lower(COALESCE(platform, source, '')) LIKE '%leboncoin%' THEN ?
            WHEN lower(COALESCE(platform, source, '')) LIKE '%brocante%' OR lower(COALESCE(platform, source, '')) LIKE '%vide%' THEN ?
            WHEN lower(COALESCE(platform, source, '')) LIKE '%instagram%' THEN ?
            WHEN lower(COALESCE(platform, source, '')) LIKE '%direct%' THEN ?
            WHEN lower(COALESCE(platform, source, '')) LIKE '%vinted%' OR source='vinteer' THEN ?
            ELSE ?
          END
        ),
        source_adapter_id=COALESCE(source_adapter_id, CASE WHEN source='vinteer' THEN 'vinteer_sales' ELSE 'manual_entry' END),
        raw_source=COALESCE(raw_source, source),
        external_reference=COALESCE(external_reference, external_id),
        dedup_confidence=COALESCE(dedup_confidence, CASE WHEN external_id IS NOT NULL AND external_id != '' THEN 'high' ELSE 'low' END),
        dedup_key=COALESCE(
          dedup_key,
          CASE
            WHEN external_id IS NOT NULL AND external_id != '' THEN 'sale|' || COALESCE(CAST(? AS TEXT), canonical_platform, platform, source, 'unknown') || '|id|' || lower(trim(external_id))
            ELSE 'sale|fallback|legacy|' || id
          END
        )
      WHERE dedup_key IS NULL OR platform_id IS NULL OR source_adapter_id IS NULL
    `).run(whatnotId, leboncoinId, brocanteId, instagramId, directId, vintedId, autreId, vintedId);

    db.prepare(`
      UPDATE purchases SET
        canonical_platform=COALESCE(canonical_platform, lower(COALESCE(platform, source, 'autre'))),
        platform_id=COALESCE(platform_id,
          CASE
            WHEN lower(COALESCE(platform, source, '')) LIKE '%whatnot%' THEN ?
            WHEN lower(COALESCE(platform, source, '')) LIKE '%vinted%' OR source='vinteer' THEN ?
            ELSE ?
          END
        ),
        source_adapter_id=COALESCE(source_adapter_id,
          CASE
            WHEN source='whatnot' THEN 'whatnot_purchases'
            WHEN source='vinteer' THEN 'vinteer_purchases'
            ELSE 'manual_entry'
          END
        ),
        raw_source=COALESCE(raw_source, source),
        external_reference=COALESCE(external_reference, external_id),
        dedup_confidence=COALESCE(dedup_confidence, CASE WHEN external_id IS NOT NULL AND external_id != '' THEN 'high' ELSE 'low' END),
        dedup_key=COALESCE(
          dedup_key,
          CASE
            WHEN external_id IS NOT NULL AND external_id != '' THEN 'purchase|' || COALESCE(CAST(platform_id AS TEXT), canonical_platform, platform, source, 'unknown') || '|id|' || lower(trim(external_id))
            ELSE 'purchase|fallback|legacy|' || id
          END
        )
      WHERE dedup_key IS NULL OR platform_id IS NULL OR source_adapter_id IS NULL
    `).run(whatnotId, vintedId, autreId);

    db.prepare(`
      UPDATE expenses SET
        canonical_platform=COALESCE(canonical_platform, lower(COALESCE(platform, supplier, source, 'autre'))),
        platform_id=COALESCE(platform_id,
          CASE
            WHEN lower(COALESCE(platform, supplier, source, '')) LIKE '%vinted%' THEN ?
            WHEN lower(COALESCE(platform, supplier, source, '')) LIKE '%whatnot%' THEN ?
            ELSE ?
          END
        ),
        source_adapter_id=COALESCE(source_adapter_id, CASE WHEN source='vinteer_boost' THEN 'vinteer_boosts' ELSE 'manual_entry' END),
        raw_source=COALESCE(raw_source, source),
        external_reference=COALESCE(external_reference, notes),
        dedup_confidence=COALESCE(dedup_confidence, CASE WHEN notes LIKE '%boost:%' THEN 'high' ELSE 'low' END),
        dedup_key=COALESCE(
          dedup_key,
          CASE
            WHEN notes LIKE '%boost:%' THEN 'expense|' || COALESCE(CAST(? AS TEXT), 'vinted') || '|id|' || lower(trim(replace(notes, 'boost:', '')))
            ELSE 'expense|fallback|legacy|' || id
          END
        )
      WHERE dedup_key IS NULL OR platform_id IS NULL OR source_adapter_id IS NULL
    `).run(vintedId, whatnotId, autreId, vintedId);

    db.prepare(`
      UPDATE stock_items SET
        canonical_platform=COALESCE(canonical_platform, lower(COALESCE(platform, source, 'autre'))),
        platform_id=COALESCE(platform_id,
          CASE
            WHEN lower(COALESCE(platform, source, '')) LIKE '%whatnot%' THEN ?
            WHEN lower(COALESCE(platform, source, '')) LIKE '%vinted%' OR source='vinteer_inventory' THEN ?
            ELSE ?
          END
        ),
        source_adapter_id=COALESCE(source_adapter_id, CASE WHEN source='vinteer_inventory' THEN 'vinteer_inventory' ELSE 'manual_entry' END),
        channel_id=COALESCE(channel_id, ?),
        raw_source=COALESCE(raw_source, source),
        external_reference=COALESCE(external_reference, internal_code),
        dedup_confidence=COALESCE(dedup_confidence, 'medium'),
        dedup_key=COALESCE(dedup_key, 'stock_item|' || COALESCE(CAST(platform_id AS TEXT), canonical_platform, source, 'unknown') || '|code|' || lower(trim(internal_code)))
      WHERE dedup_key IS NULL OR platform_id IS NULL OR source_adapter_id IS NULL
    `).run(whatnotId, vintedId, autreId, csvChannelId);

    db.prepare(`
      UPDATE boosts SET
        canonical_platform=COALESCE(canonical_platform, 'vinted'),
        platform_id=COALESCE(platform_id, ?),
        source_adapter_id=COALESCE(source_adapter_id, 'vinteer_boosts'),
        raw_source=COALESCE(raw_source, source),
        external_reference=COALESCE(external_reference, external_id),
        dedup_confidence=COALESCE(dedup_confidence, CASE WHEN external_id IS NOT NULL AND external_id != '' THEN 'high' ELSE 'low' END),
        dedup_key=COALESCE(
          dedup_key,
          CASE
            WHEN external_id IS NOT NULL AND external_id != '' THEN 'boost|' || COALESCE(CAST(? AS TEXT), 'vinted') || '|id|' || lower(trim(external_id))
            ELSE 'boost|fallback|legacy|' || id
          END
        )
      WHERE dedup_key IS NULL OR platform_id IS NULL OR source_adapter_id IS NULL
    `).run(vintedId, vintedId);

    db.prepare(`
      UPDATE documents SET
        canonical_platform=COALESCE(canonical_platform, lower(COALESCE(source, 'autre'))),
        platform_id=COALESCE(platform_id,
          CASE
            WHEN lower(COALESCE(source, '')) LIKE '%vinted%' THEN ?
            WHEN lower(COALESCE(source, '')) LIKE '%whatnot%' THEN ?
            WHEN lower(COALESCE(source, '')) LIKE '%aliexpress%' THEN ?
            ELSE ?
          END
        ),
        source_adapter_id=COALESCE(source_adapter_id, 'document_import'),
        raw_source=COALESCE(raw_source, source),
        dedup_confidence=COALESCE(dedup_confidence, 'high'),
        dedup_key=COALESCE(dedup_key, 'document|' || COALESCE(CAST(platform_id AS TEXT), canonical_platform, source, 'unknown') || '|hash|' || lower(trim(file_hash)))
      WHERE dedup_key IS NULL OR platform_id IS NULL OR source_adapter_id IS NULL
    `).run(vintedId, whatnotId, aliexpressId, autreId);

    db.prepare(`
      UPDATE imports SET
        source_adapter_id=COALESCE(source_adapter_id, import_type),
        platform_id=COALESCE(platform_id,
          CASE
            WHEN import_type LIKE 'whatnot%' THEN ?
            WHEN import_type LIKE 'vinteer%' THEN ?
            ELSE ?
          END
        ),
        channel_id=COALESCE(channel_id, ?),
        adapter_label=COALESCE(adapter_label, import_type)
      WHERE source_adapter_id IS NULL OR platform_id IS NULL
    `).run(whatnotId, vintedId ?? vinteerId, autreId, csvChannelId);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sales_dedup_key ON sales(dedup_key);
      CREATE INDEX IF NOT EXISTS idx_purchases_dedup_key ON purchases(dedup_key);
      CREATE INDEX IF NOT EXISTS idx_expenses_dedup_key ON expenses(dedup_key);
      CREATE INDEX IF NOT EXISTS idx_stock_items_dedup_key ON stock_items(dedup_key);
      CREATE INDEX IF NOT EXISTS idx_boosts_dedup_key ON boosts(dedup_key);
      CREATE INDEX IF NOT EXISTS idx_documents_dedup_key ON documents(dedup_key);

      CREATE INDEX IF NOT EXISTS idx_sales_platform_channel ON sales(platform_id, channel_id);
      CREATE INDEX IF NOT EXISTS idx_purchases_platform_channel ON purchases(platform_id, channel_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_platform_channel ON expenses(platform_id, channel_id);
      CREATE INDEX IF NOT EXISTS idx_stock_items_platform_channel ON stock_items(platform_id, channel_id);
      CREATE INDEX IF NOT EXISTS idx_suppliers_platform ON suppliers(platform_id, name);
    `);
  }
};
