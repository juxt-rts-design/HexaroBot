# HEXARO — plateforme de chatbots WhatsApp

Pour l'architecture et le fonctionnement interne, voir `DOCUMENTATION.md`.

## Stack
- Backend : Express + MySQL (`mysql2`) + Baileys (plan vue_unique) + whatsapp-web.js (plans compagnon/auto_reply, désactivés par défaut) + Socket.IO (port **5010**)
- Frontend : React + Vite (port **5011**)
- Auth : Google Sign-In pour les utilisateurs (`/`) et pour l'admin sur une route cachée (`/portail-9f3a2e`, réservée à `ADMIN_EMAIL`)
- Base de données : `aquila_saas` (à créer localement, voir ci-dessous)

## Plans (créés en base, sans moyen de paiement pour l'instant)
| Plan | Semaine | Mois | Fonction | Actif par défaut |
|---|---|---|---|---|
| `vue_unique` | 500F | 2000F | Détecte les vues uniques, notifie le propriétaire, capture via un mot-clé configurable | Oui |
| `compagnon` | 1500F | 5000F | Discussion façon "vraie personne" (Cohere + stickers wit.ai, porté de aquila V7) | Non |
| `auto_reply` | 500F | 2000F | Auto-répondeur basique par mots-clés | Non |

Pas de moyen de paiement en ligne : un utilisateur normal crée un chatbot gratuit (limité à 1) ; l'admin peut aussi exempter un compte (accès illimité à tous les plans, mais ses vues uniques ne sont jamais sauvegardées).

## Installation locale (première fois)

1. Crée une base MySQL locale (le schéma est dans `database_schema.sql` à la racine, ou `backend/src/db/schema.sql`) et renseigne `backend/.env` (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`).
2. Installe les dépendances et applique le schéma :
   ```bash
   cd backend && npm install && npm run migrate
   cd ../frontend && npm install
   ```

## Clés à fournir
1. **Google OAuth** — Client ID dans `backend/.env` (`GOOGLE_CLIENT_ID`) et `frontend/.env` (`VITE_GOOGLE_CLIENT_ID`, même valeur).
2. `backend/.env` → `ADMIN_EMAIL` : l'email Google qui a accès à l'espace admin caché.
3. **Cohere** (plan compagnon) — clé sur https://dashboard.cohere.com/api-keys → `backend/.env COHERE_API_KEY`.
4. **wit.ai** (stickers d'ambiance, plan compagnon) → `backend/.env WITAI_API_KEY`.

## Lancer en développement

```bash
cd backend && npm run dev     # http://localhost:5010
cd frontend && npm run dev    # http://localhost:5011
```

## Interface admin
- Dashboard : `/portail-9f3a2e`
- Interface "WhatsApp" (conversations en direct par session) : `/portail-9f3a2e/whatsapp`

## Déploiement (à valider avant exécution — touche l'Apache partagé du VPS)

```bash
cd frontend && npm run build
pm2 start ecosystem.config.js
pm2 save
```

Puis activer les vhosts Apache (fichiers déjà préparés dans `deploy/apache/`) :

```bash
cp deploy/apache/aquila-backend.conf /etc/apache2/sites-available/
cp deploy/apache/aquila-bot.conf /etc/apache2/sites-available/
a2ensite aquila-backend aquila-bot
systemctl reload apache2
certbot --apache -d aquila-backend.duckdns.org -d aquila-bot.duckdns.org
```

L'API doit être servie sur le **même domaine** que le site (`/api`, `/socket.io` proxiés depuis le vhost du frontend) — sinon le cookie de session ne passe pas sur certains navigateurs mobiles. Voir `DOCUMENTATION.md` §1.

## Limites connues (MVP)
- Pas de moyen de paiement : activation manuelle par l'admin (ou exemption).
- Le plan "gestion de groupes WhatsApp" n'est pas encore inclus.
- "Répondre à votre place quand vous n'êtes pas en ligne" ne détecte pas réellement le statut en ligne : c'est un auto-répondeur actif en continu.
- La vue unique ne peut pas être capturée automatiquement (restriction WhatsApp, voir `DOCUMENTATION.md` §5) : le propriétaire doit répondre au message cité avec le mot-clé configuré après l'avoir ouvert normalement.
- Chaque média de conversation (image/vidéo/audio) est stocké sur le serveur sans purge automatique — à surveiller si le volume grossit.
# HexaroBot
