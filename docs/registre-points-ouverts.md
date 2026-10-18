# Registre des types — points à arbitrer

Le registre (`src/db/registry.ts`, modifiable ensuite dans Administration › Registre des types) fusionne les 45 types
du deck et les 28 types de la spec Keystone : **69 types dans les 23 familles du deck**. Les codes Keystone sont
conservés (PRO, NCR, PID, CER…) ; les types du deck ont reçu un code mnémonique (POL, GOV, RSQ, DTF, PRT…).

## Choix de fusion à valider
- Le type deck « Audit & Inspection » est éclaté : rapport d'audit interne → AUD, fiche de non-conformité → NCR,
  checklist d'inspection remplie → REC (vierge → FRM).
- MIN (compte rendu de réunion) est transversal (Gouvernance & Management) ; il reprend « PV de réunion » et
  « note de réunion ». On peut le déplacer en Gouvernance projet.
- Les codes d'ingénierie Keystone (PID, PFD, SCH, GA, LST, BOM, FDS, HMI, VAR) sont des types à part entière ;
  LDC garde les autres plans, notes de calcul et revues de conception.
- **FDS désigne la spécification fonctionnelle** (code Keystone). Les fiches de données de sécurité deviennent le
  sous-type « Fiche de données de sécurité » du type DTF (documentation technique).
- PER = permis de travail de chantier ; les permis et autorisations administratifs restent en AUT.

## Questions ouvertes
1. Codes identiques à des codes de département (FIN, HSE, COM, JUR) : on obtient FIN-FIN-0001, HSE-HSE-0001… Garder ou
   renommer ? JUR (type « Acte juridique » et département Juridique) manquait à la liste d'origine : relevé le 18 octobre
   2026 (lot 10), la question reste la même. En attendant la réponse, l'administration garde ces quatre codes et refuse
   tout nouveau code (type, département, programme) qui recréerait une telle collision (`docs/decisions.md`).
2. MIN, PO, HSE et VIS admettent « sans rattachement » mais leur circuit contient une étape « chef de projet » :
   hors projet, l'étape revient au titulaire « groupe » de la fonction (aujourd'hui Marie Lefebvre). OK ?
3. Conservation déclenchée par « fin de projet » pour DQF, CER, COC, HSE hors projet, et pour les 12 types recherche
   (fin de programme) : la date n'est pas connue de Codex, la fin de conservation reste donc à calculer. Faut-il un
   déclencheur « fin de programme » et un repli sur la date de création hors projet ?
4. Livrables client : renseigné pour EXG, MES, REM et les types Keystone. LDC, AVT, DEF, CLO aussi ?
5. COC n'admet que l'origine externe : EPC2I émet-elle ses propres déclarations CE (intégrateur de machines) ?
6. Durées à confirmer : RSQ applique 40 ans (DUERP) à toutes les analyses de risques, rapports d'incident et CAPA ;
   RHF applique « départ du salarié + 5 ans » aussi aux supports de formation et fiches de poste.
7. Doublons du deck conservés : « demande d'achat » (FIN / ADC), « journal de décisions » (GOV / PIL), « RFQ » (COM / RFQ).
8. Clauses ISO discutables reprises de Keystone : CER 8.4.3 (8.4.2 ?), CTR 8.2 (les contrats fournisseurs relèvent de 8.4).
9. Sous-types ajoutés hors deck à valider (FRM, REC, CTR contrat client, DTF fiche de données de sécurité, LST, BOM,
   RFQ, RPT FAT/SAT, PER, HSE, VIS, MAN) ; sous-types du deck repris mot pour mot (style télégraphique).

## Valider le registre avec le cahier

Outillage du 18 octobre 2026 (lot 10, étape 2). Il présente l'état et prépare les réponses ; **il ne tranche rien,
ne préremplit aucune réponse et n'écrit ni dans la base ni dans `src/db/registry.ts`**.

```bash
npm run registry:review -- --out <dossier>        # écrit types.csv et fonctions.csv
npm run registry:review -- --check <dossier>/types.csv --check <dossier>/fonctions.csv [--org <organigramme.csv>]
```

- **Ce que montrent les cahiers** : le registre du code (`src/db/registry.ts` ; fonctions et titulaires de
  démonstration de `src/db/seed-org.ts`), pas une base : un réglage fait dans l'Administration n'y figure pas. Format
  des autres exports : BOM, point-virgule, formules neutralisées (`src/lib/csv.ts`), lisible par Excel en français.
  `--out` refuse d'écraser un cahier déjà présent (`--force` pour le remplacer).
- **`types.csv`** : une ligne par type (69), avec code, libellés FR et EN, famille (clé et libellé), origines,
  rattachements, sous-types FR et EN, circuit, durée, déclencheur, sort final, fondement FR et EN, niveaux admis et
  défaut, livrable client, ISO, source (deck, Keystone, les deux). Les listes sont séparées par « | ». Les valeurs
  sont les clés du code : origines `interne`, `externe` ; rattachements `none`, `project`, `research` ; niveaux
  `public`, `restreint`, `interne`, `confidentiel`, `tres_confidentiel` ; déclencheurs `creation`, `in_force`,
  `superseded`, `project_end`, `contract_end`, `fiscal_year_end`, `expiry`, `asset_life`, `employee_departure`,
  `permanent` ; sorts `destroy`, `review`, `archive`, `permanent` ; circuit : clés des fonctions.
- **Colonne « Question liée »** (au 18 octobre 2026) :

  | Drapeau | Types | Question |
  |---|---|---|
  | Aucune durée | 16 : 14 « durée de vie de l'actif » (MNT, DTF, EXG, FDS, HMI, VAR, LDC, PID, PFD, SCH, GA, LST, BOM, MAN), GOV et PUB permanents | O-07 |
  | Conservation à la fin du projet | 26 | question 3 ci-dessus |
  | Admet « Public » | 5 : POL, REG, DTF, PUB, COL | O-08 |
  | Code aussi celui d'un département | 4 : FIN, HSE, COM, **JUR** | question 1 ci-dessus |
  | Aucun circuit | 3 : LET, RFQ, PHO | O-06 |

- **`fonctions.csv`** : une ligne par fonction (16) : clé, libellés, portée (`global`, `department`, `project`,
  `research`), titulaires de démonstration (`DIR=hcosta (Hélène Costa)` pour un titulaire d'une valeur de portée,
  `hcosta (…)` sans valeur), types dont le circuit la nomme ; « Question liée » : O-06, et la portée fixe des
  fonctions des règles de Codex (`chef_projet`, `validation_client`, `resp_departement`).
- **Réponses** : colonnes vides « Validé (oui/non) » et « Correction » (texte libre) ; pour les types, « Nouveau code
  (renommage) ». On peut aussi corriger une valeur dans sa cellule, ajouter une ligne (nouveau type ou fonction) ou en
  supprimer une ; la colonne « Code » (« Clé ») reste l'identité de la ligne.
- **`--check`** lit un ou deux cahiers remplis (reconnus à leur en-tête) et n'écrit rien. Il contrôle chaque valeur
  avec les règles de l'Administration (`src/lib/registry-rules.ts` : formats des codes et clés, collisions d'un code
  avec un type, un département, un projet, un programme ou `QMS`, valeurs admises, niveau par défaut admis, portée
  fixe des fonctions des règles de Codex, modèles sans rattachement), les fonctions des circuits (celles d'un cahier
  de fonctions contrôlé en même temps comprises) et les titulaires (personnes et départements de la démonstration, ou
  ceux d'un organigramme donné par `--org`, voir `npm run org:check`). Il affiche ensuite les réponses (« oui »,
  « non », vides), l'écart avec le code champ par champ, les renommages demandés, les lignes ajoutées ou absentes.
  Les codes FIN, HSE, COM et JUR, déjà donnés, ne sont pas signalés comme erreur : un nouveau code ou un renommage
  l'est. Code de sortie 1 si une valeur est refusée.
- **Ensuite** : les réponses validées par l'utilisateur seront reportées dans `src/db/registry.ts` (ou
  `src/db/seed-org.ts`), puis `npm run registry:apply` (point 118 de `docs/reste-a-faire.md`) ; rien n'est appliqué
  par ces commandes.

### Organigramme : modèle et contrôle (O-04)

```bash
npm run org:check -- <organigramme.csv>
```

- **Modèle** : `docs/modeles/organigramme.csv`. Il reprend les 15 départements et les 3 sites provisoires de
  `src/db/seed-org.ts`, sans personne ; c'est l'état actuel, à remplacer ou corriger, pas une proposition. Une ligne
  par département, site ou personne :

  | Colonne | Département | Site | Personne |
  |---|---|---|---|
  | Nature | `département` | `site` | `personne` |
  | Code | 3 lettres majuscules | clé (`le_havre`) | identifiant, sans espace (en attendant O-02) |
  | Nom | — | — | nom complet (obligatoire) |
  | Libellé FR / Libellé EN | libellés (EN facultatif) | libellés (EN facultatif) | intitulé de poste (facultatif) |
  | Société (colonne facultative) | texte libre | texte libre | texte libre |
  | Département | — | — | code d'un département du fichier (obligatoire) |
  | Site | — | — | clé d'un site du fichier (facultatif) |
  | Responsable | identifiant d'une personne du fichier (facultatif) | — | — |
  | Rôle Codex | — | — | `collaborateur`, `validateur`, `auditeur`, `gestionnaire`, ou un rôle de la matrice (`lecteur`, `contributeur`, `administrateur`), ou vide |

- **Contrôle** (`src/lib/org-review.ts`) : libellés (`orgLabels`, `src/lib/org-rules.ts`), format des codes
  (`src/lib/registry-rules.ts`), un département au moins, doublons de code, références inconnues (département, site,
  responsable), et **collisions** d'un code de département avec un code de type de `src/db/registry.ts`, `QMS`, un
  projet ou un programme. Sur le modèle, il relève les quatre collisions de la question 1 (COM, HSE, FIN, JUR) et
  rien d'autre. La société n'est qu'une colonne lue et listée : Codex n'a pas de table société (O-04, option C).
  Rien n'est écrit, ni en base ni ailleurs ; code de sortie 1 en cas d'erreur, de doublon ou de collision.
- Les personnes et départements d'un organigramme contrôlé servent aussi aux titulaires de `fonctions.csv` :
  `npm run registry:review -- --check fonctions.csv --org organigramme.csv`.
