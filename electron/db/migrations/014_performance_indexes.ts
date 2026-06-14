import type Database from 'better-sqlite3';

export const migration014 = {
  version: 14,
  name: 'performance indexes',
  up(db: Database.Database) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sales_decl_period_declarable
        ON sales(declared_period, urssaf_declarable);
      CREATE INDEX IF NOT EXISTS idx_sales_classification_status
        ON sales(classification, status);
      CREATE INDEX IF NOT EXISTS idx_sales_encashment_declarable
        ON sales(declared_encashment_date, urssaf_declarable)
        WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_stock_movements_sale
        ON stock_movements(linked_sale_id, movement_type);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_item
        ON stock_movements(stock_item_id, movement_date);
      CREATE INDEX IF NOT EXISTS idx_expenses_date_category
        ON expenses(date, category);
      CREATE INDEX IF NOT EXISTS idx_purchases_payment_date
        ON purchases(payment_date);
      CREATE INDEX IF NOT EXISTS idx_documents_hash
        ON documents(file_hash);
      CREATE INDEX IF NOT EXISTS idx_documents_links
        ON document_links(entity_type, entity_id, document_id);
    `);
  }
};
