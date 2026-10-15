# Codex — GED Groupe

Gestion électronique des documents du groupe, construite d'après la maquette Claude Design
(`design/GED Groupe.dc.html`, design system Nocturne dans `design/_ds/`).

Même socle que Keystone : **Next.js 16 (App Router) · React 19 · PGlite (Postgres embarqué) + Drizzle**.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:3100
```

Au premier lancement, la base locale est créée dans `.data/` (migrations `drizzle/`) et remplie avec les
données de démonstration (registre des types, organisation provisoire, projets Keystone, documents). Les fichiers
déposés sont stockés dans `.data/files/` (ou dans SharePoint, voir `src/lib/storage.ts`).

- Repartir de zéro : arrêter le serveur, `npm run db:reset`, relancer. **Obligatoire après le passage au modèle v2** :
  une base créée avec l'ancien modèle ne peut pas recevoir la nouvelle migration. `db:reset` n'efface pas les
  sauvegardes (`.data-backups/`, voir « Sauvegarde et restauration »).
- Après une modification de `src/db/schema.ts` : tant qu'il n'y a pas de base de production, régénérer la migration
  unique (`rm -rf drizzle && npx drizzle-kit generate --name init`) puis `npm run db:reset`.
- Contrôles : `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Intégration continue GitHub Actions (`.github/workflows/ci.yml`) : `npm ci` puis ces contrôles, sous Node 22, à chaque push et PR.
- Tests : `npm test` lance Vitest une fois (`npm run test:watch` en continu), en une à deux minutes selon la machine,
  sans serveur ni réseau et sans toucher à `.data/`.
  - `tests/unit/` : règles pures (identifiants, révisions, visibilité, conservation, recherche, filtres mis en avant
    des départements, dates, expiration et revue périodique, modifications simultanées, types de fichiers, formats,
    contenu (ZIP, fichiers composés OLE2, macros) et taille admis, analyse antivirus contre un faux clamd local,
    limites de débit, en-têtes de sécurité et `src/proxy.ts`, plages d'octets et requêtes conditionnelles, tri des
    fichiers orphelins, noms et rotation des sauvegardes, lecture d'une archive altérée, verrou du dossier de données,
    journal technique sans secret, contrôle de la configuration au démarrage).
  - `tests/integration/` : règles métier sur une base PGlite en mémoire, migrée depuis `drizzle/` avec les
    déclencheurs du journal, de la version et des termes de recherche des documents (`openDb` dans `src/db/index.ts`)
    et remplie de données minimales (`tests/support/fixtures.ts`), pas de la base de démo. Identifiants et compteurs,
    révisions et dates d'effet, cohérence des dates, expiration et revue périodique, circuits, décisions Vigie et
    webhook, journal en ajout seul et ses pages, cercle de rédaction, import, recherche, recherches enregistrées, pages
    par département, modifications simultanées et limites de débit des routes et des actions (429), fichiers servis
    en flux (206, 416, 304, HEAD), nettoyage des fichiers orphelins, sauvegarde et restauration (archive écrite,
    relue, altérée, restaurée sur disque puis rouverte, retour arrière, commandes npm lancées comme par l'exploitant),
    route de santé et journal technique des routes et des actions. La visibilité en SQL, la recherche et l'explorateur lus par la base
    sont comparés à leur version en mémoire, qui reste la référence (`access-sql`, `search-sql`, `tests/support/`).
    `tests/integration/dates.test.ts` et `seed-sql.test.ts` chargent aussi les données de démo (`src/db/seed.ts`), en
    mémoire, pour en vérifier toutes les dates et y refaire ces comparaisons.
    Les Server Actions y tournent avec `next/headers` et `next/cache` simulés (`tests/support/session.ts`) ;
    l'horloge est figée au 10 octobre 2026. Les compteurs de débit sont vidés avant chaque test
    (`tests/support/setup.ts`).
  - Limite : PGlite n'a qu'une connexion et exécute les transactions l'une après l'autre. Les tests d'attributions
    « simultanées » (`Promise.all`) vérifient l'absence de doublon sous cet entrelacement, pas l'atomicité des
    compteurs entre connexions d'un vrai serveur Postgres (étape 5, O-03) : il faudra un Postgres serveur pour la
    vérifier.
  - Version de Node : la recherche en base replie les textes (accents, casse) et trie les titres avec les tables
    Unicode et ICU de PGlite (Unicode 16.0, ICU 76), la version en mémoire qui lui sert de référence avec celles de
    Node (Node 22 : Unicode 16.0, ICU 77 ; Node 26 : Unicode 17.0, ICU 78). La base replie la requête comme les
    valeurs qu'elle garde : elle reste cohérente avec elle-même sous toute version de Node. `search-sql.test.ts`
    compare les deux replis sur les points de code que les deux versions d'Unicode attribuent, et les deux tris : il
    passe sous Node 22 et sous Node 26 (vérifié avec Node 26.11.1). Un caractère ajouté par Unicode 17.0 peut être
    replié autrement par la référence en mémoire que par la base.

Variables : voir `.env.example` (Keystone, Vigie, dossier de données et de sauvegardes, jetons de l'API
d'intégration, HTTPS, proxy de confiance, limites de débit, journal technique, contrôle de la configuration). Aucune
n'est nécessaire en local : sans elles, les limites de débit gardent des valeurs généreuses, HSTS reste coupé,
`X-Forwarded-For` n'est pas tenu pour fiable et le contrôle de la configuration ne trouve aucune erreur. Elles sont
vérifiées à chaque démarrage (voir « Exploitation »).

Le modèle fonctionnel fait foi dans `docs/modele-cible.md` ; l'API d'intégration est décrite dans `docs/api.md`.

## Application Mac

```bash
npm run app
```

Construit `Codex.app` (fenêtre native macOS, sans Electron), l'installe dans `~/Applications` et dépose un alias
« Codex » sur le bureau. L'app :
- lance le serveur de production de ce projet sur `http://127.0.0.1:3110` (recompilé automatiquement si le code a
  changé depuis la dernière build) et l'arrête quand on quitte l'app — y compris si l'app plante ;
- garde ses données à part du serveur de développement : `~/Library/Application Support/Codex` (base et fichiers),
  journal dans `~/Library/Logs/Codex/server.log` (menu Présentation › Afficher le journal du serveur), une entrée JSON
  par ligne comme tout serveur de production (`CODEX_LOG_FORMAT=pretty` dans `.env.local` du projet pour des lignes lisibles) ; un refus de la
  configuration au démarrage (« Le serveur s'est arrêté au démarrage. ») y est expliqué (voir « Exploitation ») ;
- ouvre les liens Keystone / Vigie dans le navigateur, enregistre les téléchargements dans `~/Téléchargements`.

L'app pointe vers ce dossier de projet et vers le Node.js présents au moment de la construction : relancer
`npm run app` après un déplacement du projet ou un changement de Node. Pour repartir d'une base de démo neuve :
quitter l'app et supprimer `~/Library/Application Support/Codex/data`.

## Écrans

| Route | Écran |
| --- | --- |
| `/` | Tableau de bord : « À traiter » (étapes à décider, révisions à rédiger ou à reprendre, greffes possibles, revues et expirations des documents dont on est propriétaire ou propriétaire de processus), documents récents, échéances (conservation, expiration, revue), activité. La pastille d'Accueil et la cloche reprennent la même liste |
| `/explorateur` | Classement par famille, département, projet / programme, type ou origine ; filtres de statut et d'échéance dépassée (« Expirés », « Revues en retard ») ; 50 documents par page ; aperçu rapide |
| `/documents/[id]` | Fiche document : aperçu, onglets Projet · Fiche · Révisions · Validation · Demandes · Historique ; indicateurs « Expiré » (raccourcis vers les demandes de modification et de retrait) et « Revue en retard », « Revue effectuée » ; documents liés (« Remplace », « Remplacé par », « Voir aussi »), remplacement proposé avec une demande de retrait et rappelé dans le bandeau d'un document obsolète ; fiche de visa (PDF) de chaque révision approuvée, dans l'onglet Révisions |
| `/recherche` | Recherche plein texte classée par pertinence + facettes (projet, famille, type, sous-type, origine, rattachement, département, site, propriétaire, auteur, statut, échéance dépassée, confidentialité, langue, mots-clés, organisme source, phase, lot, discipline, thème), période sur une date (modification, émission, effet, révision, expiration), tri au choix, 50 résultats par page, export CSV de tous les résultats dans le même ordre ; recherches enregistrées (critères, période et tri) personnelles, ou partagées avec un département ou le groupe par un gestionnaire documentaire |
| `/departements/[code]` | Page d'un département (`/departements` ouvre celui de l'utilisateur, un sélecteur passe aux autres) : documents en vigueur, échéances, circuits en cours qu'il suit, recherches partagées avec le département et le groupe, filtres mis en avant (valeurs les plus fréquentes, chacune un lien vers la recherche filtrée), le tout limité à ce que l'utilisateur peut lire. Départements provisoires (organigramme attendu) ; filtres par défaut (type, statut, projet), réglables par département dans Administration › Organisation, en attendant le recueil des besoins de chaque métier |
| `/validations` | Circuits de validation : à valider, mes demandes, en cours, terminées ; approuver / rejeter (motif obligatoire) / déléguer, rappeler sa demande avant la dernière approbation, commentaires. Vue « Mes demandes Vigie » : demandes de modification et de retrait envoyées par l'utilisateur, avec leur statut |
| `/archivage` | Échéances (archivage, gel juridique, revue effectuée ; filtres « Expirés » et « Revues en retard »), règles de conservation du registre, archives |
| `/administration` | Registre des types (création et modification complète des types et des familles, dont la périodicité de revue), fonctions & circuits (fonctions, titulaires, programmes de recherche), rôles & droits, organisation (départements et leurs filtres mis en avant, sites), modèles (QMS), journal d'audit (filtres par document ou cible, personne, action et période ; 100 entrées par page ; export CSV complet) |

API : `/api/registry` (lu par Keystone), `/api/import` (outil de migration), `/api/integrations/vigie` (décisions
Vigie), `/api/documents/[id]/file` (fichier d'une version de travail), `/api/documents/[id]/approval?rev=B` (fiche de
visa d'une révision approuvée, PDF tiré du journal), `/api/export/*` (CSV).

Tout l'état d'écran est dans l'URL (onglets, filtres, sélection) : les liens sont partageables.

## Ce qui est réel / simulé

- **Persisté** : création codifiée (`TYPE-CONTEXTE-SEQ`, depuis un modèle, un fichier ou sans fichier), versions de
  travail (A.1, A.2…), métadonnées (dates contrôlées : format, et émission ≤ effet < expiration) et reclassement
  (nouvel identifiant tant qu'aucune révision n'a été approuvée),
  lecteurs désignés, demandes de validation et décisions (mise en vigueur à l'approbation ou à la date d'effet),
  délégation, commentaires, demandes de modification et de retrait, revue périodique (« Revue effectuée », qui fixe la
  prochaine date de revue sans créer de révision), archivage, gel juridique, matrice des droits, registre des types
  (création, modification et suppression des types, familles et fonctions : code, libellés FR/EN, famille, origines et
  rattachements admis, sous-types, circuit, confidentialité, conservation et son fondement, périodicité de revue, clause
  ISO, livrable client, actif), programmes de recherche (code, libellé, responsable, actif), titulaires des fonctions,
  départements (et filtres mis en avant sur leur page) et sites. Une entrée du registre utilisée garde son code et ne se
  supprime pas : un type ou un programme utilisé se désactive (`docs/api.md`, `GET /api/registry`). L'expiration et la revue en retard sont des indicateurs, sans nouveau statut : le
  retrait reste une demande à Vigie. Métadonnées, lecteurs désignés, versions de travail et demandes de validation
  refusent une action faite depuis une fiche périmée (« modifié entre-temps par … ; rechargez la fiche »), sans
  réserver le brouillon.
  Chacune de ces actions alimente le journal d'audit, de même que les téléchargements et les deux exports CSV. Le
  journal est en ajout seul : la base refuse toute modification ou suppression (déclencheur posé au démarrage,
  `src/db/index.ts`), et un reclassement ne réécrit pas les entrées, qui gardent l'identifiant de leur époque.
  L'horodatage est stocké en UTC et affiché à l'heure de Paris. Ne sont pas journalisés : les consultations (aperçu
  sans téléchargement) et le changement d'utilisateur ou de langue simulé.
- **Utilisateur et rôle simulés** (pas d'authentification pour l'instant) : cliquer sur le profil en bas de la
  barre latérale. La navigation suit les règles de la maquette (validations masquées pour l'auditeur, archivage
  masqué pour le collaborateur, administration réservée au gestionnaire), les actions vérifient la matrice des
  droits côté serveur et la visibilité suit `src/lib/access.ts` (confidentialité, cercle de rédaction).
- **Keystone simulé** : les projets (phase, client, pièces attendues, événements) viennent de tables locales, lues
  par `src/lib/keystone.ts`, seul fichier à remplacer par des appels API quand Keystone exposera les siennes.
- **Vigie simulé** : les demandes de modification (ECR) et de retrait sont enregistrées par `src/lib/vigie.ts` ; tant
  que `VIGIE_API_URL` n'est pas défini, un gestionnaire documentaire simule la décision depuis l'onglet Demandes.
  Le webhook `/api/integrations/vigie` applique les décisions réelles.
- **Aperçu** : un PDF, une image PNG, JPEG, GIF ou WebP, ou un fichier texte déposés s'affichent dans la fiche ; les
  autres formats se téléchargent. Les documents de démonstration (sans fichier) gardent la page maquette et se
  téléchargent sous forme d'un PDF généré.

## Sécurité HTTP et limites de débit

**En-têtes** (points 25 et 24 de `docs/reste-a-faire.md`) :
- Sur toutes les réponses (`next.config.ts`, valeurs dans `src/lib/security-headers.ts`) : `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (les autres origines ne reçoivent jamais le chemin, qui
  nomme les documents), `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` (caméra, micro, géolocalisation, paiement,
  USB, Topics coupés). Plus d'en-tête `X-Powered-By`.
- Sur les pages, `Content-Security-Policy` posée par `src/proxy.ts`, avec un nonce tiré à chaque requête : Next.js le
  lit dans la politique et l'ajoute à ses propres scripts, qui sont les seuls admis (`'strict-dynamic'`, sans
  `'unsafe-inline'` pour les scripts). Styles du code et de React admis en ligne, police Inter auto-hébergée par
  `next/font`, images `data:` et `blob:`, cadre de même origine pour l'aperçu des fichiers, `frame-ancestors 'self'`
  (l'app Mac affiche Codex en page principale de sa vue web : aucune règle de cadre ne la concerne), `eval` admis en
  développement seulement (React). Les réponses de l'API (JSON, fichiers stockés) n'ont pas de politique : rien n'y
  s'exécute, et une politique sur un PDF peut empêcher la visionneuse du navigateur de l'afficher dans l'aperçu. La
  route fichier garde ses propres en-têtes (`Content-Disposition`, `nosniff`).
- `src/proxy.ts` ne voit pas non plus les appels de Server Actions (en-tête `Next-Action`) : leur réponse est un flux
  React, pas une page, et Next.js recopie en mémoire le corps de chaque requête que voit un proxy, coupé sans erreur
  au-delà de `experimental.proxyClientMaxBodySize` (10 Mo par défaut). Les dépôts de fichiers de 10 à 50 Mo échouaient
  sinon. Un formulaire envoyé avant l'hydratation de la page passe, lui, par le proxy : `next.config.ts` règle cette
  copie sur la limite des Server Actions (taille maximale d'un fichier plus 1 Mo, voir « Fichiers déposés »).
- `Strict-Transport-Security` (un an, cet hôte seulement) et `upgrade-insecure-requests` seulement avec
  `CODEX_HTTPS=1`, à poser quand Codex est servi en HTTPS derrière un proxy TLS. Coupés par défaut : en local et dans
  l'app Mac, Codex est en HTTP, et HSTS sur `localhost` imposerait HTTPS à toutes les applications locales (Keystone,
  Vigie).

**Limites de débit** (`src/lib/ratelimit.ts`) : un seau à jetons par famille et par clé. Une clé peut envoyer d'un coup
le nombre de requêtes de sa limite, puis en regagne une à intervalle régulier ; au-delà, **429** avec `Retry-After` (en
secondes), sans rien exécuter (ni import, ni lecture de fichier, ni export journalisé, ni écriture).

| Famille | Variable | Par défaut | Clé |
|---|---|---|---|
| `POST /api/import` (jeton vérifié) | `CODEX_RATE_IMPORT` | 600 par minute | adresse du client |
| `POST /api/integrations/vigie` (jeton vérifié) | `CODEX_RATE_VIGIE` | 600 par minute | adresse du client |
| Jetons refusés sur ces deux routes | `CODEX_RATE_TOKEN_FAILURES` | 20 par 15 minutes | adresse du client |
| `GET /api/registry` | `CODEX_RATE_REGISTRY` | 300 par minute | adresse du client, derrière un proxy de confiance seulement |
| Fichiers et fiches de visa (`/api/documents/[id]/file`, `/approval`) | `CODEX_RATE_FILES` | 600 par minute | utilisateur résolu ; et adresse derrière un proxy de confiance |
| Exports CSV (`/api/export/*`, GET et HEAD) | `CODEX_RATE_EXPORTS` | 30 par minute | utilisateur résolu ; et adresse derrière un proxy de confiance |
| Server Actions qui écrivent (`src/lib/actions.ts`) | `CODEX_RATE_WRITES` | 120 par minute | utilisateur résolu |

- Valeur `N` (par minute) ou `N/<durée>` (`30s`, `1m`, `15m`, `1h`) ; `0` ou `off` lève une limite,
  `CODEX_RATE_LIMIT=off` les lève toutes. Une valeur illisible garde la valeur par défaut, avec un avertissement.
- Une action refusée affiche « Trop de demandes en peu de temps : réessayez dans N s. » ; les routes du navigateur
  répondent la même phrase en texte, les routes d'intégration en JSON (`docs/api.md`).
- **Une clé choisie par le client ne bloque jamais un tiers.** L'adresse du client est la dernière valeur de
  `X-Forwarded-For`. Sans proxy devant Codex, Next.js la pose d'après la connexion, sauf si le client l'envoie
  lui-même : il la choisit alors, y compris l'adresse d'un autre. Elle n'est donc tenue pour fiable qu'avec
  `CODEX_TRUST_PROXY=1`, à poser seulement si un proxy inverse écrit cet en-tête (le remplace, ou y ajoute l'adresse
  qu'il voit) et si Codex n'est joignable que par lui (`next start -H 127.0.0.1`, par exemple). Coupé par défaut :
  - les budgets d'import et de Vigie ne sont comptés qu'une fois le jeton vérifié : un tiers sans jeton ne peut pas
    épuiser celui de l'outil de migration ou de Vigie en se faisant passer pour leur adresse ;
  - les jetons refusés sont comptés par adresse, et au-delà du quota les jetons faux reçoivent 429 au lieu de 401 ; le
    bon jeton passe toujours. Un jeton de 32 octets aléatoires (`openssl rand -base64 32`) reste hors de portée. Avec
    `CODEX_TRUST_PROXY=1`, une adresse qui a épuisé son quota attend même avec le bon jeton, qui n'est plus comparé :
    le deviner ne va pas plus vite que la limite ;
  - le registre, sans jeton, n'est limité que derrière un proxy de confiance : ailleurs, n'importe qui pourrait
    épuiser le budget de Keystone ;
  - fichiers, fiches de visa et exports comptent par utilisateur **résolu** (`src/lib/context.ts`), jamais par la
    valeur brute du cookie : un cookie inconnu est l'utilisateur par défaut, et des cookies inventés partagent son
    budget. Derrière un proxy de confiance, un second seau par adresse plafonne aussi un client qui alternerait entre
    plusieurs comptes. Tant qu'il n'y a pas d'authentification (O-02), un client peut toujours se faire passer pour un
    autre utilisateur, et donc dépenser son budget.
- **Une seule instance** : les compteurs sont en mémoire, dans le processus du serveur ; PGlite impose déjà un seul
  processus. Un redémarrage les remet à zéro. Avec plusieurs instances, chacune compterait de son côté (jusqu'à n fois
  la limite) : il faudrait alors un magasin partagé (Redis, ou une table de la base Postgres serveur, point 51) ou
  limiter au proxy inverse (`limit_req` de nginx, par exemple). Chaque famille garde au plus 10 000 clés, dans sa propre
  table : seuls les seaux redevenus pleins sont oubliés, et tant qu'aucun ne l'est, une clé nouvelle attend (429) plutôt
  qu'un seau entamé ne soit effacé.

## Fichiers déposés : formats, taille, antivirus

Point 32 de `docs/reste-a-faire.md` (et point 64 pour la taille). Tout fichier qui entre dans Codex passe par
`stageFile` (`src/lib/storage.ts`), quelle que soit sa voie : nouveau document, version de travail, copie d'un modèle,
import (`POST /api/import`). Il y est contrôlé puis analysé **avant** d'être écrit dans le stockage : un fichier refusé
ne laisse ni document, ni version, ni fichier.

- **Formats admis** (`src/lib/filetypes.ts`) : une liste blanche d'extensions, la même pour tous les types de document
  (la liste par type attend la question M12 de l'audit). Par défaut : PDF, Word, Excel, PowerPoint (et leurs modèles
  `.dotx`, `.xltx`, `.potx`), OpenDocument, RTF, texte, CSV, Visio, Project, courriels (`.msg`, `.eml`), images (PNG,
  JPEG, GIF, WebP, TIFF, HEIC), MP4, plans et maquettes (DWG, DXF, STEP, IGES, IFC, STL), JSON et XML. Les archives
  (`.zip`…) n'y sont pas. `CODEX_FILE_EXTENSIONS` remplace la liste entière ; les exécutables, scripts, pages web, SVG,
  images disque et extensions Office à macros (`.exe`, `.bat`, `.js`, `.ps1`, `.html`, `.hta`, `.svg`, `.iso`, `.docm`,
  `.xlsm`…) restent refusés même s'ils y figurent.
- **Nom** : le fichier est contrôlé, enregistré et servi sous un seul nom, le dernier segment de celui reçu, sans
  caractères de contrôle ni séparateurs, points ou espaces finaux (`procedure.hta/` devient `procedure.hta`, refusé ;
  `C:\fakepath\plan.pdf` devient `plan.pdf`). L'extension contrôlée est donc celle du fichier stocké et du
  téléchargement. Un fichier sans extension prend celle de son contenu (PDF), jamais celle du type annoncé à l'envoi.
- **Contenu** : un format courant doit avoir le contenu qu'annonce son extension : PDF, PNG, JPEG, GIF, WebP, TIFF, RTF,
  DWG, MP4 et HEIC par leur en-tête ; Office 97-2003, Project et Outlook par le répertoire de leur fichier composé
  (OLE2), qui doit se lire ; Word, Excel, PowerPoint et Visio (`.docx`…) par l'entrée `[Content_Types].xml` de leur
  ZIP, ou, chiffrés par un mot de passe ou une étiquette de confidentialité, par le flux `EncryptedPackage` de leur
  fichier composé ; OpenDocument par l'entrée `mimetype` ou `META-INF/manifest.xml` de leur ZIP. Un `.doc` peut aussi
  être du RTF, comme l'exportent d'anciens systèmes. Une archive ZIP quelconque renommée `.docx` ou `.odt` est donc
  refusée. Les formats texte et d'échange (TXT, CSV, DXF, STEP…) sont pris sur leur nom. Un programme (Windows, Linux,
  macOS) est refusé quel que soit son nom. Un fichier sans extension n'est admis que si son contenu désigne un format
  admis (un PDF, une image, un DWG).
- **Macros** : les extensions à macros (`.docm`, `.xlsm`…) sont toujours refusées, et les macros VBA le sont quelle
  que soit l'extension : partie `vbaProject.bin` d'un ZIP, flux `_VBA_PROJECT` d'un fichier composé (Word, Excel et
  Project 97-2003, message Outlook qui en embarque un). Ne sont pas détectées sans antivirus : les macros de PowerPoint
  97-2003 (compressées dans la présentation), les macros Excel 4.0, les macros Basic d'OpenDocument et ce que contient
  un fichier chiffré.
- **Taille maximale** : `CODEX_MAX_FILE_MB`, 50 Mo par défaut, la même pour toutes les voies (250 Mo au plus avec
  SharePoint). Elle règle aussi, au démarrage du serveur, la taille d'une requête de Server Action (`next.config.ts` :
  la limite plus 1 Mo pour les autres champs), si bien qu'un fichier trop gros reçoit un refus explicite et non
  l'erreur générique du framework. Elle remplace `CODEX_IMPORT_MAX_MB`, qui n'est plus lue.
- **Dans les dialogues** : le sélecteur de fichier propose les extensions admises (`accept`), affiche la taille
  maximale et dit tout de suite pourquoi un fichier sera refusé (extension, taille) ; le formulaire ne part pas avec
  lui. Le serveur refait tous les contrôles. Refus traduits en français et en anglais (`src/lib/i18n.ts`).
- **Antivirus** (`src/lib/antivirus.ts`) : avec `CODEX_CLAMD` (`hôte:port`, port 3310 par défaut, ou chemin du socket
  Unix), chaque fichier est envoyé à clamd par la commande `INSTREAM` avant d'être stocké. Un fichier infecté est
  refusé (« Fichier refusé : l'analyse antivirus a détecté … ») et journalisé (action « Fichier refusé (antivirus) »,
  visible dans l'onglet Journal d'audit de l'administration). Hors gestionnaires documentaires, l'entrée d'un dépôt à
  l'écran ne donne ni le nom du fichier, qui peut porter l'identifiant et la version d'un brouillon
  (`PRO-ING-0007_A.2.docx`), ni le document visé, mais la voie, l'extension, la taille et la menace (D-14) ; celle d'un
  import garde le nom et la référence ancienne. Si clamd ne répond pas (injoignable, délai `CODEX_CLAMD_TIMEOUT_MS` de
  30 s dépassé, erreur), le dépôt est refusé (« réessayez plus tard »), sauf avec `CODEX_CLAMD_ON_ERROR=accept`, qui
  l'accepte sans analyse en le notant dans le journal du serveur.
- **Limites de clamd** : elles doivent couvrir `CODEX_MAX_FILE_MB`. `StreamMaxLength` (au-delà, clamd coupe l'envoi) et
  `MaxFileSize` (au-delà, clamd répond « OK » **sans analyser**) valent 100 Mo par défaut depuis ClamAV 0.105, 25 Mo
  avant ; `MaxScanSize` (contenu décompressé) 400 Mo, 100 Mo avant. Réglez-les au moins à `CODEX_MAX_FILE_MB` et
  activez `AlertExceedsMax yes` : clamd signale alors un fichier qui dépasse `MaxFileSize`, `MaxScanSize` ou
  `MaxRecursion` (« Heuristics.Limits.Exceeded… ») au lieu de le dire sain. Codex refuse ce fichier, comme celui que
  clamd coupe, avec un message qui en donne la cause (limites de l'analyse antivirus à relever) et sans inviter à
  réessayer ; à l'import, 413 `scan_too_large`. `CODEX_CLAMD_ON_ERROR=accept` l'accepte sans analyse.
- **Fichiers déjà stockés** : ils ne sont ni recontrôlés ni réanalysés. Seule la copie d'un modèle refait les contrôles,
  puisque son fichier entre dans un nouveau document : un modèle déposé avant ce contrôle dans un format désormais
  refusé (`.dotm`, PDF nommé `.docx`…) n'est plus copiable, et le refus nomme le modèle et demande à son propriétaire
  d'en déposer une nouvelle version.
- **Sans `CODEX_CLAMD`** (usage local, app Mac), rien n'est analysé : le journal du serveur le dit au premier dépôt
  (`[antivirus] scanning off`) et l'onglet Journal d'audit de l'administration l'affiche au-dessus des filtres, avec la
  taille maximale et le nombre de formats admis. Pour essayer en local : `docker run -p 3310:3310 clamav/clamav`, puis
  `CODEX_CLAMD=127.0.0.1:3310 npm run dev`. Les tests utilisent un faux clamd et le fichier de test EICAR
  (`tests/support/clamd.ts`).

## Fichiers servis et nettoyage du stockage

Points 46 et 36 de `docs/reste-a-faire.md`.

- **En flux** : `/api/documents/[id]/file` lit le fichier stocké par morceaux (`createReadStream` en local ; corps de
  la réponse de Graph pour SharePoint), sans le charger en mémoire. Les contrôles d'accès, le cercle de rédaction
  (D-14), les suffixes `_OBSOLETE` et `_ARCHIVE`, la limite de débit et la journalisation des téléchargements passent
  avant, comme auparavant. La fiche de visa (`/approval`), construite en mémoire (quelques Ko) et journalisée à chaque
  demande, reste envoyée entière ; les exports CSV étaient déjà écrits en flux.
- **Plages (`Range`)** : `Accept-Ranges: bytes` ; une plage (`bytes=0-99`, `bytes=100-`, `bytes=-500`) reçoit 206 avec
  `Content-Range` ; une plage qui commence au-delà du fichier ou mal formée reçoit 416 avec `Content-Range: bytes */taille`.
  Une autre unité ou plusieurs plages reçoivent le fichier entier (200). `If-Range` (ETag ou date) fait renvoyer le
  fichier entier quand il a changé. `HEAD` donne les en-têtes de GET (taille entière, ETag, 304), sans corps ni plage.
  Règles dans `src/lib/ranges.ts`.
- **ETag, Last-Modified, 304** : l'ETag est calculé (empreinte) sur la version de travail, sa taille et sa date, et sur
  le nom servi (identifiant, révision, état), Last-Modified vient du fichier local. Le navigateur ne garde une copie
  (`Cache-Control: private, no-cache`, revalidée à chaque usage, donc droits contrôlés à chaque fois) que du fichier
  final de la révision en vigueur, sous le niveau Confidentiel : changer de page dans l'aperçu ne retélécharge plus
  le PDF (304). Brouillons, fichiers confidentiels et très confidentiels et téléchargements explicites
  (`?download=1`) restent en `no-store`, envoyés en entier à chaque fois : pour eux, l'aperçu paginé, qui recrée son
  iframe à chaque page (`key={page}`, `src/app/documents/[id]/DocClient.tsx`), retélécharge encore tout le fichier à
  chaque page (reste du point 46). `no-transform` empêche la compression, qui
  fausserait les plages.
- **Téléchargements journalisés** : un téléchargement (`?download=1`) est inscrit au journal quand la réponse part du
  premier octet (200, ou 206 à partir de 0) ; une reprise (plage plus loin), un 416 ou un HEAD ne le sont pas.
- **Fichiers orphelins** (`src/lib/orphans.ts`) : fichiers du stockage qu'aucune version de travail ne référence
  (arrêt du serveur entre le dépôt et l'enregistrement, renommage inachevé). Dans **Administration › Journal
  d'audit**, un gestionnaire documentaire (seul à voir les noms stockés, qui portent l'identifiant et la version des
  brouillons) clique sur « Rechercher » (`?tab=audit&orphans=1`) : c'est une **simulation**, qui liste sans rien
  supprimer. « Supprimer ces fichiers » retire ensuite, du stockage local, les fichiers que cette liste montre et
  eux seuls (200 au plus par passage, les plus anciens d'abord) : un orphelin apparu depuis attend la recherche
  suivante. Chacun est revérifié juste avant (toujours sans référence, toujours ancien) ; un fichier qui ne l'est plus
  est laissé en place et compté dans le message. La suppression est
  inscrite au journal (« Fichiers orphelins supprimés », cible « Stockage des fichiers · local », avec nom, taille et
  date de chaque fichier) et dans le journal du serveur (`[orphans] removed …`).
  - Délai de grâce `CODEX_ORPHAN_GRACE_HOURS` (24 h par défaut, 1 h au moins) : un fichier écrit, lié ou déplacé
    depuis moins longtemps n'est jamais compté (dépôt en cours). La date retenue est la plus récente de `mtime` et
    `ctime` : le renommage par lien dur change la seconde.
  - Seuls les noms que Codex donne (`<uuid>-…`) sont examinés ; un autre fichier (`.DS_Store`…) est laissé en place.
  - SharePoint (dossier `_staging`) : listé seulement quand il est actif ou que des versions y pointent, jamais
    supprimé tant que le pilote n'a pas été essayé sur un vrai tenant (O-01).
  - Pas de commande npm : PGlite n'ouvre la base que dans un seul processus, celui du serveur. Le planificateur
    (point 38) appellera `purgeOrphans` quand il existera.

## Sauvegarde et restauration

Point 48 de `docs/reste-a-faire.md` ; procédure complète dans **`docs/sauvegarde.md`** (sauvegarder, restaurer, tester
une restauration, dépannage).

```bash
npm run backup                          # serveur arrêté : archive de la base et des fichiers, rotation
npm run backup:list                     # archives, de la plus récente à la plus ancienne
npm run backup:check -- latest          # relit une archive : manifeste, SHA-256 de chaque entrée, schéma
npm run restore -- <archive>            # serveur arrêté, dossier de données vide
npm run restore -- <archive> --replace  # remplace la base et les fichiers, mis de côté dans replaced-<instant>/
```

- **Archive** (`src/lib/backup-core.mjs`) : `codex-backup-<instant UTC>.tar`, avec la base vidée par PGlite
  (`dumpDataDir`) pendant que sa connexion est tenue, après un `CHECKPOINT`, les fichiers locaux que cette base
  référence (pas les orphelins, pas les fichiers SharePoint, comptés) et un `manifest.json` : date, origine, version,
  migration du schéma, nombres de documents, révisions, versions de travail, entrées de journal et fichiers, taille et
  SHA-256 de chaque entrée. L'archive est relue avant la rotation, qui garde les `CODEX_BACKUP_KEEP` plus récentes (7)
  et la plus récente de chacun des `CODEX_BACKUP_KEEP` derniers jours.
- **Où** : `CODEX_BACKUP_DIR`, par défaut à côté du dossier de données (`.data-backups/`, ignoré par git), dossier en
  `0700` et archives en `0600`, non chiffrées. Lieu de conservation, copie hors de la machine, chiffrement et fréquence
  ne sont pas décidés (hébergement) : rien n'est programmé.
- **Serveur en marche** : Administration › Journal d'audit › Sauvegardes, « Sauvegarder maintenant », réservé aux
  gestionnaires documentaires ayant l'accès Administration (l'archive contient les brouillons, D-14) ; les écritures
  attendent pendant le vidage de la base (quelques secondes) ; une sauvegarde par quart d'heure au plus, pour qu'une
  suite de clics n'écarte pas les archives d'avant ; entrée « Sauvegarde créée » au journal (archive, taille, début du
  SHA-256, nombres montrés aux seuls gestionnaires, aucun document nommé). Pas de restauration ni de téléchargement
  depuis l'application.
- **Verrou** : le serveur écrit `codex.lock` dans le dossier de données en ouvrant la base. `npm run backup` et
  `npm run restore` refusent de tourner tant que ce processus vit (PGlite n'ouvre la base que dans un processus), et le
  serveur refuse d'ouvrir la base pendant qu'une de ces commandes travaille. Un verrou laissé par un processus disparu
  est ignoré ; celui d'une commande l'est aussi 10 minutes après son dernier rafraîchissement (toutes les 30 s), au cas
  où son numéro de processus aurait été repris. En cas de doute, l'erreur du serveur nomme le fichier à supprimer
  (dépannage dans `docs/sauvegarde.md`).
- **Restauration** : refusée sur une base ou des fichiers en place sans `--replace` ; refusée pour une archive
  altérée ou d'un schéma que le code ne connaît pas ; la base est chargée à côté, ses nombres et ses fichiers comparés
  au manifeste, avant de remplacer quoi que ce soit ; mise en place entrée par entrée (un `files/` monté à part ou lien
  symbolique reste en place), défaite si un déplacement échoue ; entrée « Base restaurée » au journal, au nom de Codex.
- Les commandes lisent les variables comme Next : l'environnement, puis les fichiers de `next start`
  (`.env.production.local`, `.env.local`, `.env.production`, `.env`), ou ceux de `next dev` avec `--dev` ; elles
  affichent d'abord le dossier de données et celui des sauvegardes. App Mac :
  `CODEX_DATA_DIR="$HOME/Library/Application Support/Codex/data" npm run backup`, app quittée.

## Exploitation : journal technique, santé, configuration

Points 37 et 49 de `docs/reste-a-faire.md` ; procédure complète dans **`docs/exploitation.md`** (champs du journal,
supervision, codes du contrôle de configuration et leur correction).

- **Journal technique** (`src/lib/log.ts`), distinct du journal d'audit : une entrée par ligne sur la sortie du
  serveur, en JSON en production (`next start`, app Mac : `~/Library/Logs/Codex/server.log`), lisible en
  développement ; `CODEX_LOG_FORMAT`, `CODEX_LOG_LEVEL` (`info` par défaut). Une ligne par requête d'API (route,
  statut, durée) et par Server Action d'écriture (nom, issue, durée), chaque jeton refusé (route, adresse, raison),
  toute erreur serveur rattrapée par Next.js (`src/instrumentation.ts`, `onRequestError`), avec sa pile. Chaque entrée
  porte l'identifiant de sa requête, renvoyé dans l'en-tête `X-Request-Id` des réponses d'API (repris d'un reverse
  proxy s'il en pose un). Jamais de jeton, de cookie, de corps de requête, de contenu de document, de chaîne de
  requête ni de valeur d'une requête de base en échec.
- **Santé** : `GET /api/health` (ou `HEAD`) répond 200 quand la base répond et que le stockage actif est utilisable,
  503 sinon, avec la version et le résultat de chaque contrôle, sans dire pourquoi (la raison est au journal, sous le
  même identifiant). Sans session ni jeton.

  ```bash
  curl -fsS http://localhost:3100/api/health
  # {"status":"ok","version":"0.1.0","checks":{"database":{"ok":true,"ms":1},"storage":{"ok":true,"ms":2}},…}
  ```
- **Contrôle de la configuration au démarrage** (`src/lib/config-check.ts`, appelé par `register` de
  `src/instrumentation.ts`) : chaque variable de `.env.example` lue comme le code la lit ; ce qui serait ignoré ou mal
  lu est écrit au journal avec la variable à corriger. Une erreur (stockage inconnu ou SharePoint incomplet, jeton
  d'intégration de moins de 32 caractères, adresse Vigie ou Keystone qui n'est pas une URL http(s), `CODEX_CLAMD`
  illisible, dossier de données non inscriptible) **arrête le serveur en production** (code de sortie 1) ; en
  développement, elle est seulement écrite. `CODEX_CONFIG_CHECK=warn` ou `strict` change ce comportement. Sans
  aucune variable, il n'y a aucune erreur : `npm run dev`, `npm run start` et l'app Mac démarrent comme avant.

## Organisation du code

```
src/
  proxy.ts             politique de sécurité du contenu des pages (nonce par requête), HSTS si CODEX_HTTPS
  instrumentation.ts   au démarrage, contrôle de la configuration ; erreurs serveur au journal technique
  app/                 routes (pages serveur) + styles par écran (*.module.css)
    nocturne.css       design system Nocturne (copie de design/_ds/…/styles.css)
    globals.css        règles d'application communes
    api/               fichiers, fiches de visa, exports CSV, registre, import, webhook Vigie, santé (health)
  components/
    shell/             barre latérale, en-tête, contexte client (dialogues, toasts)
    dialogs/           toutes les boîtes de dialogue
    ui/                icônes de la maquette, contrôle segmenté, steppers, boutons d'action, pages d'une liste
  db/                  schéma Drizzle, connexion PGlite (déclencheurs, termes de recherche repliés), données de démonstration
  lib/
    actions.ts         Server Actions (toutes les mutations + contrôles de droits)
    queries.ts         lectures et modèles de vue ; recherche, explorateur et journal filtrés, comptés et paginés par la base
    context.ts         langue, utilisateur et rôle simulés, registre, libellés, droits
    access.ts          visibilité (confidentialité, cercle de rédaction), en TypeScript et en condition SQL
    lifecycle.ts       révisions : mise en vigueur, remplacement, décisions Vigie
    links.ts           liens entre documents : remplace / remplacé par, voir aussi
    approval.ts        fiche de visa d'une révision : étapes, délégations, mise en page
    pdf.ts             écriture de PDF sans dépendance (retour à la ligne, accents, plusieurs pages)
    codes.ts           identifiants TYPE-CONTEXTE-SEQ et lettres de révision
    registry-rules.ts  administration du registre : formats des codes, collisions entre segments d'un identifiant,
                       lecture des formulaires de type, famille, fonction et programme
    retention.ts       fin de conservation
    review.ts          expiration et revue périodique : indicateurs, prochaine date de revue
    concurrency.ts     modifications simultanées : version vue par un dialogue, version de travail de base
    search.ts          recherche : facettes, période, tri, pertinence
    departments.ts     pages par département : filtres mis en avant
    storage.ts         stockage des fichiers (disque local ou SharePoint) ; contrôle et analyse avant stockage ;
                       lecture en flux
    ranges.ts          plages d'octets (206, 416) et requêtes conditionnelles (ETag, 304) de la route fichier
    orphans.ts         fichiers orphelins du stockage : simulation, suppression journalisée, délai de grâce
    backup-core.mjs    sauvegarde et restauration : archive tar, manifeste, empreintes, rotation, verrou du dossier de
                       données (JavaScript, lancé aussi par scripts/codex-backup.mjs sans compilation)
    backup.ts          sauvegarde depuis Administration (serveur en marche), journalisée
    filetypes.ts       formats, contenu (signatures, ZIP, OLE2, macros) et taille admis au dépôt ; types servis en
                       ligne et affichés en aperçu
    antivirus.ts       analyse antivirus des fichiers déposés (clamd, commande INSTREAM)
    keystone.ts, vigie.ts  frontières d'intégration
    importer.ts        API d'import (outil de migration)
    ratelimit.ts       limites de débit des routes sensibles et des Server Actions (en mémoire)
    security-headers.ts  en-têtes de sécurité HTTP et politique de sécurité du contenu
    log.ts             journal technique : entrées JSON ou lisibles, identifiant de requête, routes et actions
    config-check.ts    contrôle de la configuration au démarrage
    version.ts         version de Codex (package.json), pour la santé et les sauvegardes
    i18n.ts            textes FR / EN
scripts/
  codex-backup.mjs     commandes npm run backup, backup:list, backup:check, restore (docs/sauvegarde.md)
tests/
  unit/                tests unitaires des règles pures de src/lib (Vitest, vitest.config.ts)
  integration/         tests d'intégration sur PGlite en mémoire (règles métier de src/lib, Server Actions, webhook)
  support/             base de test et données minimales, session simulée, remplacement de server-only, lecture des PDF,
                       faux clamd, ZIP et fichiers composés (OLE2) minimaux
```

## Décisions et points ouverts

Les décisions prises avec l'utilisateur et les questions encore ouvertes sont dans `docs/decisions.md` ; le deck
d'origine et son audit dans `docs/sources/` et `docs/audit-deck-epc2i.md`. Voir aussi `docs/registre-points-ouverts.md`
(registre des types) et les points *provisoires* de `docs/modele-cible.md` (organisation, stockage SharePoint).
