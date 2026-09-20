/** Traduit les erreurs techniques / anglais (Supabase, Postgres, réseau) pour l’UI. */

function rawFrom(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return (
    err.response?.data?.error ||
    err.error_description ||
    err.message ||
    ''
  );
}

function looksFrench(msg) {
  return (
    /[àâäéèêëïîôùûüçœ]/.test(msg) ||
    /^(Impossible|Aucun|Compte|Mot de passe|Session|Trop |Utilisateur|Abonnement|Fichier|Offre|Bot |Paiement|Choisis|Indique|Accès|Email non|Lien |Connexion |Inscription)/i.test(msg)
  );
}

function looksEnglish(msg) {
  return /\b(the|already|invalid|failed|error|unable|cannot|could not|user|registered|password|not found|denied|expired|required|duplicate|violates|permission|network request)\b/i.test(msg);
}

export function publicErrorMessage(err, fallback = 'Une erreur est survenue. Réessaie.') {
  const msg = String(rawFrom(err) || '').trim();
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
  if (/password should be at least|password is known to be weak|signup requires a valid password/.test(m)) {
    return 'Le mot de passe doit contenir au moins 6 caractères.';
  }
  if (/unable to validate email|invalid (email|format)|email address.*invalid/.test(m)) {
    return 'Adresse email invalide.';
  }
  if (/over_email_send_rate_limit|email rate limit|for security purposes, you can only request/.test(m)) {
    return 'Trop d’essais. Réessaie dans quelques minutes.';
  }
  if (/too many requests|rate limit/.test(m)) {
    return 'Trop de tentatives. Réessaie plus tard.';
  }
  if (/signups not allowed/.test(m)) {
    return 'Les inscriptions sont temporairement fermées.';
  }
  if (/database error saving new user/.test(m)) {
    return 'Impossible de créer le compte. Réessaie dans un instant.';
  }
  if (/network request failed|failed to fetch|load failed|fetch failed/.test(m)) {
    return 'Connexion au serveur impossible. Vérifie ta connexion.';
  }
  if (/auth session missing|session missing/.test(m)) {
    return 'Session expirée. Reconnecte-toi.';
  }
  if (/email link is invalid|token has expired|otp_expired|expired token/.test(m)) {
    return 'Lien ou code expiré. Recommence.';
  }
  if (/user not found/.test(m)) {
    return 'Aucun compte avec cet email.';
  }
  if (/provider is not enabled|unsupported provider|validation_failed.*google/.test(m)) {
    return 'Connexion Google indisponible pour le moment.';
  }
  if (/identity_already_exists|already linked/.test(m)) {
    return 'Ce compte Google est déjà lié à un autre utilisateur.';
  }
  if (/access_denied|user denied|cancelled|canceled/.test(m)) {
    return 'Connexion Google annulée.';
  }
  if (/insufficient (funds|balance)|solde insuffisant/.test(m)) {
    return 'Solde Mobile Money insuffisant.';
  }
  if (/transaction (failed|échou)/.test(m) || /payment failed/.test(m)) {
    return 'La transaction n’a pas abouti.';
  }
  if (/\btimeout\b|timed out/.test(m)) {
    return 'Délai dépassé. Réessaie.';
  }
  if (/declined|rejected by (operator|gateway)/.test(m)) {
    return 'Paiement refusé par l’opérateur.';
  }
  if (/column .+ does not exist|relation .+ does not exist|duplicate key|violates unique|permission denied for|jwt expired|invalid jwt|invalid api key/.test(m)) {
    return fallback;
  }

  if (looksEnglish(msg)) return fallback;
  return msg;
}
