import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { supabase } from '../lib/supabase';
import { Icon } from './Icons';

export default function QrModal({ botId, onClose, onConnected }) {
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState('created');

  useEffect(() => {
    let socket;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      socket = io(import.meta.env.VITE_API_URL, { auth: { token } });
      socket.on('connect', () => socket.emit('join-bot', botId));
      socket.on('qr', (payload) => {
        setQr(payload.qr);
        setStatus('qr_pending');
      });
      socket.on('status', (payload) => {
        setStatus(payload.status);
        if (payload.status === 'connected') onConnected?.();
      });
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [botId]);

  return (
    <div className="modal-overlay">
      <div className="card modal-card" style={{ textAlign: 'center' }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="whatsapp" size={20} /> Connecter WhatsApp
        </h3>
        {status === 'connected' ? (
          <p style={{ color: 'var(--accent-bright)', display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center', width: '100%' }}>
            <Icon name="check" size={18} /> Numéro connecté avec succès
          </p>
        ) : qr ? (
          <>
            <img src={qr} alt="QR code WhatsApp" style={{ width: '100%', borderRadius: 12, background: '#fff', padding: 12 }} />
            <p className="muted">WhatsApp → Appareils liés → Lier un appareil, puis scanne ce code.</p>
          </>
        ) : (
          <p className="muted">Génération du QR code en cours...</p>
        )}
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button className="btn secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
