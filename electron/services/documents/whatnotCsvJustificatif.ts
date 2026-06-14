import type Database from 'better-sqlite3';
import { addDocument, linkDocument } from './storage';

export function attachWhatNotCsvJustificatif(
  db: Database.Database,
  payload: { importId: number; csvPath: string; fileName: string }
): { documentId: number | null; linkedPurchases: number; deduplicated: boolean } {
  const purchases = db.prepare(
    `SELECT id, total_ttc
     FROM purchases
     WHERE import_id=? AND lower(COALESCE(platform, source, '')) LIKE '%whatnot%'`
  ).all(payload.importId) as { id: number; total_ttc: number | null }[];

  if (purchases.length === 0) {
    return { documentId: null, linkedPurchases: 0, deduplicated: false };
  }

  const total = purchases.reduce((sum, p) => sum + (p.total_ttc ?? 0), 0);
  const doc = addDocument(db, {
    sourcePath: payload.csvPath,
    document_type: 'whatnot_purchase_csv',
    date: new Date().toISOString().slice(0, 10),
    amount: total,
    supplier_or_customer: 'WhatNot',
    external_reference: `import:${payload.importId}`,
    notes: `Justificatif d'achat WhatNot généré par Revendo à partir du CSV importé (${payload.fileName}).`
  });

  db.prepare(
    `UPDATE documents
     SET source='WhatNot',
         match_status=COALESCE(match_status, 'matched'),
         match_confidence=COALESCE(match_confidence, 'high')
     WHERE id=?`
  ).run(doc.id);

  let linked = 0;
  for (const p of purchases) {
    linkDocument(db, { document_id: doc.id, entity_type: 'purchase', entity_id: p.id });
    linked += 1;
  }

  db.prepare(`UPDATE purchases SET justificatif_status='present' WHERE import_id=?`).run(payload.importId);
  db.prepare(`UPDATE imports SET generated_justificatif_document_id=? WHERE id=?`).run(doc.id, payload.importId);

  return { documentId: doc.id, linkedPurchases: linked, deduplicated: doc.deduplicated };
}

export function markWhatNotPurchasesJustified(
  db: Database.Database,
  payload: { importId: number; documentId: number }
): { linkedPurchases: number } {
  const purchases = db.prepare(
    `SELECT id FROM purchases
     WHERE import_id=? AND lower(COALESCE(platform, source, '')) LIKE '%whatnot%'`
  ).all(payload.importId) as { id: number }[];
  for (const p of purchases) {
    linkDocument(db, { document_id: payload.documentId, entity_type: 'purchase', entity_id: p.id });
  }
  db.prepare(`UPDATE purchases SET justificatif_status='present' WHERE import_id=?`).run(payload.importId);
  db.prepare(`UPDATE imports SET generated_justificatif_document_id=? WHERE id=?`).run(payload.documentId, payload.importId);
  return { linkedPurchases: purchases.length };
}
