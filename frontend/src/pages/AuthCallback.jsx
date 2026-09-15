import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BrandMark } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

function loginPathFromNext(next) {
  if (String(next || '').startsWith('/admin')) return '/admin/login';
  return '/login';
}

function classifyOAuthError(params) {
  const error = params.get('error');
  const code = params.get('error_code');
  const desc = params.get('error_description');
  if (!error && !code) return null;

  const decoded = desc ? decodeURIComponent(desc.replace(/\+/g, ' ')) : '';
  const cancel =
    error === 'access_denied'
    || /access_denied|user.?denied|cancelled|canceled|consent.?required/i.test(`${error} ${code} ${decoded}`);

  if (cancel) {
    return {
      type: 'cancel',
      message: 'Connexion Google annulée.',
    };
  }

  return {
    type: 'error',
    message: [
      'La connexion Google a échoué côté Supabase / Google.',
      code ? `Code : ${code}` : null,
      decoded || null,
      'Vérifie le Client ID / Secret et l’URI de callback Supabase.',
    ].filter(Boolean).join(' '),
  };
}

/** Retour OAuth Google — finalise la session puis redirige. */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading, refreshProfile } = useAuth();
  const [message, setMessage] = useState('Connexion Google en cours…');
  const [failed, setFailed] = useState(false);
  const nextFromQuery = params.get('next');
  let next = nextFromQuery || '/dashboard';
  if (!nextFromQuery) {
    try {
      next = sessionStorage.getItem('hexaro_oauth_next') || '/dashboard';
    } catch { /* ignore */ }
  }
  const backTo = loginPathFromNext(next);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const classified = classifyOAuthError(params);
      if (classified) {
        if (cancelled) return;
        if (classified.type === 'cancel') {
          // Annulation utilisateur : retour immédiat au login, pas d’alarme config
          navigate(backTo, { replace: true, state: { notice: classified.message } });
          return;
        }
        setFailed(true);
        setMessage(classified.message);
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          const code = params.get('code');
          if (!code) {
            throw new Error('Aucun code de connexion reçu. Réessaie depuis la page login.');
          }
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }
        if (!cancelled) await refreshProfile();
      } catch (err) {
        if (cancelled) return;
        setFailed(true);
        setMessage(err.response?.data?.error || err.message || 'Échec de la connexion Google.');
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (failed || loading) return;
    if (!user) return;
    try { sessionStorage.removeItem('hexaro_oauth_next'); } catch { /* ignore */ }
    const dest = next === '/' ? '/dashboard' : next;
    if (dest.startsWith('/admin') && user.role !== 'admin') {
      navigate('/dashboard', { replace: true });
      return;
    }
    navigate(dest, { replace: true });
  }, [user, loading, failed, navigate, next]);

  return (
    <div className="center-screen">
      <div className="auth-brand">
        <BrandMark size={48} />
        <h1>HEXARO</h1>
      </div>
      <p className={failed ? 'error-text auth-callback-error' : 'muted'}>{message}</p>
      {failed && (
        <Link className="btn secondary" to={backTo} style={{ marginTop: 12 }}>
          Retour à la connexion
        </Link>
      )}
    </div>
  );
}
