import { useEffect, useState } from 'react';
import api from '../api/client';
import { Icon } from './Icons';

export default function TermsModal({ open, onAccepted }) {
  const [terms, setTerms] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setError('');
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/api/auth/terms');
        if (alive) setTerms(res.data.terms);
      } catch {
        if (alive) setError('Impossible de charger les conditions.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  async function accept(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/accept-terms');
      await onAccepted?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const lines = terms?.sections || [];

  return (
    <div className="modal-overlay terms-overlay">
      <div className="card modal-card terms-modal" role="dialog" aria-modal="true" aria-labelledby="terms-title">
        <h3 id="terms-title" className="terms-head">
          <Icon name="lock" size={20} />
          {terms?.title || 'Conditions d’utilisation'}
        </h3>
        <p className="terms-lead">
          Avant d’utiliser HexaroBot, lis et accepte ces règles — en particulier sur ta{' '}
          <strong>vie privée</strong> et tes <strong>conversations</strong>.
        </p>
        <div className="terms-scroll">
          {lines.map((line, i) =>
            line === '' ? (
              <br key={`br-${i}`} />
            ) : (
              <p key={`ln-${i}`} className={/^\d+\./.test(line) ? 'terms-section' : 'terms-line'}>
                {line}
              </p>
            )
          )}
          {!lines.length && !error && <p className="muted">Chargement…</p>}
        </div>
        {error && <p className="pairing-error">{error}</p>}
        <form className="terms-actions" onSubmit={accept}>
          <button type="submit" className="btn cta" disabled={busy || !terms}>
            {busy ? 'Enregistrement…' : 'J’accepte — activer mon bot'}
          </button>
        </form>
      </div>
    </div>
  );
}
