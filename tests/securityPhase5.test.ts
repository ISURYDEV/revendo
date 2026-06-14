import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from '../electron/db/migrations';
import { decryptFile, encryptFile } from '../electron/services/security/crypto';
import { redactSaleRow } from '../electron/services/security/privacy';
import { exportFullJson } from '../electron/services/maintenance/exportJson';
import { generateMobileHtml } from '../electron/services/mobile/snapshotGenerator';
import { recordSyncChange, restoreEntity, softDeleteEntity } from '../electron/services/sync/foundation';
import { testEncryptedFile } from '../electron/services/security/dataPrivacy';

function db() {
  const d = new Database(':memory:');
  runMigrations(d);
  return d;
}

function tmp(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `revendo-${name}-`));
  return { dir, file: (f: string) => path.join(dir, f) };
}

describe('phase 5 sécurité, confidentialité et préparation sync/mobile', () => {
  it('chiffre et déchiffre un fichier sans stocker le mot de passe', () => {
    const t = tmp('crypto');
    const input = t.file('plain.txt');
    const enc = t.file('plain.txt.revendo.enc');
    const out = t.file('out.txt');
    fs.writeFileSync(input, 'secret Revendo', 'utf-8');

    encryptFile(input, enc, 'motdepasse-solide', { type: 'test' });
    const encryptedText = fs.readFileSync(enc, 'utf-8');
    expect(encryptedText).toContain('revendo-encrypted-file-v1');
    expect(encryptedText).not.toContain('motdepasse-solide');
    expect(() => decryptFile(enc, t.file('wrong.txt'), 'mauvais-password')).toThrow();

    decryptFile(enc, out, 'motdepasse-solide');
    expect(fs.readFileSync(out, 'utf-8')).toBe('secret Revendo');
  });

  it('teste un fichier chiffré sans conserver le fichier déchiffré', () => {
    const d = db();
    const t = tmp('crypto-test');
    const input = t.file('plain.zip');
    const enc = t.file('plain.zip.revendo.enc');
    fs.writeFileSync(input, Buffer.from('backup-content'));
    encryptFile(input, enc, 'motdepasse-solide', { type: 'backup' });

    const result = testEncryptedFile(d, enc, 'motdepasse-solide');
    expect(result.ok).toBe(true);
    expect(result.decryptedBytes).toBe(Buffer.byteLength('backup-content'));
    expect(() => testEncryptedFile(d, enc, 'mauvais-password')).toThrow(/Déchiffrement impossible/);
  });

  it('redaction UI masque acheteur, email et adresse', () => {
    const redacted = redactSaleRow({
      buyer_name: 'Jean Client',
      buyer_username: 'jean92',
      buyer_email: 'jean@example.com',
      buyer_address: '12 rue test'
    }, { maskBuyer: true, maskContact: true, maskUsername: true });

    expect(redacted.buyer_name).toBe('Acheteur masqué');
    expect(redacted.buyer_username).toBe('Acheteur masqué');
    expect(redacted.buyer_email).toBe('Email masqué');
    expect(redacted.buyer_address).toBe('Adresse masquée');
  });

  it('export anonymisé ne contient pas email/adresse acheteur', () => {
    const d = db();
    d.prepare(`
      INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, buyer_name, buyer_username, buyer_email, buyer_address, article_name, amount_received)
      VALUES ('manual', 'S1', 'completed', 'professional_resale', 1, 'Jean Client', 'jean92', 'jean@example.com', '12 rue test', 'Article', 20)
    `).run();
    const t = tmp('export');
    const out = exportFullJson(d, t.file('export.json'), { anonymized: true });
    const raw = fs.readFileSync(out.path, 'utf-8');
    expect(raw).not.toContain('jean@example.com');
    expect(raw).not.toContain('12 rue test');
    expect(raw).not.toContain('jean92');
    expect(raw).toContain('Acheteur masqué');
  });

  it('snapshot mobile contient schema_version et masque les usernames par défaut', () => {
    const d = db();
    d.prepare(`
      INSERT INTO sales (source, external_id, sale_date, declared_encashment_date, status, classification, urssaf_declarable, platform, article_name, buyer_username, amount_received, declarable_amount)
      VALUES ('manual', 'S1', '2026-05-01', '2026-05-01', 'completed', 'professional_resale', 1, 'Vinted', 'Article', 'jean92', 20, 20)
    `).run();
    const t = tmp('mobile');
    const out = generateMobileHtml(d, t.file('mobile.html'));
    const html = fs.readFileSync(out.path, 'utf-8');
    expect(html).toContain('revendo-mobile-v2');
    expect(html).toContain('redaction_mode');
    expect(html).not.toContain('jean92');
    expect(html).toContain('Acheteur masqué');
  });

  it('sync_state et sync_changes enregistrent update, soft delete et restore sans sync distante', () => {
    const d = db();
    const id = Number(d.prepare(`
      INSERT INTO expenses (source, date, category, amount_ttc, description)
      VALUES ('manual', '2026-05-01', 'autre', 12, 'Test')
    `).run().lastInsertRowid);

    recordSyncChange(d, 'expense', id, 'create', 'local_app', 'test');
    let changes = d.prepare(`SELECT operation FROM sync_changes WHERE entity_type='expense' AND entity_id=?`).all(id) as Array<{ operation: string }>;
    expect(changes.map((c) => c.operation)).toContain('create');

    softDeleteEntity(d, 'expense', id, 'Erreur de saisie');
    let row = d.prepare(`SELECT deleted_at FROM expenses WHERE id=?`).get(id) as { deleted_at: string | null };
    expect(row.deleted_at).toBeTruthy();

    restoreEntity(d, 'expense', id);
    row = d.prepare(`SELECT deleted_at FROM expenses WHERE id=?`).get(id) as { deleted_at: string | null };
    expect(row.deleted_at).toBeNull();
    changes = d.prepare(`SELECT operation FROM sync_changes WHERE entity_type='expense' AND entity_id=?`).all(id) as Array<{ operation: string }>;
    expect(changes.map((c) => c.operation)).toEqual(expect.arrayContaining(['create', 'delete', 'restore']));
  });
});
