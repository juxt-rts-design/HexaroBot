import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useBusy } from '../hooks/useBusy';
import QrModal from '../components/QrModal';
import PaymentModal from '../components/PaymentModal';
import { BrandMark, Icon } from '../components/Icons';
import { useBotStatusWatcher } from '../hooks/useBotStatusWatcher';
import { useToast } from '../context/ToastContext';
import ConfirmModal from '../components/ConfirmModal';
import AdminWhatsAppLink from '../components/AdminWhatsAppLink';
import { displayBotLabel, displayPlanDescription, displayPlanName } from '../utils/botDisplay';

function accessLine(sub, exempt) {
  if (exempt) return 'Compte exempté';
  if (!sub) return '';
  if (sub.expired) return 'Essai / abonnement terminé';
  const until = sub.ends_at
    ? new Date(sub.ends_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    : '';
  if (sub.is_trial) {
    if (sub.hours_left != null && sub.hours_left < 24) return `Essai · ${sub.hours_left} h restantes`;
    if (sub.days_left === 1) return `Essai · dernier jour (${until})`;
    return `Essai · ${sub.days_left} j restants (${until})`;
  }
  return until ? `Abonné jusqu’au ${until}` : 'Abonnement actif';
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { run, isBusy } = useBusy();
  const { push } = useToast();
  const [params, setParams] = useSearchParams();
  const [plans, setPlans] = useState([]);
  const [bots, setBots] = useState([]);
  const [billing, setBilling] = useState(null);
  const [qrBotId, setQrBotId] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payBotId, setPayBotId] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const autoPayRef = useRef(false);

  useBotStatusWatcher(bots);

  async function refresh() {
    const [p, b] = await Promise.all([
      api.get('/api/plans'),
      api.get('/api/bots/mine'),
    ]);
    setPlans(p.data.plans);
    setBots(b.data.bots);
    setBilling(b.data.billing || null);
    return b.data.bots || [];
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (params.get('pay') !== '1') return;
    const wanted = params.get('bot');
    setPayBotId(wanted ? Number(wanted) : null);
    setPayOpen(true);
    const next = new URLSearchParams(params);
    next.delete('pay');
    next.delete('bot');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot deep link
  }, []);

  function openPay(botId) {
    setPayBotId(botId || null);
    setPayOpen(true);
  }

  useEffect(() => {
    if (autoPayRef.current || user.exempt || !bots.length) return;
    const urgent = bots.find(
      (b) =>
        b.status === 'suspended' ||
        b.subscription?.expired ||
        (typeof b.subscription?.hours_left === 'number' && b.subscription.hours_left <= 24)
    );
    if (!urgent) return;
    const expired = urgent.status === 'suspended' || urgent.subscription?.expired;
    if (!expired && sessionStorage.getItem('hexaro-pay-dismissed') === '1') return;
    autoPayRef.current = true;
    openPay(urgent.id);
  }, [bots, user.exempt]);

  function createBot(planCode) {
    return run(`create-${planCode}`, async () => {
      setError('');
      try {
        const res = await api.post('/api/bots', { planCode });
        await refresh();
        setQrBotId(res.data.bot.id);
        if (res.data.trial) {
          push({
            title: 'Essai 3 jours',
            message: 'Ton HexaroBot est actif. Après 3 jours : 2100 FCFA / mois.',
            tone: 'info',
            duration: 6000,
          });
        }
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
      try {
        await api.post(`/api/bots/${botId}/reconnect`);
        setQrBotId(botId);
      } catch (err) {
        if (err.response?.status === 402 || err.response?.data?.code === 'subscription_expired') {
          openPay(botId);
          return;
        }
        push({
          title: 'Erreur',
          message: err.response?.data?.error || err.message,
          tone: 'danger',
        });
      }
    });
  }

  const price = billing?.price_xaf || 2100;
  const trialDays = billing?.trial_days || 3;
  const limitReached = !user.exempt && bots.length >= 1;
  const payBot =
    (payBotId && bots.find((b) => b.id === payBotId)) || bots[0] || null;
  const needsPay = bots.some(
    (b) =>
      b.status === 'suspended' ||
      b.subscription?.expired ||
      b.subscription?.status === 'expired' ||
      (typeof b.subscription?.hours_left === 'number' && b.subscription.hours_left <= 24)
  );
  const anySuspended = bots.some((b) => b.status === 'suspended' || b.subscription?.expired);
  const lastDay = bots.some(
    (b) => !b.subscription?.expired && typeof b.subscription?.hours_left === 'number' && b.subscription.hours_left <= 24
  );
  const payForced = Boolean(
    payBot && (payBot.status === 'suspended' || payBot.subscription?.expired)
  );

  function closePay() {
    if (payForced) return;
    sessionStorage.setItem('hexaro-pay-dismissed', '1');
    setPayOpen(false);
  }

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
          {!user.exempt && (
            <button type="button" className="btn secondary topbar-btn" title="Abonnement" onClick={() => openPay()}>
              <Icon name="credit" size={16} />
              <span className="btn-label">Abonnement</span>
            </button>
          )}
          <AdminWhatsAppLink className="topbar-btn" label="Aide" />
          <button className="btn secondary topbar-btn" onClick={logout} title="Déconnexion">
            <Icon name="logout" size={16} />
            <span className="btn-label">Déconnexion</span>
          </button>
        </div>
      </header>

      <div className="container user-dashboard">
        {needsPay && !user.exempt && (
          <div className={`billing-banner${anySuspended ? ' danger' : ''}`}>
            <p>
              {anySuspended
                ? `HexaroBot est en pause. ${price} FCFA pour le réactiver — rien n’est perdu.`
                : lastDay
                  ? `Moins de 24 h d’accès. Sans paiement, le bot se met en pause automatiquement.`
                  : `Essai bientôt terminé. Renouvelle pour ${price} FCFA / mois.`}
            </p>
            <button type="button" className="btn" onClick={() => openPay()}>
              Payer {price} FCFA
            </button>
          </div>
        )}

        <section className="card">
          <div className="section-title">
            <Icon name="plus" size={20} />
            <h2>Créer un bot</h2>
          </div>
          <p className="muted">
            {user.exempt
              ? 'Ton compte est exempté — crée autant de bots que tu veux, gratuitement.'
              : limitReached
              ? "Tu as déjà créé ton HexaroBot. Contacte l'administrateur si tu veux en créer un autre."
              : `${trialDays} jours d'essai, puis ${price} FCFA / mois (Airtel Money ou MoBiCash).`}
          </p>
          {error && <p className="error-text">{error}</p>}
          <div className="plan-grid">
            {plans.map((plan) => (
              <div key={plan.id} className="plan-card">
                <h3>{displayPlanName(plan)}</h3>
                <p className="muted">{displayPlanDescription(plan)}</p>
                <p className="price">
                  {user.exempt ? (
                    <span className="badge connected">Exempté</span>
                  ) : (
                    <span className="badge connected">Essai {trialDays} jours · puis {price} FCFA/mois</span>
                  )}
                </p>
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
            {bots.map((b) => {
              const sub = b.subscription;
              const suspended = b.status === 'suspended' || sub?.expired;
              return (
                <article key={b.id} className="bot-card">
                  <div className="bot-card-head">
                    <div className="bot-card-meta">
                      <strong className="bot-card-label">{displayBotLabel(b)}</strong>
                      <span className="bot-card-phone">{b.phone_number || 'Numéro non lié'}</span>
                      {!user.exempt && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          {accessLine(sub, user.exempt)}
                        </span>
                      )}
                    </div>
                    <span className={`badge active-dot ${b.status}`}>{b.status}</span>
                  </div>

                  <div className="bot-card-actions">
                    {suspended && !user.exempt ? (
                      <button type="button" className="btn bot-action-btn" onClick={() => openPay(b.id)}>
                        <Icon name="credit" size={15} />
                        <span>Payer pour réactiver</span>
                      </button>
                    ) : b.status === 'connected' ? (
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
                    {!user.exempt && !suspended && (
                      <button type="button" className="btn secondary bot-action-btn" onClick={() => openPay(b.id)}>
                        <Icon name="credit" size={15} />
                        <span>Abonnement</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {qrBotId && (
        <QrModal botId={qrBotId} onClose={() => setQrBotId(null)} onConnected={refresh} />
      )}
      <PaymentModal
        open={payOpen}
        bot={payBot}
        price={price}
        trialDays={trialDays}
        exempt={Boolean(user.exempt)}
        forced={payForced}
        onClose={closePay}
        onPaid={() => {
          sessionStorage.removeItem('hexaro-pay-dismissed');
          autoPayRef.current = false;
          setPayOpen(false);
          refresh();
        }}
      />
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
