import { useEffect } from 'react';

/**
 * Modale de confirmation style HEXARO (remplace window.confirm).
 * props:
 *  - open, title, message, confirmLabel, cancelLabel, danger, busy
 *  - onConfirm, onCancel
 */
export default function ConfirmModal({
  open,
  title = 'Confirmer',
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel?.()}>
      <div className="card modal-card confirm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{title}</h3>
        {message && <p className="muted confirm-message">{message}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn${danger ? ' danger' : ''}`} disabled={busy} onClick={onConfirm}>
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
