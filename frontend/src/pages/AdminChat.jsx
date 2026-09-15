import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../api/client';
import { supabase } from '../lib/supabase';
import { BrandMark, Icon } from '../components/Icons';
import ConfirmModal from '../components/ConfirmModal';
import { useToast } from '../context/ToastContext';
import { contactLabels, displayName, foldName, isOwnerBrandName } from '../utils/displayName';
import { useBotStatusWatcher } from '../hooks/useBotStatusWatcher';

const API_URL = import.meta.env.VITE_API_URL;
const PREFS_KEY = 'hexaro_wa_prefs';
const NOTES_KEY = 'hexaro_wa_status_notes';

const MEDIA_LABEL = {
  image: 'Photo',
  video: 'Vidéo',
  audio: 'Audio',
  voice: 'Message vocal',
  sticker: 'Sticker',
  document: 'Document',
  view_once: 'Vue unique',
  reaction: 'Réaction',
};

const MEDIA_ICON = {
  image: 'image',
  video: 'video',
  audio: 'mic',
  voice: 'mic',
  sticker: 'image',
  document: 'file',
  view_once: 'lock',
  reaction: 'check',
};

const DEFAULT_PREFS = {
  desktopNotify: true,
  enterToSend: true,
  wallpaperScale: 'md', // sm | md | lg
  compactList: true,
  showPhoneInList: true,
};

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

function timeOf(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yday = new Date();
  yday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yday.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Avatar({ name, pictureUrl, size }) {
  const cls = [
    'wa-avatar',
    size === 'lg' ? 'wa-avatar-lg' : '',
    size === 'sm' ? 'wa-avatar-sm' : '',
    pictureUrl ? 'wa-avatar-img' : '',
  ].filter(Boolean).join(' ');
  if (pictureUrl) {
    return (
      <img
        src={pictureUrl}
        alt=""
        className={cls}
        width={size === 'lg' ? 160 : size === 'sm' ? 36 : 44}
        height={size === 'lg' ? 160 : size === 'sm' ? 36 : 44}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  return <div className={cls}>{initials(name)}</div>;
}

function mediaUrl(messageId, token = '') {
  const q = token ? `?access_token=${encodeURIComponent(token)}` : '';
  return `${API_URL}/api/admin/messages/${messageId}/media${q}`;
}

/** Charge un média avec le Bearer (fiable pour img/video, y compris stories). */
function AuthMedia({ id, kind = 'image', className = '', controls = false, muted = false, autoPlay = false }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    let objectUrl = '';
    let retryTimer;
    setFailed(false);
    setSrc('');

    async function load(attempt = 0) {
      try {
        const res = await api.get(`/api/admin/messages/${id}/media`, { responseType: 'blob' });
        if (!alive) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
        setFailed(false);
      } catch {
        if (!alive) return;
        // Nouveau média : le fichier peut arriver juste après l'événement socket
        if (attempt < 3) {
          retryTimer = setTimeout(() => load(attempt + 1), 500 * (attempt + 1));
          return;
        }
        setFailed(true);
      }
    }

    load();
    return () => {
      alive = false;
      clearTimeout(retryTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (failed) {
    return (
      <div className={`wa-media-missing ${className}`.trim()}>
        <Icon name="image" size={18} />
        <span>Média indisponible</span>
      </div>
    );
  }
  if (!src) return <div className={`wa-media-loading ${className}`.trim()} />;

  if (kind === 'video') {
    return (
      <video
        src={src}
        className={className}
        controls={controls}
        controlsList="nodownload"
        muted={muted}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        onContextMenu={(e) => e.preventDefault()}
      />
    );
  }
  if (kind === 'audio') {
    return <audio src={src} className={className} controls controlsList="nodownload" />;
  }
  return (
    <img
      src={src}
      alt=""
      className={className}
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

function MediaLabel({ type }) {
  const label = MEDIA_LABEL[type] || type;
  const icon = MEDIA_ICON[type] || 'file';
  return (
    <div className="wa-media-placeholder">
      <Icon name={icon} size={14} className="wa-preview-icon" />
      {label}
    </div>
  );
}

function looksLikeFileName(text) {
  if (!text || typeof text !== 'string') return false;
  return /\.(mp4|mov|avi|mkv|webm|jpg|jpeg|png|gif|webp|pdf|docx?|xlsx?)$/i.test(text.trim())
    || /^facebook_/i.test(text.trim());
}

function MessageMedia({ msg, onOpen }) {
  if (!msg.has_media) {
    if (msg.media_type && !msg.media_type.startsWith('type:')) return <MediaLabel type={msg.media_type} />;
    if (msg.media_type) return <div className="wa-media-placeholder">{msg.media_type}</div>;
    return null;
  }

  if (msg.media_type === 'sticker') {
    return (
      <button type="button" className="wa-media-hit" onClick={() => onOpen?.(msg)} disabled={!onOpen}>
        <AuthMedia id={msg.id} kind="image" className="wa-media-sticker" />
      </button>
    );
  }
  if (msg.media_type === 'image') {
    return (
      <button type="button" className="wa-media-hit" onClick={() => onOpen?.(msg)} disabled={!onOpen}>
        <AuthMedia id={msg.id} kind="image" className="wa-media-img" />
      </button>
    );
  }
  if (msg.media_type === 'video') {
    return (
      <button type="button" className="wa-media-hit" onClick={() => onOpen?.(msg)} disabled={!onOpen}>
        <div className="wa-video-frame">
          <AuthMedia id={msg.id} kind="video" className="wa-media-video" controls={!onOpen} />
        </div>
      </button>
    );
  }
  if (msg.media_type === 'audio' || msg.media_type === 'voice') {
    return <AuthMedia id={msg.id} kind="audio" className="wa-media-audio" />;
  }
  return (
    <button type="button" className="wa-media-doc" onClick={() => window.open(mediaUrl(msg.id), '_blank')}>
      <Icon name="file" size={16} />
      {msg.body || 'Document'}
    </button>
  );
}

function normalizeSocketMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    chat_id: row.chat_id,
    chat_name: row.chat_name,
    sender_id: row.sender_id,
    sender_name: row.sender_name,
    direction: row.direction,
    body: row.body,
    media_type: row.media_type,
    has_media: Boolean(row.has_media ?? row.file_path),
    created_at: row.created_at,
  };
}

function bubbleCaption(msg) {
  if (!msg.body) return null;
  if ((msg.media_type === 'video' || msg.media_type === 'image' || msg.media_type === 'document') && looksLikeFileName(msg.body)) {
    return null;
  }
  if (msg.media_type === 'sticker') return null;
  return msg.body;
}

function previewText(c) {
  if (c.body) return c.body;
  if (c.media_type) return MEDIA_LABEL[c.media_type] || c.media_type;
  return '';
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Recherche liste chats : nom (unicode), numéro, aperçu, type média. */
function chatMatchesQuery(c, rawQ) {
  const q = String(rawQ || '').trim().toLowerCase();
  if (!q) return true;
  const labels = contactLabels(c);
  const qFold = foldName(q);
  const qDigits = digitsOnly(q);
  const fields = [
    labels.title,
    labels.subtitle,
    labels.phone,
    c.chat_name,
    c.body,
    c.chat_id,
    previewText(c),
    MEDIA_LABEL[c.media_type],
    c.phone,
  ].filter(Boolean);

  for (const field of fields) {
    const text = String(field);
    if (text.toLowerCase().includes(q)) return true;
    if (qFold && foldName(text).includes(qFold)) return true;
  }
  if (qDigits.length >= 3) {
    const phoneDigits = digitsOnly(labels.phone || c.phone || '');
    const jidDigits = digitsOnly(String(c.chat_id || '').split('@')[0]);
    if (phoneDigits.includes(qDigits) || jidDigits.includes(qDigits)) return true;
  }
  return false;
}

function highlightMatch(text, rawQ) {
  const value = String(text || '');
  const q = String(rawQ || '').trim();
  if (!value || !q) return value;
  const idx = value.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return value;
  return (
    <>
      {value.slice(0, idx)}
      <mark className="wa-search-mark">{value.slice(idx, idx + q.length)}</mark>
      {value.slice(idx + q.length)}
    </>
  );
}

function loadNotes() {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveNote(chatId, text) {
  const all = loadNotes();
  if (text) all[chatId] = text;
  else delete all[chatId];
  localStorage.setItem(NOTES_KEY, JSON.stringify(all));
}

async function copyText(value, push) {
  try {
    await navigator.clipboard.writeText(value);
    push({ title: 'Copié', message: value, tone: 'success', duration: 2000 });
  } catch {
    push({ title: 'Copie impossible', tone: 'danger' });
  }
}

function MediaLightbox({ item, onClose, onPrev, onNext }) {
  if (!item) return null;
  const kind = item.media_type === 'video' ? 'video' : (item.media_type === 'text' ? null : 'image');
  return (
    <div className="wa-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="wa-lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <header className="wa-lightbox-bar">
          <span>{MEDIA_LABEL[item.media_type] || item.media_type || 'Statut'}</span>
          <div className="wa-lightbox-actions">
            {onPrev && <button type="button" className="wa-icon-btn ghost" onClick={onPrev}><Icon name="back" size={18} /></button>}
            {onNext && <button type="button" className="wa-icon-btn ghost" onClick={onNext} style={{ transform: 'scaleX(-1)' }}><Icon name="back" size={18} /></button>}
            <button type="button" className="wa-icon-btn ghost" onClick={onClose}><Icon name="close" size={18} /></button>
          </div>
        </header>
        <div className="wa-lightbox-stage" onContextMenu={(e) => e.preventDefault()}>
          {item.body && (!item.has_media || item.media_type === 'text') && (
            <p className="wa-status-story-text">{item.body}</p>
          )}
          {item.has_media && kind === 'image' && (
            <AuthMedia id={item.id} kind="image" />
          )}
          {item.has_media && kind === 'video' && (
            <AuthMedia id={item.id} kind="video" controls autoPlay />
          )}
          {item.has_media && item.body && item.media_type !== 'text' && (
            <p className="wa-status-caption">{item.body}</p>
          )}
        </div>
        <p className="wa-lightbox-hint">Aperçu uniquement — pas d’enregistrement</p>
      </div>
    </div>
  );
}

export default function AdminChat() {
  const [bots, setBots] = useState([]);
  const [botId, setBotId] = useState('');
  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = useState('');
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showThreadOnMobile, setShowThreadOnMobile] = useState(false);
  const [panel, setPanel] = useState(null); // contact | settings | session | null
  const [profile, setProfile] = useState(null);
  const [sessionProfile, setSessionProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all | groups | direct
  const [messageHits, setMessageHits] = useState([]); // hits recherche globale (contenu messages)
  const [settingsQuery, setSettingsQuery] = useState('');
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadQuery, setThreadQuery] = useState('');
  const [threadHits, setThreadHits] = useState([]);
  const [threadHitIndex, setThreadHitIndex] = useState(0);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [rail, setRail] = useState('chats'); // chats | settings | session
  const [statusDraft, setStatusDraft] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [contactNote, setContactNote] = useState('');
  const [chatMedia, setChatMedia] = useState([]);
  const [mediaFilter, setMediaFilter] = useState('all');
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [threadLightboxId, setThreadLightboxId] = useState(null);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaToken, setMediaToken] = useState('');
  const [contactStatuses, setContactStatuses] = useState([]);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [statusViewIndex, setStatusViewIndex] = useState(-1);
  const { push } = useToast();

  const socketRef = useRef(null);
  const threadEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const chatIdRef = useRef('');
  const threadSearchRef = useRef(null);
  const messageRefs = useRef(new Map());
  const searchDebounceRef = useRef(null);
  const messagesRef = useRef([]);
  const sendingLockRef = useRef(false);
  const composerInputRef = useRef(null);

  const selectedBot = bots.find((b) => String(b.id) === String(botId));
  const selectedChat = chats.find((c) => c.chat_id === chatId);
  const scannedBots = bots.filter((b) => b.phone_number);
  useBotStatusWatcher(bots);

  const selectedLabels = contactLabels({
    chat_name: selectedChat?.chat_name,
    chat_id: selectedChat?.chat_id,
    phone: selectedChat?.phone,
    profile,
  });

  const threadMediaItems = useMemo(
    () => messages.filter((m) => m.has_media && ['image', 'video', 'sticker'].includes(m.media_type)),
    [messages]
  );
  const threadLightboxIndex = threadLightboxId == null
    ? -1
    : threadMediaItems.findIndex((m) => m.id === threadLightboxId);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const { data } = await supabase.auth.getSession();
      setMediaToken(data.session?.access_token || '');
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setMediaToken(session?.access_token || '');
    });
    unsub = () => sub.subscription.unsubscribe();
    return () => unsub();
  }, []);

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    document.documentElement.dataset.waWallpaper = prefs.wallpaperScale;
    document.documentElement.dataset.waCompact = prefs.compactList ? '1' : '0';
  }, [prefs]);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    api.get('/api/admin/bots').then((res) => setBots(res.data.bots));
  }, []);

  useEffect(() => {
    if (!botId) return;
    let cancelled = false;
    setChats([]);

    async function hydratePictures(list) {
      const missing = (list || [])
        .filter((c) => c.chat_id && !c.picture_url)
        .map((c) => c.chat_id);
      const chunkSize = 24;
      for (let i = 0; i < missing.length; i += chunkSize) {
        if (cancelled) return;
        const chatIds = missing.slice(i, i + chunkSize);
        try {
          const res = await api.post(`/api/admin/bots/${botId}/chat-pictures`, { chatIds });
          const map = res.data.pictures || {};
          if (cancelled) return;
          setChats((prev) => prev.map((c) => {
            const url = map[c.chat_id];
            return url ? { ...c, picture_url: url } : c;
          }));
        } catch {
          /* session offline / timeout — on garde les initiales */
        }
      }
    }

    api.get(`/api/admin/bots/${botId}/chats`)
      .then((res) => {
        if (cancelled) return;
        const list = res.data.chats || [];
        setChats(list);
        hydratePictures(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setChats([]);
          push({
            title: 'Chats introuvables',
            message: err.response?.data?.error || 'Impossible de charger les conversations.',
            tone: 'danger',
          });
        }
      });
    api.get(`/api/admin/bots/${botId}/session-profile`)
      .then((res) => {
        if (cancelled) return;
        setSessionProfile(res.data.profile);
        setStatusDraft(res.data.profile?.about || '');
      })
      .catch(() => { if (!cancelled) setSessionProfile(null); });
    setChatId('');
    setMessages([]);
    setShowThreadOnMobile(false);
    setPanel(null);
    setProfile(null);

    socketRef.current?.disconnect();
    let socket;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      socket = io(API_URL, { auth: { token } });
      socketRef.current = socket;
      socket.on('connect', () => socket.emit('join-bot', Number(botId)));
      socket.on('chat-message', (row) => {
        if (row.chat_id === 'status@broadcast') return;
        let needsPicture = false;
        setChats((prev) => {
          const old = prev.find((c) => c.chat_id === row.chat_id);
          const others = prev.filter((c) => c.chat_id !== row.chat_id);
          let chatName = row.chat_name;
          if (isOwnerBrandName(chatName) && old?.chat_name && !isOwnerBrandName(old.chat_name)) {
            chatName = old.chat_name;
          } else if (isOwnerBrandName(chatName)) {
            chatName = displayName(null, row.chat_id);
          }
          needsPicture = !old?.picture_url;
          return [{
            chat_id: row.chat_id,
            chat_name: chatName,
            body: row.body,
            media_type: row.media_type,
            direction: row.direction,
            created_at: row.created_at,
            phone: old?.phone || null,
            picture_url: old?.picture_url || null,
            is_group: Boolean(row.chat_id?.endsWith('@g.us')),
          }, ...others];
        });
        if (needsPicture && row.chat_id) {
          api.post(`/api/admin/bots/${botId}/chat-pictures`, { chatIds: [row.chat_id] })
            .then((res) => {
              const url = res.data.pictures?.[row.chat_id];
              if (!url) return;
              setChats((prev) => prev.map((c) => (
                c.chat_id === row.chat_id ? { ...c, picture_url: url } : c
              )));
            })
            .catch(() => {});
        }
        setMessages((prev) => {
          if (row.chat_id !== chatIdRef.current) return prev;
          const msg = normalizeSocketMessage(row);
          if (!msg?.id) return prev;
          if (prev.some((m) => m.id === msg.id)) {
            return prev.map((m) => (m.id === msg.id ? { ...m, ...msg, _pending: false } : m));
          }
          // Remplacer le message optimiste correspondant
          let replaced = false;
          const next = prev.map((m) => {
            if (
              !replaced
              && m._pending
              && m.direction === 'out'
              && msg.direction === 'out'
              && (m.body || '') === (msg.body || '')
              && (m.media_type || null) === (msg.media_type || null)
            ) {
              replaced = true;
              return { ...msg, _pending: false };
            }
            return m;
          });
          return replaced ? next : [...next, msg];
        });
      });
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [botId]);

  useEffect(() => {
    if (!botId || !chatId) return;
    let cancelled = false;
    api.get(`/api/admin/bots/${botId}/chats/${encodeURIComponent(chatId)}/messages`).then((res) => {
      if (cancelled) return;
      setMessages(res.data.messages);
      setHasMore(res.data.hasMore);
    });
    api.get(`/api/admin/bots/${botId}/chats/${encodeURIComponent(chatId)}/profile`)
      .then((res) => {
        if (cancelled) return;
        const p = res.data.profile;
        if (!p) return;
        setProfile(p);
        setChats((prev) => prev.map((c) => (
          c.chat_id === chatId
            ? {
              ...c,
              phone: p.phone || c.phone,
              picture_url: p.pictureUrl || c.picture_url,
              chat_name: (!isOwnerBrandName(p.name) && p.name) || c.chat_name,
            }
            : c
        )));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [botId, chatId]);

  useEffect(() => {
    if (threadSearchOpen) return;
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [chatId, messages.length, threadSearchOpen]);

  // Recherche globale dans le contenu des messages (débounced)
  useEffect(() => {
    if (!botId) {
      setMessageHits([]);
      return undefined;
    }
    const q = query.trim();
    if (q.length < 2) {
      setMessageHits([]);
      return undefined;
    }
    clearTimeout(searchDebounceRef.current);
    let cancelled = false;
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get(`/api/admin/bots/${botId}/search`, { params: { q } });
        if (!cancelled) setMessageHits(res.data.hits || []);
      } catch {
        if (!cancelled) setMessageHits([]);
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(searchDebounceRef.current);
    };
  }, [botId, query]);

  // Recherche dans la conversation ouverte
  useEffect(() => {
    if (!botId || !chatId || !threadSearchOpen) {
      setThreadHits([]);
      return undefined;
    }
    const q = threadQuery.trim();
    if (q.length < 1) {
      setThreadHits([]);
      setThreadHitIndex(0);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const localHits = (messagesRef.current || [])
        .filter((m) => (m.body || '').toLowerCase().includes(q.toLowerCase()))
        .map((m) => ({ id: m.id, body: m.body, created_at: m.created_at }));

      let remote = [];
      if (q.length >= 2) {
        try {
          const res = await api.get(
            `/api/admin/bots/${botId}/chats/${encodeURIComponent(chatId)}/search`,
            { params: { q } }
          );
          remote = res.data.hits || [];
        } catch { /* ignore */ }
      }
      if (cancelled) return;
      const byId = new Map();
      for (const h of [...remote, ...localHits]) byId.set(h.id, h);
      const merged = [...byId.values()].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );
      setThreadHits(merged);
      setThreadHitIndex(merged.length ? merged.length - 1 : 0);

      if (merged.length) {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const extra = merged
            .filter((h) => !ids.has(h.id))
            .map((h) => ({
              id: h.id,
              sender_id: null,
              sender_name: h.sender_name || null,
              direction: h.direction || 'in',
              body: h.body,
              media_type: h.media_type || null,
              has_media: false,
              created_at: h.created_at,
              _fromSearch: true,
            }));
          if (!extra.length) return prev;
          return [...extra, ...prev].sort(
            (a, b) => new Date(a.created_at) - new Date(b.created_at)
          );
        });
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [botId, chatId, threadQuery, threadSearchOpen]);

  useEffect(() => {
    if (!threadSearchOpen || !threadHits.length) return;
    const hit = threadHits[threadHitIndex];
    if (!hit) return;
    const el = messageRefs.current.get(hit.id);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [threadHitIndex, threadHits, threadSearchOpen]);

  const filteredChats = useMemo(() => {
    const q = query.trim();
    const hitChatIds = new Set(messageHits.map((h) => h.chat_id));
    const snippetByChat = new Map();
    for (const h of messageHits) {
      if (!snippetByChat.has(h.chat_id) && h.body) snippetByChat.set(h.chat_id, h.body);
    }

    return chats
      .filter((c) => {
        if (filter === 'groups' && !c.chat_id?.endsWith('@g.us')) return false;
        if (filter === 'direct' && c.chat_id?.endsWith('@g.us')) return false;
        if (!q) return true;
        return chatMatchesQuery(c, q) || hitChatIds.has(c.chat_id);
      })
      .map((c) => ({
        ...c,
        _searchSnippet: q && !chatMatchesQuery(c, q) ? snippetByChat.get(c.chat_id) : null,
      }));
  }, [chats, query, filter, messageHits]);

  const settingsItems = useMemo(() => ([
    {
      id: 'notifications',
      title: 'Notifications bureau',
      desc: 'Connexion / déconnexion bot',
      keywords: 'notif alerte son',
    },
    {
      id: 'enter',
      title: 'Entrée pour envoyer',
      desc: 'Sinon le texte reste dans le champ',
      keywords: 'envoyer clavier enter',
    },
    {
      id: 'phone',
      title: 'Afficher le numéro dans la liste',
      desc: 'Sous le nom du contact',
      keywords: 'téléphone phone numéro',
    },
    {
      id: 'compact',
      title: 'Liste compacte',
      desc: 'Lignes un peu plus serrées',
      keywords: 'compact densite',
    },
    {
      id: 'wallpaper',
      title: 'Échelle du fond des discussions',
      desc: 'Fin Moyen Large',
      keywords: 'wallpaper fond motif ecran',
    },
    {
      id: 'admin',
      title: 'Administration',
      desc: 'Utilisateurs, bots, abonnements',
      keywords: 'admin panel users',
    },
  ]), []);

  const visibleSettings = useMemo(() => {
    const q = settingsQuery.trim().toLowerCase();
    const qFold = foldName(settingsQuery);
    if (!q) return new Set(settingsItems.map((i) => i.id));
    return new Set(
      settingsItems
        .filter((i) => {
          const blob = `${i.title} ${i.desc} ${i.keywords}`.toLowerCase();
          return blob.includes(q) || (qFold && foldName(blob).includes(qFold));
        })
        .map((i) => i.id)
    );
  }, [settingsItems, settingsQuery]);

  function openChat(id) {
    setChatId(id);
    setShowThreadOnMobile(true);
    setPanel(null);
    setProfile(null);
    setRail('chats');
    setThreadSearchOpen(false);
    setThreadQuery('');
    setThreadHits([]);
    setThreadLightboxId(null);
  }

  function openThreadSearch() {
    setThreadSearchOpen(true);
    setPanel(null);
    setTimeout(() => threadSearchRef.current?.focus(), 50);
  }

  function closeThreadSearch() {
    setThreadSearchOpen(false);
    setThreadQuery('');
    setThreadHits([]);
    setThreadHitIndex(0);
  }

  function goThreadHit(delta) {
    if (!threadHits.length) return;
    setThreadHitIndex((i) => (i + delta + threadHits.length) % threadHits.length);
  }

  async function openContactProfile() {
    setPanel('contact');
    setLoadingProfile(true);
    setLightboxIndex(-1);
    try {
      const res = await api.get(`/api/admin/bots/${botId}/chats/${encodeURIComponent(chatId)}/profile`);
      const p = res.data.profile;
      setProfile(p);
      const notes = loadNotes();
      setContactNote(notes[chatId] || p?.about || '');
      if (p?.phone || p?.name || p?.pictureUrl) {
        setChats((prev) => prev.map((c) => (
          c.chat_id === chatId
            ? {
              ...c,
              phone: p.phone || c.phone,
              chat_name: (!isOwnerBrandName(p.name) && p.name) || c.chat_name,
              picture_url: p.pictureUrl || c.picture_url,
            }
            : c
        )));
      }
    } catch {
      setProfile({ jid: chatId, pictureUrl: null });
      setContactNote(loadNotes()[chatId] || '');
    } finally {
      setLoadingProfile(false);
    }
    loadChatMedia('all');
    loadContactStatuses();
  }

  async function loadContactStatuses() {
    if (!botId || !chatId) return;
    setLoadingStatuses(true);
    try {
      const res = await api.get(`/api/admin/bots/${botId}/chats/${encodeURIComponent(chatId)}/statuses`);
      setContactStatuses(res.data.statuses || []);
    } catch {
      setContactStatuses([]);
    } finally {
      setLoadingStatuses(false);
    }
  }

  async function loadChatMedia(type = mediaFilter) {
    if (!botId || !chatId) return;
    setLoadingMedia(true);
    try {
      const res = await api.get(`/api/admin/bots/${botId}/chats/${encodeURIComponent(chatId)}/media`, {
        params: { type: type === 'all' ? 'all' : type },
      });
      setChatMedia(res.data.media || []);
    } catch {
      setChatMedia([]);
    } finally {
      setLoadingMedia(false);
    }
  }

  function saveContactStatusNote() {
    saveNote(chatId, contactNote.trim());
    push({ title: 'Statut enregistré', message: 'Sauvegardé localement sur ce navigateur.', tone: 'success', duration: 2200 });
  }

  async function openSessionPanel() {
    setRail('session');
    setPanel(null);
    setChatId('');
    setShowThreadOnMobile(false);
    if (!botId) return;
    try {
      const res = await api.get(`/api/admin/bots/${botId}/session-profile`);
      setSessionProfile(res.data.profile);
      setStatusDraft(res.data.profile?.about || '');
    } catch { /* keep previous */ }
  }

  async function saveSessionStatus() {
    if (!botId || !statusDraft.trim()) return;
    setSavingStatus(true);
    try {
      const res = await api.post(`/api/admin/bots/${botId}/session-status`, { status: statusDraft.trim() });
      setSessionProfile((p) => ({ ...(p || {}), about: res.data.about }));
      push({ title: 'Statut publié', message: 'Mis à jour sur WhatsApp.', tone: 'success' });
    } catch (err) {
      push({ title: 'Échec', message: err.response?.data?.error || 'Impossible de publier le statut.', tone: 'danger' });
    } finally {
      setSavingStatus(false);
    }
  }

  function openSettings() {
    setRail('settings');
    setPanel(null);
    setChatId('');
    setShowThreadOnMobile(false);
    setPanel(null);
  }

  function openChatsRail() {
    setRail('chats');
    setPanel(null);
  }

  async function refreshChats() {
    if (!botId) return;
    const res = await api.get(`/api/admin/bots/${botId}/chats`);
    setChats(res.data.chats || []);
    push({ title: 'Liste actualisée', tone: 'success', duration: 1800 });
  }

  async function loadOlder() {
    if (!messages.length) return;
    setLoadingOlder(true);
    try {
      const res = await api.get(
        `/api/admin/bots/${botId}/chats/${encodeURIComponent(chatId)}/messages`,
        { params: { before: messages[0].id } }
      );
      setMessages((prev) => [...res.data.messages, ...prev]);
      setHasMore(res.data.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function deleteMessage(id) {
    if (String(id).startsWith('tmp-')) {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      return;
    }
    setConfirm({
      title: 'Supprimer ce message ?',
      message: 'Il sera retiré du journal HEXARO uniquement (pas sur WhatsApp).',
      danger: true,
      confirmLabel: 'Supprimer',
      onConfirm: async () => {
        setConfirm((c) => ({ ...c, busy: true }));
        try {
          await api.delete(`/api/admin/messages/${id}`);
          setMessages((prev) => prev.filter((m) => m.id !== id));
          push({ title: 'Message supprimé', tone: 'warn', duration: 2500 });
          setConfirm(null);
        } catch (err) {
          setConfirm(null);
          push({ title: 'Échec', message: err.response?.data?.error || 'Suppression impossible.', tone: 'danger' });
        }
      },
    });
  }

  async function send() {
    const payload = text.trim();
    if (!payload || !botId || !chatId) return;
    if (selectedBot?.status !== 'connected') return;
    if (sendingLockRef.current || uploading) return;
    sendingLockRef.current = true;
    setSending(true);

    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();
    const optimistic = {
      id: tempId,
      chat_id: chatId,
      sender_id: 'me',
      sender_name: 'Vous',
      direction: 'out',
      body: payload,
      media_type: null,
      has_media: false,
      created_at: createdAt,
      _pending: true,
    };

    setText('');
    setMessages((prev) => [...prev, optimistic]);
    setChats((prev) => {
      const old = prev.find((c) => c.chat_id === chatId);
      const others = prev.filter((c) => c.chat_id !== chatId);
      return [{
        chat_id: chatId,
        chat_name: old?.chat_name || selectedChat?.chat_name || chatId,
        body: payload,
        media_type: null,
        direction: 'out',
        created_at: createdAt,
        phone: old?.phone || selectedChat?.phone || null,
        picture_url: old?.picture_url || selectedChat?.picture_url || null,
        is_group: Boolean(chatId?.endsWith('@g.us')),
      }, ...others];
    });
    requestAnimationFrame(() => composerInputRef.current?.focus());

    try {
      const res = await api.post(
        `/api/admin/bots/${botId}/chats/${encodeURIComponent(chatId)}/send`,
        { text: payload }
      );
      const real = normalizeSocketMessage(res.data?.message);
      if (real?.id) {
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          if (withoutTemp.some((m) => m.id === real.id)) return withoutTemp;
          return [...withoutTemp, { ...real, _pending: false }];
        });
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(payload);
      push({ title: "Échec de l'envoi", message: err.response?.data?.error || 'Réessaie.', tone: 'danger' });
      requestAnimationFrame(() => composerInputRef.current?.focus());
    } finally {
      sendingLockRef.current = false;
      setSending(false);
    }
  }

  function onComposerKeyDown(e) {
    if (e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.shiftKey) return;
    if (!prefs.enterToSend) return;
    e.preventDefault();
    e.stopPropagation();
    send();
  }

  async function sendFile(file, voiceNote = false) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (voiceNote) form.append('voiceNote', 'true');
      await api.post(`/api/admin/bots/${botId}/chats/${encodeURIComponent(chatId)}/send-media`, form);
    } catch (err) {
      push({ title: "Échec de l'envoi", message: err.response?.data?.error || 'Média non envoyé.', tone: 'danger' });
    } finally {
      setUploading(false);
    }
  }

  function onFilePicked(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) sendFile(file);
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && recordedChunksRef.current.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        sendFile(new File([blob], 'note-vocale.webm', { type: 'audio/webm' }), true);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      push({ title: 'Micro inaccessible', message: "Impossible d'accéder au micro.", tone: 'danger' });
    }
  }

  const canSend = selectedBot?.status === 'connected' && !uploading;

  let lastDay = null;

  return (
    <div className="wa-app">
      <nav className="wa-rail">
        <button type="button" className={`wa-rail-btn${rail === 'chats' ? ' active' : ''}`} title="Discussions" onClick={openChatsRail}>
          <Icon name="whatsapp" size={22} />
          {chats.length > 0 && <span className="wa-rail-badge">{chats.length > 99 ? '99+' : chats.length}</span>}
        </button>
        <button type="button" className={`wa-rail-btn${rail === 'session' ? ' active' : ''}`} title="Profil session" onClick={openSessionPanel}>
          <Icon name="status" size={22} />
        </button>
        <Link to="/admin" className="wa-rail-btn" title="Admin">
          <Icon name="admin" size={20} />
        </Link>
        <div className="wa-rail-spacer" />
        <button type="button" className={`wa-rail-btn${rail === 'settings' ? ' active' : ''}`} title="Paramètres" onClick={openSettings}>
          <Icon name="settings" size={22} />
        </button>
        <button type="button" className="wa-rail-avatar" title="Session" onClick={openSessionPanel}>
          {sessionProfile?.pictureUrl
            ? <img src={sessionProfile.pictureUrl} alt="" />
            : <Icon name="user" size={18} />}
        </button>
      </nav>

      <aside className={`wa-sidebar${showThreadOnMobile ? ' wa-hide-mobile' : ''}`}>
        {rail === 'settings' ? (
          <div className="wa-settings-view">
            <header className="wa-settings-view-head">
              <h1>Paramètres</h1>
            </header>
            <div className="wa-search">
              <Icon name="search" size={16} />
              <input
                type="search"
                placeholder="Rechercher dans les paramètres"
                value={settingsQuery}
                onChange={(e) => setSettingsQuery(e.target.value)}
              />
              {settingsQuery && (
                <button type="button" className="wa-search-clear" onClick={() => setSettingsQuery('')} title="Effacer">
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
            <button type="button" className="wa-settings-profile" onClick={openSessionPanel}>
              <Avatar name={sessionProfile?.name || selectedBot?.phone_number || 'HEXARO'} pictureUrl={sessionProfile?.pictureUrl} />
              <div>
                <strong>{sessionProfile?.name || 'HEXARO'}</strong>
                <span>{sessionProfile?.phone || selectedBot?.phone_number || 'Session WhatsApp'}</span>
              </div>
            </button>
            <div className="wa-settings-menu">
              {visibleSettings.has('notifications') && (
              <label className="wa-setting-row">
                <Icon name="bell" size={18} />
                <div>
                  <strong>Notifications bureau</strong>
                  <span>Connexion / déconnexion bot</span>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.desktopNotify}
                  onChange={(e) => setPrefs((p) => ({ ...p, desktopNotify: e.target.checked }))}
                />
              </label>
              )}
              {visibleSettings.has('enter') && (
              <label className="wa-setting-row">
                <Icon name="send" size={18} />
                <div>
                  <strong>Entrée pour envoyer</strong>
                  <span>Sinon le texte reste dans le champ</span>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.enterToSend}
                  onChange={(e) => setPrefs((p) => ({ ...p, enterToSend: e.target.checked }))}
                />
              </label>
              )}
              {visibleSettings.has('phone') && (
              <label className="wa-setting-row">
                <Icon name="users" size={18} />
                <div>
                  <strong>Afficher le numéro dans la liste</strong>
                  <span>Sous le nom du contact</span>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.showPhoneInList}
                  onChange={(e) => setPrefs((p) => ({ ...p, showPhoneInList: e.target.checked }))}
                />
              </label>
              )}
              {visibleSettings.has('compact') && (
              <label className="wa-setting-row">
                <Icon name="moon" size={18} />
                <div>
                  <strong>Liste compacte</strong>
                  <span>Lignes un peu plus serrées</span>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.compactList}
                  onChange={(e) => setPrefs((p) => ({ ...p, compactList: e.target.checked }))}
                />
              </label>
              )}
              {visibleSettings.has('wallpaper') && (
              <div className="wa-setting-block">
                <div className="wa-setting-block-head">
                  <Icon name="wallpaper" size={18} />
                  <strong>Échelle du fond des discussions</strong>
                </div>
                <div className="wa-seg">
                  {[
                    ['sm', 'Fin'],
                    ['md', 'Moyen'],
                    ['lg', 'Large'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`wa-seg-btn${prefs.wallpaperScale === id ? ' active' : ''}`}
                      onClick={() => setPrefs((p) => ({ ...p, wallpaperScale: id }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              )}
              {visibleSettings.has('admin') && (
              <Link to="/admin" className="wa-setting-row wa-setting-link">
                <Icon name="admin" size={18} />
                <div>
                  <strong>Administration</strong>
                  <span>Utilisateurs, bots, abonnements</span>
                </div>
              </Link>
              )}
              {settingsQuery.trim() && visibleSettings.size === 0 && (
                <p className="wa-empty">Aucun paramètre pour « {settingsQuery.trim()} ».</p>
              )}
              <p className="wa-settings-hint muted">Enregistrés sur ce navigateur.</p>
            </div>
          </div>
        ) : rail === 'session' ? (
          <div className="wa-settings-view">
            <header className="wa-settings-view-head">
              <button type="button" className="wa-back" onClick={openChatsRail} title="Retour">
                <Icon name="back" size={20} />
              </button>
              <h1>Profil</h1>
            </header>
            <div className="wa-session-pane">
              {!botId ? (
                <p className="muted">Choisis une session d’abord.</p>
              ) : (
                <>
                  <div className="wa-profile-avatar-wrap">
                    <Avatar name={sessionProfile?.name || selectedBot?.phone_number} pictureUrl={sessionProfile?.pictureUrl} size="lg" />
                  </div>
                  <h3 className="wa-profile-name">{sessionProfile?.name || 'Session'}</h3>
                  <p className="wa-profile-number">{sessionProfile?.phone || selectedBot?.phone_number || '—'}</p>
                  <p className="wa-profile-meta">
                    Connexion : <strong>{selectedBot?.status || sessionProfile?.status || '—'}</strong>
                  </p>
                  <div className="wa-status-box">
                    <div className="wa-status-box-head">
                      <Icon name="status" size={16} />
                      <strong>Mon statut WhatsApp</strong>
                    </div>
                    <textarea
                      className="wa-status-input"
                      rows={3}
                      maxLength={139}
                      placeholder="Ex. Disponible · HEXARO"
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value)}
                      disabled={selectedBot?.status !== 'connected'}
                    />
                    <div className="wa-status-actions">
                      <span className="muted" style={{ fontSize: 12 }}>{statusDraft.length}/139</span>
                      <button
                        type="button"
                        className="btn"
                        disabled={savingStatus || !statusDraft.trim() || selectedBot?.status !== 'connected'}
                        onClick={saveSessionStatus}
                      >
                        {savingStatus ? 'Publication…' : 'Enregistrer'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
        <header className="wa-sidebar-top">
          <div className="wa-brand-row">
            <BrandMark size={28} />
            <h1 className="wa-brand-title">HEXARO</h1>
            <div className="wa-brand-actions">
              <button type="button" className="wa-icon-btn ghost" title="Actualiser" onClick={refreshChats} disabled={!botId}>
                <Icon name="refresh" size={18} />
              </button>
              <button type="button" className="wa-icon-btn ghost" title="Paramètres" onClick={openSettings}>
                <Icon name="more" size={18} />
              </button>
            </div>
          </div>
          <select className="wa-bot-select" value={botId} onChange={(e) => setBotId(e.target.value)}>
            <option value="">Choisir une session</option>
            {scannedBots.map((b) => (
              <option key={b.id} value={b.id}>{b.phone_number} — {b.user_email}</option>
            ))}
          </select>
          <div className="wa-search">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder="Rechercher un nom, numéro ou message…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
              }}
            />
            {query && (
              <button type="button" className="wa-search-clear" onClick={() => setQuery('')} title="Effacer">
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <div className="wa-filters">
            {[
              ['all', 'Toutes'],
              ['direct', 'Contacts'],
              ['groups', 'Groupes'],
            ].map(([id, label]) => (
              <button key={id} type="button" className={`wa-chip${filter === id ? ' active' : ''}`} onClick={() => setFilter(id)}>
                {label}
                {id === 'groups' && ` ${chats.filter((c) => c.chat_id?.endsWith('@g.us')).length || ''}`}
              </button>
            ))}
          </div>
        </header>

        {selectedBot && (
          <div className="wa-session-status">
            <span className={`badge active-dot ${selectedBot.status}`}>{selectedBot.status}</span>
            {selectedBot.phone_number && <span className="wa-session-phone">{selectedBot.phone_number}</span>}
          </div>
        )}
          </>
        )}

        {rail === 'chats' && (
        <div className="wa-chat-list">
          {filteredChats.map((c) => {
            const labels = contactLabels(c);
            const preview = c._searchSnippet || previewText(c);
            return (
              <button key={c.chat_id} className={`wa-chat-item${c.chat_id === chatId ? ' active' : ''}`} onClick={() => openChat(c.chat_id)}>
                <Avatar name={labels.title} pictureUrl={c.picture_url} />
                <div className="wa-chat-item-body">
                  <div className="wa-chat-item-top">
                    <span className="wa-chat-name">{query.trim() ? highlightMatch(labels.title, query) : labels.title}</span>
                    <span className="wa-chat-time">{timeOf(c.created_at)}</span>
                  </div>
                  {prefs.showPhoneInList && labels.subtitle && (
                    <div className="wa-chat-sub">{labels.subtitle}</div>
                  )}
                  <div className="wa-chat-preview">
                    {c._searchSnippet && <span className="wa-preview-you">Message :</span>}
                    {!c._searchSnippet && c.direction === 'out' && <span className="wa-preview-you">Vous :</span>}
                    {!c._searchSnippet && c.media_type && !c.body && <Icon name={MEDIA_ICON[c.media_type] || 'file'} size={13} className="wa-preview-icon" />}
                    {query.trim() ? highlightMatch(preview, query) : preview}
                  </div>
                </div>
              </button>
            );
          })}
          {botId && !filteredChats.length && (
            <p className="wa-empty">
              {query.trim() ? `Aucun résultat pour « ${query.trim()} ».` : 'Aucune conversation.'}
            </p>
          )}
          {!botId && <p className="wa-empty">Sélectionne une session WhatsApp pour voir les chats.</p>}
        </div>
        )}
      </aside>

      <section className={`wa-thread${!showThreadOnMobile ? ' wa-hide-mobile' : ''}`}>
        {selectedChat && rail === 'chats' ? (
          <>
            <header className="wa-thread-header">
              <button type="button" className="wa-back wa-back-mobile" onClick={() => setShowThreadOnMobile(false)}>
                <Icon name="back" size={20} />
              </button>
              {threadSearchOpen ? (
                <div className="wa-thread-search">
                  <Icon name="search" size={16} />
                  <input
                    ref={threadSearchRef}
                    type="search"
                    placeholder="Rechercher dans la conversation"
                    value={threadQuery}
                    onChange={(e) => setThreadQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') closeThreadSearch();
                      if (e.key === 'Enter' && e.shiftKey) {
                        e.preventDefault();
                        goThreadHit(-1);
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        goThreadHit(1);
                      }
                    }}
                  />
                  <span className="wa-thread-search-count">
                    {threadQuery.trim()
                      ? (threadHits.length ? `${threadHitIndex + 1}/${threadHits.length}` : '0')
                      : ''}
                  </span>
                  <button type="button" className="wa-icon-btn ghost" disabled={!threadHits.length} onClick={() => goThreadHit(-1)} title="Précédent">
                    <Icon name="back" size={16} />
                  </button>
                  <button type="button" className="wa-icon-btn ghost wa-search-next" disabled={!threadHits.length} onClick={() => goThreadHit(1)} title="Suivant">
                    <Icon name="back" size={16} />
                  </button>
                  <button type="button" className="wa-icon-btn ghost" onClick={closeThreadSearch} title="Fermer">
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ) : (
                <>
              <button type="button" className="wa-thread-identity" onClick={openContactProfile}>
                <Avatar name={selectedLabels.title} pictureUrl={profile?.pictureUrl || selectedChat?.picture_url} />
                <div className="wa-thread-meta">
                  <span className="wa-chat-name">{selectedLabels.title}</span>
                  <span className="wa-thread-sub">
                    {selectedLabels.subtitle || (selectedChat.is_group || chatId.endsWith('@g.us') ? 'Groupe' : 'Appuyer pour les infos')}
                  </span>
                </div>
              </button>
              <div className="wa-thread-actions">
                <button type="button" className="wa-icon-btn ghost" title="Rechercher dans la conversation" onClick={openThreadSearch}>
                  <Icon name="search" size={18} />
                </button>
                <button type="button" className="wa-icon-btn ghost" title="Infos contact" onClick={openContactProfile}>
                  <Icon name="more" size={18} />
                </button>
              </div>
                </>
              )}
            </header>
            <div className={`wa-messages wa-wallpaper-${prefs.wallpaperScale}`}>
              {hasMore && (
                <button className="btn secondary wa-load-older" disabled={loadingOlder} onClick={loadOlder}>
                  {loadingOlder ? 'Chargement...' : 'Messages précédents'}
                </button>
              )}
              {messages.map((m) => {
                const day = dayLabel(m.created_at);
                const showDay = day !== lastDay;
                lastDay = day;
                const isSticker = m.media_type === 'sticker' && m.has_media;
                const isMediaBubble = m.has_media && (m.media_type === 'image' || m.media_type === 'video');
                const caption = bubbleCaption(m);
                const isActiveHit = threadSearchOpen && threadHits[threadHitIndex]?.id === m.id;
                const isHit = threadSearchOpen && threadHits.some((h) => h.id === m.id);
                const isPending = Boolean(m._pending);
                return (
                  <div
                    key={m.id}
                    ref={(el) => {
                      if (el) messageRefs.current.set(m.id, el);
                      else messageRefs.current.delete(m.id);
                    }}
                  >
                    {showDay && <div className="wa-day-sep"><span>{day}</span></div>}
                    <div className={`wa-bubble-row ${m.direction === 'out' ? 'out' : 'in'}${isSticker ? ' is-sticker' : ''}${isMediaBubble ? ' is-media' : ''}${isActiveHit ? ' wa-hit-active' : ''}${isHit && !isActiveHit ? ' wa-hit' : ''}${isPending ? ' is-pending' : ''}`}>
                      <div className={`wa-bubble${isSticker ? ' wa-bubble-sticker' : ''}${isMediaBubble ? ' wa-bubble-media' : ''}`}>
                        <button type="button" className="wa-bubble-delete" title="Supprimer du journal" onClick={() => deleteMessage(m.id)} disabled={isPending}>
                          <Icon name="trash" size={12} />
                        </button>
                        {m.direction === 'in' && chatId.endsWith('@g.us') && !isSticker && (
                          <div className="wa-bubble-sender">
                            {displayName(m.sender_name, m.sender_id)}
                          </div>
                        )}
                        {caption && (
                          <div className="wa-bubble-text">
                            {threadSearchOpen && threadQuery.trim() ? highlightMatch(caption, threadQuery) : caption}
                          </div>
                        )}
                        <MessageMedia msg={m} onOpen={(msg) => setThreadLightboxId(msg.id)} />
                        <div className="wa-bubble-meta">
                          <span className="wa-bubble-time">{timeOf(m.created_at)}</span>
                          {m.direction === 'out' && (
                            isPending
                              ? <span className="wa-pending-dot" title="Envoi…" />
                              : <Icon name="check" size={12} style={{ opacity: 0.55 }} />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>
            <div className="wa-composer">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                style={{ display: 'none' }}
                onChange={onFilePicked}
              />
              <button type="button" className="wa-icon-btn" disabled={!canSend} title="Joindre un fichier" onClick={() => fileInputRef.current?.click()}>
                <Icon name="plus" size={22} />
              </button>
              <button type="button" className="wa-icon-btn ghost" disabled title="Émoji (bientôt)">
                <Icon name="smile" size={20} />
              </button>
              <div className="wa-composer-field">
                <input
                  ref={composerInputRef}
                  type="text"
                  placeholder={selectedBot?.status === 'connected' ? 'Écrire un message' : 'Bot non connecté'}
                  value={text}
                  disabled={selectedBot?.status !== 'connected' || uploading}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onComposerKeyDown}
                  autoComplete="off"
                  enterKeyHint="send"
                />
              </div>
              {text.trim() ? (
                <button
                  type="button"
                  className="wa-icon-btn send-btn"
                  disabled={uploading || selectedBot?.status !== 'connected'}
                  title="Envoyer"
                  onClick={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <Icon name="send" size={18} />
                </button>
              ) : (
                <button type="button" className={`wa-icon-btn${recording ? ' recording' : ''}`} disabled={!canSend} title="Note vocale" onClick={toggleRecording}>
                  <Icon name={recording ? 'stop' : 'mic'} size={20} />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className={`wa-placeholder${rail === 'settings' ? ' wa-placeholder-settings' : ''}${rail === 'session' ? ' wa-placeholder-session' : ''}`}>
            <div className="wa-placeholder-splash">
              {rail === 'settings' ? (
                <>
                  <Icon name="settings" size={72} className="wa-placeholder-icon" />
                  <strong>Paramètres</strong>
                  <p className="muted">Choisis une option dans le panneau de gauche.</p>
                </>
              ) : rail === 'session' ? (
                <>
                  <Icon name="user" size={72} className="wa-placeholder-icon" />
                  <strong>Profil</strong>
                  <p className="muted">Gère le compte WhatsApp de la session.</p>
                </>
              ) : (
                <>
                  <BrandMark size={64} />
                  <strong>HEXARO</strong>
                  <p className="muted" style={{ margin: 0 }}>
                    {botId
                      ? 'Sélectionne une conversation pour lire et répondre.'
                      : 'Choisis une session connectée pour commencer.'}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {panel === 'contact' && selectedChat && (
        <aside className="wa-profile-panel">
          <header className="wa-profile-header">
            <button type="button" className="wa-back" onClick={() => { setPanel(null); setLightboxIndex(-1); }}>
              <Icon name="close" size={20} />
            </button>
            <span>Infos du contact</span>
          </header>
          <div className="wa-profile-body">
            {loadingProfile ? (
              <p className="muted">Chargement...</p>
            ) : (
              <>
                <div className="wa-profile-avatar-wrap">
                  <Avatar name={selectedLabels.title} pictureUrl={profile?.pictureUrl || selectedChat?.picture_url} size="lg" />
                </div>
                <h3 className="wa-profile-name">{profile?.name || selectedLabels.title}</h3>
                <p className="wa-profile-number">{selectedLabels.phone || selectedLabels.subtitle || 'Numéro non disponible'}</p>
                {profile?.isGroup && (
                  <p className="wa-profile-meta">{profile.participantsCount ?? '—'} participants</p>
                )}

                <div className="wa-status-box">
                  <div className="wa-status-box-head">
                    <Icon name="status" size={16} />
                    <strong>Statuts mis en ligne</strong>
                  </div>
                  {loadingStatuses ? (
                    <p className="muted">Chargement des statuts…</p>
                  ) : contactStatuses.length === 0 ? (
                    <p className="muted">
                      Aucun statut story capturé pour ce contact. Ils apparaissent ici dès qu’il en publie pendant que le bot est connecté.
                    </p>
                  ) : (
                    <div className="wa-status-stories">
                      {contactStatuses.map((s, idx) => (
                        <button
                          key={s.id}
                          type="button"
                          className="wa-status-story"
                          onClick={() => setStatusViewIndex(idx)}
                          title={timeOf(s.created_at)}
                        >
                          {s.has_media && (s.media_type === 'image' || s.media_type === 'sticker') && (
                            <AuthMedia id={s.id} kind="image" />
                          )}
                          {s.has_media && s.media_type === 'video' && (
                            <AuthMedia id={s.id} kind="video" muted />
                          )}
                          {(!s.has_media || s.media_type === 'text') && (
                            <span className="wa-status-story-fallback">{(s.body || 'Statut').slice(0, 40)}</span>
                          )}
                          <span className="wa-status-story-time">{timeOf(s.created_at)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="wa-settings-hint muted">Stories WhatsApp (24h) — aperçu uniquement.</p>
                </div>

                <div className="wa-status-box">
                  <div className="wa-status-box-head">
                    <Icon name="user" size={16} />
                    <strong>Info / bio</strong>
                  </div>
                  {profile?.about ? (
                    <p className="wa-status-live">{profile.about}</p>
                  ) : (
                    <p className="wa-status-live muted">Aucune bio publique</p>
                  )}
                  <textarea
                    className="wa-status-input"
                    rows={2}
                    placeholder="Note locale sur ce contact…"
                    value={contactNote}
                    onChange={(e) => setContactNote(e.target.value)}
                  />
                  <div className="wa-status-actions">
                    <button type="button" className="btn secondary" disabled={!profile?.about} onClick={() => copyText(profile.about, push)}>
                      Copier bio
                    </button>
                    <button type="button" className="btn" onClick={saveContactStatusNote} disabled={!contactNote.trim()}>
                      Enregistrer note
                    </button>
                  </div>
                </div>

                <div className="wa-info-cards">
                  <div className="wa-info-card">
                    <span className="wa-info-label">Messages</span>
                    <strong>{profile?.stats?.total ?? messages.length}</strong>
                  </div>
                  <div className="wa-info-card">
                    <span className="wa-info-label">Médias reçus</span>
                    <strong>{profile?.stats?.mediaCount ?? chatMedia.length}</strong>
                  </div>
                  <div className="wa-info-card">
                    <span className="wa-info-label">Reçus / Envoyés</span>
                    <strong>{profile?.stats?.inCount ?? 0} / {profile?.stats?.outCount ?? 0}</strong>
                  </div>
                </div>

                <div className="wa-media-section">
                  <div className="wa-status-box-head">
                    <Icon name="image" size={16} />
                    <strong>Médias reçus</strong>
                  </div>
                  <div className="wa-filters wa-media-filters">
                    {[
                      ['all', 'Tous'],
                      ['image', 'Photos'],
                      ['video', 'Vidéos'],
                      ['sticker', 'Stickers'],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`wa-chip${mediaFilter === id ? ' active' : ''}`}
                        onClick={() => {
                          setMediaFilter(id);
                          loadChatMedia(id);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {loadingMedia ? (
                    <p className="muted">Chargement des médias…</p>
                  ) : chatMedia.length === 0 ? (
                    <p className="muted">Aucun média reçu enregistré pour ce chat.</p>
                  ) : (
                    <div className="wa-media-grid">
                      {chatMedia.map((item, idx) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`wa-media-tile wa-media-${item.media_type}`}
                          title={MEDIA_LABEL[item.media_type] || item.media_type}
                          onClick={() => setLightboxIndex(idx)}
                        >
                          {(item.media_type === 'image' || item.media_type === 'sticker') && (
                            <AuthMedia id={item.id} kind="image" />
                          )}
                          {item.media_type === 'video' && (
                            <>
                              <AuthMedia id={item.id} kind="video" muted />
                              <span className="wa-media-tile-badge"><Icon name="video" size={14} /></span>
                            </>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="wa-settings-hint muted">Aperçu uniquement — pas de téléchargement.</p>
                </div>

                <div className="wa-profile-actions">
                  {selectedLabels.phone && (
                    <button type="button" className="wa-action-row" onClick={() => copyText(selectedLabels.phone, push)}>
                      <Icon name="copy" size={18} />
                      <div>
                        <strong>Copier le numéro</strong>
                        <span>{selectedLabels.phone}</span>
                      </div>
                    </button>
                  )}
                  <button type="button" className="wa-action-row" onClick={() => copyText(chatId, push)}>
                    <Icon name="link" size={18} />
                    <div>
                      <strong>Copier l’identifiant</strong>
                      <span className="mono">{chatId}</span>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      )}

      <ConfirmModal
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        danger={confirm?.danger}
        confirmLabel={confirm?.confirmLabel}
        busy={!!confirm?.busy}
        onCancel={() => !confirm?.busy && setConfirm(null)}
        onConfirm={confirm?.onConfirm}
      />

      {lightboxIndex >= 0 && chatMedia[lightboxIndex] && (
        <MediaLightbox
          item={chatMedia[lightboxIndex]}
          onClose={() => setLightboxIndex(-1)}
          onPrev={lightboxIndex > 0 ? () => setLightboxIndex((i) => i - 1) : null}
          onNext={lightboxIndex < chatMedia.length - 1 ? () => setLightboxIndex((i) => i + 1) : null}
        />
      )}

      {threadLightboxIndex >= 0 && threadMediaItems[threadLightboxIndex] && (
        <MediaLightbox
          item={threadMediaItems[threadLightboxIndex]}
          onClose={() => setThreadLightboxId(null)}
          onPrev={threadLightboxIndex > 0
            ? () => setThreadLightboxId(threadMediaItems[threadLightboxIndex - 1].id)
            : null}
          onNext={threadLightboxIndex < threadMediaItems.length - 1
            ? () => setThreadLightboxId(threadMediaItems[threadLightboxIndex + 1].id)
            : null}
        />
      )}

      {statusViewIndex >= 0 && contactStatuses[statusViewIndex] && (
        <MediaLightbox
          item={contactStatuses[statusViewIndex]}
          onClose={() => setStatusViewIndex(-1)}
          onPrev={statusViewIndex > 0 ? () => setStatusViewIndex((i) => i - 1) : null}
          onNext={statusViewIndex < contactStatuses.length - 1 ? () => setStatusViewIndex((i) => i + 1) : null}
        />
      )}
    </div>
  );
}
