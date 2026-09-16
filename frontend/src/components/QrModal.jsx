import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { supabase } from '../lib/supabase';
import api from '../api/client';
import { Icon } from './Icons';

export default function QrModal({ botId, onClose, onConnected }) {
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState('created');
  const [phone, setPhone] = useState('');
  const [pairingCode, setPairingCode] = useState(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState('');

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
      socket.on('pairing-code', (payload) => {
        if (payload?.code) setPairingCode(payload.code);
      });
      socket.on('status', (payload) => {
        if (!payload?.status) return;
        if (payload.status === 'connected') setQr(null);
        setStatus(payload.status);
        if (payload.status === 'connected') onConnected?.();
      });
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [botId]);

  async function requestCode(e) {
    e?.preventDefault();
    setPairingError('');
    setPairingBusy(true);
    try {
      const res = await api.post(`/api/bots/${botId}/pairing-code`, { phone });
      setPairingCode(res.data.code);
    } catch (err) {
      setPairingError(err.response?.data?.error || err.message || 'Impossible d’obtenir le code.');
    } finally {
      setPairingBusy(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="card modal-card qr-modal" style={{ textAlign: 'center' }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="whatsapp" size={20} /> Connecter WhatsApp
        </h3>
        {status === 'connected' && !qr ? (
          <p style={{ color: 'var(--accent-bright)', display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center', width: '100%' }}>
            <Icon name="check" size={18} /> Numéro connecté avec succès
          </p>
        ) : (
          <>
            {qr ? (
              <>
                <img className="qr-image" src={qr} alt="QR code WhatsApp" />
                <p className="muted">
                  WhatsApp → Appareils liés → Lier un appareil, puis scanne ce code.
                </p>
              </>
            ) : (
              <p className="muted">Génération du QR code en cours...</p>
            )}

            <div className="pairing-box">
              <p className="pairing-title">Pas de 2ᵉ téléphone ?</p>
              <p className="muted pairing-hint">
                Entre ton numéro WhatsApp (avec l’indicatif pays), récupère un code, puis sur ton téléphone :
                Appareils liés → Lier un appareil → <strong>Connecter avec un numéro de téléphone</strong>.
              </p>
              <form className="pairing-form" onSubmit={requestCode}>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="ex. 24165255707"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={pairingBusy || status === 'connected'}
                  aria-label="Numéro WhatsApp avec indicatif"
                />
                <button className="btn" type="submit" disabled={pairingBusy || !phone.trim() || !qr}>
                  {pairingBusy ? 'Demande…' : 'Obtenir le code'}
                </button>
              </form>
              {pairingError && <p className="pairing-error">{pairingError}</p>}
              {pairingCode && (
                <div className="pairing-code-wrap">
                  <span className="muted">Ton code (environ 1 minute) :</span>
                  <p className="pairing-code">{pairingCode}</p>
                </div>
              )}
            </div>
          </>
        )}
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button className="btn secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
