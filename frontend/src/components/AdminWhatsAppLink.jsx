import { Icon } from './Icons';
import { ADMIN_WHATSAPP_URL } from '../utils/botDisplay';

/** Bouton / lien WhatsApp pour contacter l’admin. */
export default function AdminWhatsAppLink({ className = '', label = 'Aide WhatsApp', compact = false }) {
  return (
    <a
      className={`btn secondary admin-wa-link ${className}`.trim()}
      href={ADMIN_WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Écrire à l’admin sur WhatsApp"
    >
      <Icon name="whatsapp" size={compact ? 18 : 16} className="admin-wa-icon" />
      {!compact && <span className="btn-label">{label}</span>}
    </a>
  );
}
