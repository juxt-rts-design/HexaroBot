import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useBusy } from '../hooks/useBusy';
import QrModal from '../components/QrModal';
import { BrandMark, Icon } from '../components/Icons';
import { useBotStatusWatcher } from '../hooks/useBotStatusWatcher';
import { useToast } from '../context/ToastContext';
import ConfirmModal from '../components/ConfirmModal';
import AdminWhatsAppLink from '../components/AdminWhatsAppLink';
import { displayBotLabel, displayPlanDescription, displayPlanName } from '../utils/botDisplay';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { run, isBusy } = useBusy();
  const { push } = useToast();
  const [plans, setPlans] = useState([]);
  const [bots, setBots] = useState([]);
  const [qrBotId, setQrBotId] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);

  useBotStatusWatcher(bots);

  async function refresh() {
    const [p, b] = await Promise.all([
      api.get('/api/plans'),
      api.get('/api/bots/mine'),
    ]);
    setPlans(p.data.plans);
    setBots(b.data.bots);
  }

  useEffect(() => {
    refresh();
  }, []);

  function createBot(planCode) {
    return run(`create-${planCode}`, async () => {
      setError('');
      try {
        const res = await api.post('/api/bots', { planCode });
        await refresh();
        setQrBotId(res.data.bot.id);
      } catch (err) {
        setError(err.response?.data?.error || 'Échec de la création du bot.');
      }
    });
  }

  function disconnectBot(botId) {
    setConfirm({
      title: 'Déconnecter le bot ?',
      message: 'La session WhatsApp sera coupée. Tu pourras reconnecter un numéro ensuite.',
      danger: true,
      confirmLabel: 'Déconnecter',
      busyKey: `disconnect-${botId}`,
      onConfirm: () =>
        run(`disconnect-${botId}`, async () => {
          setConfirm(null);
          await api.post(`/api/bots/${botId}/disconnect`);
          await refresh();
          push({ title: 'Bot déconnecté', message: 'Session coupée.', tone: 'warn' });
        }),
    });
  }

  function reconnectBot(botId) {
    return run(`reconnect-${botId}`, async () => {
      await api.post(`/api/bots/${botId}/reconnect`);
      setQrBotId(botId);
    });
  }

  const limitReached = !user.exempt && bots.length >= 1;

  return (
    <div className="user-shell">
      <header className="topbar">
        <strong className="brand">
          <BrandMark size={32} />
          <span className="brand-text">HEXARO</span>
        </strong>
        <div className="topbar-user">
          <span className="topbar-name" title={user.name}>{user.name}</span>
          <Link className="btn secondary topbar-btn" to="/guide" title="Guide">
            <Icon name="book" size={16} />
            <span className="btn-label">Guide</span>
          </Link>
          <AdminWhatsAppLink className="topbar-btn" label="Aide" />
          <button className="btn secondary topbar-btn" onClick={logout} title="Déconnexion">
            <Icon name="logout" size={16} />
            <span className="btn-label">Déconnexion</span>
          </button>
        </div>
      </header>

      <div className="container user-dashboard">
        <section className="card">
          <div className="section-title">
            <Icon name="plus" size={20} />
            <h2>Créer un bot</h2>
          </div>
          <p className="muted">
            {user.exempt
              ? 'Ton compte est exempté — crée autant de bots que tu veux, gratuitement.'
              : limitReached
              ? "Tu as déjà créé ton chatbot gratuit. Contacte l'administrateur si tu veux en créer un autre."
              : "C'est gratuit pour le moment — tu peux créer un chatbot."}
          </p>
          {error && <p className="error-text">{error}</p>}
          <div className="plan-grid">
            {plans.map((plan) => (
              <div key={plan.id} className="plan-card">
                <h3>{displayPlanName(plan)}</h3>
                <p className="muted">{displayPlanDescription(plan)}</p>
                <p className="price"><span className="badge connected">Gratuit</span></p>
                <button
                  className="btn"
                  disabled={isBusy(`create-${plan.code}`) || limitReached}
                  onClick={() => createBot(plan.code)}
                >
                  {isBusy(`create-${plan.code}`) ? 'Création...' : 'Créer un bot'}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="section-title">
            <Icon name="bot" size={20} />
            <h2>Mes bots</h2>
          </div>

          {!bots.length && <p className="empty">Aucun bot pour le moment.</p>}

          <div className="bot-list">
            {bots.map((b) => (
              <article key={b.id} className="bot-card">
                <div className="bot-card-head">
                  <div className="bot-card-meta">
                    <strong className="bot-card-label">{displayBotLabel(b)}</strong>
                    <span className="bot-card-phone">{b.phone_number || 'Numéro non lié'}</span>
                  </div>
                  <span className={`badge active-dot ${b.status}`}>{b.status}</span>
                </div>

                <div className="bot-card-actions">
                  {b.status === 'connected' ? (
                    <button
                      type="button"
                      className="btn secondary bot-action-btn"
                      disabled={isBusy(`disconnect-${b.id}`)}
                      onClick={() => disconnectBot(b.id)}
                    >
                      <Icon name="logout" size={15} />
                      <span>{isBusy(`disconnect-${b.id}`) ? '…' : 'Déconnecter'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn bot-action-btn"
                      disabled={isBusy(`reconnect-${b.id}`)}
                      onClick={() => reconnectBot(b.id)}
                    >
                      <Icon name="link" size={15} />
                      <span>{isBusy(`reconnect-${b.id}`) ? '…' : 'Connecter'}</span>
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      {qrBotId && (
        <QrModal botId={qrBotId} onClose={() => setQrBotId(null)} onConnected={refresh} />
      )}
      <ConfirmModal
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        danger={confirm?.danger}
        confirmLabel={confirm?.confirmLabel}
        busy={confirm?.busyKey ? isBusy(confirm.busyKey) : false}
        onCancel={() => setConfirm(null)}
        onConfirm={confirm?.onConfirm}
      />
    </div>
  );
}
