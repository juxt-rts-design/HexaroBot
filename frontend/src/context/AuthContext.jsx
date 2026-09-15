import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refreshProfile() {
    try {
      const res = await api.get('/api/auth/me');
      setUser(res.data.user);
      return res.data.user;
    } catch (err) {
      setUser(null);
      const msg = err.response?.data?.error || err.message;
      const e = new Error(msg || 'Profil introuvable.');
      e.status = err.response?.status;
      throw e;
    }
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) {
        try {
          await refreshProfile();
        } catch {
          setUser(null);
        }
      } else setUser(null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        try {
          await refreshProfile();
        } catch {
          setUser(null);
        }
      } else setUser(null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setSession(data.session);
    return refreshProfile();
  }

  async function register(email, password, name) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) throw error;
    setSession(data.session);
    if (data.session) return refreshProfile();
    return null;
  }

  async function loginWithGoogle({ next = '/dashboard' } = {}) {
    const path = next.startsWith('/') ? next : `/${next}`;
    try {
      sessionStorage.setItem('hexaro_oauth_next', path);
    } catch { /* ignore */ }
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          prompt: 'select_account',
        },
      },
    });
    if (error) throw error;
  }

  async function logout() {
    await supabase.auth.signOut();
    try {
      await api.post('/api/auth/logout');
    } catch { /* ignore */ }
    setUser(null);
    setSession(null);
  }

  return (
    <AuthContext.Provider value={{ user, setUser, session, loading, login, loginWithGoogle, register, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
