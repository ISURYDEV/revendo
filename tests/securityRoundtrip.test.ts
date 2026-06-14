import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { decryptBuffer, encryptBuffer, type EncryptedFileEnvelope } from '../electron/services/security/crypto';

const password = 'Passphrase-solide-2026!';

describe('chiffrement Revendo', () => {
  for (const size of [1024, 1024 * 1024, 5 * 1024 * 1024]) {
    it(`chiffre et déchiffre ${size} octets sans altération`, () => {
      const plain = crypto.randomBytes(size);
      const envelope = encryptBuffer(plain, password, { test: true });
      const decrypted = decryptBuffer(envelope, password);
      expect(Buffer.compare(plain, decrypted)).toBe(0);
    });
  }

  it('refuse une passphrase incorrecte', () => {
    const envelope = encryptBuffer(Buffer.from('secret'), password);
    expect(() => decryptBuffer(envelope, 'Mauvaise-passphrase-2026!')).toThrow();
  });

  it('refuse un authTag corrompu', () => {
    const envelope = encryptBuffer(Buffer.from('secret'), password);
    const corrupted: EncryptedFileEnvelope = { ...envelope, authTag: Buffer.from(envelope.authTag, 'base64').fill(1, 0, 1).toString('base64') };
    expect(() => decryptBuffer(corrupted, password)).toThrow();
  });
});
