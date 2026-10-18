# Accessibilité de Codex

Bilan du 18 octobre 2026 (lot 9, étape 8 ; point 55 de [reste-a-faire.md](reste-a-faire.md)). Le deck et
[decisions.md](decisions.md) ne posent aucune exigence d'accessibilité : le RGAA n'est pas exigé, et rien n'a été
audité selon lui. La démarche est une démarche de qualité, alignée sur les WCAG 2.2 niveau AA, sans s'écarter de la
maquette (`design/GED Groupe.dc.html`, design system Nocturne, thème sombre seul).

## Contrôle automatisé : `npm run a11y`

`scripts/codex-a11y.mts` lance axe-core 4.14 dans Chromium (playwright-core) sur l'application servie par Codex :

```bash
npm run build && npm run a11y           # build de production, base de démo jetable, interface en français
npm run a11y -- --lang all              # français puis anglais
npm run a11y -- --dev                   # next dev au lieu du build (plus lent ; aucun autre next dev dans le dépôt)
npm run a11y -- --url http://localhost:3100 --json rapport.json   # application déjà lancée, rapport complet
```

- **Base** : sans `--url`, le script démarre son propre serveur (port 3190, `--port` pour un autre) sur une base de
  démonstration neuve, dans un dossier temporaire supprimé à la fin (`CODEX_DATA_DIR`, `CODEX_SEED=demo`, jamais
  `.data/`). Avec `--url`, il travaille sur la base de ce serveur : aucun dialogue n'est envoyé, mais les fiches
  ouvertes y sont journalisées comme des consultations.
- **Navigateur** : le Chromium que connaît playwright-core (`PLAYWRIGHT_BROWSERS_PATH`, ou
  `npx playwright-core install chromium`), ou celui de `CODEX_A11Y_CHROMIUM`.
- **Ce qui est parcouru**, comme l'utilisatrice simulée par défaut (Claire Bardet, gestionnaire documentaire, qui voit
  tous les écrans) : 30 écrans et onglets (Accueil, Explorateur avec et sans aperçu rapide, Recherche avec et sans
  critères, page de département, fiche en vigueur et ses cinq onglets, fiche de projet, brouillon, Validations et ses
  vues dont « Mes demandes Vigie », les quatre onglets d'Archivage, les huit onglets d'Administration, Aide, page
  introuvable) et 20 dialogues (nouveau document depuis un modèle et depuis un fichier, notes, simulation de
  l'utilisateur, métadonnées, demandes de modification et de retrait, lecteurs désignés, lien, version de travail,
  demande de validation, comparaison, rejet, délégation, rappel, simulation Vigie, recherche enregistrée, type,
  fonction, département). Chaque dialogue est ouvert, analysé, puis fermé par Échap : rien n'est enregistré.
- **Règles** : celles d'axe marquées WCAG 2.0, 2.1 et 2.2 niveaux A et AA, et ses bonnes pratiques. Le script
  échoue (code 1) sur une violation qu'axe classe sérieuse ou critique ; les modérées et mineures sont listées.
- **Contrôles en plus** : le premier arrêt de la touche Tab est « Aller au contenu », visible quand il a le focus, et
  Entrée envoie le focus sur `<main id="contenu">` ; le focus entre dans chaque dialogue à l'ouverture et Échap le
  ferme ; chaque écran répond 200 (404 pour la page introuvable), sans erreur JavaScript.
- **Durée** : environ 70 s en français, 125 s pour les deux langues (build de production, conteneur de la session
  cloud). Trois passages de suite ont donné le même résultat.
- **Intégration continue** : `.github/workflows/ci.yml` l'exécute après le build, en français, après
  `npx playwright-core install --with-deps chromium`. Cette étape n'a pas encore tourné sur GitHub au moment du commit
  (branche non poussée) : si l'installation de Chromium y échouait, la retirer de la CI et garder `npm run a11y` en
  local suffit.

## Résultats

| | Avant (commit `65af2e6`) | Après |
|---|---|---|
| Éléments en violation sérieuse ou critique | 82 : contraste 65, contrôles imbriqués 8, cibles trop petites 6, attribut ARIA interdit 3 | 0 (français et anglais) |
| Éléments en violation modérée ou mineure | 52 : page sans titre de niveau 1 30, en-têtes de tableau vides 14, ordre des titres 7, repère sans nom distinct 1 | 0 |
| Contrôles en plus | pas de lien d'évitement, `/aide` absente | tous passent |

Mesure « avant » : le même script sur le code du commit `65af2e6`, servi par `next dev` sur une base de démo neuve.

### Contrastes mesurés (WCAG 1.4.3, 4,5:1 pour un texte de moins de 18,66 px gras ou 24 px)

Fonds Nocturne : `--color-bg` #161826 (écran), `--color-surface` #232532 (cartes, dialogues, champs). Texte
`--color-text` #e9e9ed, mêlé à la transparence par `color-mix`.

| Texte | Sur le fond | Sur une surface | Constat |
|---|---|---|---|
| `.text-muted` (texte à 55 %), dont les textes de 10 à 11 px (`.sub`, dates, compteurs) | 5,19 | 4,83 | passe |
| Libellés de champ (70 %) | 7,64 | 6,89 | passe |
| En-têtes de tableau (60 %, 11 px) | 5,94 | 5,47 | passe |
| Accent #9184d9 (liens, surtitres de carte de 10 px, étiquettes en contour) | 5,45 | 4,71 | passe |
| Étiquettes pleines (accent-100 sur accent-800, neutral-100 sur neutral-800) | 9,42 | 9,20 | passe |
| `.card-meta` de Nocturne (50 %, 11 px), sous les chiffres des cartes | — | 4,25 | **corrigé** : 55 % comme `.text-muted`, 4,83 (`src/app/globals.css`) |
| Portée d'un titulaire et nombre d'usages d'un terme (opacité 0,6 sur une étiquette neutre) | — | 4,47 | **corrigé** : opacité 0,7, 5,47 |
| Nombre de termes dans le titre d'une section de Vocabulaires (texte atténué dans un titre déjà à 70 %) | 3,18 | — | **corrigé** : le nombre prend l'opacité du titre, 7,64 |
| Petits caractères de la page maquette de l'aperçu (neutral-600 sur neutral-100, 8 et 9 px) | 3,96 sur le papier | | **corrigé** : entre neutral-600 et neutral-700, 4,9 (`document.module.css`) |

Les états désactivés (opacité 0,45 de Nocturne) sont exemptés par les WCAG et n'ont pas été modifiés. Aucune taille
de texte n'a changé ; il n'y a pas de thème clair (la maquette n'en a pas). Les captures d'écran de 19 écrans avant et
après ne diffèrent que sur les éléments corrigés, le bas de la barre latérale (Aide ajoutée au-dessus de « Notes de
conception ») et, sur la page d'un département, un décalage de 3 px sous « N de plus ».

### Autres corrections

- **Lien d'évitement** (WCAG 2.4.1) : « Aller au contenu » / « Skip to content », premier élément de la page, caché
  jusqu'à ce qu'il reçoive le focus, mène à `<main id="contenu" tabindex="-1">` (`src/app/layout.tsx`, `.skip-link` dans
  `src/app/globals.css`).
- **Titres** : le nom de l'écran dans l'en-tête est le seul `<h1>` de la page ; les titres de section, dessinés comme
  le `h6` de Nocturne, sont des `<h2>` (classe `.sec-title`), le titre d'une fiche ou d'un circuit aussi ; mêmes
  rendus qu'avant.
- **Repères** : la barre latérale est la « Navigation principale » ; les deux colonnes `<aside>` de l'Explorateur
  sont nommées (« Plan de classement », « Aperçu rapide »).
- **Versions de travail** (onglet Révisions) : la ligne n'est plus un bouton qui contient le lien de téléchargement ;
  son étiquette (« A.2 ») est un bouton à bascule (`aria-pressed`, « Sélectionner la version A.2 »), la ligne reste
  cliquable à la souris.
- **Pagination** : « Page précédente » inactive est un lien désactivé (`role="link"`, `aria-disabled`), et non un
  `span` portant un `aria-label` interdit.
- **Tableaux** : chaque colonne de boutons a un en-tête lu par les lecteurs d'écran seulement (« Actions »,
  « Attribut » dans la comparaison ; classe `.sr-only`).
- **Cibles** (WCAG 2.5.8) : « N de plus » des pages de département et le sommaire de l'Aide font 24 px de haut ; les
  cases des niveaux de confidentialité du dialogue de type sont espacées de 6 px.

## Affichage étroit et zoom : `npm run a11y -- --narrow`

Lot 10, étape 6 (18 octobre 2026 ; points 79 et 55 de [reste-a-faire.md](reste-a-faire.md)). WCAG 1.4.10 (redistribution :
320 px de large sans défilement dans les deux sens) et 1.4.4 (texte agrandi à 200 % sans perte de contenu).

```bash
npm run build && npm run a11y -- --narrow                       # ~190 s en français
npm run a11y -- --narrow --json etroit.json --shots captures/   # chaque constat, une capture par écran et taille
```

- **Tailles** (`scripts/codex-narrow.mts`) : chaque écran et chaque dialogue du contrôle ordinaire (30 et 20), rendus à
  **1 440 × 900** (référence, le bureau), **320 × 256** px CSS (l'équivalent WCAG de 1 280 × 1 024 à 400 %) et
  **640 × 400** px CSS à deux pixels par px CSS (**1 280 × 800 zoomé à 200 %**, ce que fait le zoom du navigateur).
  axe tourne à chaque taille.
- **Relevés**, dans la page :
  - **page** : débordement horizontal de la page, en px ; pour un dialogue, de combien sa boîte sort de la fenêtre.
    `html` et `body` cachent leur débordement, donc ce qui dépasse le bord droit est inatteignable : aucune barre ne
    l'amène ;
  - **hors fenêtre** : textes et contrôles au-delà d'un bord de la fenêtre ;
  - **masqués** : coupés par un bloc qui cache son débordement (`overflow: hidden`) ;
  - **tronqués** : textes coupés par des points de suspension ;
  - **blocs à défilement horizontal** : leur contenu s'atteint, mais en deux dimensions, ce que 1.4.10 admet pour un
    tableau ;
  - **superpositions** : deux textes ou contrôles dessinés l'un sur l'autre.
- Un texte compte par la boîte de son texte, un contrôle par la sienne ; ce qui est caché ou réservé aux lecteurs
  d'écran est ignoré. Les nombres au bureau font partie de la maquette (titres longs en points de suspension, loupe
  dans le champ de recherche). Ce qu'ajoutent les tailles étroites est la différence.
- Le script affiche une ligne par écran et taille, puis les totaux. Le détail est dans `--json` : éléments, textes,
  px, et pour chaque page trop large les éléments les plus extérieurs qui la font déborder.
- **Constats non bloquants** : avec `--narrow`, ni la mise en page ni une violation axe trouvée aux tailles étroites
  ne font échouer la commande. Seuls comptent, comme d'habitude, le bureau et les contrôles. L'option n'est pas
  dans la CI.
- `--shots <dossier>` (aussi sans `--narrow`) garde une capture de chaque écran et dialogue. C'est ainsi qu'on vérifie
  qu'une correction ne change pas le bureau.

### Résultats (français, build de production, base de démonstration neuve)

| | 1 280 px à 200 %, avant | après | 320 px, avant | après |
|---|---|---|---|---|
| Écrans ou dialogues plus larges que la fenêtre (sur 50) | 15 | **3** | 30 | 30 |
| Débordement de la page (px) | jusqu'à 804 (Administration), 541 sur ses autres onglets, 357 (Archivage) | 132 (Explorateur avec aperçu), 64 (Recherche ×2) | 305 à 1 124 | 305 partout |
| Textes et contrôles hors fenêtre | 252 | **28** | 1 162 | 529 |
| Masqués par un bloc | 59 | 59 | 114 | 188 (contrôles passés de « hors fenêtre » à « masqués » dans les onglets qui vont à la ligne) |
| Tronqués (bureau : 183) | 205 | 205 | 233 | 237 |
| Blocs à défilement horizontal (bureau : 2) | 27 | 27 | 32 | 31 |
| Superpositions (bureau : 40, maquette) | 40 | 40 | 0 | 0 |
| Violations axe sérieuses | 1 | 1 | 14 | 14 |

Au bureau (1 440 px) : 0 violation avant comme après. Le débordement de 4 px (invisible) de l'onglet Registre
d'Administration a disparu.

**Corrections, sans effet sur le bureau** (à 1 440 px, 30 écrans et 20 dialogues capturés avant et après :
49 captures identiques au pixel près ; la cinquantième, Administration › Journal, ne diffère que par les heures du
planificateur) :

- **Barre latérale** : elle défile quand la fenêtre est trop basse (`overflow-y: auto`, `Sidebar.module.css`). À 200 %, l'Aide,
  les notes de conception et le profil (simulation de l'utilisateur) étaient sous le bord de la fenêtre sur les
  30 écrans, inatteignables.
- **Onglets d'Administration et d'Archivage, filtres des échéances** : ils vont à la ligne quand leur rangée est trop
  étroite (`<Seg wrap>`, classe `.seg-wrap`). Les huit onglets d'Administration faisaient déborder la page de 541 px.
  Les autres contrôles segmentés (langue de l'en-tête, Explorateur, fiche, dialogues) n'ont pas changé : leur
  passage à la ligne déformait l'en-tête.
- **En-têtes de colonne réservés aux lecteurs d'écran** (« Actions », « Attribut ») : ils restent dans le flux de leur
  cellule (`th > .sr-only`). Positionnés jusqu'ici par rapport à l'écran, ils prolongeaient la page jusqu'au bord
  droit d'un tableau large qui défile pourtant dans son bloc : 182 à 804 px de débordement invisible à 200 %. La
  cellule elle-même n'est pas positionnée, sinon elle couvrirait le trait sous les en-têtes (vu sur les captures).
- **Dialogue « Nouveau document », liste des modèles** : la ligne de référence d'un modèle se termine par des points de
  suspension au lieu de sortir du dialogue.

### Ce qui reste : dépend de M23 (accès terrain et mobile)

Ces constats demandent une autre mise en page sur écran étroit. Ce choix appartient à la réponse à M23 (point 79 de
[reste-a-faire.md](reste-a-faire.md)), avec la maquette, qui ne prévoit que le bureau. Rien n'a été refondu : ni
barre latérale repliable, ni PWA.

- **320 px** : la barre latérale fixe de 224 px laisse 96 px aux écrans, et l'en-tête (titre d'au moins 200 px,
  recherche, langue, cloche) fait déborder chaque écran de 305 px. Viennent ensuite les tableaux, les colonnes de
  l'Explorateur et de la Recherche, et le panneau de fiche. Tous les écrans sont concernés, aucun dialogue (ils
  prennent la largeur de la fenêtre et défilent).
- **Fiche document, à 320 px** : la zone d'aperçu, écrasée par le panneau de 400 px, défile sans pouvoir recevoir le
  focus (axe `scrollable-region-focusable`, sérieux, 14 écrans de fiche). Lui donner le focus ajouterait un arrêt de
  tabulation au bureau.
- **Fiche document, à 200 %** : le panneau latéral garde 400 px. La colonne d'aperçu tombe à 16 px et « Aucun fichier
  joint » déborde sur la barre latérale. Sur une fiche en brouillon, les onglets du panneau sortent de la fenêtre
  (1 à 9 éléments hors fenêtre).
- **Explorateur avec aperçu rapide, à 200 %** : les trois colonnes (plan de classement, liste, aperçu) dépassent de
  132 px ; 57 éléments de la liste sont masqués.
- **Recherche, à 200 %** : la colonne des filtres est fixe et « Trier par » sort de 64 px.
- **Tableaux** (Archivage, Administration, Validations, journal) : ils défilent dans leur bloc, en deux dimensions,
  comme 1.4.10 l'admet pour un tableau ; une présentation en liste relèverait de M23.
- **Titres en points de suspension** dans les listes (205 à 200 %, dont 183 déjà au bureau) : le titre entier est dans
  la fiche.
- **Contraste au survol** (trouvé par `--narrow`, présent aussi au bureau) : dans « Nouveau document », la référence
  d'un modèle (texte atténué à 55 %, 11 px) sur une ligne survolée (`hover-tint`) donne 4,38:1, sous les 4,5:1. Ce
  n'est pas un débordement : laissé tel quel, à corriger avec la teinte de survol de Nocturne.
- **Anglais** : `--narrow --lang all` n'a pas été mesuré, seulement le français.

## Ce qui reste

- **Test manuel avec un lecteur d'écran** (NVDA ou JAWS sous Windows, VoiceOver sous macOS) sur les parcours de l'Aide :
  création, dépôt, demande de validation, décision, demande à Vigie. axe ne vérifie qu'une partie des critères (pas la
  pertinence des libellés, l'ordre de lecture, les annonces des messages ni la compréhension).
- **Zoom et redimensionnement** (WCAG 1.4.4, 1.4.10) : mesurés le 18 octobre 2026 (`npm run a11y -- --narrow`,
  ci-dessus). Les débordements sans effet sur le bureau sont corrigés. Le reste demande une mise en page sur écran
  étroit, qui dépend de M23.
- **Contenus produits par Codex** : les PDF générés (fiche de visa, page de démonstration téléchargée) ne sont pas
  balisés ; le contenu des fichiers déposés relève de leurs auteurs.
- **App Mac** (WebKit) : non vérifiée, faute de session macOS.
- **Écrans et états non parcourus** : le script ne parcourt qu'un rôle et les données de démonstration ; les autres
  rôles, les messages d'erreur et les dialogues qu'il n'ouvre pas (greffe, revue, conservation, reprise,
  vocabulaires, registre complet) suivent les mêmes composants mais n'ont pas été analysés un à un.
- **RGAA** : non exigé ; une déclaration d'accessibilité et un audit RGAA demanderaient une décision de l'utilisateur.
