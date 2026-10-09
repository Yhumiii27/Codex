# API d'intégration de Codex

Points d'entrée prévus par `docs/modele-cible.md` §1 pour les applications voisines :

| Point d'entrée | Méthode | Consommateur | Authentification |
|---|---|---|---|
| `/api/registry` | `GET` | Keystone | aucune (lecture seule, réseau du groupe) |
| `/api/import` | `POST` | outil de migration | jeton `CODEX_IMPORT_TOKEN` |
| `/api/integrations/vigie` | `POST` | Vigie (webhook) | jeton `VIGIE_WEBHOOK_TOKEN` |

Code : `src/app/api/registry/route.ts`, `src/app/api/import/route.ts`, `src/app/api/integrations/vigie/route.ts`,
logique partagée dans `src/lib/importer.ts`.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `CODEX_IMPORT_TOKEN` | Jeton attendu par `/api/import`. Absente ou vide : l'import est **désactivé** (503). |
| `CODEX_IMPORT_MAX_MB` | Taille maximale d'un fichier importé, en Mo (100 par défaut ; 250 au plus avec `CODEX_STORAGE=sharepoint`). |
| `VIGIE_WEBHOOK_TOKEN` | Jeton attendu par `/api/integrations/vigie`. Absente ou vide : le webhook est **désactivé** (503). |

Les fichiers importés vont dans le stockage actif (`CODEX_STORAGE`, voir `src/lib/storage.ts`) : disque local par défaut,
bibliothèque SharePoint en option.

Générer un jeton : `openssl rand -base64 32`. Les mêmes valeurs sont déclarées (en commentaire) dans `.env.example`.

## Conventions

- Corps et réponses en JSON (`Content-Type: application/json`), dates au format `AAAA-MM-JJ`.
- Erreur : `{ "error": "<code>", … }` avec un code stable, en anglais, destiné aux programmes.
- Jeton : en-tête `Authorization: Bearer <jeton>`, comparé en temps constant.
  - variable d'environnement non définie → **503** `{"error":"disabled"}` (le point d'entrée est fermé) ;
  - en-tête absent ou jeton faux → **401** `{"error":"unauthorized"}` avec `WWW-Authenticate: Bearer realm="codex"`.
- Les réponses des points d'entrée protégés portent `Cache-Control: no-store`.

---

## `GET /api/registry` — registre des types

Registre des familles et des types de documents, dont Codex est propriétaire et que Keystone lit (`docs/modele-cible.md`
§2). Lecture seule, sans session ni jeton tant qu'Entra ID n'est pas branché : à n'exposer que sur le réseau du groupe.
Keystone l'appelle de serveur à serveur (pas d'en-têtes CORS).

**Cache** : `Cache-Control: public, max-age=60, must-revalidate` et un `ETag` calculé sur le contenu du registre ;
une requête avec `If-None-Match` reçoit **304** tant que le registre n'a pas changé.

```bash
curl -s http://localhost:3100/api/registry | jq '.types[] | {code, family, active}'

# Revalidation : 304 si rien n'a changé
curl -si http://localhost:3100/api/registry -H 'If-None-Match: "<valeur de l’ETag reçu>"'
```

Réponse **200** (extrait) :

```json
{
  "schema": "codex.registry/1",
  "confLevels": [
    { "key": "public", "labels": { "fr": "Public", "en": "Public" } },
    { "key": "restreint", "labels": { "fr": "Restreint", "en": "Restricted" } }
  ],
  "families": [
    { "key": "ingenierie_conception", "labels": { "fr": "Ingénierie & Conception", "en": "Engineering & Design" }, "group": "DP", "types": ["PID", "PFD", "…"] }
  ],
  "types": [
    {
      "code": "PID",
      "labels": { "fr": "P&ID (schéma de tuyauterie et d’instrumentation)", "en": "P&ID (piping and instrumentation diagram)" },
      "family": "ingenierie_conception",
      "origins": ["interne", "externe"],
      "attachments": ["project"],
      "subtypes": [],
      "circuit": [
        { "function": "referent_ingenierie", "labels": { "fr": "Référent ingénierie", "en": "Engineering lead" }, "scope": "project" },
        { "function": "chef_projet", "labels": { "fr": "Chef de projet", "en": "Project manager" }, "scope": "project" }
      ],
      "retention": {
        "years": null,
        "trigger": "asset_life", "triggerLabels": { "fr": "Durée de vie de l’actif", "en": "Asset life" },
        "disposition": "review", "dispositionLabels": { "fr": "Revue", "en": "Review" },
        "basis": "…"
      },
      "confAllowed": ["restreint", "interne", "confidentiel"],
      "confDefault": "restreint",
      "iso": "8.3 Conception et développement",
      "clientDeliverable": true,
      "active": true,
      "source": "keystone"
    }
  ],
  "generatedAt": "2026-10-08T07:58:19.512Z"
}
```

| Champ d'un type | Contenu |
|---|---|
| `code` | Code du type, premier segment de l'identifiant `TYPE-CONTEXTE-SEQ`. |
| `labels` | Libellés FR / EN. |
| `family` | Clé de la famille (`families[].key`). |
| `origins` | Origines admises : `interne`, `externe`. |
| `attachments` | Rattachements admis : `none`, `project`, `research`. |
| `subtypes` | Sous-types proposés (`{fr, en}`), saisie libre possible. |
| `circuit` | Étapes d'approbation après l'auteur, dans l'ordre, par fonction (`scope` : `global`, `department`, `project`, `research`). Liste vide : approbation immédiate. |
| `retention` | Règle de conservation : durée en années (`null` : sans durée fixe), événement déclencheur, sort final, fondement. |
| `confAllowed` / `confDefault` | Niveaux de confidentialité admis et niveau proposé par défaut. |
| `iso` | Clause ISO 9001 (ou `null`). |
| `clientDeliverable` | Livrable client. |
| `active` | Type proposé à la création. Un type inactif reste listé pour afficher les documents existants. |
| `source` | Origine de l'entrée du registre : `deck`, `keystone` ou `both`. |

---

## `POST /api/import` — reprise d'un document (outil de migration)

Crée **un** document par appel à partir d'un document de l'ancien système. Codex attribue l'identifiant
`TYPE-CONTEXTE-SEQ` ; la référence d'origine (`legacyRef`) est conservée comme ancienne référence du document
(`documents.aliases`) : elle reste résolue par la fiche document (`/documents/<legacyRef>`).

### Format de la requête

- `multipart/form-data` :
  - partie `meta` (obligatoire) : les métadonnées en JSON, en champ texte ou en fichier `.json` ;
  - partie `file` (facultative) : le fichier de la révision, avec son `Content-Type` (en Python :
    `files={'file': (nom, fh, 'application/pdf')}`). Sans type, ou avec un type générique (`application/octet-stream`,
    `text/plain` pour un fichier qui n'est pas du texte), Codex le déduit de l'extension et de la signature `%PDF-`.
- ou `application/json` : les métadonnées seules, sans fichier.

Taille maximale du fichier : `CODEX_IMPORT_MAX_MB` (100 Mo par défaut, 250 Mo au plus avec SharePoint), au-delà **413**.

### Métadonnées (`meta`)

| Champ | Obligatoire | Description |
|---|---|---|
| `legacyRef` | oui | Référence dans l'ancien système, unique (≤ 200 caractères). |
| `title` | oui | Titre du document. |
| `typeCode` | oui | Code d'un type **actif** du registre (`/api/registry`). |
| `department` | oui | Code du département propriétaire (3 lettres, ex. `QUA`). |
| `ownerId` | oui | Identifiant de l'utilisateur propriétaire. |
| `origin` | non | `interne` / `externe`. Défaut : première origine admise par le type. |
| `attachment` | non | `none` / `project` / `research`. Défaut : `project` si `projectCode` est fourni, `research` si `programCode` l'est, sinon `none` (ou le premier rattachement admis par le type). |
| `projectCode` | si projet | Code projet Keystone connu de Codex (ex. `HLT-026`). |
| `programCode` | si recherche | Code du programme de recherche (ex. `R2601`). |
| `subtype` | non | Sous-type (texte). |
| `site` | non | Clé d'un site connu. |
| `author` | non | Identifiant d'un utilisateur, sinon texte libre (auteur externe, ancien salarié…). |
| `conf` | non | `public`, `restreint`, `interne`, `confidentiel`, `tres_confidentiel`. Défaut : niveau par défaut du type ; doit être admis par le type. |
| `readers` | non | Identifiants des lecteurs désignés : documents confidentiels ou très confidentiels seulement (sinon `readers_conf`). |
| `keywords` | non | Tableau de chaînes ou liste séparée par des virgules (50 au plus). |
| `lang` | non | Langue du document (`fr`, `en`…). |
| `revision` | non | Lettre de la révision reprise : `A` (défaut), `B`, … `Z`, `AA`… |
| `status` | non | `in_force` (défaut) ou `draft`. |
| `inForceAt` | non | Date de mise en vigueur de la révision (`status: in_force`). Défaut : `issuedAt`, sinon le jour de l'import. |
| `issuedAt` | non | Date d'émission (première mise en vigueur du document). Défaut : `inForceAt`. |
| `createdAt`, `modifiedAt` | non | Dates de création et de dernière modification dans l'ancien système. |
| `reviewDueAt`, `expiresAt` | non | Dates de révision et d'expiration. |
| `comment` | non | Commentaire de la version de travail. Défaut : « Reprise de <legacyRef> ». |

Champs selon le contexte (ignorés, avec un avertissement, quand le contexte ne s'applique pas) :

| Contexte | Champs |
|---|---|
| Externe | `sourceOrg` (**obligatoire**), `externalRef`, `receivedAt` |
| Projet | `projectPhase`, `workPackage`, `discipline` |
| Recherche | `researchTheme`, `studyId`, `ipStatus` |
| Interne | `processOwnerId` (identifiant utilisateur) |

### Règles appliquées

Les mêmes que la création depuis l'interface (`validateFields` dans `src/lib/actions.ts`) : le type existe et est
actif, il admet l'origine, le rattachement et le niveau de confidentialité ; le projet ou le programme existe ; un
document externe a un organisme source ; département, site, propriétaire et lecteurs existent. Toutes les erreurs sont
renvoyées ensemble.

### Ce que crée l'import

- le document, avec l'identifiant suivant libre pour le couple (type, contexte), la classe de conservation du type et
  `legacyRef` en ancienne référence. Une `legacyRef` déjà au format `TYPE-CONTEXTE-SEQ` du document (même type, même
  contexte, même largeur de numéro) et libre devient son identifiant ;
- **une** révision avec la lettre demandée (les révisions antérieures restent dans l'ancien système ; la prochaine
  révision ouverte dans Codex prendra la lettre suivante) :
  - `status: in_force` → révision **En vigueur** à `inForceAt` ; si cette date est future, la révision est **Approuvée**
    avec cette date d'effet et passe en vigueur automatiquement le jour venu ;
  - `status: draft` → révision **Brouillon** ;
- la version de travail n° 1 de cette révision, qui porte le fichier. Le fichier est déposé dans le stockage avant
  la transaction, sous un nom provisoire, puis renommé `{ID}_{lettre}.{ext}` (ex. `PID-HLT-026-002_C.pdf`), ou
  `{ID}_{lettre}.1.{ext}` pour un brouillon ; un import refusé le supprime. Un brouillon sans fichier n'a pas encore de
  version de travail ;
- le statut affiché du document (via `refreshHeadline`) et une entrée **Import** au journal d'audit, au nom de
  l'utilisateur système `codex`.

### Réponses

| Code | Corps |
|---|---|
| **201** | `{"id","revision","version","status","file","href","warnings"}` + en-tête `Location: /documents/<id>` |
| **400** | `{"error":"validation","issues":[{field,code,message}],"warnings":[…]}` ; ou `invalid_json`, `meta_required`, `invalid_body`, `file_not_a_file` |
| **401** / **503** | jeton absent ou faux / import désactivé |
| **409** | `{"error":"duplicate","id":"<ID existant>"}` : `legacyRef` déjà importée. Vérifié avant la validation : un document déjà repris répond 409 même si le registre a changé depuis (type désactivé…). |
| **409** | `{"error":"ref_is_codex_id","id":"<ID>"}` : `legacyRef` est l'identifiant Codex d'**un autre** document, qui n'a pas été importé depuis elle. Ce n'est pas un rejeu : l'outil ne doit pas enregistrer cette correspondance. |
| **413** | fichier trop volumineux |
| **415** | type de contenu autre que `multipart/form-data` ou `application/json` |

Codes de `issues[].code` : `required`, `invalid_type`, `too_long`, `invalid_date`, `invalid_value`, `invalid_letter`,
`unknown_type`, `unknown_department`, `unknown_site`, `unknown_user`, `type_mismatch`, `conf_not_allowed`,
`project_required`, `program_required`, `source_required`, `readers_conf`. Avertissement (`warnings[].code`) : `ignored`.

Le 409 `duplicate` rend l'outil de migration rejouable : un document déjà repris renvoie son identifiant Codex sans être
recréé. Seul ce code vaut « déjà migré ».

### Exemples

```bash
export CODEX=http://localhost:3100
export CODEX_IMPORT_TOKEN=…

# Plan P&ID en vigueur à l'indice C, avec son fichier
curl -s -X POST "$CODEX/api/import" \
  -H "Authorization: Bearer $CODEX_IMPORT_TOKEN" \
  -F 'meta={"legacyRef":"GED1-PID-0042","title":"P&ID boucle eau glacée","typeCode":"PID","projectCode":"HLT-026","department":"ING","ownerId":"jwagner","author":"Bureau d’études Tartempion","revision":"C","inForceAt":"2025-03-12","issuedAt":"2023-01-10","projectPhase":"Etudes","keywords":["eau glacée","CVC"]}' \
  -F 'file=@./export/GED1-PID-0042_C.pdf;type=application/pdf'
# → 201 {"id":"PID-HLT-026-002","revision":"C","version":"C.1","status":"in_force","file":true,"href":"/documents/PID-HLT-026-002","warnings":[]}

# Métadonnées lues depuis un fichier JSON
curl -s -X POST "$CODEX/api/import" \
  -H "Authorization: Bearer $CODEX_IMPORT_TOKEN" \
  -F 'meta=@./export/Q-12.json;type=application/json' \
  -F 'file=@./export/Q-12.docx'

# Brouillon sans fichier (corps JSON)
curl -s -X POST "$CODEX/api/import" \
  -H "Authorization: Bearer $CODEX_IMPORT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"legacyRef":"Q-12","title":"Procédure achats","typeCode":"PRO","department":"ACH","ownerId":"gcomte","status":"draft"}'
# → 201 {"id":"PRO-ACH-0001","revision":"A","version":null,"status":"draft",…}

# Erreur de validation
curl -s -X POST "$CODEX/api/import" \
  -H "Authorization: Bearer $CODEX_IMPORT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"legacyRef":"OLD-1","title":"Note","typeCode":"PID","department":"ING","ownerId":"jwagner","conf":"public"}'
# → 400 {"error":"validation","issues":[{"field":"conf","code":"conf_not_allowed",…},{"field":"projectCode","code":"project_required",…}],"warnings":[]}
```

---

## `POST /api/integrations/vigie` — décisions de Vigie

Vigie gère les demandes de modification (ECR/ECO) et de retrait créées depuis Codex (`requestChange`). Ce webhook lui
permet de renvoyer sa décision ; Codex l'applique dans une transaction, au nom de l'utilisateur système `vigie`
(`applyChangeDecision` dans `src/lib/lifecycle.ts`). Tant qu'aucune URL Vigie n'est configurée (`VIGIE_API_URL`), un
gestionnaire documentaire peut aussi simuler la décision depuis la fiche document.

### Corps

```json
{ "requestId": "ECR-2026-001", "accepted": true, "ecoRef": "ECO-2026-010", "modifierId": "jwagner", "note": "Validé en CCB du 8/10" }
```

| Champ | Obligatoire | Description |
|---|---|---|
| `requestId` | oui | Référence de la demande dans Vigie (`ECR-…`), telle que Codex l'a transmise. |
| `accepted` | oui | `true` : acceptée ; `false` : refusée. |
| `ecoRef` | non | Référence de l'ordre de modification (ECO) ; à défaut, la référence de la demande sert de référence de changement. |
| `modifierId` | non | Utilisateur désigné pour rédiger la révision (modification acceptée). Défaut : le demandeur, s'il peut déposer et voit encore le document ; sinon le propriétaire. |
| `note` | non | Commentaire de décision (≤ 2000 caractères). |

### Effet

| Demande | Acceptée | Refusée |
|---|---|---|
| Modification | Codex ouvre la révision suivante en **Brouillon**, attribuée au modificateur, avec la référence ECO ; la demande passe **Appliquée**. | La demande passe **Refusée**. |
| Retrait | Le document passe **Obsolète** ; un circuit en cours est clos (commentaire « document retiré ») et les révisions ouvertes passent **Annulées** ; la demande passe **Appliquée**. | La demande passe **Refusée**. |

Les mêmes règles s'appliquent à la décision simulée depuis la fiche document (`applyChangeDecision`).

### Réponses

| Code | Corps |
|---|---|
| **200** | `{"ok":true,"requestId","kind","docId","status":"implemented"\|"rejected","docStatus","revision"}` (`revision` : lettre ouverte par une modification acceptée) |
| **200** | `{"ok":true,"alreadyApplied":true,…}` : la même décision a déjà été appliquée (renvoi du webhook sans effet) |
| **400** | `invalid_json`, `{"error":"invalid","field":"…"}`, `{"error":"unknown_user","field":"modifierId"}` |
| **401** / **503** | jeton absent ou faux / webhook désactivé |
| **404** | `{"error":"not_found"}` : demande inconnue de Codex |
| **409** | `already_decided` (décision contraire déjà appliquée), `document_locked` (document archivé, obsolète ou sous gel juridique : une acceptation ne peut plus s'appliquer), `revision_in_progress` (une révision est déjà en cours sur le document) |

### Exemples

```bash
export VIGIE_WEBHOOK_TOKEN=…

# ECO accepté : ouverture de la révision suivante attribuée à jwagner
curl -s -X POST http://localhost:3100/api/integrations/vigie \
  -H "Authorization: Bearer $VIGIE_WEBHOOK_TOKEN" -H 'Content-Type: application/json' \
  -d '{"requestId":"ECR-2026-001","accepted":true,"ecoRef":"ECO-2026-010","modifierId":"jwagner"}'
# → 200 {"ok":true,"requestId":"ECR-2026-001","kind":"modification","docId":"PRO-QUA-0001","status":"implemented","docStatus":"in_force","revision":"F"}

# Demande de retrait refusée
curl -s -X POST http://localhost:3100/api/integrations/vigie \
  -H "Authorization: Bearer $VIGIE_WEBHOOK_TOKEN" -H 'Content-Type: application/json' \
  -d '{"requestId":"ECR-2026-003","accepted":false,"note":"Le modèle reste utilisé hors Keystone"}'
```
