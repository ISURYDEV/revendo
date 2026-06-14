import type Database from 'better-sqlite3';
import type { SavedFilter } from '../../../shared/types';

export function listSavedFilters(db: Database.Database, entityType?: string): SavedFilter[] {
  if (entityType) {
    return db
      .prepare(`SELECT * FROM saved_filters WHERE entity_type=? ORDER BY is_favorite DESC, updated_at DESC`)
      .all(entityType) as SavedFilter[];
  }
  return db.prepare(`SELECT * FROM saved_filters ORDER BY entity_type, is_favorite DESC, updated_at DESC`).all() as SavedFilter[];
}

export function createSavedFilter(
  db: Database.Database,
  payload: { entity_type: string; name: string; filter_state: unknown; is_favorite?: boolean }
): { id: number } {
  if (!payload.entity_type.trim()) throw new Error("Type d'écran obligatoire.");
  if (!payload.name.trim()) throw new Error('Nom du filtre obligatoire.');
  const info = db
    .prepare(
      `INSERT INTO saved_filters (entity_type, name, filter_state_json, is_favorite)
       VALUES (?, ?, ?, ?)`
    )
    .run(payload.entity_type, payload.name.trim(), JSON.stringify(payload.filter_state ?? {}), payload.is_favorite ? 1 : 0);
  return { id: Number(info.lastInsertRowid) };
}

export function updateSavedFilter(
  db: Database.Database,
  id: number,
  patch: { name?: string; filter_state?: unknown; is_favorite?: boolean }
): { ok: true } {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error('Nom du filtre obligatoire.');
    sets.push('name=?');
    params.push(patch.name.trim());
  }
  if (patch.filter_state !== undefined) {
    sets.push('filter_state_json=?');
    params.push(JSON.stringify(patch.filter_state ?? {}));
  }
  if (patch.is_favorite !== undefined) {
    sets.push('is_favorite=?');
    params.push(patch.is_favorite ? 1 : 0);
  }
  if (sets.length === 0) return { ok: true };
  sets.push("updated_at=datetime('now')");
  params.push(id);
  db.prepare(`UPDATE saved_filters SET ${sets.join(', ')} WHERE id=?`).run(...params);
  return { ok: true };
}

export function deleteSavedFilter(db: Database.Database, id: number): { ok: true } {
  db.prepare(`DELETE FROM saved_filters WHERE id=?`).run(id);
  return { ok: true };
}
