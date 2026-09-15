/** Utilitaires noms WhatsApp (évite le pseudo du compte bot / brand). */

const LOOKALIKES = {
  Α: 'a', α: 'a', А: 'a', а: 'a',
  Β: 'b', β: 'b',
  Ε: 'e', ε: 'e', Ξ: 'e', ξ: 'e',
  Η: 'h', η: 'h',
  Ι: 'i', ι: 'i',
  Κ: 'k', κ: 'k',
  Λ: 'a', λ: 'a',
  Μ: 'm', μ: 'm',
  Ν: 'n', ν: 'n',
  Ο: 'o', ο: 'o', Ө: 'o', ө: 'o', Ø: 'o', ø: 'o', Ǿ: 'o', ǿ: 'o',
  Ρ: 'r', ρ: 'p',
  Τ: 't', τ: 't',
  Χ: 'x', χ: 'x',
  Υ: 'y', υ: 'y',
};

function foldName(name) {
  if (!name || typeof name !== 'string') return '';
  let s = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = [...s].map((c) => LOOKALIKES[c] || c).join('');
  return s.replace(/[^\w]/gi, '').toLowerCase();
}

function looksLikeJid(value) {
  return typeof value === 'string' && (value.includes('@') || /^\d{10,}$/.test(value));
}

function isBrandName(name) {
  if (!name || typeof name !== 'string') return false;
  const n = foldName(name);
  if (!n) return false;
  return n.includes('hexaro') || n.includes('hexar') || n === 'hxr' || n === 'aquila' || n.includes('aquilabot');
}

function formatPhoneDisplay(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('241') && digits.length >= 10) {
    const rest = digits.slice(3);
    return `+241 ${rest.replace(/(\d{2})(?=\d)/g, '$1 ').trim()}`;
  }
  if (digits.length >= 8) {
    return `+${digits}`;
  }
  return String(raw).startsWith('+') ? String(raw) : `+${digits}`;
}

function phoneFromJid(jid) {
  if (!jid) return null;
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) {
    return formatPhoneDisplay(jid.split('@')[0].split(':')[0]);
  }
  return null;
}

function formatJidLabel(jid) {
  if (!jid) return 'Contact';
  if (jid.endsWith('@g.us')) return 'Groupe';
  if (jid.endsWith('@lid') || jid.endsWith('@hosted')) return 'Contact';
  const phone = phoneFromJid(jid);
  if (phone) return phone;
  return jid;
}

function isUsableName(name) {
  return Boolean(name && !looksLikeJid(name) && !isBrandName(name));
}

/** Meilleur chat_name pour une conversation (ignore brand / JID bruts). */
function pickBestChatName(names, jid) {
  for (const n of names || []) {
    if (isUsableName(n)) return n;
  }
  return formatJidLabel(jid);
}

module.exports = {
  foldName,
  looksLikeJid,
  isBrandName,
  formatJidLabel,
  formatPhoneDisplay,
  phoneFromJid,
  isUsableName,
  pickBestChatName,
};
