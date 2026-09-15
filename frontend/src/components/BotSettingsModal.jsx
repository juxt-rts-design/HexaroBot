import { useEffect, useState } from 'react';
import api from '../api/client';

export default function BotSettingsModal({ bot, onClose }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/api/bots/${bot.id}/settings`).then((res) => setSettings(res.data.settings));
  }, [bot.id]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/api/bots/${bot.id}/settings`, settings);
      setSettings(res.data.settings);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Échec de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  }

  const isVueUnique = bot.plan_code === 'vue_unique';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Paramètres — {bot.label}</h3>

        {!settings ? (
          <p>Chargement...</p>
        ) : isVueUnique ? (
          <div className="settings-form">
            <p className="muted">
              Sans ouvrir la vue unique : appui long → Répondre, envoie n&apos;importe quel texte.
              Le média arrive en privé.
            </p>
            <div className="modal-actions">
              <button className="btn secondary" onClick={onClose}>Fermer</button>
            </div>
          </div>
        ) : (
          <div className="settings-form">
            <div className="field field-row">
              <label htmlFor="reactions_enabled">Réactions emoji automatiques</label>
              <input
                id="reactions_enabled"
                type="checkbox"
                checked={!!settings.reactions_enabled}
                onChange={(e) => setSettings({ ...settings, reactions_enabled: e.target.checked })}
              />
            </div>

            {error && <p className="error-text">{error}</p>}

            <div className="modal-actions">
              <button className="btn secondary" onClick={onClose}>Annuler</button>
              <button className="btn" onClick={save} disabled={saving}>{saving ? 'Sauvegarde...' : 'Enregistrer'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
