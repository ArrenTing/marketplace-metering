import { useEffect, useRef, useState } from 'react';
import { DIMENSIONS, type Dimension, type UsageInput } from './types';

type Props = {
  open: boolean;
  busy: boolean;
  departments: string[];
  lastInput: UsageInput | null;
  lastOutcome: string | null;
  onClose: () => void;
  onGenerate: (input: UsageInput) => void;
  onRandomBatch: () => void;
  onResend: () => void;
  onConflict: () => void;
};

export default function SendUsageDialog({
  open,
  busy,
  departments,
  lastInput,
  lastOutcome,
  onClose,
  onGenerate,
  onRandomBatch,
  onResend,
  onConflict,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [customerId, setCustomerId] = useState(departments[0] ?? '');
  const [dimension, setDimension] = useState<Dimension>('api_calls');
  const [timestamp, setTimestamp] = useState(() => new Date().toISOString());
  const [quantity, setQuantity] = useState('1200');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      setTimestamp(new Date().toISOString());
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function readForm(): UsageInput | null {
    const parsedQuantity = Number(quantity);
    if (!customerId.trim()) {
      setFormError('Department is required.');
      return null;
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setFormError('Quantity must be a positive whole number.');
      return null;
    }
    if (Number.isNaN(Date.parse(timestamp))) {
      setFormError('Timestamp must be a valid ISO date.');
      return null;
    }
    setFormError(null);
    return { customerId: customerId.trim(), dimension, timestamp, quantity: parsedQuantity };
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="dialog-body">
        <div className="panel-heading">
          <h2>Send usage</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="hint">
          Pretend to be a vendor reporting how much a department used. Each record is one department,
          one dimension and one hour.
        </p>

        <div className="form-grid">
          <label>
            Department
            <input
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              list="departments"
            />
            <datalist id="departments">
              {departments.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </label>
          <label>
            Dimension
            <select
              value={dimension}
              onChange={(event) => setDimension(event.target.value as Dimension)}
            >
              {DIMENSIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Timestamp (UTC)
            <input value={timestamp} onChange={(event) => setTimestamp(event.target.value)} />
          </label>
          <label>
            Quantity
            <input
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>
        {formError ? <p className="form-error">{formError}</p> : null}

        <div className="actions">
          <button
            type="button"
            onClick={() => {
              const input = readForm();
              if (input) {
                onGenerate(input);
              }
            }}
            disabled={busy}
          >
            Generate
          </button>
          <button type="button" onClick={onRandomBatch} disabled={busy}>
            Generate random batch
          </button>
        </div>

        <div className="dialog-section">
          <h3>Try the duplicate rules</h3>
          <p className="hint">
            Resending the same record is safe and stored once. Sending the same hour with a
            different quantity is rejected with 409.
          </p>
          <div className="actions">
            <button type="button" className="secondary" onClick={onResend} disabled={busy || !lastInput}>
              Resend last
            </button>
            <button type="button" className="danger" onClick={onConflict} disabled={busy || !lastInput}>
              Send conflict
            </button>
          </div>
        </div>

        {lastOutcome ? <p className="dialog-outcome">{lastOutcome}</p> : null}
      </div>
    </dialog>
  );
}
