import {
  COMPATIBLE_SNAPSHOT_VERSIONS,
  detectSnapshotVersion,
  mobileSnapshotSchema,
  type MobileSnapshot
} from '@shared/mobile';
import { decryptEnvelopeJson, looksEncryptedEnvelope } from './crypto';

/**
 * Read a snapshot file picked by the user.
 *
 * Supports:
 *  - Plain JSON (`revendo-mobile-v3` ideal, `v2` legacy).
 *  - Encrypted envelope (`.revendo.enc`) — password required.
 *  - Legacy HTML snapshot (we extract the `const DATA = ...;` block).
 */
export async function readSnapshotFile(file: File, password?: string): Promise<MobileSnapshot> {
  const text = await file.text();
  if (looksEncryptedEnvelope(text)) {
    if (!password) throw new Error('Fichier chiffré : saisissez le mot de passe.');
    const plainBytes = await decryptEnvelopeJson(text, password);
    const plain = new TextDecoder().decode(plainBytes);
    return parseSnapshotText(plain);
  }
  return parseSnapshotText(text);
}

export function parseSnapshotText(text: string): MobileSnapshot {
  const trimmed = text.trim();
  let raw: unknown;
  if (trimmed.startsWith('{')) {
    raw = JSON.parse(trimmed);
  } else {
    // Try to extract DATA = {...}; from legacy HTML snapshot
    const marker = 'const DATA = ';
    const idx = trimmed.indexOf(marker);
    if (idx < 0) throw new Error('Fichier non reconnu (ni JSON, ni snapshot HTML Revendo).');
    let depth = 0;
    let start = -1;
    for (let i = idx + marker.length; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '{') {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          raw = JSON.parse(trimmed.slice(start, i + 1));
          break;
        }
      }
    }
    if (!raw) throw new Error('Snapshot HTML malformé.');
  }

  const version = detectSnapshotVersion(raw);
  if (!version || !COMPATIBLE_SNAPSHOT_VERSIONS.includes(version as typeof COMPATIBLE_SNAPSHOT_VERSIONS[number])) {
    throw new Error(`Schéma de snapshot incompatible : ${version ?? 'inconnu'}.`);
  }

  const parsed = mobileSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Snapshot invalide : ${first.path.join('.')} — ${first.message}`);
  }
  return parsed.data;
}
