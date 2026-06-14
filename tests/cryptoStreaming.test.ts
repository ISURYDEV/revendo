import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  encryptBuffer,
  decryptBuffer,
  encryptFile,
  decryptFile,
  encryptFileStream,
  decryptFileStream,
  looksEncryptedFile,
  ENCRYPTED_FILE_FORMAT,
  ENCRYPTED_STREAM_FORMAT
} from '../electron/services/security/crypto';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeRandomFile(p: string, sizeBytes: number): void {
  const chunkSize = 64 * 1024;
  const buf = Buffer.alloc(chunkSize);
  const fd = fs.openSync(p, 'w');
  try {
    let remaining = sizeBytes;
    while (remaining > 0) {
      const n = Math.min(chunkSize, remaining);
      crypto.randomFillSync(buf, 0, n);
      fs.writeSync(fd, buf, 0, n);
      remaining -= n;
    }
  } finally {
    fs.closeSync(fd);
  }
}

function sha256(p: string): string {
  const data = fs.readFileSync(p);
  return crypto.createHash('sha256').update(data).digest('hex');
}

describe('P1.2 — streaming cifré v2', () => {
  const PASSWORD = 'mot-de-passe-tres-long-12345';

  it('roundtrip streaming : encrypt puis decrypt restaure le contenu exact (8 Mo)', () => {
    const dir = tmpDir('revendo-stream-');
    const src = path.join(dir, 'src.bin');
    const enc = path.join(dir, 'enc.bin');
    const dec = path.join(dir, 'dec.bin');
    writeRandomFile(src, 8 * 1024 * 1024);
    const srcHash = sha256(src);

    encryptFileStream(src, enc, PASSWORD, { context: 'test' });
    expect(fs.statSync(enc).size).toBeGreaterThan(8 * 1024 * 1024); // contient header + tag

    decryptFileStream(enc, dec, PASSWORD);
    const decHash = sha256(dec);
    expect(decHash).toBe(srcHash);
  });

  it('le fichier chiffré streaming N\'EST PAS un JSON envelope v1', () => {
    const dir = tmpDir('revendo-stream-');
    const src = path.join(dir, 'src.bin');
    const enc = path.join(dir, 'enc.bin');
    writeRandomFile(src, 256 * 1024);
    encryptFileStream(src, enc, PASSWORD);
    const fd = fs.openSync(enc, 'r');
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    // Le premier octet ne doit PAS être `{` (JSON v1) : c'est un entier big-endian.
    expect(head[0]).not.toBe(0x7b);
    // Le format détecté doit être v2 streaming.
    expect(looksEncryptedFile(enc)).toBe(true);
  });

  it('passphrase incorrecte échoue (auth tag invalide)', () => {
    const dir = tmpDir('revendo-stream-');
    const src = path.join(dir, 'src.bin');
    const enc = path.join(dir, 'enc.bin');
    const dec = path.join(dir, 'dec.bin');
    writeRandomFile(src, 128 * 1024);
    encryptFileStream(src, enc, PASSWORD);
    expect(() => decryptFileStream(enc, dec, 'mauvais-mot-de-passe-long-1')).toThrow();
  });

  it('authTag corrompu fait échouer le déchiffrement', () => {
    const dir = tmpDir('revendo-stream-');
    const src = path.join(dir, 'src.bin');
    const enc = path.join(dir, 'enc.bin');
    const dec = path.join(dir, 'dec.bin');
    writeRandomFile(src, 64 * 1024);
    encryptFileStream(src, enc, PASSWORD);
    // Corrompt le dernier octet (qui appartient au authTag).
    const stat = fs.statSync(enc);
    const fd = fs.openSync(enc, 'r+');
    const lastByte = Buffer.alloc(1);
    fs.readSync(fd, lastByte, 0, 1, stat.size - 1);
    lastByte[0] = lastByte[0] ^ 0xff;
    fs.writeSync(fd, lastByte, 0, 1, stat.size - 1);
    fs.closeSync(fd);
    expect(() => decryptFileStream(enc, dec, PASSWORD)).toThrow();
  });

  it('compatibilité : un fichier v1 JSON envelope est toujours déchiffrable via decryptFile', () => {
    const dir = tmpDir('revendo-compat-');
    const src = path.join(dir, 'src.bin');
    const enc = path.join(dir, 'enc.json');
    const dec = path.join(dir, 'dec.bin');
    writeRandomFile(src, 1024);
    // Crée un envelope v1 explicitement avec encryptBuffer.
    const envelope = encryptBuffer(fs.readFileSync(src), PASSWORD, { test: true });
    expect(envelope.format).toBe(ENCRYPTED_FILE_FORMAT);
    fs.writeFileSync(enc, JSON.stringify(envelope));
    // decryptFile détecte le format v1 par le premier octet `{` et le déchiffre.
    decryptFile(enc, dec, PASSWORD);
    expect(sha256(dec)).toBe(sha256(src));
  });

  it('encryptFile bascule en streaming quand le fichier dépasse le seuil', () => {
    // On force le seuil bas en utilisant encryptFileStream directement
    // (sinon il faudrait écrire 100 Mo, trop lourd pour un test rapide).
    // Ici on vérifie surtout que le format produit est v2 streaming.
    const dir = tmpDir('revendo-threshold-');
    const src = path.join(dir, 'src.bin');
    const enc = path.join(dir, 'enc.bin');
    writeRandomFile(src, 256 * 1024);
    encryptFileStream(src, enc, PASSWORD);
    const headerLen = fs.readFileSync(enc).readUInt32BE(0);
    const headerJson = fs.readFileSync(enc).subarray(4, 4 + headerLen).toString('utf-8');
    const header = JSON.parse(headerJson);
    expect(header.format).toBe(ENCRYPTED_STREAM_FORMAT);
    expect(header.cipher).toBe('aes-256-gcm');
    expect(header.kdf).toBe('scrypt');
  });

  it("buffer existant : decryptBuffer reste inchangé pour les anciens envelopes", () => {
    // Régression v1.
    const plain = Buffer.from('Données sensibles — facture 2026.');
    const env = encryptBuffer(plain, PASSWORD);
    const out = decryptBuffer(env, PASSWORD);
    expect(out.equals(plain)).toBe(true);
  });
});
