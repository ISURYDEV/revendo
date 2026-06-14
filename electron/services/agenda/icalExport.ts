import type Database from 'better-sqlite3';
import fs from 'node:fs';

function escapeIcal(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/**
 * Export diary_entries (used as Agenda) to .ics file for Google Calendar import.
 * Each entry becomes an all-day VEVENT.
 */
export function exportAgendaIcs(db: Database.Database, outputPath: string): { path: string; count: number } {
  const rows = db
    .prepare(`SELECT id, entry_date, note, tags, created_at FROM diary_entries ORDER BY entry_date ASC`)
    .all() as { id: number; entry_date: string; note: string; tags: string | null; created_at: string }[];

  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//Revendo//Agenda Export//FR');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push('X-WR-CALNAME:Revendo Agenda');
  lines.push('X-WR-TIMEZONE:Europe/Paris');

  for (const r of rows) {
    const date = r.entry_date.slice(0, 10).replace(/-/g, '');
    const stamp = new Date(r.created_at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    // Build a 1-day all-day event
    const nextDay = new Date(r.entry_date);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const dateEnd = nextDay.toISOString().slice(0, 10).replace(/-/g, '');
    const summary = (r.tags ? `[${r.tags}] ` : '') + r.note.slice(0, 80).replace(/\n/g, ' ');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:revendo-agenda-${r.id}@local`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${date}`);
    lines.push(`DTEND;VALUE=DATE:${dateEnd}`);
    lines.push(`SUMMARY:${escapeIcal(summary)}`);
    if (r.note.length > 80) lines.push(`DESCRIPTION:${escapeIcal(r.note)}`);
    if (r.tags) lines.push(`CATEGORIES:${escapeIcal(r.tags)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  fs.writeFileSync(outputPath, lines.join('\r\n'), 'utf-8');
  return { path: outputPath, count: rows.length };
}
