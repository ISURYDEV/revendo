/**
 * Decrypt a Revendo encrypted envelope (`revendo-encrypted-file-v1`)
 * using the WebCrypto API.
 *
 * Format must match `electron/services/security/crypto.ts` on desktop:
 *  - AES-256-GCM
 *  - scrypt (with kdf_params if present, otherwise default N=16384/r=8/p=1)
 *  - AAD = format string
 *
 * NOTE: WebCrypto has PBKDF2 native but no scrypt. We use a small JS implementation.
 * For the desktop default of N=16384 (legacy) or N=131072 (current) on a modern
 * phone, scrypt takes 0.3–2s — acceptable for a one-shot decryption.
 */

const FORMAT = 'revendo-encrypted-file-v1';

interface Envelope {
  format: string;
  cipher: string;
  kdf: string;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  metadata?: Record<string, unknown>;
  kdf_params?: { N: number; r: number; p: number };
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * scrypt implementation tailored for browser. Returns 32-byte key.
 * Based on RFC 7914 — N up to 2^17 reasonable on modern phones.
 */
async function scrypt(password: string, salt: Uint8Array, N: number, r: number, p: number, dkLen: number): Promise<Uint8Array> {
  // Use PBKDF2 + iteration count as a fallback approximation if N is too large?
  // No — we implement actual scrypt because the envelope IS scrypt.
  const enc = new TextEncoder();
  const passwd = enc.encode(password);
  return scryptInternal(passwd, salt, N, r, p, dkLen);
}

// ---- minimal scrypt (RFC 7914) ----
// Adapted from public-domain references. Sufficient for N=16384..131072.

// Helper: cast a Uint8Array to BufferSource for the strict TS 5.6 DOM lib
// (it now requires ArrayBufferView<ArrayBuffer>, not ArrayBufferLike).
function buf(arr: Uint8Array): BufferSource {
  return arr as unknown as BufferSource;
}

function pbkdf2HmacSha256(passwd: Uint8Array, salt: Uint8Array, c: number, dkLen: number): Promise<Uint8Array> {
  return crypto.subtle.importKey('raw', buf(passwd), 'PBKDF2', false, ['deriveBits']).then((key) =>
    crypto.subtle.deriveBits({ name: 'PBKDF2', salt: buf(salt), iterations: c, hash: 'SHA-256' }, key, dkLen * 8)
  ).then((bits) => new Uint8Array(bits));
}

function R(a: number, b: number): number { return (a << b) | (a >>> (32 - b)); }

function salsa208Core(B: Uint32Array): void {
  const x = new Uint32Array(16);
  for (let i = 0; i < 16; i++) x[i] = B[i];
  for (let i = 0; i < 8; i += 2) {
    x[4] ^= R(x[0] + x[12] | 0, 7);  x[8] ^= R(x[4] + x[0] | 0, 9);
    x[12] ^= R(x[8] + x[4] | 0, 13); x[0] ^= R(x[12] + x[8] | 0, 18);
    x[9] ^= R(x[5] + x[1] | 0, 7);   x[13] ^= R(x[9] + x[5] | 0, 9);
    x[1] ^= R(x[13] + x[9] | 0, 13); x[5] ^= R(x[1] + x[13] | 0, 18);
    x[14] ^= R(x[10] + x[6] | 0, 7); x[2] ^= R(x[14] + x[10] | 0, 9);
    x[6] ^= R(x[2] + x[14] | 0, 13); x[10] ^= R(x[6] + x[2] | 0, 18);
    x[3] ^= R(x[15] + x[11] | 0, 7); x[7] ^= R(x[3] + x[15] | 0, 9);
    x[11] ^= R(x[7] + x[3] | 0, 13); x[15] ^= R(x[11] + x[7] | 0, 18);
    x[1] ^= R(x[0] + x[3] | 0, 7);   x[2] ^= R(x[1] + x[0] | 0, 9);
    x[3] ^= R(x[2] + x[1] | 0, 13);  x[0] ^= R(x[3] + x[2] | 0, 18);
    x[6] ^= R(x[5] + x[4] | 0, 7);   x[7] ^= R(x[6] + x[5] | 0, 9);
    x[4] ^= R(x[7] + x[6] | 0, 13);  x[5] ^= R(x[4] + x[7] | 0, 18);
    x[11] ^= R(x[10] + x[9] | 0, 7); x[8] ^= R(x[11] + x[10] | 0, 9);
    x[9] ^= R(x[8] + x[11] | 0, 13); x[10] ^= R(x[9] + x[8] | 0, 18);
    x[12] ^= R(x[15] + x[14] | 0, 7); x[13] ^= R(x[12] + x[15] | 0, 9);
    x[14] ^= R(x[13] + x[12] | 0, 13); x[15] ^= R(x[14] + x[13] | 0, 18);
  }
  for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
}

function blockmixSalsa8(B: Uint32Array, Y: Uint32Array, r: number): void {
  const X = new Uint32Array(16);
  for (let i = 0; i < 16; i++) X[i] = B[(2 * r - 1) * 16 + i];
  for (let i = 0; i < 2 * r; i++) {
    for (let j = 0; j < 16; j++) X[j] ^= B[i * 16 + j];
    salsa208Core(X);
    for (let j = 0; j < 16; j++) Y[i * 16 + j] = X[j];
  }
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < 16; j++) B[i * 16 + j] = Y[2 * i * 16 + j];
  }
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < 16; j++) B[(i + r) * 16 + j] = Y[(2 * i + 1) * 16 + j];
  }
}

function smix(B: Uint32Array, r: number, N: number): void {
  const V = new Uint32Array(N * 32 * r);
  const X = new Uint32Array(32 * r);
  const Y = new Uint32Array(32 * r);
  for (let i = 0; i < 32 * r; i++) X[i] = B[i];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < 32 * r; j++) V[i * 32 * r + j] = X[j];
    blockmixSalsa8(X, Y, r);
  }
  for (let i = 0; i < N; i++) {
    const j = X[(2 * r - 1) * 16] & (N - 1);
    for (let k = 0; k < 32 * r; k++) X[k] ^= V[j * 32 * r + k];
    blockmixSalsa8(X, Y, r);
  }
  for (let i = 0; i < 32 * r; i++) B[i] = X[i];
}

async function scryptInternal(passwd: Uint8Array, salt: Uint8Array, N: number, r: number, p: number, dkLen: number): Promise<Uint8Array> {
  if ((N & (N - 1)) !== 0 || N < 2) throw new Error('Invalid scrypt N');
  const B = await pbkdf2HmacSha256(passwd, salt, 1, p * 128 * r);
  const Bview = new Uint32Array(B.buffer, B.byteOffset, B.byteLength / 4);
  for (let i = 0; i < p; i++) {
    const block = Bview.subarray(i * 32 * r, (i + 1) * 32 * r);
    smix(block, r, N);
  }
  return pbkdf2HmacSha256(passwd, B, 1, dkLen);
}

// ---- end scrypt ----

export async function decryptEnvelopeJson(envelopeJson: string, password: string): Promise<Uint8Array> {
  const env = JSON.parse(envelopeJson) as Envelope;
  if (env.format !== FORMAT) throw new Error('Format de fichier non pris en charge.');
  if (env.cipher !== 'aes-256-gcm') throw new Error('Algorithme de chiffrement non pris en charge.');
  if (env.kdf !== 'scrypt') throw new Error('KDF non pris en charge.');

  const salt = fromB64(env.salt);
  const iv = fromB64(env.iv);
  const tag = fromB64(env.authTag);
  const ciphertext = fromB64(env.ciphertext);
  const N = env.kdf_params?.N ?? 16384;
  const r = env.kdf_params?.r ?? 8;
  const p = env.kdf_params?.p ?? 1;

  const key = await scrypt(password, salt, N, r, p, 32);
  const cryptoKey = await crypto.subtle.importKey('raw', buf(key), { name: 'AES-GCM' }, false, ['decrypt']);

  // WebCrypto expects ciphertext+tag concatenated
  const ct = new Uint8Array(ciphertext.length + tag.length);
  ct.set(ciphertext, 0);
  ct.set(tag, ciphertext.length);

  const aad = new TextEncoder().encode(FORMAT);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad), tagLength: 128 },
      cryptoKey,
      buf(ct)
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error('Déchiffrement impossible : mot de passe incorrect ou fichier endommagé.');
  }
}

export function looksEncryptedEnvelope(text: string): boolean {
  return text.slice(0, 512).includes(FORMAT);
}
