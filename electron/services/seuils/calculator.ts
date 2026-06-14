import type Database from 'better-sqlite3';

export interface SeuilStatus {
  year: number;
  caUrssaf: number;
  seuilMarchandises: number;
  seuilTvaFranchise: number;
  marchandisesPct: number;
  tvaPct: number;
  warningAt: number;
  dangerAt: number;
  level: 'ok' | 'warning' | 'danger' | 'over';
  message: string;
}

export function buildSeuilStatus(db: Database.Database, year: number = new Date().getUTCFullYear()): SeuilStatus {
  const startIso = `${year}-01-01T00:00:00.000Z`;
  const endIso = `${year}-12-31T23:59:59.999Z`;

  const caRow = db
    .prepare(
      `SELECT COALESCE(SUM(declarable_amount), 0) AS ca
       FROM sales
       WHERE urssaf_declarable=1
         AND declared_encashment_date >= ? AND declared_encashment_date <= ?`
    )
    .get(startIso, endIso) as { ca: number };

  const get = (key: string, def: number) => {
    const r = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined;
    return r ? Number(r.value) || def : def;
  };
  const seuilM = get('seuil_marchandises', 85000);
  const seuilTva = get('seuil_tva_franchise', 91900);
  const warningAt = get('seuil_marchandises_warning_at', 0.75);
  const dangerAt = get('seuil_marchandises_danger_at', 0.9);

  const marchandisesPct = caRow.ca / seuilM;
  const tvaPct = caRow.ca / seuilTva;

  let level: SeuilStatus['level'] = 'ok';
  let message = '';
  if (caRow.ca >= seuilM) {
    level = 'over';
    message = `CA ${caRow.ca.toFixed(0)} € supera el seuil vente de marchandises (${seuilM.toLocaleString('fr-FR')} €). Pierdes el régimen micro-entreprise.`;
  } else if (caRow.ca >= seuilTva) {
    level = 'over';
    message = `CA supera el seuil franchise en base TVA (${seuilTva.toLocaleString('fr-FR')} €). Debes facturar TVA.`;
  } else if (marchandisesPct >= dangerAt) {
    level = 'danger';
    message = `Estás al ${(marchandisesPct * 100).toFixed(0)}% del seuil marchandises. Cuidado: cerca del límite.`;
  } else if (marchandisesPct >= warningAt) {
    level = 'warning';
    message = `Estás al ${(marchandisesPct * 100).toFixed(0)}% del seuil marchandises. Vigílalo.`;
  } else {
    message = `Margen disponible: ${(seuilM - caRow.ca).toFixed(0)} €.`;
  }

  return {
    year,
    caUrssaf: caRow.ca,
    seuilMarchandises: seuilM,
    seuilTvaFranchise: seuilTva,
    marchandisesPct,
    tvaPct,
    warningAt,
    dangerAt,
    level,
    message
  };
}
