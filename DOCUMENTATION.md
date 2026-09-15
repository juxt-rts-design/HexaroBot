# Documentation technique — HEXARO

Ce document explique **comment le projet fonctionne en interne** — architecture, choix techniques, et pourquoi certaines choses sont faites d'une manière précise. Pour l'installation, voir `README.md`.

## 1. Vue d'ensemble

```
Navigateur ──HTTPS──▶ Apache (reverse proxy)
                         ├─ /              → frontend (React/Vite, port 5011)
                         └─ /api, /socket.io → backend (Express, port 5010)

Backend ──MySQL (aquila_saas)
Backend ──Baileys / whatsapp-web.js──▶ WhatsApp (un socket par bot connecté)
```

Point important : le frontend et l'API sont servis sur le **même nom de domaine** (Apache route `/api` et `/socket.io` vers le backend). C'est volontaire : si l'API était sur un sous-domaine différent, le cookie de session serait "cross-site" et bloqué par défaut sur beaucoup de navigateurs mobiles (Safari iOS notamment). Voir `deploy/apache/`.

## 2. Base de données (`backend/src/db/schema.sql`)

| Table | Rôle |
|---|---|
| `users` | Comptes Google (id, email, rôle `user`/`admin`, `exempt`, `blocked`) |
| `plans` | Catalogue des offres (code, prix semaine/mois, `active`) |
| `subscriptions` | Un abonnement = un user + un plan + une période. `amount=0` pour les comptes exemptés/gratuits |
| `bots` | Une session WhatsApp = une ligne. `session_key` sert de dossier d'authentification, `settings` (JSON) stocke la config par bot (mot-clé, emojis...) |
| `view_once_logs` | Vues uniques capturées (fichier + métadonnées) — jamais rempli pour un compte exempté |
| `messages_log` | Historique de conversation (texte + médias) pour l'interface "WhatsApp" admin — rempli pour **tout le monde**, y compris les comptes exemptés (seule la vue unique reste privée pour eux) |

Pas de moyen de paiement branché : `subscriptions.status` passe à `active` soit manuellement par l'admin (`POST /api/admin/subscriptions/:id/activate`), soit automatiquement pour un compte exempté (`POST /api/admin/users/:id/exempt`, voir `admin.controller.js`).

## 3. Backend — structure

```
backend/src/
  server.js                 point d'entrée : Express + Socket.IO + middlewares de sécurité
  config/db.js               pool mysql2
  middleware/auth.js          requireAuth (vérifie aussi `blocked` en base à chaque requête) / requireAdmin
  controllers/, routes/       un fichier par ressource (auth, catalog, bots, admin)
  services/
    botManager.js             moteur whatsapp-web.js (plans compagnon/auto_reply — désactivés par défaut)
    baileysManager.js         moteur Baileys (plan vue_unique) — reconnexion auto, heartbeat, capture, envoi
    botSettings.js            lecture/écriture de bots.settings (JSON) avec cache mémoire
    messageLog.js             écriture dans messages_log (+ diffusion Socket.IO)
    persona/
      viewOnceBaileys.js      logique du plan vue_unique (voir §5)
      companion.js, autoReply.js   personas whatsapp-web.js (désactivés)
    stickerConverter.js, audioTranscoder.js   conversions ffmpeg (stickers, notes vocales)
```

## 4. Deux moteurs WhatsApp — pourquoi

- **whatsapp-web.js** pilote un vrai Chromium headless (une instance par bot connecté). Simple à utiliser, mais lourd en RAM/CPU par session, et surtout : **respecte les restrictions de l'interface WhatsApp Web**, ce qui bloque la capture des vues uniques (voir §5).
- **Baileys** parle directement au protocole WhatsApp (pas de navigateur). Beaucoup plus léger, et donne accès au contenu brut des messages — nécessaire pour tout ce qui touche à la capture avancée.

Le plan `vue_unique` (seul actif par défaut) tourne donc sur Baileys. Les plans `compagnon`/`auto_reply` (whatsapp-web.js) sont désactivés (`plans.active = 0`) mais le code reste dans le projet.

## 5. Le plan "vue unique" — la vraie difficulté

**WhatsApp ne transmet jamais le contenu d'un message vue-unique à un appareil lié** (confirmé empiriquement : la clé du message arrive avec `isViewOnce:true` mais `message` est vide). C'est une restriction volontaire de WhatsApp pour empêcher exactement ce genre de capture automatique — ni whatsapp-web.js, ni Baileys, ni aucune bibliothèque ne peut contourner ça côté réception directe.

La seule méthode fiable (utilisée aussi par le bot de référence aquila V7 avec sa commande `.dac`) : **citer le message après l'avoir vu**. Quand un humain cite un message dans WhatsApp, son client intègre le contenu déjà déchiffré directement dans la citation — le bot peut alors l'extraire.

Flux implémenté (`persona/viewOnceBaileys.js`) :
1. Une vue unique arrive → le bot détecte la coquille vide (`key.isViewOnce`) et envoie une notification **privée** au propriétaire (jamais dans la conversation d'origine) : heure, nom de l'expéditeur, lien `wa.me` vers la conversation.
2. Le propriétaire ouvre la vue unique normalement dans WhatsApp (comme d'habitude).
3. Il répond à ce message, **en le citant**, avec le mot-clé configuré (par défaut `wait`, modifiable par bot dans les Paramètres).
4. Le bot extrait le contenu de la citation, le transfère vers le propre compte du propriétaire, et le sauvegarde (sauf compte exempté).

Le mot-clé ne fonctionne que si c'est le **propriétaire du bot lui-même** qui répond (`msg.key.fromMe === true`) — l'expéditeur d'origine ne peut jamais déclencher la capture.

## 6. Confidentialité et comptes exemptés

Un utilisateur **exempté** (`users.exempt = 1`, activé par l'admin dans l'onglet "Utilisateurs") a un accès gratuit et illimité à tous les plans. En échange, une partie de son activité reste privée et invisible pour l'admin — mais **pas toute son activité**, et cette règle a changé une fois. Détail complet pour éviter toute ambiguïté :

**Ce qui reste privé pour un compte exempté (aujourd'hui, et depuis la création de la fonctionnalité) :**
- Ses vues uniques ne sont **jamais** enregistrées ni sauvegardées côté serveur (`view_once_logs` reste vide pour lui) — voir `isBotOwnerExempt()` dans `services/persona/viewOnceBaileys.js`. Le transfert vers son propre compte fonctionne quand même, seule la copie serveur/admin est sautée.

**Ce qui est visible pour un compte exempté (depuis le 2026-09-14, voir historique) :**
- Ses conversations normales (texte, images, vidéos, audio) sont journalisées dans `messages_log` et visibles par l'admin dans l'interface "WhatsApp", **exactement comme pour un utilisateur payant**.

### Historique de cette règle

- **2026-09-08** — Création de la fonctionnalité "compte exempté" : accès gratuit illimité + vues uniques jamais enregistrées. À cette date, la vue unique était la seule donnée personnelle stockée par la plateforme, donc "exempté" voulait dire **rien du tout n'était visible** pour ce compte.
- **2026-09-14, plus tôt dans la journée** — Ajout de la fonctionnalité "Conversations" (`messages_log` + interface WhatsApp admin). Dans cette première version, la même règle de confidentialité a été **étendue par défaut** aux conversations : un compte exempté était alors intégralement invisible pour l'admin, vues uniques **et** conversations.
- **2026-09-14, 17:33 UTC** — Changement explicitement demandé : la règle ne s'applique plus qu'aux vues uniques. Les conversations d'un compte exempté sont désormais journalisées et visibles comme celles de n'importe quel utilisateur payant (`services/messageLog.js` ne vérifie plus `exempt`). C'est l'état actuel du code.

**En résumé** : avant le 2026-09-14, exempter quelqu'un le rendait totalement invisible pour l'admin. Ce n'est plus le cas — seule sa vue unique reste protégée.

## 7. Authentification

- Connexion utilisateur : bouton Google (`@react-oauth/google`), le frontend envoie le `credential` (JWT Google) au backend qui le vérifie via `google-auth-library`, puis émet son propre JWT dans un cookie `httpOnly`.
- Admin : même mécanisme mais sur une route **volontairement non liée** dans la navigation (`/portail-9f3a2e`), et seul l'email `ADMIN_EMAIL` (`.env`) est accepté sur cette route.
- `requireAuth` revérifie `blocked` en base à **chaque requête** (pas seulement au login) : un blocage prend effet immédiatement, même sur une session déjà ouverte.
- Cookie `SameSite=Lax` (possible car même domaine que le frontend, voir §1) — protège aussi contre le CSRF.

## 8. Temps réel (Socket.IO)

Une "room" par bot (`bot:<id>`). Le frontend rejoint la room via l'événement `join-bot` (le serveur vérifie que l'utilisateur possède ce bot — ou est admin, qui peut rejoindre n'importe quelle room). Événements émis :
- `qr` : nouveau QR code à scanner (data URL déjà encodée)
- `status` : changement de statut du bot (`qr_pending`/`connected`/`disconnected`)
- `chat-message` : nouveau message journalisé (utilisé par l'interface "WhatsApp" admin pour l'affichage en direct)

Un socket qui rejoint une room en retard reçoit immédiatement le dernier `qr`/`status` connu (`sendSnapshot`), pour ne pas rater un événement déjà passé.

## 9. Interface "WhatsApp" de l'admin (`/portail-9f3a2e/whatsapp`)

Reproduit l'expérience WhatsApp Web pour superviser n'importe quelle session : liste des conversations (dernière activité en premier), fil de discussion avec bulles et médias inline, envoi de texte/média/note vocale (transcodée en ogg/opus via ffmpeg), suppression de message, fiche contact (photo de profil via `sock.profilePictureUrl`), pagination des anciens messages. Tout passe par `baileysManager.sendToChat` / `sendMediaToChat`, qui envoient réellement le message via la session WhatsApp du bot **et** le journalisent dans `messages_log`.

**Fonctionnalité ajoutée le 2026-09-14.** Avant cette date, aucune conversation n'était enregistrée nulle part : ni texte, ni média, pour aucun utilisateur. Le stockage des médias de conversation (images/vidéos/audio téléchargés et gardés sur disque, colonne `messages_log.file_path`) date de la même journée, ajouté dans la foulée de l'interface elle-même.

## 10. Sécurité

- `helmet` (en-têtes), `express-rate-limit` (limite générale + limite stricte sur `/api/auth`).
- `.env` en permissions `600`.
- Toutes les requêtes SQL sont paramétrées (`?`), aucune concaténation de chaînes.
- Upload de médias via `multer` (mémoire, 25 Mo max), jamais écrit directement à un chemin fourni par le client.

## 11. Limites connues

- Pas de moyen de paiement en ligne (activation manuelle, ou exemption).
- Chaque média de conversation est stocké sur disque **sans purge automatique** depuis son ajout le 2026-09-14 — à surveiller si le volume grossit (`backend/uploads/chat/`).
- Les contacts en identifiant privé WhatsApp (`@lid`) n'exposent pas de numéro de téléphone réel sans synchronisation complète des contacts (non implémentée) — seul le nom WhatsApp est affiché.
- "Réponse automatique hors ligne" ne détecte pas le vrai statut en ligne (WhatsApp ne l'expose pas de façon fiable) : c'est un auto-répondeur actif en continu.

## 12. Journal des modifications

Dates au format ISO, heures en UTC (heure du serveur) quand elles sont connues avec précision — sinon date seule.

| Date | Ajout / modification |
|---|---|
| 2026-09-07 | Création du projet : plateforme, 3 plans, auth Google, bots vue_unique/compagnon/auto_reply, dashboard admin de base |
| 2026-09-08 | Bascule du plan `vue_unique` sur Baileys ; capture par citation + mot-clé (`wait`) ; comptes exemptés créés (accès illimité, vues uniques jamais enregistrées) ; blocage utilisateur ; broadcast admin |
| 2026-09-12 | Suppression du paiement obligatoire : 1 bot gratuit par utilisateur normal, illimité pour les exemptés |
| 2026-09-14, journée | Ajout de `messages_log` et de l'interface "WhatsApp" admin (conversations, envoi de texte). Première version : mêmes règles de confidentialité que la vue unique (compte exempté = invisible) |
| 2026-09-14, 17:33 UTC | Correction de la règle ci-dessus : les conversations restent visibles pour un compte exempté, seule la vue unique reste privée pour lui |
| 2026-09-14, 17:33 UTC | Ajout de l'envoi de médias et notes vocales, suppression de message, fiche contact (photo de profil), pagination de l'historique dans l'interface WhatsApp admin |
| 2026-09-14, 17:33 UTC | Rédaction de cette documentation technique |
