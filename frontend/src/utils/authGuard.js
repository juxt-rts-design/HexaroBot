import api from '../api/client';
import { publicErrorMessage } from './publicError';

/** Messages d’auth lisibles (FR). */
export function authErrorMessage(err) {
  return publicErrorMessage(err, 'Connexion impossible.');
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
