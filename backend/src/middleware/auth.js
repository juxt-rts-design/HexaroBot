const { supabase, supabaseAnon } = require('../config/supabase');

function bearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  // Permet <img>/<video src> (pas d'en-tête Authorization)
  const q = req.query?.access_token || req.query?.token;
  if (typeof q === 'string' && q.length > 20) return q;
  return null;
}

const PROFILE_FIELDS = 'id, email, name, avatar_url, role, exempt, blocked';

function adminEmail() {
  return (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
}

function isAdminEmail(email) {
  const configured = adminEmail();
  return Boolean(configured && email && String(email).trim().toLowerCase() === configured);
}

async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Crée le profil si le compte Auth existe déjà sans ligne (inscription avant le trigger, etc.). */
async function ensureProfile(authUser) {
  let profile = await loadProfile(authUser.id);
  const meta = authUser.user_metadata || {};
  const email = authUser.email || profile?.email || '';
  const name = meta.name || meta.full_name || profile?.name || (email ? email.split('@')[0] : 'Utilisateur');
  const avatarUrl = meta.avatar_url || meta.picture || profile?.avatar_url || null;
  const desiredRole = isAdminEmail(email) ? 'admin' : 'user';

  if (profile) {
    const patch = {};
    if (!profile.email && email) patch.email = email;
    if (!profile.name && name) patch.name = name;
    if (!profile.avatar_url && avatarUrl) patch.avatar_url = avatarUrl;
    if (desiredRole === 'admin' && profile.role !== 'admin') patch.role = 'admin';
    if (Object.keys(patch).length) {
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', authUser.id)
        .select(PROFILE_FIELDS)
        .single();
      if (error) {
        console.error('ensureProfile update:', error.message, error);
      } else if (data) {
        profile = data;
      }
    }
    return profile;
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: authUser.id,
        email,
        name,
        avatar_url: avatarUrl,
        role: desiredRole,
      },
      { onConflict: 'id' }
    )
    .select(PROFILE_FIELDS)
    .single();
  if (error) throw error;
  return data;
}

exports.requireAuth = async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });
  try {
    const { data: authData, error: authError } = await supabaseAnon.auth.getUser(token);
    if (authError || !authData?.user) {
      return res.status(401).json({ error: 'Session invalide ou expirée.' });
    }
    let profile = await ensureProfile(authData.user);
    if (!profile) return res.status(404).json({ error: 'Profil introuvable.' });
    if (profile.blocked) return res.status(403).json({ error: 'Compte bloqué.' });
    // Filet de sécurité si l'update précédent a échoué (droits SQL, etc.)
    if (isAdminEmail(authData.user.email || profile.email) && profile.role !== 'admin') {
      console.warn(`Promo admin forcée en mémoire pour ${profile.email} (UPDATE DB a peut‑être échoué).`);
      profile = { ...profile, role: 'admin' };
    }
    req.user = profile;
    req.accessToken = token;
    next();
  } catch (err) {
    console.error('requireAuth:', err.message);
    res.status(401).json({ error: err.message || 'Session invalide ou expirée.' });
  }
};

exports.requireAdmin = (req, res, next) => {
  exports.requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès refusé.' });
    }
    return next();
  });
};
