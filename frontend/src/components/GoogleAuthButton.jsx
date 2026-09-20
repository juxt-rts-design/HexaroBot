import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { publicErrorMessage } from '../utils/publicError';

/**
 * Bouton Connexion Google (logo officiel + OAuth Supabase).
 * @param {{ next?: string, className?: string }} props
 */
export default function GoogleAuthButton({ next = '/dashboard', className = '' }) {
  const { loginWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setError('');
    setBusy(true);
    try {
      await loginWithGoogle({ next });
      // Redirection Google — le busy reste jusqu'au unload
    } catch (err) {
      setBusy(false);
      setError(publicErrorMessage(err, 'Connexion Google impossible. Réessaie.'));
    }
  }

  return (
    <div className={`google-auth ${className}`.trim()}>
      <button
        type="button"
        className="btn secondary google-btn"
        onClick={handleClick}
        disabled={busy}
      >
        <img src="/google-g.png" alt="" className="google-btn-logo" width={18} height={18} />
        {busy ? 'Redirection Google…' : 'Continuer avec Google'}
      </button>
      {error && <p className="error-text google-auth-error">{error}</p>}
    </div>
  );
}
