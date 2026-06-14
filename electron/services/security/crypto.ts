import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * Formats de chiffrement Revendo
 *
 * v1 — JSON envelope (existant, conservé pour compatibilité) :
 *   `revendo-encrypted-file-v1`. Tout le contenu chiffré est encodé en base64
 *   dans un fichier JSON unique. Pratique pour les petits fichiers (< 100 Mo)
 *   mais charge tout en mémoire.
 *
 * v2 — Streaming binaire (P1.2, nouveau) :
 *   `revendo-encrypted-stream-v1`. Format binaire en streaming :
 *
 *     [4 octets big-endian : headerLen]
 *     [headerLen octets   : JSON header avec salt, iv, kdf_params, metadata, format]
 *     [N octets           : ciphertext]
 *     [16 octets          : authTag GCM]
 *
 *   Le premier octet d'un fichier v2 n'est PAS `{`, ce qui permet de
 *   différencier les deux formats au déchiffrement.
 */

export const ENCRYPTED_FILE_FORMAT = 'revendo-encrypted-file-v1';
export const ENCRYPTED_STREAM_FORMAT = 'revendo-encrypted-stream-v1';

/** Taille à partir de laquelle on bascule sur le streaming binaire (P1.2). */
export const STREAM_THRESHOLD_BYTES = 100 * 1024 * 1024;

export interface EncryptedFileEnvelope {
  format: typeof ENCRYPTED_FILE_FORMAT;
  cipher: 'aes-256-gcm';
  kdf: 'scrypt';
  kdf_params?: { N: number; r: number; p: number };
  salt: string;
  iv: string;
  authTag: string;
  metadata?: Record<string, unknown>;
  ciphertext: string;
}

interface StreamHeader {
  format: typeof ENCRYPTED_STREAM_FORMAT;
  cipher: 'aes-256-gcm';
  kdf: 'scrypt';
  kdf_params: { N: number; r: number; p: number };
  salt: string;
  iv: string;
  metadata?: Record<string, unknown>;
}

const CURRENT_KDF_PARAMS = { N: 131072, r: 8, p: 1 } as const;
const LEGACY_KDF_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const AUTH_TAG_SIZE = 16;
const HEADER_LEN_SIZE = 4;

function deriveKey(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number } = CURRENT_KDF_PARAMS
): Buffer {
  if (!password || password.length < 12) {
    throw new Error('Mot de passe trop court : utilisez au moins 12 caractères.');
  }
  return crypto.scryptSync(password, salt, 32, { ...params, maxmem: 256 * 1024 * 1024 });
}

// =============================================================================
// v1 — Envelope JSON (buffer en mémoire, compatible avec l'existant)
// =============================================================================

export function encryptBuffer(
  plain: Buffer,
  password: string,
  metadata: Record<string, unknown> = {}
): EncryptedFileEnvelope {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const aad = Buffer.from(ENCRYPTED_FILE_FORMAT, 'utf-8');
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    format: ENCRYPTED_FILE_FORMAT,
    cipher: 'aes-256-gcm',
    kdf: 'scrypt',
    kdf_params: CURRENT_KDF_PARAMS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    metadata,
    ciphertext: encrypted.toString('base64')
  };
}

export function decryptBuffer(envelope: EncryptedFileEnvelope, password: string): Buffer {
  if (envelope.format !== ENCRYPTED_FILE_FORMAT || envelope.cipher !== 'aes-256-gcm' || envelope.kdf !== 'scrypt') {
    throw new Error('Format de fichier chiffré non pris en charge.');
  }
  const key = deriveKey(password, Buffer.from(envelope.salt, 'base64'), envelope.kdf_params ?? LEGACY_KDF_PARAMS);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(ENCRYPTED_FILE_FORMAT, 'utf-8'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]);
}

// =============================================================================
// Routage entre v1 et v2 selon la taille
// =============================================================================

export function encryptFile(
  inputPath: string,
  outputPath: string,
  password: string,
  metadata: Record<string, unknown> = {}
): { path: string; size: number } {
  const stat = fs.statSync(inputPath);
  if (stat.size > STREAM_THRESHOLD_BYTES) {
    return encryptFileStream(inputPath, outputPath, password, metadata);
  }
  const envelope = encryptBuffer(fs.readFileSync(inputPath), password, {
    ...metadata,
    originalFileName: path.basename(inputPath),
    encryptedAt: new Date().toISOString()
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(envelope), 'utf-8');
  const outStat = fs.statSync(outputPath);
  return { path: outputPath, size: outStat.size };
}

export function decryptFile(
  inputPath: string,
  outputPath: string,
  password: string
): { path: string; size: number } {
  // Détection du format par les premiers octets.
  const fd = fs.openSync(inputPath, 'r');
  const head = Buffer.alloc(1);
  try {
    fs.readSync(fd, head, 0, 1, 0);
  } finally {
    fs.closeSync(fd);
  }

  // Le format v1 (JSON envelope) commence par `{`.
  // Tout le reste est traité comme v2 streaming binaire.
  if (head[0] === 0x7b /* '{' */) {
    const envelope = JSON.parse(fs.readFileSync(inputPath, 'utf-8')) as EncryptedFileEnvelope;
    const plain = decryptBuffer(envelope, password);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, plain);
    const stat = fs.statSync(outputPath);
    return { path: outputPath, size: stat.size };
  }

  return decryptFileStream(inputPath, outputPath, password);
}

// =============================================================================
// v2 — Streaming binaire (P1.2) — pipeline réel, pas de readFileSync
// =============================================================================

/**
 * Chiffrement par streaming réel : lit `inputPath` par chunks et écrit
 * `outputPath` au fur et à mesure. Ne charge JAMAIS le fichier complet
 * en mémoire.
 *
 * Layout de sortie :
 *   [4 octets : headerLen big-endian]
 *   [headerLen octets : JSON header]
 *   [N octets : ciphertext]
 *   [16 octets : authTag GCM]
 */
export async function encryptFileStreamAsync(
  inputPath: string,
  outputPath: string,
  password: string,
  metadata: Record<string, unknown> = {}
): Promise<{ path: string; size: number }> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);

  const header: StreamHeader = {
    format: ENCRYPTED_STREAM_FORMAT,
    cipher: 'aes-256-gcm',
    kdf: 'scrypt',
    kdf_params: CURRENT_KDF_PARAMS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    metadata: {
      ...metadata,
      originalFileName: path.basename(inputPath),
      encryptedAt: new Date().toISOString(),
      streaming: true
    }
  };

  const headerJson = Buffer.from(JSON.stringify(header), 'utf-8');
  const headerLenBuf = Buffer.alloc(HEADER_LEN_SIZE);
  headerLenBuf.writeUInt32BE(headerJson.length, 0);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(ENCRYPTED_STREAM_FORMAT, 'utf-8'));

  const out = fs.createWriteStream(outputPath);
  // Write header length + header JSON FIRST.
  await new Promise<void>((resolve, reject) => {
    out.write(headerLenBuf, (err) => (err ? reject(err) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    out.write(headerJson, (err) => (err ? reject(err) : resolve()));
  });

  const input = fs.createReadStream(inputPath, { highWaterMark: 64 * 1024 });
  await pipeline(input, cipher, out, { end: false });

  const authTag = cipher.getAuthTag(); // 16 bytes
  await new Promise<void>((resolve, reject) => {
    out.write(authTag, (err) => (err ? reject(err) : resolve()));
  });
  await new Promise<void>((resolve) => out.end(resolve));

  const stat = fs.statSync(outputPath);
  return { path: outputPath, size: stat.size };
}

/**
 * Wrapper synchrone — utilisé par `encryptFile`. better-sqlite3 et le reste
 * du code sont synchrones ; on utilise `deasync`-style via Atomics ? Non :
 * on bloque proprement avec `child_process` ? Non plus.
 *
 * En pratique, l'unique appelant côté Electron passe par
 * `encryptFileStreamAsync`. Pour la rétro-compatibilité avec l'API
 * synchrone existante (utilisée par `encryptFile`), on expose une variante
 * qui fait fallback sur la version buffer si l'appel est synchrone.
 */
export function encryptFileStream(
  inputPath: string,
  outputPath: string,
  password: string,
  metadata: Record<string, unknown> = {}
): { path: string; size: number } {
  // Note technique : `fs.createReadStream` + `pipeline` sont nativement
  // asynchrones. Pour rester synchrone et compatible avec les callers
  // existants, on utilise une boucle de lecture/écriture par chunks
  // qui n'alloue jamais plus de 64 Ko en mémoire à la fois.
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);

  const header: StreamHeader = {
    format: ENCRYPTED_STREAM_FORMAT,
    cipher: 'aes-256-gcm',
    kdf: 'scrypt',
    kdf_params: CURRENT_KDF_PARAMS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    metadata: {
      ...metadata,
      originalFileName: path.basename(inputPath),
      encryptedAt: new Date().toISOString(),
      streaming: true
    }
  };

  const headerJson = Buffer.from(JSON.stringify(header), 'utf-8');
  const headerLenBuf = Buffer.alloc(HEADER_LEN_SIZE);
  headerLenBuf.writeUInt32BE(headerJson.length, 0);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(ENCRYPTED_STREAM_FORMAT, 'utf-8'));

  const fdIn = fs.openSync(inputPath, 'r');
  const fdOut = fs.openSync(outputPath, 'w');
  try {
    fs.writeSync(fdOut, headerLenBuf);
    fs.writeSync(fdOut, headerJson);

    const chunkSize = 64 * 1024;
    const buf = Buffer.alloc(chunkSize);
    let position = 0;
    // Boucle de chunks : n'alloue jamais plus que `chunkSize` à la fois.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const bytesRead = fs.readSync(fdIn, buf, 0, chunkSize, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const encChunk = cipher.update(buf.subarray(0, bytesRead));
      if (encChunk.length > 0) fs.writeSync(fdOut, encChunk);
    }
    const final = cipher.final();
    if (final.length > 0) fs.writeSync(fdOut, final);
    const authTag = cipher.getAuthTag();
    fs.writeSync(fdOut, authTag);
  } finally {
    fs.closeSync(fdIn);
    fs.closeSync(fdOut);
  }

  const stat = fs.statSync(outputPath);
  return { path: outputPath, size: stat.size };
}

/**
 * Déchiffrement par streaming. Lit le tag à la fin du fichier (16 derniers
 * octets), puis lit/déchiffre le ciphertext par chunks. N'alloue jamais
 * plus de 64 Ko à la fois.
 */
export function decryptFileStream(
  inputPath: string,
  outputPath: string,
  password: string
): { path: string; size: number } {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const fileSize = fs.statSync(inputPath).size;
  if (fileSize < HEADER_LEN_SIZE + AUTH_TAG_SIZE) {
    throw new Error('Format de fichier chiffré streaming invalide (trop petit).');
  }

  const fdIn = fs.openSync(inputPath, 'r');
  const fdOut = fs.openSync(outputPath, 'w');
  try {
    // 1) Lire la longueur du header.
    const headerLenBuf = Buffer.alloc(HEADER_LEN_SIZE);
    fs.readSync(fdIn, headerLenBuf, 0, HEADER_LEN_SIZE, 0);
    const headerLen = headerLenBuf.readUInt32BE(0);
    if (headerLen <= 0 || headerLen > 1024 * 1024) {
      throw new Error('En-tête de fichier chiffré streaming invalide.');
    }

    // 2) Lire le header JSON.
    const headerBuf = Buffer.alloc(headerLen);
    fs.readSync(fdIn, headerBuf, 0, headerLen, HEADER_LEN_SIZE);
    let header: StreamHeader;
    try {
      header = JSON.parse(headerBuf.toString('utf-8')) as StreamHeader;
    } catch {
      throw new Error('En-tête de fichier chiffré streaming illisible.');
    }
    if (header.format !== ENCRYPTED_STREAM_FORMAT || header.cipher !== 'aes-256-gcm' || header.kdf !== 'scrypt') {
      throw new Error('Format de fichier chiffré streaming non pris en charge.');
    }

    // 3) Lire le tag d'authentification (16 derniers octets).
    const authTagBuf = Buffer.alloc(AUTH_TAG_SIZE);
    fs.readSync(fdIn, authTagBuf, 0, AUTH_TAG_SIZE, fileSize - AUTH_TAG_SIZE);

    // 4) Préparer le déchiffrement.
    const salt = Buffer.from(header.salt, 'base64');
    const iv = Buffer.from(header.iv, 'base64');
    const key = deriveKey(password, salt, header.kdf_params ?? LEGACY_KDF_PARAMS);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(ENCRYPTED_STREAM_FORMAT, 'utf-8'));
    decipher.setAuthTag(authTagBuf);

    // 5) Stream du ciphertext par chunks (du début du body jusqu'avant le tag).
    const bodyStart = HEADER_LEN_SIZE + headerLen;
    const bodyEnd = fileSize - AUTH_TAG_SIZE;
    const chunkSize = 64 * 1024;
    const buf = Buffer.alloc(chunkSize);
    let pos = bodyStart;
    while (pos < bodyEnd) {
      const toRead = Math.min(chunkSize, bodyEnd - pos);
      const n = fs.readSync(fdIn, buf, 0, toRead, pos);
      if (n === 0) break;
      pos += n;
      const decChunk = decipher.update(buf.subarray(0, n));
      if (decChunk.length > 0) fs.writeSync(fdOut, decChunk);
    }
    const finalChunk = decipher.final();
    if (finalChunk.length > 0) fs.writeSync(fdOut, finalChunk);
  } finally {
    fs.closeSync(fdIn);
    fs.closeSync(fdOut);
  }

  const stat = fs.statSync(outputPath);
  return { path: outputPath, size: stat.size };
}

/**
 * Détecte par les premiers octets si un fichier ressemble à un fichier
 * chiffré Revendo (v1 ou v2).
 */
export function looksEncryptedFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(256);
    let n = 0;
    try {
      n = fs.readSync(fd, head, 0, 256, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (n === 0) return false;
    if (head[0] === 0x7b) {
      // Tente JSON v1
      const raw = head.subarray(0, n).toString('utf-8');
      return raw.includes(ENCRYPTED_FILE_FORMAT);
    }
    // v2 binaire : on lit le header
    const stat = fs.statSync(filePath);
    if (stat.size < HEADER_LEN_SIZE) return false;
    const headerLen = head.readUInt32BE(0);
    if (headerLen <= 0 || headerLen > 1024 * 1024 || headerLen + HEADER_LEN_SIZE > stat.size) {
      return false;
    }
    const headerEnd = Math.min(n, HEADER_LEN_SIZE + headerLen);
    const slice = head.subarray(HEADER_LEN_SIZE, headerEnd).toString('utf-8');
    return slice.includes(ENCRYPTED_STREAM_FORMAT);
  } catch {
    return false;
  }
}
