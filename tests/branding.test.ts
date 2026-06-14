import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf-8');
}

describe('Revendo branding', () => {
  it('package metadata uses Revendo', () => {
    const pkg = JSON.parse(read('package.json')) as {
      name: string;
      build: { appId: string; productName: string };
    };
    expect(pkg.name).toBe('revendo');
    expect(pkg.build.appId).toBe('fr.isury.revendo');
    expect(pkg.build.productName).toBe('Revendo');
  });

  it('UI and generated documents use Revendo as product name', () => {
    expect(read('src/components/Layout.tsx')).toContain('brand-title">Revendo');
    expect(read('electron/main.ts')).toContain("title: 'Revendo'");
    expect(read('electron/services/pdf/factureVente.ts')).toContain('Document généré par Revendo');
    expect(read('electron/services/pdf/declarationRecap.ts')).toContain('Document généré par Revendo');
    expect(read('electron/services/mobile/snapshotGenerator.ts')).toContain('<title>Revendo — Vue mobile</title>');
  });
});
