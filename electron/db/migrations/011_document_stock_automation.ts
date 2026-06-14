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

export const migration011 = {
  version: 11,
  name: 'document matching and automatic stock association',
  up(db: Database.Database) {
    addColumn(db, 'documents', 'extracted_sku TEXT');
    addColumn(db, 'documents', 'extracted_metadata_json TEXT');
    addColumn(db, 'documents', 'match_confidence TEXT');
    addColumn(db, 'documents', 'match_status TEXT');

    addColumn(db, 'stock_items', 'auto_created_from_sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL');
    addColumn(db, 'stock_items', 'auto_created_reason TEXT');

    addColumn(db, 'sales', 'stock_association_status TEXT');
    addColumn(db, 'purchases', 'justificatif_status TEXT');
    addColumn(db, 'imports', 'generated_justificatif_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS document_match_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        match_type TEXT NOT NULL,
        confidence TEXT NOT NULL DEFAULT 'medium',
        score REAL NOT NULL DEFAULT 0,
        reasons_json TEXT,
        status TEXT NOT NULL DEFAULT 'candidate',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(document_id, entity_type, entity_id, match_type)
      );

      CREATE INDEX IF NOT EXISTS idx_document_match_candidates_doc ON document_match_candidates(document_id, status);
      CREATE INDEX IF NOT EXISTS idx_document_match_candidates_entity ON document_match_candidates(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_documents_match_status ON documents(match_status, document_type);
      CREATE INDEX IF NOT EXISTS idx_documents_extracted_sku ON documents(extracted_sku);
      CREATE INDEX IF NOT EXISTS idx_stock_auto_sale ON stock_items(auto_created_from_sale_id);
      CREATE INDEX IF NOT EXISTS idx_sales_stock_assoc ON sales(stock_association_status);
      CREATE INDEX IF NOT EXISTS idx_purchases_justificatif ON purchases(justificatif_status);
    `);

    db.prepare(`
      UPDATE sales
      SET stock_association_status='associated'
      WHERE linked_stock_item_id IS NOT NULL
        AND (stock_association_status IS NULL OR stock_association_status='')
    `).run();

    db.prepare(`
      UPDATE purchases
      SET justificatif_status='present'
      WHERE (justificatif_status IS NULL OR justificatif_status='')
        AND EXISTS (
          SELECT 1 FROM document_links dl
          WHERE dl.entity_type='purchase' AND dl.entity_id=purchases.id
        )
    `).run();
  }
};
