import type Database from 'better-sqlite3';
import { nextDueDate } from '../declarations/quarters';

export interface Reminder {
  key: string;
  level: 'info' | 'warning' | 'danger';
  title: string;
  body: string;
  cta?: { label: string; route: string };
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

/**
 * Build the active reminders for today.
 *  - URSSAF échéance < 14 days
 *  - CFE deadline approaching (configurable, default Dec 15) within 14 days
 *  - Uncertain sales older than 30 days
 *  - Documents orphan count > 5
 *
 * Each reminder has a stable `key`. If user dismisses it, `reminders_state.dismissed_until`
 * suppresses it until that date.
 */
export function buildReminders(db: Database.Database): Reminder[] {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const reminders: Reminder[] = [];

  // 1. URSSAF échéance
  const due = nextDueDate(today);
  if (due) {
    const days = daysBetween(due.dueDate, todayIso);
    if (days >= 0 && days <= 14) {
      reminders.push({
        key: `urssaf_${due.year}_Q${due.quarter}`,
        level: days <= 3 ? 'danger' : days <= 7 ? 'warning' : 'info',
        title: `Échéance URSSAF Q${due.quarter} ${due.year} en ${days} jour(s)`,
        body: `Échéance le ${due.dueDate}. Générez le livre des recettes et déclarez sur urssaf.fr.`,
        cta: { label: 'Aller à Déclaration', route: '/declarations' }
      });
    }
  }

  // 2. CFE (default Dec 15 — vence 15/12 cada año)
  const cfeDate = (db.prepare(`SELECT value FROM settings WHERE key='cfe_reminder_date'`).get() as { value: string } | undefined)?.value ?? '12-01';
  const cfeY = today.getUTCFullYear();
  const cfeIso = `${cfeY}-${cfeDate.length === 5 ? cfeDate : '12-01'}`;
  const cfeFinal = `${cfeY}-12-15`;
  if (todayIso >= cfeIso && todayIso <= cfeFinal) {
    const days = daysBetween(cfeFinal, todayIso);
    reminders.push({
      key: `cfe_${cfeY}`,
      level: days <= 3 ? 'danger' : 'warning',
      title: `CFE ${cfeY} : échéance le 15/12 (dans ${days} jour(s))`,
      body: "Payez la Cotisation Foncière des Entreprises sur impots.gouv.fr. Si c'est votre première année, elle est souvent exonérée."
    });
  }

  // 3. Uncertain sales > 30 days
  const cutoff = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const uncertainRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sales
       WHERE classification='uncertain_to_review'
         AND COALESCE(sale_date, finalization_date) < ?`
    )
    .get(cutoff) as { n: number };
  if (uncertainRow.n > 0) {
    reminders.push({
      key: 'uncertain_aging',
      level: 'warning',
      title: `${uncertainRow.n} vente(s) "À vérifier" ont plus de 30 jours`,
      body: "Vérifiez-les pour qu'elles ne restent pas indéfiniment exclues du CA.",
      cta: { label: 'Aller à Ventes → À vérifier', route: '/sales' }
    });
  }

  // 4. Filter dismissed
  const dismissed = db.prepare(`SELECT reminder_key, dismissed_until FROM reminders_state`).all() as {
    reminder_key: string;
    dismissed_until: string | null;
  }[];
  const dismissedMap = new Map(dismissed.map((d) => [d.reminder_key, d.dismissed_until]));
  return reminders.filter((r) => {
    const until = dismissedMap.get(r.key);
    if (!until) return true;
    return todayIso > until;
  });
}

export function dismissReminder(db: Database.Database, key: string, days = 1): void {
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO reminders_state (reminder_key, dismissed_until, last_shown)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(reminder_key) DO UPDATE SET dismissed_until=excluded.dismissed_until, last_shown=excluded.last_shown`
  ).run(key, until);
}
