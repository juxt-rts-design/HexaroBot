import { useEffect, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useDesktopNotify } from './useDesktopNotify';

const API_URL = import.meta.env.VITE_API_URL;

/**
 * Écoute le statut Socket.IO de chaque bot et notifie (toast + push navigateur).
 */
export function useBotStatusWatcher(bots = []) {
  const { push } = useToast();
  const { notify, requestPermission } = useDesktopNotify();
  const lastStatus = useRef(new Map());
  const sockets = useRef(new Map());
  const botsRef = useRef(bots);
  botsRef.current = bots;

  const botKey = useMemo(
    () => bots.map((b) => b.id).filter(Boolean).sort((a, b) => a - b).join(','),
    [bots]
  );

  useEffect(() => {
    requestPermission();
  }, [requestPermission]);

  useEffect(() => {
    let cancelled = false;
    const ids = botKey ? botKey.split(',').map(Number) : [];

    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;

      const idSet = new Set(ids);
      for (const [id, sock] of sockets.current.entries()) {
        if (!idSet.has(id)) {
          sock.disconnect();
          sockets.current.delete(id);
          lastStatus.current.delete(id);
        }
      }

      for (const id of ids) {
        if (sockets.current.has(id)) continue;
        const socket = io(API_URL, { auth: { token } });
        sockets.current.set(id, socket);

        socket.on('connect', () => socket.emit('join-bot', id));
        socket.on('status', (payload) => {
          const prev = lastStatus.current.get(id);
          lastStatus.current.set(id, payload.status);
          if (!prev || prev === payload.status) return;

          const bot = botsRef.current.find((b) => b.id === id) || {};
          const label = bot.label || bot.plan_code || `Bot #${id}`;
          const phone = payload.phone_number || bot.phone_number || '';

          if (payload.status === 'connected') {
            const message = phone ? `${label} · ${phone}` : label;
            push({ title: 'Bot connecté', message, tone: 'success' });
            notify({ title: 'HEXARO — Connecté', body: message, tag: `bot-${id}-connected` });
          } else if (payload.status === 'disconnected') {
            push({ title: 'Bot déconnecté', message: label, tone: 'danger' });
            notify({ title: 'HEXARO — Déconnecté', body: label, tag: `bot-${id}-disconnected` });
          } else if (payload.status === 'qr_pending') {
            push({ title: 'QR en attente', message: label, tone: 'warn', duration: 3500 });
          }
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [botKey, push, notify]);

  useEffect(() => {
    return () => {
      for (const sock of sockets.current.values()) sock.disconnect();
      sockets.current.clear();
    };
  }, []);
}
