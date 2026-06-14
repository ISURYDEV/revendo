import type { ImportType } from '../../../shared/types';

const SIGNATURES: { type: ImportType; required: string[] }[] = [
  {
    type: 'vinteer_sales',
    required: ['ID Transaction', 'Date de vente', 'Montant encaissé', 'Statut', 'Articles']
  },
  {
    type: 'vinteer_purchases',
    required: ['ID Transaction', 'Date de paiement', 'Montant total TTC', 'Vendeur']
  },
  {
    type: 'vinteer_boosts',
    required: ['Date de début', 'Type de boost', 'Montant TTC', 'Montant HT']
  },
  {
    type: 'vinteer_inventory',
    required: ['SKU', 'Nom', 'En stock (restants)', 'COGS unitaire (€)']
  },
  {
    type: 'whatnot_purchases',
    required: ['order id', 'buyer', 'seller', 'product name', 'sold price']
  },
  {
    type: 'generic_stock',
    required: ['Nom', 'Quantite', 'Type (personnel|professionnel)', 'Cout total (€)']
  },
  {
    type: 'generic_expenses',
    required: ['Nom', 'Prix (€)', 'Lieu achat', 'Recu (oui|non)']
  }
];

export function detectImportType(headers: string[]): ImportType | 'unknown' {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const sig of SIGNATURES) {
    const ok = sig.required.every((r) =>
      lower.some((h) => h === r.toLowerCase() || h.includes(r.toLowerCase().slice(0, 12)))
    );
    if (ok) return sig.type;
  }
  return 'unknown';
}
