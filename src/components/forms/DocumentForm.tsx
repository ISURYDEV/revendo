import { useState } from 'react';
import { notify } from '../../lib/notify';
import { api } from '../../lib/api';
import { Field, Input, Select, Textarea } from '../Modal';
import WizardModal from '../WizardModal';
import type { DocumentLink, DocumentType } from '../../../shared/types';

const TYPES: { value: DocumentType; label: string }[] = [
  { value: 'facture_vente', label: 'Facture de vente' },
  { value: 'facture_achat', label: 'Facture d\'achat' },
  { value: 'ticket_caisse', label: 'Ticket caisse' },
  { value: 'facture_boost', label: 'Facture boost' },
  { value: 'justificatif_urssaf', label: 'Justificatif URSSAF' },
  { value: 'export_vinteer', label: 'Export Vinteer' },
  { value: 'export_whatnot', label: 'Export WhatNot' },
  { value: 'autre', label: 'Autre' }
];

export default function DocumentForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [paths, setPaths] = useState<string[]>([]);
  const [type, setType] = useState<DocumentType>('facture_vente');
  const [linkType, setLinkType] = useState<DocumentLink['entity_type'] | 'none'>('none');
  const [linkId, setLinkId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [ocrResult, setOcrResult] = useState<{ date: string | null; amount: number | null } | null>(null);

  const pick = async () => {
    const p = await api.docs.pickFiles();
    if (p && p.length > 0) setPaths(p);
  };

  const runOCR = async () => {
    const pdfPath = paths.find((p) => p.toLowerCase().endsWith('.pdf'));
    if (!pdfPath) {
      notify('L’OCR fonctionne uniquement avec les fichiers PDF. Sélectionnez d’abord un PDF.');
      return;
    }
    try {
      const r = await api.ocr.pdf(pdfPath);
      setOcrResult({ date: r.date, amount: r.amount });
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };

  const onSubmit = async () => {
    if (paths.length === 0) return notify('Sélectionnez au moins un fichier.');
    setBusy(true);
    const results = await api.docs.addFromPaths(paths, type);
    const ok = results.filter((r) => r.ok);
    const dup = results.filter((r) => r.ok && r.deduplicated);
    const err = results.filter((r) => !r.ok);

    // Optional linking
    if (linkType !== 'none' && linkId) {
      const id = Number(linkId);
      for (const r of ok) {
        if (r.id) await api.docs.link({ document_id: r.id, entity_type: linkType, entity_id: id });
      }
    }
    if (notes.trim()) {
      for (const r of ok) {
        if (r.id) await api.docs.update(r.id, { notes });
      }
    }
    setBusy(false);
    notify(
      `${ok.length} document(s) ajouté(s). ${dup.length > 0 ? `${dup.length} doublon(s) détecté(s), non dupliqué(s). ` : ''}${err.length > 0 ? `${err.length} en erreur.` : ''}`
    );
    onSaved();
    onClose();
  };

  return (
    <WizardModal
      title="Ajouter document(s)"
      onClose={onClose}
      onConfirm={onSubmit}
      confirmLabel="Ajouter"
      busy={busy}
      steps={[
        {
          title: 'Fichiers',
          validate: () => paths.length === 0 ? 'Sélectionnez au moins un fichier.' : null,
          content: (
            <Field label="Fichiers sélectionnés">
              <div className="flex gap-2 items-center">
                <button className="btn-secondary text-sm" onClick={pick}>Choisir des fichiers…</button>
                <span className="text-xs text-slate-500">{paths.length} fichier(s)</span>
              </div>
              {paths.length > 0 && <ul className="text-xs text-slate-600 mt-1 max-h-32 overflow-y-auto">{paths.map((p) => (<li key={p} className="truncate">• {p}</li>))}</ul>}
            </Field>
          )
        },
        {
          title: 'Type',
          content: (
            <>
              {paths.length > 0 && (
                <div className="card p-3 bg-slate-50 mb-3">
                  <div className="flex gap-2 items-center">
                    <button className="btn-secondary text-xs" onClick={runOCR}>Détecter date/montant (PDF)</button>
                    {ocrResult && <span className="text-xs text-slate-600">Détecté : date <strong>{ocrResult.date ?? '—'}</strong>, montant <strong>{ocrResult.amount != null ? `${ocrResult.amount.toFixed(2)} €` : '—'}</strong></span>}
                  </div>
                </div>
              )}
              <Field label="Type de document"><Select value={type} onChange={(e) => setType(e.target.value as DocumentType)}>{TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}</Select></Field>
            </>
          )
        },
        {
          title: 'Association',
          validate: () => linkType !== 'none' && !Number(linkId) ? "Indiquez l'ID de l'entité ou choisissez Aucune." : null,
          content: (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Associer à une entité (optionnel)"><Select value={linkType} onChange={(e) => setLinkType(e.target.value as typeof linkType)}><option value="none">Aucune</option><option value="sale">Vente</option><option value="purchase">Achat</option><option value="expense">Dépense</option><option value="boost">Boost</option><option value="stock_item">Article de stock</option><option value="declaration">Déclaration</option></Select></Field>
              <Field label="ID de l'entité"><Input value={linkId} onChange={(e) => setLinkId(e.target.value)} disabled={linkType === 'none'} placeholder="Ex. : 42" /></Field>
            </div>
          )
        },
        {
          title: 'Résumé',
          content: (
            <>
              <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              <div className="card p-4 text-sm space-y-2">
                <div className="flex justify-between"><span>Fichiers</span><strong>{paths.length}</strong></div>
                <div className="flex justify-between"><span>Type</span><strong>{TYPES.find((t) => t.value === type)?.label ?? type}</strong></div>
                <div className="flex justify-between"><span>Association</span><strong>{linkType === 'none' ? 'Aucune' : `${linkType} #${linkId}`}</strong></div>
              </div>
            </>
          )
        }
      ]}
    />
  );
}
