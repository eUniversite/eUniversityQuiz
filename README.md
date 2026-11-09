# eUniversité Live

Quiz interactifs en classe : un professeur, 150 à 200 étudiants sur téléphone, sans installation.
Stack : React + TypeScript + Tailwind (web), Node.js + Express + Socket.IO (API temps réel), PostgreSQL + Prisma.
Un seul backend, qui sert aussi le frontend compilé en production.

## Démarrage rapide

```bash
cp .env.example .env            # puis adapter JWT_SECRET, PUBLIC_URL, mot de passe professeur
npm install
npm run db:up                   # PostgreSQL via Docker Compose (port hôte 5442)
npm run db:migrate              # applique les migrations Prisma
npm run db:seed                 # compte professeur + quiz de démonstration
npm run dev                     # API : http://localhost:3100 · web : http://localhost:5173
```

Sans Docker, pointez `DATABASE_URL` vers n'importe quel PostgreSQL 14+.

- Professeur : `http://localhost:5173/enseignant/connexion` (identifiants de `.env` : `TEACHER_EMAIL` / `TEACHER_PASSWORD`).
- **Téléphones** : `PUBLIC_URL` doit être l'adresse que les téléphones peuvent atteindre (ex. `http://192.168.1.20:5173` en dev, ou l'URL publique en production). Elle est encodée dans le QR code.
- Production : `npm run build && npm start` (le serveur sert `web/dist` ; mettre `PUBLIC_URL` sur l'URL du serveur, `NODE_ENV=production`, un `JWT_SECRET` long, `TRUST_PROXY=1` derrière un proxy). Le proxy doit transmettre les WebSockets.

## Utilisation

1. Tableau de bord → « Ouvrir une session » sur un quiz (le quiz `[DÉMO] Culture numérique` est fourni).
2. Console : ouvrir « Écran de projection » dans un second onglet (vidéoprojecteur) : QR code + code.
3. Les étudiants scannent, saisissent leur nom complet et un pseudo, attendent.
4. « Préparer la question » puis « Lancer la question ». La question se ferme seule à l'échéance ; correction + Top 5 ; « Question suivante » ; « Terminer la session » → podium. Historique et export CSV : tableau de bord → Résultats.

## Règles et garanties

- Barème : bonne réponse = 800 + `round(200 × (1 − écoulé/durée))` borné à 0–200 ; sinon 0. Temps écoulé mesuré à la réception serveur ; toute réponse reçue à l'échéance ou après est refusée. Rang de compétition (1, 1, 3…).
- Une réponse par participant et par question : contrainte unique en base `(questionId, participantId)` + insertion idempotente (re-soumission = renvoi de la réponse déjà acceptée).
- Les points sont ajoutés aux totaux dans la **même transaction** que le passage `OPEN → CLOSED` (garde `updateMany … WHERE status='OPEN'`) : pas de double attribution. La fermeture attend les soumissions en cours.
- La bonne réponse et l'explication ne sont jamais envoyées avant la fermeture (ni aux étudiants, ni à la projection, ni au professeur).
- Les échéances sont stockées en base : au redémarrage, les questions ouvertes sont rechargées et fermées (ou replanifiées). Un balayage toutes les 2 s sert de filet.
- Auth professeur : JWT (12 h) vérifié sur toutes les routes HTTP et à la connexion WebSocket ; les commandes d'animation sont des événements `teacher:*` réservés aux sockets professeur propriétaires de la session.
- Étudiants : jeton opaque aléatoire (256 bits), seul son hachage SHA-256 est stocké ; il est lié à une session et un participant. Le pseudo est unique par session et affiché publiquement (classement, podium) ; le nom complet n'est visible que du professeur.
- Pseudo déjà pris : refus 409 avec un message générique. Le professeur peut « Réinitialiser » un participant : son jeton est invalidé et la même personne (même pseudo **et** même nom complet) peut se réinscrire, en conservant ses points.
- Limitation : essais de code (30 échecs / 10 min / IP), connexion professeur (par IP et par e-mail), soumissions (30 / 10 s / participant). Les limites de code ne comptent que les échecs, car une classe partage souvent une seule IP.
- Retardataires : peuvent s'inscrire pendant une question ouverte et y répondre, sans points rétroactifs.

## Choix et décisions documentées

- Une seule classe implicite ; un seul compte professeur créé par `db:seed` (pas d'inscription publique).
- Les questions sont copiées (snapshot) à l'ouverture d'une session : modifier un quiz ensuite n'altère pas l'historique.
- « Réordonner » les questions se fait avec des boutons ↑/↓ (accessibles, fiables sur tactile) plutôt que par glisser-déposer.
- Questions de 2 à 4 propositions ; dans l'éditeur, les propositions vides en fin de liste sont ignorées.
- Les états `READY` n'exposent pas l'énoncé aux étudiants (uniquement au professeur).
- Palette provisoire basée sur le logo fourni (orange `#FD9503`), centralisée dans `web/src/index.css`.

## Tests

```bash
npm test          # vitest : barème, boucle complète, tardives, doublons, reconnexion, redémarrage, droits
npm run load      # charge : 200 étudiants (serveur lancé) ; STUDENTS=150 QUESTIONS=3 pour ajuster
```

Les tests utilisent `TEST_DATABASE_URL` (défaut `postgresql://euniv:euniv@localhost:5455/euniv_live_test` ; avec Docker : `docker compose --profile test up -d db_test` puis `TEST_DATABASE_URL=postgresql://euniv:euniv@localhost:5443/euniv_live_test`).

## Vérifications effectuées (voir aussi le récapitulatif de livraison)

Tests automatisés (8 passés) : calcul des points, rang partagé, bonne réponse absente des données avant fermeture, double soumission simultanée → 1 ligne, réponse tardive refusée, fermeture automatique professeur déconnecté, reconnexion avec résultat restauré, jeton étranger/invalide refusé, étudiant ne pouvant ni piloter la session ni utiliser les routes professeur, réinitialisation d'accès, retardataire, fermeture après redémarrage du serveur.

Test de charge (200 étudiants, 3 questions de 10 s, 60 % des réponses dans les 3 dernières secondes, 5 % envoyées après l'échéance, 10 % de doubles clics), machine unique (client de test + serveur + PostgreSQL) : 190–194 réponses acceptées par question, 6–10 refusées comme tardives, 0 doublon en base, latence d'accusé p50 2 ms / p95 3–4 ms / max 9 ms, fermeture et correction diffusées ~14 ms après l'échéance, somme des points des réponses = somme des totaux.

## Limites

- **Processus unique** : l'état temps réel et les limiteurs sont en mémoire ; ne pas lancer plusieurs instances sans adaptateur Socket.IO/verrous partagés. Le redémarrage est supporté (état reconstruit depuis la base).
- Le test de charge est local (réseau loopback) : il ne mesure ni les Wi-Fi saturés ni les téléphones réels. Mémoire/CPU non mesurés.
- Interface web non testée automatiquement dans un navigateur (vérifiée par compilation TypeScript/build) : faire un essai à blanc avec quelques téléphones avant le premier cours.
- Pas de réinscription publique de professeurs, pas de changement de mot de passe dans l'interface (relancer `db:seed` ne modifie pas un compte existant).
- Le serveur n'applique pas de HTTPS lui-même : utiliser un proxy TLS (les caméras/QR n'en ont pas besoin, mais les navigateurs préfèrent HTTPS).

## Study : création de parcours par LLM

Un étudiant (compte étudiant) importe un cours (PDF texte, DOCX, TXT, MD) → analyse → création des questions → jeu 3D « Course des savoirs » (`web/public/jeu/`, lancé avec `?course=<id>`).

- Configurer `GEMINI_API_KEY` (et au besoin `GEMINI_MODEL`) dans `.env`, puis redémarrer le serveur. Sans clé, l'import répond « pas encore activé ».
- Les prompts système sont dans `server/src/study/prompts.ts`, l'unique appel au modèle dans `server/src/study/gemini.ts` (le modèle auto-hébergé remplacera cette fonction).
- Contrôle qualité avant enregistrement (`server/src/study/pipeline.ts`) : 4 propositions distinctes, extrait source retrouvé dans le document, pas de doublon.
- Le fichier importé n'est pas conservé ; les PDF scannés ne sont pas encore pris en charge (pas d'OCR).
