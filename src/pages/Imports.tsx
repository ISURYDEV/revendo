import { useEffect, useState } from 'react';
import { notify } from '../lib/notify';
import { api } from '../lib/api';
import { eur, longDate, shortDate } from '../lib/format';
import { useToast, useConfirm } from '../components/Toast';
import DropZone from '../components/DropZone';
import SortControls from '../components/SortControls';
import { sortRows, type SortDirection, type SortValueType } from '../lib/sort';
import type { CsvMappingTemplate, GenericCsvMapping, ImportPreview, ImportResult, ImportType } from '../../shared/types';

const TYPE_LABELS: Record<ImportType | 'unknown', string> = {
  vinteer_sales: 'Vinteer — Ventes Vinted',
  vinteer_purchases: 'Vinteer — Achats Vinted',
  vinteer_boosts: 'Vinteer — Boosts (→ Dépenses)',
  vinteer_inventory: 'Vinteer — Inventaire',
  whatnot_purchases: 'WhatNot — Achats',
  generic_sales: 'Générique — Ventes',
  generic_purchases: 'Générique — Achats',
  generic_expenses: 'Modèle — Dépenses',
  generic_stock: 'Modèle — Stock',
  pdf_invoice: 'PDF — Facture',
  unknown: 'Inconnu'
};

const CATEGORIES = [
  {
    key: 'sales_vinted_csv',
    icon: '🛍️',
    title: '1. Ventes Vinted (CSV)',
    desc: 'Importer le CSV Vinteer des ventes. Les ventes apparaîtront dans "Ventes" étiquetées Vinted. Les doublons (même ID transaction) ne sont pas comptés deux fois; seul un changement de statut met à jour la ligne.',
    action: 'csv'
  },
  {
    key: 'sales_vinted_pdf',
    icon: '🧾',
    title: '2. Ventes Vinted (PDF factures)',
    desc: 'PDFs de factures de ventes → Justificatifs de ventes étiquetés Vinted. Doublons détectés par hash SHA-256 du fichier.',
    action: 'pdf-sales-vinted'
  },
  {
    key: 'purchases_whatnot_csv',
    icon: '🎙️',
    title: '3. Achats WhatNot (CSV)',
    desc: 'CSV order report WhatNot → Justificatifs d\'achats étiquetés WhatNot. Doublons par order ID.',
    action: 'csv'
  },
  {
    key: 'purchases_aliexpress_pdf',
    icon: '📦',
    title: '4. Achats AliExpress (PDF)',
    desc: 'PDFs/images des commandes AliExpress → Justificatifs d\'achats étiquetés AliExpress. Doublons par hash.',
    action: 'pdf-purchases-aliexpress'
  },
  {
    key: 'purchases_vinted_csv',
    icon: '📄',
    title: '5. Achats Vinted (CSV)',
    desc: 'CSV Vinteer des achats → Justificatifs d\'achats étiquetés Vinted. Doublons par ID transaction.',
    action: 'csv'
  },
  {
    key: 'boosts_vinted_csv',
    icon: '🚀',
    title: '6. Boosts Vinted (CSV)',
    desc: 'CSV Vinteer des boosts → enregistrés dans "Dépenses" avec la catégorie "Boost Vinted". Doublons par ID.',
    action: 'csv'
  },
  {
    key: 'boosts_vinted_pdf',
    icon: '🧾',
    title: '7. Factures de boosts',
    desc: 'PDFs/images de factures de boosts → documents facture_boost. Revendo tente de les associer automatiquement aux dépenses de boost.',
    action: 'pdf-boosts'
  },
  {
    key: 'stock_csv',
    icon: '🏷️',
    title: '8. Stock (CSV)',
    desc: 'Téléchargez un modèle vide à remplir avec votre stock (date + lieu d\'achat obligatoires pour stock professionnel). Puis ré-importez le fichier rempli.',
    action: 'stock'
  },
  {
    key: 'expenses_csv',
    icon: '💸',
    title: '9. Dépenses (CSV)',
    desc: 'Téléchargez un modèle vide (Nom, Prix, Lieu, Date, Reçu oui/non). Après import, l\'app vous demandera de joindre les reçus pour les lignes marquées "oui".',
    action: 'expenses'
  },
  {
    key: 'generic_csv',
    icon: '🌍',
    title: '10. CSV générique multi-marketplace',
    desc: 'Import flexible pour ventes, achats, dépenses ou stock venant de LeBonCoin, brocante, vente directe, Instagram ou autre plateforme. Utilise un modèle de mapping enregistré dans Réglages.',
    action: 'generic'
  }
] as const;

type ImportHistorySort = 'imported_at' | 'import_type' | 'file_name' | 'rows_total' | 'rows_created' | 'rows_error';

const IMPORT_HISTORY_SORT_OPTIONS: { value: ImportHistorySort; label: string }[] = [
  { value: 'imported_at', label: 'Date d’import' },
  { value: 'import_type', label: 'Type' },
  { value: 'file_name', label: 'Fichier' },
  { value: 'rows_total', label: 'Lignes' },
  { value: 'rows_created', label: 'Créées' },
  { value: 'rows_error', label: 'Erreurs' }
];

const IMPORT_HISTORY_SORT_TYPES: Record<ImportHistorySort, SortValueType> = {
  imported_at: 'date',
  import_type: 'string',
  file_name: 'string',
  rows_total: 'number',
  rows_created: 'number',
  rows_error: 'number'
};

export default function Imports() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.imports.list>>>([]);
  const [templates, setTemplates] = useState<CsvMappingTemplate[]>([]);
  const [genericEntity, setGenericEntity] = useState<'sales' | 'purchases' | 'expenses' | 'stock'>('sales');
  const [genericTemplateId, setGenericTemplateId] = useState<number | ''>('');
  const [genericMappingJson, setGenericMappingJson] = useState('{\n  "date": "Date",\n  "status": "Statut",\n  "article_name": "Article",\n  "quantity": "Quantité",\n  "amount_received": "Montant",\n  "platform": "Plateforme"\n}');
  const [historySortBy, setHistorySortBy] = useState<ImportHistorySort>('imported_at');
  const [historySortDirection, setHistorySortDirection] = useState<SortDirection>('desc');
  const [needReceipt, setNeedReceipt] = useState<Array<{ expense_id: number; name: string; amount: number }>>([]);
  const toast = useToast();
  const confirmDialog = useConfirm();

  const refreshHistory = () => api.imports.list().then(setHistory);
  useEffect(() => {
    refreshHistory();
    api.csvTemplates.list().then(setTemplates);
  }, []);

  const onPickCsv = async () => {
    setResult(null); setPreview(null); setNeedReceipt([]);
    const fp = await api.imports.pickFile();
    if (!fp) return;
    setFilePath(fp);
    const prev = await api.imports.preview(fp);
    setPreview(prev);
  };

  const onRun = async () => {
    if (!filePath || !preview) return;
    setRunning(true);
    try {
      const mapping = buildGenericMapping();
      const r = await api.imports.run(filePath, preview.type as ImportType, mapping ?? undefined);
      setResult(r);
      // If expenses CSV, surface "need receipt" rows
      const need = (r as unknown as { needReceipt?: Array<{ expense_id: number; name: string; amount: number }> }).needReceipt;
      if (Array.isArray(need)) setNeedReceipt(need);
      await refreshHistory();
    } catch (err) {
      notify(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const genericType = (entity: typeof genericEntity): ImportType =>
    entity === 'sales' ? 'generic_sales' :
    entity === 'purchases' ? 'generic_purchases' :
    entity === 'expenses' ? 'generic_expenses' :
    'generic_stock';

  const buildGenericMapping = (): GenericCsvMapping | null => {
    if (!preview?.type.startsWith('generic_')) return null;
    // Bugfix : les types generic_stock et generic_expenses utilisent les
    // templates officiels avec des en-têtes fixes (Nom, Quantite, Date achat…).
    // Leur importer dédié (importStockCsv / importExpensesCsv) connaît déjà
    // ces colonnes. Si on envoie un csvMapping ici, runImport bascule sur
    // l'importer générique avec un mapping non adapté et rejette toutes les
    // lignes. On laisse donc passer ces deux types SANS mapping.
    if (preview.type === 'generic_stock' || preview.type === 'generic_expenses') return null;
    try {
      const selected = templates.find((t) => t.id === genericTemplateId);
      return {
        entityType: genericEntity,
        platformId: selected?.platform_id ?? null,
        templateId: selected?.id ?? null,
        mapping: JSON.parse(genericMappingJson) as Record<string, string>,
        currency: selected?.currency ?? 'EUR'
      };
    } catch {
      throw new Error('Mapping CSV générique invalide.');
    }
  };

  const onPickGenericCsv = async () => {
    setResult(null); setPreview(null); setNeedReceipt([]);
    const fp = await api.imports.pickFile();
    if (!fp) return;
    setFilePath(fp);
    const prev = await api.imports.preview(fp, genericType(genericEntity));
    setPreview(prev);
  };

  const onPreviewGeneric = async () => {
    if (!filePath) return;
    const mapping = buildGenericMappingForPreview();
    const prev = await api.imports.preview(filePath, genericType(genericEntity), mapping);
    setPreview(prev);
  };

  const buildGenericMappingForPreview = (): GenericCsvMapping => {
    const selected = templates.find((t) => t.id === genericTemplateId);
    return {
      entityType: genericEntity,
      platformId: selected?.platform_id ?? null,
      templateId: selected?.id ?? null,
      mapping: JSON.parse(genericMappingJson) as Record<string, string>,
      currency: selected?.currency ?? 'EUR'
    };
  };

  const onSelectTemplate = (id: number | '') => {
    setGenericTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    if (tpl) {
      setGenericEntity(tpl.entity_type);
      try {
        setGenericMappingJson(JSON.stringify(JSON.parse(tpl.mapping_json), null, 2));
      } catch {
        setGenericMappingJson(tpl.mapping_json);
      }
    }
  };

  const onPdfImport = async (kind: 'sales-vinted' | 'purchases-aliexpress' | 'purchases-vinted' | 'purchases-whatnot' | 'boosts-vinted') => {
    let res;
    if (kind === 'sales-vinted') res = await api.importsPdf.sales('vinted');
    else if (kind === 'purchases-aliexpress') res = await api.importsPdf.purchases('aliexpress');
    else if (kind === 'purchases-vinted') res = await api.importsPdf.purchases('vinted');
    else if (kind === 'purchases-whatnot') res = await api.importsPdf.purchases('whatnot');
    else res = await api.importsPdf.boosts('vinted');
    if (res.canceled) return;
    const ok = res.results.filter((r) => r.ok).length;
    const dup = res.results.filter((r) => r.ok && r.deduplicated).length;
    notify(`${ok} fichier(s) importé(s)${dup > 0 ? `, dont ${dup} déjà présent(s) (doublons)` : ''}.`);
  };

  const onAttachReceipt = async (expenseId: number) => {
    const r = await api.expenseReceipt.attach(expenseId);
    if (!r.canceled) {
      setNeedReceipt((prev) => prev.filter((x) => x.expense_id !== expenseId));
    }
  };

  const onDropFiles = async (paths: string[]) => {
    const csv = paths.find((p) => p.toLowerCase().endsWith('.csv'));
    const pdfs = paths.filter((p) => /\.(pdf|png|jpg|jpeg)$/i.test(p));
    if (csv) {
      setFilePath(csv);
      try {
        const prev = await api.imports.preview(csv);
        setPreview(prev);
        toast.info('CSV détecté', `Type : ${TYPE_LABELS[prev.type] ?? 'inconnu'}`);
      } catch (err) {
        toast.error('Erreur preview', err instanceof Error ? err.message : String(err));
      }
    }
    if (pdfs.length > 0 && !csv) {
      // Ask which type
      const isVintedSales = await confirmDialog({
        title: 'Type de PDF',
        message: `${pdfs.length} PDF détecté(s). Sont-ils des justificatifs de VENTES Vinted ?\n\n(Oui = ventes, Non = achats AliExpress par défaut)`
      });
      const target = isVintedSales ? 'sales-vinted' : 'purchases-aliexpress';
      await onPdfImport(target);
    }
  };

  const sortedHistory = sortRows(
    history,
    (row) => row[historySortBy],
    historySortDirection,
    IMPORT_HISTORY_SORT_TYPES[historySortBy]
  );

  return (
    <DropZone onFiles={onDropFiles} label="Déposez CSV ou PDF ici" accept=".csv,.pdf,.png,.jpg,.jpeg">
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">📥 Importer des données</h1>
      <div className="alert-info text-sm">
        Choisissez la catégorie selon le type de fichier, ou <strong>glissez-déposez directement</strong> vos
        fichiers sur cette page. Doublons toujours détectés automatiquement
        (par ID plateforme pour CSV, par hash SHA-256 pour PDF).
      </div>

      <div className="import-grid">
        {CATEGORIES.map((cat) => (
          <div key={cat.key} className="import-card">
            <div className="import-card-title"><span>{cat.icon}</span>{cat.title}</div>
            <div className="import-card-desc">{cat.desc}</div>
            <div className="import-card-actions">
              {cat.action === 'csv' && (
                <button className="btn-primary import-action" onClick={onPickCsv}>📁 Sélectionner CSV…</button>
              )}
              {cat.action === 'pdf-sales-vinted' && (
                <button className="btn-primary import-action" onClick={() => onPdfImport('sales-vinted')}>📁 Sélectionner PDF/Images…</button>
              )}
              {cat.action === 'pdf-purchases-aliexpress' && (
                <button className="btn-primary import-action" onClick={() => onPdfImport('purchases-aliexpress')}>📁 Sélectionner PDF/Images…</button>
              )}
              {cat.action === 'pdf-boosts' && (
                <button className="btn-primary import-action" onClick={() => onPdfImport('boosts-vinted')}>📁 Importer factures de boosts…</button>
              )}
              {cat.action === 'stock' && (
                <>
                  <button className="btn-secondary import-action import-action-secondary" onClick={() => api.templates.stockCsv()}>📥 Télécharger modèle</button>
                  <button className="btn-primary import-action" onClick={onPickCsv}>📤 Importer CSV rempli</button>
                </>
              )}
              {cat.action === 'expenses' && (
                <>
                  <button className="btn-secondary import-action import-action-secondary" onClick={() => api.templates.expensesCsv()}>📥 Télécharger modèle</button>
                  <button className="btn-primary import-action" onClick={onPickCsv}>📤 Importer CSV rempli</button>
                </>
              )}
              {cat.action === 'generic' && (
                <button className="btn-primary import-action" onClick={onPickGenericCsv}>🌍 Sélectionner CSV générique…</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Preview */}
      {preview && (
        <div className="card p-4 space-y-3">
          <h2 className="text-lg font-semibold">Aperçu — {TYPE_LABELS[preview.type]}</h2>
          <div className="grid grid-cols-4 gap-3 text-sm">
            <Fact label="Source détectée" value={preview.platformName ?? preview.sourceAdapterName ?? '—'} />
            <Fact label="Adaptateur" value={preview.sourceAdapterId ?? '—'} />
            <Fact label="Doublons exacts" value={preview.dedupSummary?.exactDuplicates ?? preview.duplicates} color="text-amber-700" />
            <Fact label="Doublons possibles" value={preview.dedupSummary?.possibleDuplicates ?? 0} color="text-orange-700" />
          </div>
          {preview.type.startsWith('generic_') && (
            <div className="alert-info space-y-3">
              <div className="font-semibold">Mapping CSV générique</div>
              <div className="grid grid-cols-3 gap-2">
                <select className="border rounded px-2 py-1 text-sm" value={genericEntity} onChange={(e) => setGenericEntity(e.target.value as typeof genericEntity)}>
                  <option value="sales">Ventes</option>
                  <option value="purchases">Achats</option>
                  <option value="expenses">Dépenses</option>
                  <option value="stock">Stock</option>
                </select>
                <select className="border rounded px-2 py-1 text-sm col-span-2" value={genericTemplateId} onChange={(e) => onSelectTemplate(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Aucun modèle enregistré</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.entity_type})</option>)}
                </select>
              </div>
              <textarea className="w-full border rounded px-2 py-1 font-mono text-xs min-h-28" value={genericMappingJson} onChange={(e) => setGenericMappingJson(e.target.value)} />
              <div className="text-xs text-slate-500">
                Format: champ Revendo → colonne CSV. Champs requis: {(preview.requiredFields ?? []).join(', ') || '—'}.
              </div>
              <button className="btn-secondary text-sm" onClick={onPreviewGeneric}>Recalculer l’aperçu avec ce mapping</button>
            </div>
          )}
          <div className="grid grid-cols-4 gap-3 text-sm">
            <Fact label="Fichier" value={preview.fileName} />
            <Fact label="Lignes" value={preview.totalRows} />
            <Fact label="Nouvelles" value={preview.newRows} color="text-emerald-700" />
            <Fact label="Doublons" value={preview.duplicates} color="text-amber-700" />
            <Fact label="Montant total" value={preview.totalAmount != null ? eur(preview.totalAmount) : '—'} />
            <Fact label="Période" value={`${shortDate(preview.dateMin)} → ${shortDate(preview.dateMax)}`} />
          </div>
          {preview.warnings.map((w, i) => (<div key={i} className="alert-warn text-xs">{w}</div>))}
          <div className="flex gap-2">
            <button className="btn-primary disabled:opacity-50" onClick={onRun} disabled={running || preview.type === 'unknown'}>
              {running ? 'Import en cours…' : `Importer ${preview.totalRows} ligne(s)`}
            </button>
            <button className="btn-secondary" onClick={() => { setPreview(null); setFilePath(null); setResult(null); }}>Annuler</button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card p-4">
          <h2 className="text-lg font-semibold mb-2">Résultat</h2>
          <div className="grid grid-cols-4 gap-3 text-sm">
            <Fact label="Nouvelles (créées)" value={result.created} color="text-emerald-700" />
            <Fact label="Doublons ignorés" value={result.duplicatesIdentical} color="text-slate-600" />
            <Fact label="Mises à jour" value={result.updated} color="text-sky-700" />
            <Fact label="Conflits" value={result.conflicts} color="text-amber-700" />
            <Fact label="Avant début d'activité" value={result.preActivityCount} color="text-orange-700" />
            <Fact label="Annulées / remboursées" value={result.canceledRefundedCount} color="text-red-700" />
            <Fact label="CA réellement ajouté" value={eur(result.caAdded)} color="text-emerald-700" />
            <Fact label="Erreurs" value={result.errors.length} color="text-red-700" />
          </div>
        </div>
      )}

      {/* Receipt prompts */}
      {needReceipt.length > 0 && (
        <div className="card p-4 bg-amber-50 border-amber-300">
          <h2 className="text-lg font-semibold mb-2">📎 Joindre les reçus</h2>
          <p className="text-sm text-slate-700 mb-3">
            Les dépenses suivantes ont été marquées "Reçu: oui". Pour chacune, joignez le PDF ou l'image du reçu.
          </p>
          <div className="space-y-2">
            {needReceipt.map((n) => (
              <div key={n.expense_id} className="flex items-center justify-between bg-white p-2 rounded border">
                <div className="text-sm">
                  <strong>{n.name}</strong> — {eur(n.amount)}
                </div>
                <button className="btn-primary text-xs" onClick={() => onAttachReceipt(n.expense_id)}>
                  📎 Joindre le reçu
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <section>
        <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold">Historique des imports</h2>
          <SortControls
            value={historySortBy}
            direction={historySortDirection}
            options={IMPORT_HISTORY_SORT_OPTIONS}
            onValueChange={setHistorySortBy}
            onDirectionChange={setHistorySortDirection}
          />
        </div>
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Fichier</th>
                <th className="px-3 py-2 text-right">Lignes</th>
                <th className="px-3 py-2 text-right">Créées</th>
                <th className="px-3 py-2 text-right">Erreurs</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sortedHistory.map((h) => (
                <tr key={h.id} className="border-t">
                  <td className="px-3 py-2">#{h.id}</td>
                  <td className="px-3 py-2">{longDate(h.imported_at)}</td>
                  <td className="px-3 py-2">{TYPE_LABELS[h.import_type as ImportType] ?? h.import_type}</td>
                  <td className="px-3 py-2 truncate max-w-[260px]">{h.file_name}</td>
                  <td className="px-3 py-2 text-right">{h.rows_total}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{h.rows_created}</td>
                  <td className="px-3 py-2 text-right text-red-700">{h.rows_error}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="text-xs text-red-700 hover:underline"
                      onClick={async () => {
                        if (!confirm(`Annuler l'import #${h.id} ? Les lignes créées seront supprimées.`)) return;
                        await api.imports.revert(h.id); refreshHistory();
                      }}
                    >Annuler</button>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Aucun import.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    </DropZone>
  );
}

function Fact({ label, value, color = 'text-slate-800' }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`font-semibold ${color}`}>{value}</div>
    </div>
  );
}
