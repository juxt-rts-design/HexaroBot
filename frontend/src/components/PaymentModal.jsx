import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { Icon } from './Icons';
import { publicErrorMessage } from '../utils/publicError';

const OPERATORS = {
  airtel: {
    code: 'AIRTEL_MONEY',
    label: 'Airtel Money',
    logo: '/logos/airtel.png',
    placeholder: '074000000',
    hint: 'Numéro Airtel, ex. 074000000',
  },
  mobicash: {
    code: 'MOOV_MONEY',
    label: 'MoBiCash',
    logo: '/logos/moov.png',
    placeholder: '065255797',
                hint: 'Numéro Libertis à 9 chiffres, ex. 065255797',
  },
};

function formatAmount(n) {
  return new Intl.NumberFormat('fr-FR').format(Number(n) || 0);
}

function formatEndDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function remainingLabel(sub) {
  if (!sub) return 'Aucun abonnement';
  if (sub.expired) return 'Accès terminé';
  if (sub.hours_left != null && sub.hours_left < 24) {
    return `${sub.hours_left} h restantes`;
  }
  if (typeof sub.days_left === 'number') {
    return sub.days_left <= 1 ? 'Dernier jour' : `${sub.days_left} jours restants`;
  }
  return '';
}

export default function PaymentModal({
  open,
  bot,
  price = 2100,
  trialDays = 3,
  exempt = false,
  forced = false,
  onClose,
  onPaid,
}) {
  const [msisdn, setMsisdn] = useState('');
  const [operator, setOperator] = useState('airtel');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('form'); // form | pending | success | failed
  const [message, setMessage] = useState('');
  const [reference, setReference] = useState('');
  const pollRef = useRef(null);
  const sub = bot?.subscription;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && phase !== 'pending' && !(forced && phase !== 'success')) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, phase, onClose]);

  useEffect(() => {
    if (!open) {
      stopPoll();
      setPhase('form');
      setMessage('');
      setReference('');
      setBusy(false);
    }
    return () => stopPoll();
  }, [open]);

  function stopPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPoll(ref, operatorKey) {
    stopPoll();
    const firstDelay = operatorKey === 'mobicash' ? 5000 : 2500;
    const tick = async () => {
      try {
        const res = await api.get(`/api/payments/${encodeURIComponent(ref)}/status`);
        const st = res.data?.payment?.status;
        if (st === 'SUCCESS') {
          stopPoll();
          setPhase('success');
          const subAfter = res.data?.subscription;
          const days = subAfter?.days_left;
          setMessage(
            typeof days === 'number'
              ? `Paiement reçu. Il te reste ${days} jour${days > 1 ? 's' : ''}.`
              : 'Paiement reçu. Ton accès est prolongé d’un mois.'
          );
          onPaid?.(subAfter);
        } else if (st === 'FAILED') {
          stopPoll();
          setPhase('failed');
          setMessage(
            publicErrorMessage(res.data?.payment?.failure_reason, 'La transaction n’a pas abouti.')
          );
        }
      } catch {
        /* ignore */
      }
    };
    const start = setTimeout(() => {
      if (pollRef.current !== start) return;
      tick();
      pollRef.current = setInterval(tick, operatorKey === 'mobicash' ? 4000 : 3500);
    }, firstDelay);
    pollRef.current = start;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!bot?.id) {
      setPhase('failed');
      setMessage('Crée d’abord HexaroBot avant de payer.');
      return;
    }
    setBusy(true);
    setMessage('');
    stopPoll();
    try {
      const op = OPERATORS[operator];
      const res = await api.post('/api/payments', {
        operator_code: op.code,
        customer_msisdn: msisdn,
        bot_id: bot.id,
      });
      const ref = res.data?.payment?.reference || '';
      setReference(ref);
      setPhase('pending');
      setMessage(
        operator === 'mobicash'
          ? `Valide ${formatAmount(price)} FCFA sur ton téléphone MoBiCash (message / USSD). Ça peut prendre jusqu’à 1 minute.`
          : `Valide ${formatAmount(price)} FCFA sur ton téléphone ${op.label}.`
      );
      if (ref) startPoll(ref, operator);
    } catch (err) {
      setPhase('failed');
      setMessage(publicErrorMessage(err, 'Impossible d’initier le paiement.'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const trialActive = Boolean(sub?.is_trial) && !sub?.expired;
  const paidActive = Boolean(sub) && !sub.is_trial && !sub.expired;
  const locked = Boolean(sub?.expired) || bot?.status === 'suspended';
  const cannotDismiss = (forced || locked) && phase !== 'success';

  return (
    <div
      className="modal-overlay pay-overlay"
      onClick={() => phase !== 'pending' && !cannotDismiss && onClose?.()}
    >
      <div
        className="card pay-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pay-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pay-modal-head">
          <div className="pay-modal-brand">
            <img src="/logos/hexapay.png" alt="" width={36} height={36} />
            <div>
              <h3 id="pay-modal-title">Abonnement</h3>
              <p>2100 FCFA · 30 jours</p>
            </div>
          </div>
          {!cannotDismiss && (
          <button
            type="button"
            className="pay-close"
            onClick={onClose}
            disabled={phase === 'pending'}
            aria-label="Fermer"
          >
            <Icon name="close" size={18} />
          </button>
          )}
        </header>

        {exempt ? (
          <p className="pay-exempt">Ton compte est exempté. Aucun paiement n’est demandé.</p>
        ) : (
          <>
            <div className={`pay-status-card${locked ? ' is-locked' : trialActive ? ' is-trial' : ' is-ok'}`}>
              <div className="pay-status-top">
                <span className="pay-status-kicker">
                  {locked ? 'Accès en pause' : trialActive ? `Essai ${trialDays} jours` : 'Abonnement actif'}
                </span>
                <strong>{remainingLabel(sub)}</strong>
              </div>
              { (trialActive || paidActive) && (
                <div className="pay-progress" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, sub.progress || 0)}%` }} />
                </div>
              )}
              <p className="pay-status-copy">
                {locked
                  ? 'Rien n’est supprimé. Paie pour relancer HexaroBot.'
                  : trialActive
                    ? `Fin de l’essai le ${formatEndDate(sub.ends_at)}.`
                    : paidActive
                      ? `Valable jusqu’au ${formatEndDate(sub.ends_at)}.`
                      : 'Choisis un moyen de paiement pour continuer.'}
              </p>
            </div>

            {phase === 'success' ? (
              <div className="pay-feedback ok">
                <Icon name="check" size={22} />
                <div>
                  <strong>Paiement reçu</strong>
                  <p>{message}</p>
                </div>
                <button type="button" className="btn" onClick={onClose}>Fermer</button>
              </div>
            ) : phase === 'pending' ? (
              <div className="pay-feedback pending">
                <span className="pay-spinner" aria-hidden="true" />
                <div>
                  <strong>En attente de validation</strong>
                  <p>{message}</p>
                  {reference && <p className="pay-ref">Réf. {reference}</p>}
                </div>
              </div>
            ) : (
              <form className="pay-form" onSubmit={onSubmit}>
                <div className="pay-amount-row">
                  <span>Montant</span>
                  <strong>{formatAmount(price)} <small>FCFA</small></strong>
                </div>

                <fieldset className="pay-operators">
                  <legend>Payer avec</legend>
                  <div className="pay-operator-grid">
                    {Object.entries(OPERATORS).map(([key, op]) => (
                      <label key={key} className={`pay-operator${operator === key ? ' is-on' : ''}`}>
                        <input
                          type="radio"
                          name="operator"
                          value={key}
                          checked={operator === key}
                          onChange={() => {
                            setOperator(key);
                            setMsisdn('');
                          }}
                        />
                        <img src={op.logo} alt="" />
                        <span>{op.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="pay-label" htmlFor="pay-msisdn">Numéro Mobile Money</label>
                <input
                  id="pay-msisdn"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder={OPERATORS[operator].placeholder}
                  value={msisdn}
                  onChange={(e) => setMsisdn(e.target.value)}
                  required
                  disabled={busy}
                />
                <p className="pay-msisdn-hint">{OPERATORS[operator].hint}</p>

                {phase === 'failed' && message && (
                  <p className="pay-error" role="alert">{message}</p>
                )}

                <button className="btn pay-cta" type="submit" disabled={busy || !msisdn.trim()}>
                  {busy ? 'Envoi…' : `Payer ${formatAmount(price)} FCFA`}
                </button>
                <p className="pay-secure">
                  <Icon name="lock" size={13} /> Paiement sécurisé · montant non modifiable
                </p>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
