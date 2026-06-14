import type { MobileSnapshot } from '@shared/mobile';

export interface SearchHit {
  source: 'sale' | 'stock' | 'expense' | 'purchase' | 'document';
  title: string;
  subtitle: string;
  amount?: number;
  date?: string;
  raw: Record<string, unknown>;
}

function asString(v: unknown): string {
  return v == null ? '' : String(v).toLowerCase();
}

export function searchSnapshot(snapshot: MobileSnapshot | null, query: string): SearchHit[] {
  if (!snapshot || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  const hits: SearchHit[] = [];

  for (const row of snapshot.sales ?? []) {
    const name = asString((row as Record<string, unknown>).article_name);
    const sku = asString((row as Record<string, unknown>).sku);
    const buyer = asString((row as Record<string, unknown>).buyer_username);
    const ext = asString((row as Record<string, unknown>).external_id);
    if (name.includes(q) || sku.includes(q) || buyer.includes(q) || ext.includes(q)) {
      hits.push({
        source: 'sale',
        title: String((row as Record<string, unknown>).article_name ?? 'Vente'),
        subtitle: [buyer || ext, asString((row as Record<string, unknown>).platform)].filter(Boolean).join(' · '),
        amount: Number((row as Record<string, unknown>).amount_received ?? 0),
        date: String((row as Record<string, unknown>).declared_encashment_date ?? (row as Record<string, unknown>).sale_date ?? ''),
        raw: row as Record<string, unknown>
      });
    }
  }

  for (const row of snapshot.stock ?? []) {
    const name = asString((row as Record<string, unknown>).name);
    const sku = asString((row as Record<string, unknown>).sku);
    const loc = asString((row as Record<string, unknown>).location);
    const code = asString((row as Record<string, unknown>).internal_code);
    if (name.includes(q) || sku.includes(q) || loc.includes(q) || code.includes(q)) {
      hits.push({
        source: 'stock',
        title: String((row as Record<string, unknown>).name ?? code),
        subtitle: [`x${(row as Record<string, unknown>).quantity ?? 0}`, loc].filter(Boolean).join(' · '),
        raw: row as Record<string, unknown>
      });
    }
  }

  for (const row of snapshot.expenses ?? []) {
    const desc = asString((row as Record<string, unknown>).description);
    const supplier = asString((row as Record<string, unknown>).supplier);
    const cat = asString((row as Record<string, unknown>).category);
    if (desc.includes(q) || supplier.includes(q) || cat.includes(q)) {
      hits.push({
        source: 'expense',
        title: String((row as Record<string, unknown>).description ?? supplier ?? 'Dépense'),
        subtitle: [cat, supplier].filter(Boolean).join(' · '),
        amount: Number((row as Record<string, unknown>).amount_ttc ?? 0),
        date: String((row as Record<string, unknown>).date ?? ''),
        raw: row as Record<string, unknown>
      });
    }
  }

  for (const row of snapshot.purchases ?? []) {
    const articles = asString((row as Record<string, unknown>).articles);
    const seller = asString((row as Record<string, unknown>).seller);
    if (articles.includes(q) || seller.includes(q)) {
      hits.push({
        source: 'purchase',
        title: String((row as Record<string, unknown>).articles ?? 'Achat'),
        subtitle: seller,
        amount: Number((row as Record<string, unknown>).total_ttc ?? 0),
        date: String((row as Record<string, unknown>).payment_date ?? ''),
        raw: row as Record<string, unknown>
      });
    }
  }

  for (const row of snapshot.documents ?? []) {
    const name = asString((row as Record<string, unknown>).original_file_name);
    const type = asString((row as Record<string, unknown>).document_type);
    if (name.includes(q) || type.includes(q)) {
      hits.push({
        source: 'document',
        title: String((row as Record<string, unknown>).original_file_name ?? 'Document'),
        subtitle: type,
        raw: row as Record<string, unknown>
      });
    }
  }

  return hits.slice(0, 60);
}
