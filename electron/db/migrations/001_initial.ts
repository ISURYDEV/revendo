import type Database from 'better-sqlite3';

export const migration001Initial = {
  version: 1,
  name: 'initial schema',
  up(db: Database.Database) {
    db.exec(`
    -- Imports log
    CREATE TABLE imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      rows_total INTEGER NOT NULL DEFAULT 0,
      rows_created INTEGER NOT NULL DEFAULT 0,
      rows_updated INTEGER NOT NULL DEFAULT 0,
      rows_skipped INTEGER NOT NULL DEFAULT 0,
      rows_error INTEGER NOT NULL DEFAULT 0,
      import_type TEXT NOT NULL,
      notes TEXT
    );
    CREATE INDEX idx_imports_hash ON imports(file_hash);
    CREATE INDEX idx_imports_type ON imports(import_type);

    -- Sales
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      external_id TEXT,
      import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL,
      sale_date TEXT,
      finalization_date TEXT,
      declared_encashment_date TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      sale_account TEXT,
      platform TEXT,
      is_pro_account INTEGER NOT NULL DEFAULT 0,
      article_name TEXT,
      quantity INTEGER,
      sku TEXT,
      brand TEXT,
      size TEXT,
      color TEXT,
      buyer_name TEXT,
      buyer_email TEXT,
      buyer_username TEXT,
      buyer_address TEXT,
      buyer_country TEXT,
      sale_price_ttc REAL,
      sale_price_ht REAL,
      vat_amount REAL,
      vinted_fees REAL,
      purchase_cost_total REAL,
      purchase_cost_base_margin REAL,
      ancillary_costs REAL,
      net_profit_source REAL,
      refunded_amount REAL,
      shipping_cost_ttc REAL,
      individual_prices_raw TEXT,
      vat_credit REAL,
      amount_received REAL,
      vat_rate REAL,
      multi_vat INTEGER,
      vat_detail TEXT,
      carrier TEXT,
      tracking_number TEXT,
      note TEXT,
      is_declarable INTEGER NOT NULL DEFAULT 1,
      declarable_amount REAL,
      exclusion_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, external_id)
    );
    CREATE INDEX idx_sales_external_id ON sales(external_id);
    CREATE INDEX idx_sales_status ON sales(status);
    CREATE INDEX idx_sales_declared_date ON sales(declared_encashment_date);
    CREATE INDEX idx_sales_declarable ON sales(is_declarable);

    -- Purchases
    CREATE TABLE purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      external_id TEXT,
      import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL,
      payment_date TEXT,
      status TEXT,
      created_date TEXT,
      updated_date TEXT,
      seller TEXT,
      buyer_account TEXT,
      platform TEXT,
      articles TEXT,
      quantity INTEGER,
      price_per_item_raw TEXT,
      sku TEXT,
      brand TEXT,
      size TEXT,
      color TEXT,
      total_ttc REAL,
      refunded_amount REAL,
      effective_amount REAL,
      items_price REAL,
      shipping_fee REAL,
      protection_fee REAL,
      estimated_sale_price REAL,
      vat_regime TEXT,
      base_ht REAL,
      deductible_vat REAL,
      vat_source TEXT,
      carrier TEXT,
      tracking_number TEXT,
      original_currency TEXT,
      original_amount REAL,
      exchange_rate REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, external_id)
    );
    CREATE INDEX idx_purchases_external_id ON purchases(external_id);
    CREATE INDEX idx_purchases_payment_date ON purchases(payment_date);

    -- Boosts
    CREATE TABLE boosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      external_id TEXT,
      import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL,
      start_date TEXT,
      boost_type TEXT,
      scope TEXT,
      duration_days INTEGER,
      boosted_articles_count INTEGER,
      amount_ht REAL,
      vat_rate REAL,
      vat_amount REAL,
      amount_ttc REAL,
      gross_price_ttc REAL,
      discount REAL,
      allocation_method TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, external_id)
    );
    CREATE INDEX idx_boosts_start_date ON boosts(start_date);

    -- Expenses
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'manual',
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      supplier TEXT,
      platform TEXT,
      description TEXT,
      amount_ttc REAL NOT NULL,
      amount_ht REAL,
      vat_amount REAL,
      vat_deductible REAL NOT NULL DEFAULT 0,
      payment_method TEXT,
      linked_product_id INTEGER,
      linked_sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
      linked_purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_expenses_date ON expenses(date);
    CREATE INDEX idx_expenses_category ON expenses(category);

    -- Products (canonical concept-level)
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT,
      brand TEXT,
      category TEXT,
      default_sku TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_products_name ON products(normalized_name);

    -- Stock items (one row per unit or per lot-unit)
    CREATE TABLE stock_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      internal_code TEXT NOT NULL UNIQUE,
      sku TEXT,
      name TEXT,
      source TEXT,
      purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
      supplier TEXT,
      platform TEXT,
      status TEXT NOT NULL DEFAULT 'in_stock',
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_cost_ttc REAL,
      total_cost_ttc REAL,
      estimated_sale_price REAL,
      brand TEXT,
      size TEXT,
      color TEXT,
      location TEXT,
      purchase_date TEXT,
      received_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_stock_items_status ON stock_items(status);
    CREATE INDEX idx_stock_items_sku ON stock_items(sku);
    CREATE INDEX idx_stock_items_code ON stock_items(internal_code);

    -- Stock movements
    CREATE TABLE stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
      movement_date TEXT NOT NULL DEFAULT (datetime('now')),
      movement_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_ttc REAL,
      total_cost_ttc REAL,
      reason TEXT,
      linked_sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
      linked_purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
      linked_document_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_stock_movements_item ON stock_movements(stock_item_id);
    CREATE INDEX idx_stock_movements_date ON stock_movements(movement_date);

    -- Documents
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      original_file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      mime_type TEXT,
      document_type TEXT,
      source TEXT,
      date TEXT,
      amount REAL,
      supplier_or_customer TEXT,
      external_reference TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_documents_hash ON documents(file_hash);

    -- Document links (polymorphic)
    CREATE TABLE document_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_doc_links_doc ON document_links(document_id);
    CREATE INDEX idx_doc_links_entity ON document_links(entity_type, entity_id);

    -- Declarations
    CREATE TABLE declarations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      period_type TEXT NOT NULL DEFAULT 'trimestrial',
      quarter INTEGER,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      due_date TEXT NOT NULL,
      ca_goods REAL NOT NULL DEFAULT 0,
      ca_services REAL NOT NULL DEFAULT 0,
      total_ca REAL NOT NULL DEFAULT 0,
      included_sales_count INTEGER NOT NULL DEFAULT 0,
      excluded_sales_count INTEGER NOT NULL DEFAULT 0,
      estimated_contributions_normal REAL,
      estimated_contributions_acre REAL,
      actual_declared_ca REAL,
      actual_paid_contributions REAL,
      status TEXT NOT NULL DEFAULT 'draft',
      declaration_date TEXT,
      urssaf_receipt_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(year, quarter, period_type)
    );

    -- Settings (key/value)
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Contribution rates table (editable, NOT hardcoded)
    CREATE TABLE contribution_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      activity_type TEXT NOT NULL,
      normal_rate REAL NOT NULL,
      acre_rate REAL NOT NULL,
      versement_liberatoire_rate REAL,
      notes TEXT,
      UNIQUE(year, activity_type)
    );

    -- Seed default rates for vente_marchandises_bic (USER MUST VERIFY EACH YEAR)
    -- Source officielle: urssaf.fr — taux 2025 vente marchandises: ~12.3% normal, ~6.2% ACRE 1ère année.
    -- L'utilisateur doit vérifier et corriger via Settings > Tasas.
    INSERT INTO contribution_rates (year, activity_type, normal_rate, acre_rate, versement_liberatoire_rate, notes)
    VALUES
      (2024, 'vente_marchandises_bic', 0.123, 0.062, 0.01, 'Valeur indicative — vérifier sur urssaf.fr'),
      (2025, 'vente_marchandises_bic', 0.123, 0.062, 0.01, 'Valeur indicative — vérifier sur urssaf.fr'),
      (2026, 'vente_marchandises_bic', 0.123, 0.062, 0.01, 'Valeur indicative — vérifier sur urssaf.fr');

    -- Default settings
    INSERT INTO settings (key, value) VALUES
      ('activity_type', 'vente_marchandises_bic'),
      ('urssaf_periodicity', 'trimestrial'),
      ('vat_regime', 'franchise_en_base'),
      ('default_currency', 'EUR'),
      ('acre_enabled', 'false'),
      ('versement_liberatoire', 'false');

    -- Sequence helper for internal stock codes
    CREATE TABLE _sequences (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO _sequences (name, value) VALUES ('stock_items_2026', 0);
    `);
  }
};
