/**
 * Contrôle la persistance des médias sur disque.
 * Anti-delete / statuts / vue unique utilisent surtout la RAM — pas ce dossier.
 */
function envFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultValue;
}

/** Historique média Admin Chat (uploads/chat) — source des 26 Go sur VPS. */
function persistChatMedia() {
  return envFlag('PERSIST_CHAT_MEDIA', process.env.NODE_ENV !== 'production');
}

/** Copie disque des vues uniques (uploads/viewonce). Le renvoi WhatsApp privé reste actif. */
function persistViewOnceArchive() {
  return envFlag('PERSIST_VIEWONCE_ARCHIVE', process.env.NODE_ENV !== 'production');
}

function uploadsMaxAgeDays() {
  const n = Number(process.env.UPLOADS_MAX_AGE_DAYS || 7);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 7;
}

module.exports = {
  persistChatMedia,
  persistViewOnceArchive,
  uploadsMaxAgeDays,
};
