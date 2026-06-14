import type Database from 'better-sqlite3';

export interface TopBuyer {
  buyer_username: string;
  buyer_country: string | null;
  sales_count: number;
  total_amount: number;
  last_purchase: string | null;
}

/** Top N buyers by total CA over all professional collected sales. */
export function buildTopBuyers(db: Database.Database, limit: number = 15): TopBuyer[] {
  return db
    .prepare(
      `SELECT buyer_username,
              MAX(buyer_country) AS buyer_country,
              COUNT(*) AS sales_count,
              COALESCE(SUM(amount_received), 0) AS total_amount,
              MAX(declared_encashment_date) AS last_purchase
       FROM sales
       WHERE classification='professional_resale' AND status IN ('completed','colis_perdu')
         AND deleted_at IS NULL
         AND buyer_username IS NOT NULL AND buyer_username != ''
       GROUP BY buyer_username
       ORDER BY total_amount DESC
       LIMIT ?`
    )
    .all(limit) as TopBuyer[];
}
