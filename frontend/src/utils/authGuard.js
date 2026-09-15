import api from '../api/client';

/** Messages d’auth lisibles (FR). */
export function authErrorMessage(err) {
  const raw = err?.response?.data?.error || err?.message || '';
  const msg = String(raw);
  if (/invalid login credentials/i.test(msg) || /invalid_credentials/i.test(msg)) {
    return 'Mot de passe ou email incorrect.';
  }
  if (/email not confirmed/i.test(msg)) {
    return 'Email non confirmé. Vérifie ta boîte mail.';
  }
  if (/too many requests|rate limit|trop de/i.test(msg)) {
    return msg.includes('Réessaie') || msg.includes('tentatives')
      ? msg
      : 'Trop de tentatives. Réessaie plus tard.';
  }
  if (/user already registered/i.test(msg)) {
    return 'Un compte existe déjà avec cet email.';
  }
  return msg || 'Connexion impossible.';
}

/**
 * Garde anti-bruteforce avant / après tentative email-mdp.
 * @param {'user'|'admin'} scope
 */
export async function withLoginGuard(email, scope, attempt) {
  const payload = { email: String(email || '').trim().toLowerCase(), scope };
  try {
    await api.post('/api/auth/login-guard', payload);
  } catch (err) {
    throw new Error(authErrorMessage(err));
  }

  try {
    const result = await attempt();
    try { await api.post('/api/auth/login-ok', payload); } catch { /* ignore */ }
    return result;
  } catch (err) {
    try {
      await api.post('/api/auth/login-fail', payload);
    } catch (failErr) {
      if (failErr.response?.data?.error) {
        throw new Error(String(failErr.response.data.error));
      }
    }
    throw new Error(authErrorMessage(err));
  }
}
