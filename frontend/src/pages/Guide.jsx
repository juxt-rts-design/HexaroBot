import { Link } from 'react-router-dom';
import { BrandMark, Icon } from '../components/Icons';
import AdminWhatsAppLink from '../components/AdminWhatsAppLink';
import { ADMIN_WHATSAPP_URL } from '../utils/botDisplay';

export default function Guide() {
  return (
    <div className="user-shell">
      <header className="topbar">
        <strong className="brand">
          <BrandMark size={32} />
          <span className="brand-text">Guide HEXARO</span>
        </strong>
        <div className="topbar-user">
          <Link className="btn secondary topbar-btn" to="/dashboard" title="Retour">
            <Icon name="back" size={16} />
            <span className="btn-label">Retour</span>
          </Link>
          <AdminWhatsAppLink className="topbar-btn" label="Aide" />
        </div>
      </header>

      <div className="container guide">
        <section className="card">
          <h2>Bienvenue</h2>
          <p>
            Ce guide explique <strong>ce que ton bot fait</strong> une fois branché à WhatsApp.
            Lis tranquillement. Pas besoin de connaître l’informatique.
          </p>
        </section>

        <section className="card">
          <h2>Essai &amp; paiement</h2>
          <ul>
            <li><strong>3 jours d’essai</strong> dès la création du bot.</li>
            <li>Ensuite : <strong>2 100 FCFA / mois</strong> (montant fixe).</li>
            <li>Paiement via <strong>Airtel Money</strong> ou <strong>MoBiCash</strong> : bouton <Link to="/dashboard?pay=1">Abonnement</Link> sur le dashboard.</li>
            <li>
              Si tu ne paies pas à temps, le bot est <strong>mis en pause</strong> (pas supprimé).
              Après paiement, il repart. Tu vois le temps d’essai restant dans la fenêtre Abonnement.
            </li>
            <li>Tu reçois un message WhatsApp privé quand il reste <strong>moins de 24 h</strong>, avec le lien de paiement. Sans paiement, le bot se met en pause tout seul.</li>
          </ul>
        </section>

        <section className="card">
          <h2>1. Brancher ton bot (une seule fois)</h2>
          <ol>
            <li>Sur le site, clique sur <strong>Créer un bot</strong>.</li>
            <li>Un grand code (carré noir et blanc) apparaît.</li>
            <li>
              <strong>Option A — scanner le QR</strong> (idéal si tu as un PC ou un 2ᵉ téléphone) :
              WhatsApp → <strong>Paramètres</strong> → <strong>Appareils liés</strong> → <strong>Lier un appareil</strong> → scanne.
            </li>
            <li>
              <strong>Option B — code par numéro</strong> (idéal avec un seul téléphone) :
              sous le QR, entre ton numéro avec l’indicatif (ex. <code>24165255707</code>),
              clique sur <strong>Obtenir le code</strong>, puis sur ton téléphone :
              Appareils liés → Lier un appareil → <strong>Connecter avec un numéro de téléphone</strong>
              et tape le code affiché (ex. <code>ABCD-EFGH</code>).
            </li>
          </ol>
          <p>
            Quand c’est bon, ton bot affiche <span className="badge connected">connected</span>.
            Il travaille alors avec ton WhatsApp.
          </p>
        </section>

        <section className="card">
          <h2>2. Photo ou vidéo « vue une seule fois »</h2>
          <p>
            Sur WhatsApp, parfois quelqu’un t’envoie une photo ou une vidéo
            qui disparaît après l’avoir ouverte.
          </p>
          <p><strong>Bonne nouvelle :</strong> tu n’es pas obligé de l’ouvrir.</p>
          <ol>
            <li>Appuie longtemps sur ce message.</li>
            <li>Choisis <strong>Répondre</strong>.</li>
            <li>Écris n’importe quoi (même un point : <code>.</code>) et envoie.</li>
          </ol>
          <p>
            Le bot te renvoie la photo ou la vidéo <strong>dans ton chat avec toi-même</strong>
            (Messages à toi-même / ton propre numéro).
          </p>
        </section>

        <section className="card">
          <h2>3. Message effacé par quelqu’un</h2>
          <p>
            Si une personne t’écrit, puis <strong>supprime</strong> le message
            (texte, photo, vidéo ou vocal) :
          </p>
          <p>
            Le bot te le renvoie en privé, avec le <strong>nom</strong> de la personne
            et le type : photo, vidéo, audio ou message.
          </p>
          <p className="muted">
            Important : ton bot doit déjà être connecté quand le message arrive.
            S’il n’était pas branché, il ne peut pas le retrouver.
          </p>
        </section>

        <section className="card">
          <h2>4. Photo de profil de quelqu’un</h2>
          <p>Tu veux voir la photo de profil d’une personne ?</p>
          <ol>
            <li>Ouvre la discussion avec cette personne (ou réponds à un de ses messages).</li>
            <li>Écris une phrase avec le mot <strong>profil</strong> ou <strong>profile</strong>.</li>
          </ol>
          <p>Exemple : <code>montre le profil</code></p>
          <p>Le bot t’envoie la photo <strong>en privé</strong>.</p>
        </section>

        <section className="card">
          <h2>5. Télécharger une vidéo depuis un lien</h2>
          <p>
            Si quelqu’un (ou toi) envoie un lien TikTok, Instagram, YouTube, Facebook…
          </p>
          <p>
            Le bot écrit « Téléchargement en cours... », puis t’envoie la vidéo
            dans la même discussion.
          </p>
          <p>
            Si ça ne marche pas, tu verras :
            « Impossible d&apos;obtenir le média à partir de la ressource. »
          </p>
        </section>

        <section className="card">
          <h2>6. Faire un sticker</h2>
          <ol>
            <li>Quelqu’un t’envoie une photo ou une petite vidéo.</li>
            <li>Réponds à ce message avec : <code>-sticker</code></li>
          </ol>
          <p>Le bot te renvoie un sticker WhatsApp.</p>
        </section>

        <section className="card">
          <h2>7. Les statuts WhatsApp</h2>
          <p>
            Le bot ne prend <strong>pas</strong> tous les statuts tout seul.
          </p>
          <p><strong>Pour récupérer un statut :</strong></p>
          <ol>
            <li>Ouvre le statut de la personne.</li>
            <li>Mets un cœur ❤️ <strong>ou</strong> réponds au statut (même un point <code>.</code>).</li>
          </ol>
          <p>
            Le bot t’envoie alors le statut <strong>en privé</strong>
            (« Status récupéré avec succès »).
          </p>
          <p className="muted">
            Astuce : si le cœur seul ne marche pas, réponds au statut avec un point — ça marche à tous les coups.
          </p>
        </section>

        <section className="card">
          <h2>8. Arrêter ou reconnecter</h2>
          <ul>
            <li><strong>Déconnecter</strong> : coupe le bot. WhatsApp n’est plus lié.</li>
            <li><strong>Connecter</strong> : affiche un nouveau code à scanner pour le relier.</li>
          </ul>
        </section>

        <section className="card">
          <h2>En résumé</h2>
          <p>
            Une fois ton bot connecté, il t’aide à garder les vues uniques, récupérer les messages
            effacés, voir un profil, télécharger des vidéos, faire des stickers et récupérer un statut
            (like / réponse). Essai 3 jours, puis 2 100 FCFA/mois.
          </p>
        </section>

        <section className="card">
          <h2>Besoin d’aide ?</h2>
          <p>Si quelque chose ne marche pas, écris à l’admin sur WhatsApp.</p>
          <p>
            <a
              className="btn admin-wa-cta"
              href={ADMIN_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="whatsapp" size={22} className="admin-wa-icon" />
              Contacter l’admin sur WhatsApp
            </a>
          </p>
          <p className="muted">On t’aidera volontiers.</p>
        </section>
      </div>
    </div>
  );
}
