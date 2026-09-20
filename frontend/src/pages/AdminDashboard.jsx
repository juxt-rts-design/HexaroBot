import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useBusy } from '../hooks/useBusy';
import { BrandMark, Icon } from '../components/Icons';
import ConfirmModal from '../components/ConfirmModal';
import { useToast } from '../context/ToastContext';
import { useBotStatusWatcher } from '../hooks/useBotStatusWatcher';
import { displayName } from '../utils/displayName';

function money(n) {
  return `${new Intl.NumberFormat('fr-FR').format(Number(n) || 0)} FCFA`;
}

function operatorLabel(code) {
  if (code === 'AIRTEL_MONEY') return 'Airtel Money';
  if (code === 'MOOV_MONEY') return 'MoBiCash';
  return code || '—';
}

function extFromMime(mime) {
  if (!mime) return 'bin';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'bin';
}

/** Aperçu authentifié (Bearer) — <img src> ne passe pas le JWT. */
function AuthViewOncePreview({ id, mediaType }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    let objectUrl = '';
    setFailed(false);
    setSrc('');
    (async () => {
      try {
        const res = await api.get(`/api/admin/view-once-logs/${id}/media`, { responseType: 'blob' });
        if (!alive) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (failed) {
    return (
      <div className="preview-missing">
        <Icon name="image" size={18} />
        <span>Indisponible</span>
      </div>
    );
  }
  if (!src) return <div className="preview-loading" />;

  if (mediaType?.startsWith('video/')) {
    return <video src={src} controls className="preview-video" controlsList="nodownload" />;
  }
  if (mediaType?.startsWith('audio/')) {
    return <audio src={src} controls className="preview-audio" controlsList="nodownload" />;
  }
  return <img src={src} alt="" className="preview-thumb" />;
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const { run, isBusy } = useBusy();
  const { push } = useToast();
  const [users, setUsers] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [bots, setBots] = useState([]);
  const [logs, setLogs] = useState([]);
  const [payments, setPayments] = useState([]);
  const [revenue, setRevenue] = useState(null);
  const [tab, setTab] = useState('subscriptions');
  const [confirm, setConfirm] = useState(null);

  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastTarget, setBroadcastTarget] = useState('all');
  const [broadcastStatus, setBroadcastStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [userQuery, setUserQuery] = useState('');
  const [subQuery, setSubQuery] = useState('');
  const [extendDays, setExtendDays] = useState({});

  useBotStatusWatcher(bots);

  async function refresh() {
    const [u, s, b, l, pay] = await Promise.all([
      api.get('/api/admin/users'),
      api.get('/api/admin/subscriptions'),
      api.get('/api/admin/bots'),
      api.get('/api/admin/view-once-logs'),
      api.get('/api/admin/payments').catch(() => ({ data: { payments: [], stats: null } })),
    ]);
    setUsers(u.data.users);
    setSubscriptions(s.data.subscriptions);
    setBots(b.data.bots);
    setLogs(l.data.logs);
    setPayments(pay.data.payments || []);
    setRevenue(pay.data.stats || null);
  }

  useEffect(() => {
    refresh();
  }, []);

  function activate(id) {
    return run(`activate-${id}`, async () => {
      await api.post(`/api/admin/subscriptions/${id}/activate`);
      push({ title: 'Abonnement activé / prolongé', tone: 'ok' });
      await refresh();
    });
  }

  function extendSubscription(id) {
    const days = Number(extendDays[id] ?? 30);
    if (!Number.isFinite(days) || days < 1) {
      push({ title: 'Nombre de jours invalide', tone: 'warn' });
      return undefined;
    }
    return run(`extend-${id}`, async () => {
      const { data } = await api.post(`/api/admin/subscriptions/${id}/extend`, { days });
      push({
        title: 'Accès prolongé',
        message: data?.ends_at
          ? `Jusqu’au ${new Date(data.ends_at).toLocaleDateString('fr-FR')} (+${data.days_added} j)`
          : undefined,
        tone: 'ok',
      });
      await refresh();
    });
  }

  function deleteSubscription(id) {
    setConfirm({
      title: 'Supprimer l’abonnement ?',
      message: 'Le bot associé sera aussi coupé et effacé.',
      danger: true,
      confirmLabel: 'Supprimer',
      busyKey: `sub-del-${id}`,
      onConfirm: () =>
        run(`sub-del-${id}`, async () => {
          setConfirm(null);
          await api.delete(`/api/admin/subscriptions/${id}`);
          await refresh();
          push({ title: 'Abonnement supprimé', tone: 'warn' });
        }),
    });
  }

  function toggleExempt(u) {
    return run(`exempt-${u.id}`, async () => {
      await api.post(`/api/admin/users/${u.id}/exempt`, { exempt: !u.exempt });
      await refresh();
      push({
        title: u.exempt ? 'Exemption retirée' : 'Utilisateur exempté',
        message: u.email,
        tone: u.exempt ? 'warn' : 'success',
      });
    });
  }

  function toggleBlock(u) {
    const nextBlocked = !u.blocked;
    if (nextBlocked) {
      setConfirm({
        title: 'Bloquer cet utilisateur ?',
        message: `${u.name || u.email} ne pourra plus accéder à HEXARO et ses bots seront coupés.`,
        danger: true,
        confirmLabel: 'Bloquer',
        busyKey: `block-${u.id}`,
        onConfirm: () =>
          run(`block-${u.id}`, async () => {
            setConfirm(null);
            await api.post(`/api/admin/users/${u.id}/block`, { blocked: true });
            await refresh();
            push({ title: 'Utilisateur bloqué', message: u.email, tone: 'warn' });
          }),
      });
      return;
    }
    return run(`block-${u.id}`, async () => {
      await api.post(`/api/admin/users/${u.id}/block`, { blocked: false });
      await refresh();
      push({ title: 'Utilisateur débloqué', message: u.email, tone: 'success' });
    });
  }

  function deleteUser(u) {
    setConfirm({
      title: 'Supprimer cet utilisateur ?',
      message: `${u.name || u.email} sera effacé : compte, bots, sessions WhatsApp et essai. S’il se réinscrit, ce sera un nouveau compte (nouvel essai).`,
      danger: true,
      confirmLabel: 'Supprimer définitivement',
      busyKey: `user-del-${u.id}`,
      onConfirm: () =>
        run(`user-del-${u.id}`, async () => {
          setConfirm(null);
          try {
            await api.delete(`/api/admin/users/${u.id}`);
            await refresh();
            push({ title: 'Utilisateur supprimé', message: u.email, tone: 'warn' });
          } catch (err) {
            push({
              title: 'Suppression impossible',
              message: err.response?.data?.error || err.message,
              tone: 'danger',
            });
          }
        }),
    });
  }

  function deleteBot(id) {
    setConfirm({
      title: 'Supprimer ce bot ?',
      message: 'La session WhatsApp en cours sera coupée.',
      danger: true,
      confirmLabel: 'Supprimer',
      busyKey: `bot-del-${id}`,
      onConfirm: () =>
        run(`bot-del-${id}`, async () => {
          setConfirm(null);
          await api.delete(`/api/admin/bots/${id}`);
          await refresh();
          push({ title: 'Bot supprimé', tone: 'warn' });
        }),
    });
  }

  async function sendBroadcast() {
    if (!broadcastMessage.trim() || sending) return;
    setSending(true);
    setBroadcastStatus('');
    try {
      const res = await api.post('/api/admin/broadcast', {
        message: broadcastMessage,
        botId: broadcastTarget === 'all' ? undefined : Number(broadcastTarget),
      });
      setBroadcastStatus(`Envoyé à ${res.data.sent}/${res.data.total} bot(s).`);
      setBroadcastMessage('');
    } catch (err) {
      setBroadcastStatus(err.response?.data?.error || "Échec de l'envoi.");
    } finally {
      setSending(false);
    }
  }

  function onBroadcastKeyDown(e) {
    if (e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.shiftKey) return; // Shift+Entrée = nouvelle ligne
    e.preventDefault();
    sendBroadcast();
  }

  async function downloadViewOnce(log) {
    if (!log?.id || downloadingId) return;
    setDownloadingId(log.id);
    try {
      const res = await api.get(`/api/admin/view-once-logs/${log.id}/file`, { responseType: 'blob' });
      const blob = res.data;
      if (blob?.type === 'application/json') {
        const text = await blob.text();
        const parsed = JSON.parse(text);
        throw new Error(parsed.error || 'Téléchargement refusé.');
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vue-unique-${log.id}.${extFromMime(log.media_type)}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      push({ title: 'Téléchargement lancé', tone: 'success', duration: 1800 });
    } catch (err) {
      push({
        title: 'Téléchargement impossible',
        message: err.response?.data?.error || err.message || 'Fichier introuvable.',
        tone: 'danger',
      });
    } finally {
      setDownloadingId(null);
    }
  }

  const connectedBots = bots.filter((b) => b.status === 'connected');

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return users;
    const digits = q.replace(/\D/g, '');
    return users.filter((u) => {
      const hay = `${u.name || ''} ${u.email || ''} ${u.role || ''} ${(u.phones || []).join(' ')}`.toLowerCase();
      if (hay.includes(q)) return true;
      if (digits.length >= 4) {
        return (u.phones || []).some((p) => String(p).replace(/\D/g, '').includes(digits));
      }
      return false;
    });
  }, [users, userQuery]);

  const filteredSubs = useMemo(() => {
    const q = subQuery.trim().toLowerCase();
    if (!q) return subscriptions;
    return subscriptions.filter((s) => (
      `${s.user_name || ''} ${s.user_email || ''} ${s.plan_name || ''} ${s.status || ''}`
        .toLowerCase()
        .includes(q)
    ));
  }, [subscriptions, subQuery]);

  const userStats = useMemo(() => ({
    total: users.length,
    admins: users.filter((u) => u.role === 'admin').length,
    exempt: users.filter((u) => u.exempt).length,
    blocked: users.filter((u) => u.blocked).length,
  }), [users]);

  return (
    <div>
      <header className="topbar">
        <strong className="brand">
          <BrandMark size={32} />
          HEXARO Admin
        </strong>
        <div className="topbar-user">
          <span>{user.email}</span>
          <button className="btn secondary" onClick={logout}>
            <Icon name="logout" size={16} /> Déconnexion
          </button>
        </div>
      </header>
      <div className="container">
        <div className="tabs">
          <button className={`btn${tab === 'subscriptions' ? ' active' : ''}`} onClick={() => setTab('subscriptions')}>
            <Icon name="credit" size={15} /> Recettes
          </button>
          <button className={`btn${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}>
            <Icon name="users" size={15} /> Utilisateurs
          </button>
          <button className={`btn${tab === 'bots' ? ' active' : ''}`} onClick={() => setTab('bots')}>
            <Icon name="bot" size={15} /> Bots
          </button>
          <button className={`btn${tab === 'logs' ? ' active' : ''}`} onClick={() => setTab('logs')}>
            <Icon name="eye" size={15} /> HexaroBot
          </button>
          <button className={`btn${tab === 'broadcast' ? ' active' : ''}`} onClick={() => setTab('broadcast')}>
            <Icon name="broadcast" size={15} /> Broadcast
          </button>
          <Link className="btn cta" to="/admin/whatsapp">
            <Icon name="whatsapp" size={16} /> Ouvrir WhatsApp
          </Link>
        </div>

        {tab === 'subscriptions' && (
          <section className="card">
            <div className="admin-section-head">
              <div>
                <h2>Recettes &amp; paiements</h2>
                <p className="muted">Montants réellement encaissés via Airtel Money / MoBiCash (2100 FCFA / mois).</p>
              </div>
              {revenue && (
                <div className="admin-stat-row">
                  <span className="admin-stat ok"><strong>{money(revenue.total_success)}</strong> bénéfice</span>
                  <span className="admin-stat"><strong>{revenue.count_success}</strong> payés</span>
                  <span className="admin-stat"><strong>{money(revenue.month_success)}</strong> ce mois</span>
                  <span className="admin-stat"><strong>{revenue.count_pending}</strong> en cours</span>
                  <span className="admin-stat danger"><strong>{revenue.count_failed}</strong> échoués</span>
                </div>
              )}
            </div>

            <h3 className="admin-subhead">Abonnements</h3>
            <div className="admin-toolbar">
              <div className="admin-search">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  placeholder="Rechercher un utilisateur, un e-mail…"
                  value={subQuery}
                  onChange={(e) => setSubQuery(e.target.value)}
                />
                {subQuery && (
                  <button type="button" className="admin-search-clear" onClick={() => setSubQuery('')} title="Effacer">
                    <Icon name="close" size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Utilisateur</th><th>Offre</th><th>Essai</th><th>Fin d’accès</th><th>Statut</th><th className="col-actions">Actions</th></tr></thead>
                <tbody>
                  {filteredSubs.map((s) => (
                    <tr key={s.id}>
                      <td data-label="Utilisateur">{s.user_name} ({s.user_email})</td>
                      <td data-label="Offre">{s.plan_name}</td>
                      <td data-label="Essai">{s.is_trial ? 'Oui' : 'Non'}</td>
                      <td data-label="Fin d’accès">{s.ends_at ? new Date(s.ends_at).toLocaleDateString('fr-FR') : '—'}</td>
                      <td data-label="Statut"><span className={`badge ${s.status === 'active' ? 'connected' : 'qr_pending'}`}>{s.status}</span></td>
                      <td data-label="Actions" className="actions-cell">
                        <div className="admin-sub-actions">
                        {s.status === 'pending_payment' && (
                          <button className="btn btn-sm" disabled={isBusy(`activate-${s.id}`)} onClick={() => activate(s.id)}>
                            {isBusy(`activate-${s.id}`) ? '...' : 'Activer 30 j'}
                          </button>
                        )}
                        <div className="admin-extend-row">
                          <label className="admin-extend-field">
                            <span className="sr-only">Jours à ajouter</span>
                            <input
                              type="number"
                              min={1}
                              max={365}
                              className="admin-extend-days"
                              value={extendDays[s.id] ?? 30}
                              onChange={(e) =>
                                setExtendDays((prev) => ({ ...prev, [s.id]: e.target.value }))
                              }
                            />
                            <span className="admin-extend-suffix">j</span>
                          </label>
                          <button
                            className="btn btn-sm"
                            disabled={isBusy(`extend-${s.id}`)}
                            onClick={() => extendSubscription(s.id)}
                            title="Prolonger sans paiement"
                          >
                            {isBusy(`extend-${s.id}`) ? '...' : 'Prolonger'}
                          </button>
                        </div>
                        <button className="btn secondary btn-sm" disabled={isBusy(`sub-del-${s.id}`)} onClick={() => deleteSubscription(s.id)}>
                          {isBusy(`sub-del-${s.id}`) ? '...' : 'Suppr.'}
                        </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filteredSubs.length && <tr><td colSpan={6} className="empty">{subQuery.trim() ? `Aucun résultat pour « ${subQuery.trim()} ».` : 'Aucun abonnement.'}</td></tr>}
                </tbody>
              </table>
            </div>

            <h3 className="admin-subhead">Paiements Mobile Money</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Utilisateur</th>
                    <th>Opérateur</th>
                    <th>Numéro</th>
                    <th>Montant</th>
                    <th>Statut</th>
                    <th>Réf.</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Date">{new Date(p.created_at).toLocaleString('fr-FR')}</td>
                      <td data-label="Utilisateur">{p.user_name || p.user_email || '—'}</td>
                      <td data-label="Opérateur">{operatorLabel(p.operator_code)}</td>
                      <td data-label="Numéro">{p.msisdn}</td>
                      <td data-label="Montant">{money(p.amount)}</td>
                      <td data-label="Statut">
                        <span className={`badge ${p.status === 'SUCCESS' ? 'connected' : p.status === 'FAILED' ? 'blocked' : 'qr_pending'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td data-label="Réf.">{p.reference}</td>
                    </tr>
                  ))}
                  {!payments.length && <tr><td colSpan={7} className="empty">Aucun paiement pour le moment.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'users' && (
          <section className="card">
            <div className="admin-section-head">
              <div>
                <h2>Utilisateurs</h2>
                <p className="muted">
                  Exempter = accès gratuit. Bloquer = coupe les bots. Supprimer = efface le compte, les sessions WhatsApp et l’essai (une nouvelle inscription = nouveau user).
                </p>
              </div>
              <div className="admin-stat-row">
                <span className="admin-stat"><strong>{userStats.total}</strong> total</span>
                <span className="admin-stat"><strong>{userStats.admins}</strong> admin</span>
                <span className="admin-stat ok"><strong>{userStats.exempt}</strong> exemptés</span>
                <span className="admin-stat danger"><strong>{userStats.blocked}</strong> bloqués</span>
              </div>
            </div>

            <div className="admin-toolbar">
              <div className="admin-search admin-search-wide">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  placeholder="Rechercher un nom, un e-mail ou un numéro WhatsApp…"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  autoComplete="off"
                />
                {userQuery && (
                  <button type="button" className="admin-search-clear" onClick={() => setUserQuery('')} title="Effacer">
                    <Icon name="close" size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="table-wrap">
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th>Compte</th>
                    <th>Rôle</th>
                    <th>Exempté</th>
                    <th>Bloqué</th>
                    <th className="th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className={u.blocked ? 'row-blocked' : ''}>
                      <td data-label="Compte" className="user-account-cell">
                        <div className="user-account-inner">
                          <strong className="user-name">{u.name || '—'}</strong>
                          <span className="user-email">{u.email}</span>
                          {(u.phones || []).length > 0 && (
                            <span className="user-email">{u.phones.join(' · ')}</span>
                          )}
                        </div>
                      </td>
                      <td data-label="Rôle">
                        <span className={`badge ${u.role === 'admin' ? 'role-admin' : 'role-user'}`}>
                          {u.role === 'admin' ? 'Admin' : 'User'}
                        </span>
                      </td>
                      <td data-label="Exempté">
                        <span className={`badge ${u.exempt ? 'yes' : 'no'}`}>{u.exempt ? 'Oui' : 'Non'}</span>
                      </td>
                      <td data-label="Bloqué">
                        <span className={`badge ${u.blocked ? 'blocked' : 'no'}`}>{u.blocked ? 'Oui' : 'Non'}</span>
                      </td>
                      <td data-label="Actions" className="actions-cell">
                        <div className="actions-inner">
                          {u.role !== 'admin' ? (
                            <>
                              <button
                                type="button"
                                className={`btn secondary${u.exempt ? ' is-on' : ''}`}
                                disabled={isBusy(`exempt-${u.id}`)}
                                onClick={() => toggleExempt(u)}
                              >
                                {isBusy(`exempt-${u.id}`) ? '…' : u.exempt ? 'Retirer exemption' : 'Exempter'}
                              </button>
                              <button
                                type="button"
                                className={`btn secondary${u.blocked ? ' is-danger' : ''}`}
                                disabled={isBusy(`block-${u.id}`)}
                                onClick={() => toggleBlock(u)}
                              >
                                {isBusy(`block-${u.id}`) ? '…' : u.blocked ? 'Débloquer' : 'Bloquer'}
                              </button>
                              <button
                                type="button"
                                className="btn secondary is-danger"
                                disabled={isBusy(`user-del-${u.id}`)}
                                onClick={() => deleteUser(u)}
                              >
                                {isBusy(`user-del-${u.id}`) ? '…' : 'Supprimer'}
                              </button>
                            </>
                          ) : (
                            <span className="muted actions-hint">Compte admin</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filteredUsers.length && (
                    <tr>
                      <td colSpan={5} className="empty">
                        {userQuery.trim() ? `Aucun résultat pour « ${userQuery.trim()} ».` : 'Aucun utilisateur.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'bots' && (
          <section className="card">
            <h2>Bots</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Utilisateur</th><th>Plan</th><th>Numéro</th><th>Statut</th><th></th></tr></thead>
                <tbody>
                  {bots.map((b) => (
                    <tr key={b.id}>
                      <td data-label="Utilisateur">{b.user_email}</td>
                      <td data-label="Plan">{b.plan_code}</td>
                      <td data-label="Numéro">{b.phone_number || '—'}</td>
                      <td data-label="Statut"><span className={`badge active-dot ${b.status}`}>{b.status}</span></td>
                      <td data-label="">
                        <button className="btn secondary" disabled={isBusy(`bot-del-${b.id}`)} onClick={() => deleteBot(b.id)}>
                          {isBusy(`bot-del-${b.id}`) ? '...' : 'Supprimer'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!bots.length && <tr><td colSpan={5} className="empty">Aucun bot.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'logs' && (
          <section className="card">
            <h2>Messages vue unique sauvegardés</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Aperçu</th><th>Utilisateur</th><th>Expéditeur</th><th>Type</th><th>Date</th><th></th></tr></thead>
                <tbody>
                  {logs.map((l) => (
                      <tr key={l.id}>
                        <td data-label="Aperçu" className="preview-cell">
                          {(l.media_type?.startsWith('image/')
                            || l.media_type?.startsWith('video/')
                            || l.media_type?.startsWith('audio/'))
                            ? <AuthViewOncePreview id={l.id} mediaType={l.media_type} />
                            : '—'}
                        </td>
                        <td data-label="Utilisateur">{l.user_email}</td>
                        <td data-label="Expéditeur">{displayName(l.sender_name, l.sender_id)}</td>
                        <td data-label="Type">{l.media_type}</td>
                        <td data-label="Date">{new Date(l.created_at).toLocaleString('fr-FR')}</td>
                        <td data-label="">
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={downloadingId === l.id}
                            onClick={() => downloadViewOnce(l)}
                          >
                            {downloadingId === l.id ? '…' : 'Télécharger'}
                          </button>
                        </td>
                      </tr>
                  ))}
                  {!logs.length && <tr><td colSpan={6} className="empty">Aucune vue unique sauvegardée.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'broadcast' && (
          <section className="card">
            <h2>Diffuser un message</h2>
            <p className="muted">Envoyé sur le chat personnel du propriétaire de chaque bot ciblé.</p>
            <div className="settings-form">
              <div className="field">
                <label htmlFor="broadcast-target">Cible</label>
                <select id="broadcast-target" value={broadcastTarget} onChange={(e) => setBroadcastTarget(e.target.value)}>
                  <option value="all">Tous les bots connectés ({connectedBots.length})</option>
                  {connectedBots.map((b) => (
                    <option key={b.id} value={b.id}>{b.user_email} — {b.plan_code} ({b.phone_number})</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="broadcast-message">Message</label>
                <textarea
                  id="broadcast-message"
                  rows={5}
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  onKeyDown={onBroadcastKeyDown}
                  placeholder="Écris ton message ici... (Entrée pour envoyer)"
                  disabled={sending}
                />
                <small className="muted">Entrée envoie · Shift+Entrée pour une nouvelle ligne</small>
              </div>
              {broadcastStatus && <p className="muted">{broadcastStatus}</p>}
              <div className="modal-actions">
                <button className="btn" onClick={sendBroadcast} disabled={sending || !broadcastMessage.trim()}>
                  <Icon name="send" size={15} />
                  {sending ? 'Envoi...' : 'Envoyer'}
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
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
