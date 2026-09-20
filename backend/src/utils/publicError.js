/** Traduit les erreurs techniques / anglais avant envoi au client. */

function looksFrench(msg) {
  return (
    /[àâäéèêëïîôùûüçœ]/.test(msg) ||
    /^(Impossible|Aucun|Compte|Mot de passe|Session|Trop |Utilisateur|Abonnement|Fichier|Offre|Bot |Paiement|Choisis|Indique|Accès|Email non|Lien |Connexion |Inscription|Non authent|Profil |Message |Type |Envoi)/i.test(msg)
  );
}

function looksEnglish(msg) {
  return /\b(the|already|invalid|failed|error|unable|cannot|could not|user|registered|password|not found|denied|expired|required|duplicate|violates|permission|network request|column|relation)\b/i.test(msg);
}

function mapPublicError(raw, fallback = 'Une erreur est survenue. Réessaie.') {
  const msg = String(raw || '').trim();
  if (!msg) return fallback;
  if (looksFrench(msg)) return msg;

  const m = msg.toLowerCase();

  if (/user already registered|already been registered|already registered/.test(m)) {
    return 'Un compte existe déjà avec cet email. Connecte-toi, ou utilise Google.';
  }
  if (/invalid login credentials|invalid_credentials/.test(m)) {
    return 'Mot de passe ou email incorrect.';
  }
  if (/email not confirmed/.test(m)) {
    return 'Email non confirmé. Vérifie ta boîte mail.';
  }
  if (/password should be at least|password is known to be weak/.test(m)) {
    return 'Le mot de passe doit contenir au moins 6 caractères.';
  }
  if (/unable to validate email|invalid (email|format)/.test(m)) {
    return 'Adresse email invalide.';
  }
  if (/too many requests|rate limit/.test(m)) {
    return 'Trop de tentatives. Réessaie plus tard.';
  }
  if (/network request failed|fetch failed|econnrefused|etimedout|enotfound/.test(m)) {
    return 'Service indisponible. Réessaie dans un instant.';
  }
  if (/jwt expired|invalid jwt|invalid api key|auth session missing/.test(m)) {
    return 'Session invalide ou expirée.';
  }
  if (/insufficient (funds|balance)/.test(m)) {
    return 'Solde Mobile Money insuffisant.';
  }
  if (/transaction failed|payment failed/.test(m)) {
    return 'La transaction n’a pas abouti.';
  }
  if (/\btimeout\b|timed out/.test(m)) {
    return 'Délai dépassé. Réessaie.';
  }
  if (/column .+ does not exist|relation .+ does not exist|duplicate key|violates unique|permission denied for|row-level security/.test(m)) {
    return fallback;
  }

  if (looksEnglish(msg)) return fallback;
  return msg;
}

function publicError(err, fallback) {
  return mapPublicError(err?.message || err, fallback);
}

function patchJsonErrors(req, res, next) {
  const orig = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object') {
      if (typeof body.error === 'string') {
        body.error = mapPublicError(body.error, 'Une erreur est survenue. Réessaie.');
      }
    }
    return orig(body);
  };
  next();
}

module.exports = { mapPublicError, publicError, patchJsonErrors };
