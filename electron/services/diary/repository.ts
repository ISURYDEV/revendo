import type Database from 'better-sqlite3';

export interface DiaryEntry {
  id: number;
  entry_date: string;
  note: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export function listEntries(db: Database.Database, filters: { year?: number; month?: number; search?: string } = {}): DiaryEntry[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.year && filters.month) {
    const m = String(filters.month).padStart(2, '0');
    where.push('entry_date >= ? AND entry_date < ?');
    params.push(`${filters.year}-${m}-01`, `${filters.year}-${m}-32`);
  } else if (filters.year) {
    where.push('entry_date >= ? AND entry_date <= ?');
    params.push(`${filters.year}-01-01`, `${filters.year}-12-31`);
  }
  if (filters.search) {
    where.push('(note LIKE ? OR tags LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like);
  }
  const sql = `SELECT * FROM diary_entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY entry_date DESC LIMIT 500`;
  return db.prepare(sql).all(...params) as DiaryEntry[];
}

export function createEntry(db: Database.Database, payload: { entry_date: string; note: string; tags?: string }): { id: number } {
  const info = db.prepare(`INSERT INTO diary_entries (entry_date, note, tags) VALUES (?, ?, ?)`).run(payload.entry_date, payload.note, payload.tags ?? null);
  return { id: Number(info.lastInsertRowid) };
}

export function updateEntry(db: Database.Database, id: number, patch: Partial<{ entry_date: string; note: string; tags: string }>): { ok: true } {
  const fields = Object.keys(patch).map((k) => `${k}=?`).join(', ');
  if (!fields) return { ok: true };
  db.prepare(`UPDATE diary_entries SET ${fields}, updated_at=datetime('now') WHERE id=?`).run(...Object.values(patch), id);
  return { ok: true };
}

export function deleteEntry(db: Database.Database, id: number): { ok: true } {
  db.prepare(`DELETE FROM diary_entries WHERE id=?`).run(id);
  return { ok: true };
}
