import { useState } from 'react';
import { notify } from '../../lib/notify';
import { Modal, Field, Input, Select, Textarea } from '../Modal';

export interface EditFieldSpec {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'textarea' | 'select';
  options?: { value: string; label: string }[];
  hint?: string;
}

/**
 * Generic edit modal — given a row + a schema, produces inputs and emits a patch on save.
 * Used for Expense, Boost, Purchase, Document, Stock — keeps each page's edit logic minimal.
 */
export default function GenericEditForm({
  title,
  fields,
  initial,
  onClose,
  onSave
}: {
  title: string;
  fields: EditFieldSpec[];
  initial: Record<string, unknown>;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of fields) {
      let raw = initial[f.key];
      if (raw == null) raw = '';
      if (f.type === 'date' && typeof raw === 'string') raw = raw.slice(0, 10);
      v[f.key] = raw;
    }
    return v;
  });
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      for (const f of fields) {
        let v = values[f.key];
        if (v === '' || v == null) {
          patch[f.key] = null;
          continue;
        }
        if (f.type === 'number') {
          const n = Number(String(v).replace(',', '.'));
          patch[f.key] = Number.isFinite(n) ? n : null;
        } else if (f.type === 'date') {
          // Store as date-only string (e.g. expenses.date column) or as ISO if relevant
          patch[f.key] = String(v);
        } else {
          patch[f.key] = v;
        }
      }
      await onSave(patch);
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} size="lg">
      {fields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          {f.type === 'textarea' ? (
            <Textarea rows={2} value={String(values[f.key] ?? '')} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
          ) : f.type === 'select' ? (
            <Select value={String(values[f.key] ?? '')} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
              {(f.options ?? []).map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </Select>
          ) : (
            <Input
              type={f.type === 'date' ? 'date' : f.type === 'number' ? 'text' : 'text'}
              value={String(values[f.key] ?? '')}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            />
          )}
        </Field>
      ))}
      <div className="flex justify-end gap-2 mt-3">
        <button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={onSubmit} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les modifications'}</button>
      </div>
    </Modal>
  );
}
