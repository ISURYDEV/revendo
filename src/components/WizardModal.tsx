import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';

export interface WizardStep {
  title: string;
  description?: string;
  content: ReactNode;
  validate?: () => string | null;
}

export default function WizardModal({
  title,
  steps,
  onClose,
  onConfirm,
  confirmLabel = 'Confirmer',
  busy = false
}: {
  title: string;
  steps: WizardStep[];
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const step = steps[index];
  const progress = steps.length > 0 ? ((index + 1) / steps.length) * 100 : 0;

  const next = async () => {
    const validation = step.validate?.();
    if (validation) {
      setError(validation);
      return;
    }
    setError('');
    if (index < steps.length - 1) {
      setIndex(index + 1);
      return;
    }
    await onConfirm();
  };

  return (
    <Modal title={title} onClose={onClose} size="lg">
      <div className="wizard">
        <div className="wizard-progress">
          <div className="wizard-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="wizard-steps">
          {steps.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className={`wizard-step ${i === index ? 'is-current' : ''} ${i < index ? 'is-done' : ''}`}
              onClick={() => i <= index && setIndex(i)}
            >
              <span>{i + 1}</span>
              <strong>{s.title}</strong>
            </button>
          ))}
        </div>

        <div className="wizard-body">
          <h3>{step.title}</h3>
          {step.description && <p>{step.description}</p>}
          {error && <div className="alert-warn mb-3">{error}</div>}
          {step.content}
        </div>

        <div className="wizard-actions">
          <button className="btn-secondary" type="button" onClick={onClose}>Annuler</button>
          <button className="btn-secondary" type="button" disabled={index === 0} onClick={() => { setError(''); setIndex(index - 1); }}>
            Précédent
          </button>
          <button className="btn-primary" type="button" disabled={busy} onClick={next}>
            {index === steps.length - 1 ? (busy ? 'Enregistrement...' : confirmLabel) : 'Suivant'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
