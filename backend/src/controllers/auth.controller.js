const loginRateLimit = require('../services/loginRateLimit');
const userTerms = require('../services/userTerms');
const baileysManager = require('../services/baileysManager');

exports.logout = (_req, res) => {
  // La session est gérée côté client (Supabase Auth).
  res.json({ ok: true });
};

exports.me = async (req, res) => {
  const u = req.user;
  const terms = userTerms.publicTermsPayload(u);
  res.json({
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      avatar_url: u.avatar_url,
      role: u.role,
      exempt: u.exempt,
      terms_accepted: terms.accepted,
      terms_required: terms.required,
    },
    terms,
  });
};

exports.acceptTerms = async (req, res) => {
  try {
    const row = await userTerms.acceptTerms(req.user.id);
    await baileysManager.releaseTermsHoldForUser(req.user.id);
    const terms = userTerms.publicTermsPayload({ ...req.user, ...row });
    res.json({ ok: true, terms });
  } catch (err) {
    console.error('acceptTerms:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getTerms = (_req, res) => {
  res.json({
    terms: userTerms.publicTermsPayload(null),
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
