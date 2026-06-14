import type Database from 'better-sqlite3';

/**
 * Migration 002:
 *  - Adds classification fields to sales (rule: collected sale without SKU and without linked
 *    purchase/stock = personal_item, hors activité, NOT declared in URSSAF CA)
 *  - Adds linked_stock_item_id, linked_purchase_id to sales
 *  - Adds allocation_targets JSON to boosts (for associating to multiple products/sales/campaigns)
 *  - Adds linked_boost_id to expenses
 *  - Adds sale_classification_audit table for change history
 *  - Backfills classification on existing sales using the same engine logic
 *  - Recomputes is_declarable from urssaf_declarable
 *
 * IDEMPOTENT and DATA-PRESERVING: no DROP, only ADD COLUMN + UPDATE.
 */
export const migration002 = {
  version: 2,
  name: 'classification and links',
  up(db: Database.Database) {
    // --- Sales: new classification fields ---
    db.exec(`
      ALTER TABLE sales ADD COLUMN classification TEXT;
      ALTER TABLE sales ADD COLUMN urssaf_declarable INTEGER;
      ALTER TABLE sales ADD COLUMN classification_reason TEXT;
      ALTER TABLE sales ADD COLUMN manual_override INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sales ADD COLUMN override_note TEXT;
      ALTER TABLE sales ADD COLUMN linked_stock_item_id INTEGER REFERENCES stock_items(id) ON DELETE SET NULL;
      ALTER TABLE sales ADD COLUMN linked_purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL;
      ALTER TABLE sales ADD COLUMN declared_period TEXT;
      CREATE INDEX IF NOT EXISTS idx_sales_classification ON sales(classification);
      CREATE INDEX IF NOT EXISTS idx_sales_urssaf_declarable ON sales(urssaf_declarable);
    `);

    // --- Boosts: allocation targets JSON ---
    db.exec(`
      ALTER TABLE boosts ADD COLUMN allocation_targets TEXT;
      ALTER TABLE boosts ADD COLUMN linked_campaign TEXT;
    `);

    // --- Expenses: link to boost ---
    db.exec(`
      ALTER TABLE expenses ADD COLUMN linked_boost_id INTEGER REFERENCES boosts(id) ON DELETE SET NULL;
      ALTER TABLE expenses ADD COLUMN linked_stock_item_id INTEGER REFERENCES stock_items(id) ON DELETE SET NULL;
    `);

    // --- Sale classification audit ---
    db.exec(`
      CREATE TABLE sale_classification_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        prev_classification TEXT,
        new_classification TEXT NOT NULL,
        prev_urssaf_declarable INTEGER,
        new_urssaf_declarable INTEGER NOT NULL,
        prev_reason TEXT,
        new_reason TEXT,
        manual INTEGER NOT NULL DEFAULT 0,
        note TEXT
      );
      CREATE INDEX idx_audit_sale ON sale_classification_audit(sale_id);
    `);

    // --- Backfill: classify all existing sales using the same rule engine ---
    // We reproduce the rule here (instead of calling JS) so the migration is self-contained.
    // Rule:
    //   status not collected (completed/colis_perdu)             → excluded, declarable=0
    //   collected AND (sku NOT NULL OR linked_*)                 → professional_resale, declarable=1
    //   collected AND no SKU and no link                         → personal_item, declarable=0
    db.exec(`
      UPDATE sales SET
        classification = CASE
          WHEN status NOT IN ('completed','colis_perdu') THEN 'excluded'
          WHEN sku IS NOT NULL AND sku != '' THEN 'professional_resale'
          WHEN linked_purchase_id IS NOT NULL OR linked_stock_item_id IS NOT NULL THEN 'professional_resale'
          ELSE 'personal_item'
        END,
        urssaf_declarable = CASE
          WHEN status NOT IN ('completed','colis_perdu') THEN 0
          WHEN sku IS NOT NULL AND sku != '' THEN 1
          WHEN linked_purchase_id IS NOT NULL OR linked_stock_item_id IS NOT NULL THEN 1
          ELSE 0
        END,
        classification_reason = CASE
          WHEN status NOT IN ('completed','colis_perdu') THEN 'Vente non finalisée / annulée / remboursée'
          WHEN sku IS NOT NULL AND sku != '' THEN 'Avec SKU : traité comme revente professionnelle'
          WHEN linked_purchase_id IS NOT NULL OR linked_stock_item_id IS NOT NULL THEN 'Avec achat/stock associé : revente professionnelle'
          ELSE 'Sans SKU ni achat associé : traité comme bien personnel hors activité'
        END
      WHERE classification IS NULL;
    `);

    // Now keep is_declarable in sync with urssaf_declarable (legacy column still used by some queries).
    db.exec(`UPDATE sales SET is_declarable = urssaf_declarable WHERE is_declarable != urssaf_declarable;`);

    // Pre-compute declared_period for fast quarterly grouping (YYYY-Q[1-4])
    db.exec(`
      UPDATE sales
      SET declared_period =
        CASE
          WHEN declared_encashment_date IS NULL THEN NULL
          ELSE substr(declared_encashment_date, 1, 4) || '-Q' ||
               CASE
                 WHEN cast(substr(declared_encashment_date, 6, 2) as integer) <= 3 THEN '1'
                 WHEN cast(substr(declared_encashment_date, 6, 2) as integer) <= 6 THEN '2'
                 WHEN cast(substr(declared_encashment_date, 6, 2) as integer) <= 9 THEN '3'
                 ELSE '4'
               END
        END
      WHERE declared_period IS NULL;
    `);
  }
};
