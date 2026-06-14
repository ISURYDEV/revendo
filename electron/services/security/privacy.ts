import type Database from 'better-sqlite3';

export interface PrivacyOptions {
  maskBuyer: boolean;
  maskContact: boolean;
  maskUsername: boolean;
  anonymizedExports: boolean;
  mobileRedaction: boolean;
}

export interface RedactionOptions {
  maskBuyer?: boolean;
  maskContact?: boolean;
  maskUsername?: boolean;
}

function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function getPrivacyOptions(db: Database.Database): PrivacyOptions {
  return {
    maskBuyer: getSetting(db, 'privacy_mask_buyers_ui') === 'true',
    maskContact: getSetting(db, 'privacy_mask_contact_ui') === 'true',
    maskUsername: getSetting(db, 'privacy_mask_username_ui') === 'true',
    anonymizedExports: getSetting(db, 'privacy_exports_anonymized_default') !== 'false',
    mobileRedaction: getSetting(db, 'mobile_snapshot_redaction_enabled') !== 'false'
  };
}

export function maskValue(value: unknown, replacement: string): unknown {
  if (value == null || value === '') return value;
  return replacement;
}

export function redactSaleRow<T extends Record<string, unknown>>(row: T, options: RedactionOptions): T {
  const out: Record<string, unknown> = { ...row };
  if (options.maskBuyer) {
    out.buyer_name = maskValue(out.buyer_name, 'Acheteur masqué');
  }
  if (options.maskUsername) {
    out.buyer_username = maskValue(out.buyer_username, 'Acheteur masqué');
  }
  if (options.maskContact) {
    out.buyer_email = maskValue(out.buyer_email, 'Email masqué');
    out.buyer_address = maskValue(out.buyer_address, 'Adresse masquée');
  }
  return out as T;
}

export function redactDocumentRow<T extends Record<string, unknown>>(row: T, options: RedactionOptions): T {
  const out: Record<string, unknown> = { ...row };
  if (options.maskBuyer || options.maskUsername) {
    out.supplier_or_customer = maskValue(out.supplier_or_customer, 'Tiers masqué');
  }
  return out as T;
}

export function redactDiaryRow<T extends Record<string, unknown>>(row: T, options: RedactionOptions): T {
  const out: Record<string, unknown> = { ...row };
  if (options.maskBuyer || options.maskContact) {
    out.note = maskValue(out.note, 'Note masquée');
  }
  return out as T;
}

export function redactCompanyRow<T extends Record<string, unknown>>(settings: T, options: RedactionOptions): T {
  const out: Record<string, unknown> = { ...settings };
  if (options.maskBuyer && options.maskContact) {
    out.first_name = maskValue(out.first_name, 'Identité masquée');
    out.last_name = maskValue(out.last_name, 'Identité masquée');
    out.commercial_name = maskValue(out.commercial_name, 'Entreprise masquée');
    out.address = maskValue(out.address, 'Adresse masquée');
    out.email = maskValue(out.email, 'Email masqué');
    out.siret = maskValue(out.siret, 'SIRET masqué');
  }
  return out as T;
}

export function redactSettingsRows(rows: Array<Record<string, unknown>>, options: RedactionOptions): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const key = String(row.key ?? '');
    if (options.maskContact && ['email', 'address'].includes(key)) return { ...row, value: key === 'email' ? 'Email masqué' : 'Adresse masquée' };
    if (options.maskBuyer && ['first_name', 'last_name'].includes(key)) return { ...row, value: 'Identité masquée' };
    return row;
  });
}

export function redactRowsForExport(
  table: string,
  rows: Array<Record<string, unknown>>,
  options: RedactionOptions
): Array<Record<string, unknown>> {
  if (table === 'sales') return rows.map((r) => redactSaleRow(r, { ...options, maskBuyer: true, maskContact: true, maskUsername: true }));
  if (table === 'documents') return rows.map((r) => redactDocumentRow(r, { ...options, maskBuyer: true, maskContact: true, maskUsername: true }));
  if (table === 'settings') return redactSettingsRows(rows, { ...options, maskBuyer: true, maskContact: true, maskUsername: true });
  return rows;
}

export function redactTextForDisplay(value: unknown, fallback: string, enabled: boolean): unknown {
  return enabled ? maskValue(value, fallback) : value;
}
