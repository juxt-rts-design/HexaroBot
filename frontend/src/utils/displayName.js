/**
 * Affichage propre des noms / JID WhatsApp.
 */

/** Replie les lookalikes unicode (Ξ→e, Λ→a, Ø→o…) vers ASCII. */
export function foldName(name) {
  if (!name || typeof name !== 'string') return '';
  const lookalikes = {
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
  let s = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = [...s].map((c) => lookalikes[c] || c).join('');
  return s.replace(/[^\w]/gi, '').toLowerCase();
}

export function isRawJid(value) {
  return typeof value === 'string' && (value.includes('@') || /^\d{8,}$/.test(value));
}

export function isOwnerBrandName(name) {
  if (!name || typeof name !== 'string') return false;
  const n = foldName(name);
  if (!n) return false;
  return (
    n.includes('hexaro') ||
    n.includes('hexar') ||
    n === 'hxr' ||
    n === 'aquila' ||
    n.includes('aquilabot')
  );
}

export function formatPhoneDisplay(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('241') && digits.length >= 10) {
    const rest = digits.slice(3);
    return `+241 ${rest.replace(/(\d{2})(?=\d)/g, '$1 ').trim()}`;
  }
  if (digits.length >= 8) return `+${digits}`;
  return String(raw).startsWith('+') ? String(raw) : `+${digits}`;
}

export function phoneFromJid(jid) {
  if (!jid) return null;
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) {
    return formatPhoneDisplay(jid.split('@')[0].split(':')[0]);
  }
  return null;
}

export function formatJidLabel(jid) {
  if (!jid) return 'Contact';
  if (jid.endsWith('@g.us')) return 'Groupe';
  if (jid.endsWith('@lid') || jid.endsWith('@hosted')) return 'Contact';
  return phoneFromJid(jid) || jid;
}

export function displayName(name, jid) {
  if (name && !isRawJid(name) && !isOwnerBrandName(name)) return name;
  if (jid) return formatJidLabel(jid);
  if (name && !isOwnerBrandName(name)) return formatJidLabel(name);
  return 'Contact';
}

export function pickBestChatName(names, jid) {
  for (const n of names || []) {
    if (n && !isRawJid(n) && !isOwnerBrandName(n)) return n;
  }
  return displayName(null, jid);
}

/** Titre + sous-titre (numéro) pour la liste / l'en-tête. */
export function contactLabels({ chat_name, chat_id, phone, profile } = {}) {
  const resolvedPhone = profile?.phone || phone || phoneFromJid(chat_id) || phoneFromJid(profile?.phoneJid);
  const name = displayName(profile?.name || chat_name, chat_id);
  const phoneLabel = resolvedPhone ? formatPhoneDisplay(resolvedPhone) || resolvedPhone : null;
  const title = name === 'Contact' && phoneLabel ? phoneLabel : name;
  const subtitle =
    phoneLabel && title !== phoneLabel
      ? phoneLabel
      : chat_id?.endsWith('@g.us')
        ? 'Groupe'
        : null;
  return { title, subtitle, phone: phoneLabel };
}
