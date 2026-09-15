const loginRateLimit = require('../services/loginRateLimit');

exports.logout = (_req, res) => {
  // La session est gérée côté client (Supabase Auth).
  res.json({ ok: true });
};

exports.me = async (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      avatar_url: u.avatar_url,
      role: u.role,
      exempt: u.exempt,
    },
  });
};

/** Vérifie si une tentative email/mdp est autorisée (anti-bruteforce). */
exports.loginGuard = (req, res) => {
  const email = req.body?.email;
  const scope = req.body?.scope === 'admin' ? 'admin' : 'user';
  const status = loginRateLimit.getStatus(req, email, scope);
  if (!status.allowed) {
    return res.status(429).json({
      error: status.message,
      retryAfterSec: status.retryAfterSec,
      remaining: status.remaining,
    });
  }
  res.json({ ok: true, remaining: status.remaining });
};

exports.loginFail = (req, res) => {
  const email = req.body?.email;
  const scope = req.body?.scope === 'admin' ? 'admin' : 'user';
  const status = loginRateLimit.recordFail(req, email, scope);
  const payload = {
    error: status.allowed
      ? 'Mot de passe ou email incorrect.'
      : status.message,
    remaining: status.remaining,
    retryAfterSec: status.retryAfterSec,
    locked: !status.allowed,
  };
  res.status(status.allowed ? 401 : 429).json(payload);
};

exports.loginOk = (req, res) => {
  const email = req.body?.email;
  const scope = req.body?.scope === 'admin' ? 'admin' : 'user';
  loginRateLimit.recordOk(req, email, scope);
  res.json({ ok: true });
};
