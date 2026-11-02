# Bibliothèque de documents sur notre serveur : préparation et guide pas à pas

**Décision du 2 novembre 2026 (D-28, `docs/decisions.md`)** :

> Nous allons choisir pour le moment d'héberger la bibliothèque de document sur notre serveur.

Les fichiers déposés dans Codex restent donc dans le stockage local (`CODEX_STORAGE=local`, le défaut), sur le serveur
Coolify qui fait tourner Codex. SharePoint n'est pas activé ; la question O-01 pourra être rouverte plus tard. Rien
n'est irréversible : un passage à SharePoint ne demanderait aucune reprise de données, car le stockage est enregistré
fichier par fichier (`docs/fiches-decision.md`, O-01).

Ce document dit ce qui est en place, ce que Codex fait de plus depuis ce jour, et **les étapes à faire par
l'exploitant**, dans l'ordre. Les étapes 1 à 5 suffisent pour être protégé ; les étapes 6 à 8 complètent.

## 1. Où en est la production (vérifié le 2 novembre 2026, en lecture seule)

| Élément | État |
|---|---|
| Application Coolify `codex` | `https://codex.projectdirection.fr`, branche `main`, en marche et saine, sur le serveur `localhost` (la machine qui fait tourner Coolify). |
| Base de données | Serveur PostgreSQL commun EPC2I (`DATABASE_URL`, schéma `codex`). Sauvegardée chaque nuit par `pg_dump` (dépôt Matrix, `infra/postgres/sauvegarde/sauvegarder.sh`, 14 jours). |
| Fichiers déposés | Volume Docker `manjb61o00i8pdtg738izfh0-codex-data` monté sur `/data` ; fichiers dans `/data/files`. |
| Sauvegarde des fichiers | **Aucune.** Le `pg_dump` ne contient pas les fichiers. `CODEX_BACKUP_DIR` n'est pas posé (défaut `/data/backups`, sur le même volume que les fichiers) et `CODEX_SCHEDULE_BACKUP` non plus. |
| Antivirus | **Aucun** : `CODEX_CLAMD` n'est pas posé ; les fichiers sont stockés sans analyse. |
| Copie hors du serveur | Aucune, ni pour la base ni pour les fichiers (question P-08 de Matrix, M22 de l'audit). |

Si ce volume ou ce disque était perdu aujourd'hui, la base se restaurerait depuis le `pg_dump`, mais **tous les fichiers
seraient perdus**. C'est la première chose que ce guide corrige.

## 2. Ce que Codex fait désormais

Avec la base sur un serveur PostgreSQL, la sauvegarde de Codex (Administration › Journal d'audit › Sauvegardes, et la
tâche planifiée `CODEX_SCHEDULE_BACKUP`) **sauvegarde les fichiers** (`src/lib/files-backup-core.mjs`) :

- dans `CODEX_BACKUP_DIR/fichiers/objets/`, une copie de chaque fichier que la base référence, faite **une seule fois**,
  vérifiée par l'empreinte SHA-256 enregistrée au dépôt (un fichier dont l'empreinte ne correspond plus n'est pas
  copié et est signalé) ;
- dans `CODEX_BACKUP_DIR/fichiers/codex-fichiers-<instant>.json`, un **état** par sauvegarde : la liste des fichiers à
  cet instant, avec taille et empreinte ;
- rotation : les `CODEX_BACKUP_KEEP` états les plus récents et le plus récent de chacun des `CODEX_BACKUP_KEEP`
  derniers jours ; les copies qu'aucun état gardé ne cite sont supprimées ;
- journal d'audit : « Sauvegarde créée », « fichiers seulement », avec les nombres (montrés aux seuls gestionnaires
  documentaires, D-14).

Le bouton **« Remettre les fichiers manquants »** (même panneau) remet dans le stockage, depuis cette sauvegarde, les
fichiers que la base référence et qui manquent : après une restauration de la base, ou la perte du volume des
fichiers. Il ne remplace ni ne supprime jamais un fichier présent : on peut le lancer serveur en marche, sans risque.
Journalisé « Fichiers remis en place ».

Au démarrage, le contrôle de la configuration signale désormais, sur un serveur PostgreSQL :
- `files_backup_off` : `CODEX_SCHEDULE_BACKUP` n'est pas posé, les fichiers ne sont pas sauvegardés ;
- `backup_same_disk` : `CODEX_BACKUP_DIR` est sur le même disque que les fichiers.

Ces deux avertissements doivent disparaître du journal du conteneur à la fin de l'étape 3.

## 3. Guide pas à pas

Légende : 🖥️ terminal du serveur (SSH sur la machine Coolify, en `root` ou avec `sudo`) ; 🌐 interface Coolify ;
📄 interface de Codex.

### Étape 0 — Fusionner la pull request

🌐 GitHub : fusionner la pull request « Bibliothèque sur notre serveur : sauvegarde des fichiers » une fois la CI verte.
Coolify redéploie Codex tout seul. Aucune migration de base.

### Étape 1 — Mesurer la place disponible

🖥️ Sur le serveur :

```bash
df -h /                                   # place libre du disque principal
docker volume inspect manjb61o00i8pdtg738izfh0-codex-data --format '{{ .Mountpoint }}'
du -sh "$(docker volume inspect manjb61o00i8pdtg738izfh0-codex-data --format '{{ .Mountpoint }}')/files"
lsblk -f                                  # disques présents ; un second disque apparaît comme sdb, vdb, nvme1n1…
```

Notez : la taille de `files`, la place libre, et s'il existe un second disque. Prévoyez pour la sauvegarde au moins
**deux fois** la taille des fichiers, plus la croissance attendue sur un an.

### Étape 2 — Un emplacement de sauvegarde sur un autre disque

Une sauvegarde sur le même disque protège d'une erreur, pas d'une panne du disque. Le mieux est un **second disque**
(volume bloc de l'hébergeur : « Block Storage », « Volume additionnel », quelques euros par mois).

**2a. Si vous ajoutez un disque** (chez l'hébergeur, l'attacher au serveur, puis) 🖥️ :

```bash
lsblk -f                                  # repérer le nouveau disque vide, ici /dev/vdb (à adapter)
mkfs.ext4 -L sauvegardes /dev/vdb         # ATTENTION : efface ce disque ; vérifier deux fois le nom
mkdir -p /srv/sauvegardes
echo 'LABEL=sauvegardes /srv/sauvegardes ext4 defaults,nofail 0 2' >> /etc/fstab
mount -a && df -h /srv/sauvegardes        # le disque doit apparaître
```

**2b. Sans second disque** (en attendant) : créez simplement `/srv/sauvegardes` sur le disque principal. Codex
affichera l'avertissement `backup_same_disk` : la copie hors du serveur (étape 5) devient alors indispensable.

**2c. Le dossier de Codex** 🖥️ (le serveur Codex tourne sous l'utilisateur `node`, uid 1000) :

```bash
mkdir -p /srv/sauvegardes/codex
chown 1000:1000 /srv/sauvegardes/codex
chmod 700 /srv/sauvegardes/codex
```

**2d. Le monter dans Codex** 🌐 : Coolify › projet › `codex` › **Persistent Storage** › **+ Add** › *Directory Mount*
(« bind mount ») :
- Source Path : `/srv/sauvegardes/codex`
- Destination Path : `/backups`

Enregistrer (ne pas redéployer tout de suite).

### Étape 3 — Variables de Codex

🌐 Coolify › `codex` › **Environment Variables** › ajouter, en variables d'exécution (ne pas cocher « Build
Variable ») :

| Variable | Valeur proposée | Rôle |
|---|---|---|
| `CODEX_BACKUP_DIR` | `/backups` | la sauvegarde va sur le dossier monté à l'étape 2 |
| `CODEX_SCHEDULE_BACKUP` | `1d` | une sauvegarde des fichiers par jour (comptée depuis la précédente, pas à heure fixe) |
| `CODEX_BACKUP_KEEP` | `14` | 14 états gardés, comme les 14 jours du `pg_dump` du serveur commun |
| `CODEX_SCHEDULE_INTEGRITY` | `7d` | relecture de tous les fichiers une fois par semaine, comparée à leur empreinte |

Les valeurs `1d`, `14` et `7d` sont des propositions (fréquence et durée de conservation : M22, à votre choix) ; elles
se changent à tout moment. Puis **Redeploy**.

Vérifier 🌐 › **Logs** du conteneur, au démarrage : plus de ligne `files_backup_off`. La ligne `backup_same_disk`
ne reste que dans le cas 2b.

### Étape 4 — Première sauvegarde et contrôle

📄 Codex, en gestionnaire documentaire : **Administration › Journal d'audit › Sauvegardes › Afficher** :
1. **Sauvegarder maintenant** : le message donne le nombre de fichiers et leur taille. Le tableau montre l'état.
2. **Remettre les fichiers manquants** : rien ne manque, le message doit dire « Fichiers remis en place : 0 ;
   déjà présents : N », N étant le nombre de fichiers. C'est le contrôle que la remise en place fonctionne.
3. **Planificateur** (même onglet) : la tâche « Sauvegarde » est à `1d`, et « Vérification d'intégrité » à `7d`.

🖥️ Sur le serveur : `ls /srv/sauvegardes/codex/fichiers/` montre `objets/` et un fichier `codex-fichiers-….json`.

### Étape 5 — Copie hors du serveur, chiffrée

Une sauvegarde qui reste sur la machine ne survit ni à sa perte, ni à un rançongiciel. **Destination à choisir par
vous** (question P-08 de Matrix, M22) ; trois possibilités :

| Destination | Pour | Contre |
|---|---|---|
| Stockage objet S3 d'un autre fournisseur ou d'une autre région (Scaleway, OVH, Backblaze B2…) | simple, peu coûteux, hors du site | abonnement, données chez un tiers (chiffrées par vous) |
| NAS au bureau | données chez vous | dépend du réseau du bureau, à surveiller |
| Second serveur | indépendant | plus cher, à administrer |

L'outil proposé est **restic** : il chiffre avant d'envoyer, ne renvoie que ce qui a changé, et garde un historique.
Exemple avec un stockage S3 🖥️ :

```bash
apt-get install -y restic
install -d -m 700 /root/.restic
# Mot de passe du dépôt restic : à générer, à garder AUSSI hors du serveur (gestionnaire de mots de passe).
# Sans lui, la copie est illisible, et perdue.
openssl rand -base64 32 > /root/.restic/mot-de-passe && chmod 600 /root/.restic/mot-de-passe
cat > /root/.restic/env <<'EOF'
export RESTIC_REPOSITORY=s3:https://<point d'accès S3>/<nom du bucket>/epc2i
export RESTIC_PASSWORD_FILE=/root/.restic/mot-de-passe
export AWS_ACCESS_KEY_ID=<clé d'accès du bucket>
export AWS_SECRET_ACCESS_KEY=<secret du bucket>
EOF
chmod 600 /root/.restic/env
. /root/.restic/env && restic init
```

Puis une tâche chaque nuit, **après** la sauvegarde de Codex et le `pg_dump` du serveur commun 🖥️ (`crontab -e`) :

```cron
30 4 * * * . /root/.restic/env && restic backup /srv/sauvegardes --tag epc2i --quiet && restic forget --tag epc2i --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune --quiet
```

`/srv/sauvegardes` contient la sauvegarde de Codex. Les dumps du serveur commun sont dans le volume des sauvegardes de
Matrix (`docker volume ls | grep sauvegardes`, puis `docker volume inspect … --format '{{ .Mountpoint }}'`) : ajoutez
ce chemin à la même commande `restic backup` si vous voulez les copier ensemble (c'est la question P-08 de Matrix).

Vérifier le lendemain : `. /root/.restic/env && restic snapshots`.

### Étape 6 — Antivirus (clamd)

Sans antivirus, un fichier infecté déposé dans Codex est stocké et servi tel quel. 🌐 Coolify, dans le même projet :
**+ New › Docker Image** :
- Image : `clamav/clamav:stable` (clamd et la mise à jour des signatures, freshclam, dans le même conteneur) ;
- **pas de domaine**, aucun port publié (Codex le joint par le réseau interne de Coolify) ;
- **Persistent Storage** : un volume sur `/var/lib/clamav` (les signatures ne sont pas retéléchargées à chaque
  redémarrage) ;
- mémoire : clamd en demande 2 à 3 Go ; vérifier que le serveur les a (`free -h`).

Déployer, attendre que le conteneur soit sain (le premier démarrage télécharge les signatures, plusieurs minutes),
puis relever son nom 🖥️ : `docker ps --format '{{.Names}}' | grep -i clam`.

🌐 Sur `codex`, ajouter `CODEX_CLAMD` = `<nom du conteneur clamav>:3310`, puis **Redeploy**. Les deux conteneurs doivent
être sur le même réseau Docker (même « Destination » Coolify ; sinon, dans les réglages du service clamav, *Connect To
Predefined Network*).

Vérifier : plus de ligne `clamd_off` dans les journaux de Codex ; déposer le fichier de test EICAR (eicar.org, inoffensif)
dans un brouillon : Codex doit le refuser. Les limites par défaut de clamd (100 Mo) couvrent la taille maximale de Codex
(`CODEX_MAX_FILE_MB`, 50 Mo) ; au-delà de 100 Mo, ajuster `clamd.conf` (`.env.example`, « Files entering Codex »).

### Étape 7 — Chiffrement du disque

Les fichiers sont écrits en clair sur le disque, brouillons et documents confidentiels compris
(`docs/exploitation.md` §9). Demandez à l'hébergeur si ses disques sont chiffrés au repos. Si non, c'est une décision
à prendre (point 88 de `docs/reste-a-faire.md`) : chiffrement du disque par l'hébergeur, LUKS sur le second disque, ou
chiffrement des fichiers par Codex lui-même (à développer). La copie restic de l'étape 5, elle, est déjà chiffrée.

### Étape 8 — Essai de restauration (une fois, puis chaque trimestre)

🖥️ Sans toucher à la production :

```bash
. /root/.restic/env
restic restore latest --target /tmp/essai-restauration --include /srv/sauvegardes/codex
ls /tmp/essai-restauration/srv/sauvegardes/codex/fichiers/objets | wc -l   # même nombre que l'étape 4
rm -rf /tmp/essai-restauration
```

## 4. En cas de perte

| Ce qui est perdu | Que faire |
|---|---|
| Quelques fichiers (effacés, abîmés) | 📄 Administration › Sauvegardes › **Remettre les fichiers manquants**. Un fichier abîmé (signalé par la vérification d'intégrité) : le déplacer hors de `/data/files` 🖥️, puis le même bouton. |
| Le volume des fichiers (`/data`) | 🌐 Redéployer Codex (un volume neuf est créé). 📄 **Remettre les fichiers manquants**. |
| La base (schéma `codex`) | Restaurer `codex.dump` selon la procédure du dépôt Matrix (`infra/postgres/README.md`, « Restaurer le schéma d'un outil »), redémarrer Codex, puis 📄 **Remettre les fichiers manquants** : les fichiers que la base restaurée référence et qui ne sont plus sur le disque reviennent. |
| Le serveur entier | Nouveau serveur : Coolify, serveur commun (Matrix), Codex ; récupérer `/srv/sauvegardes` et les dumps par `restic restore` ; restaurer la base ; monter `/srv/sauvegardes/codex` sur `/backups` ; 📄 **Remettre les fichiers manquants**. |

Le message de la remise en place dit combien de fichiers manquent aussi à la sauvegarde ; leur liste est dans le
journal du serveur (`files restored`).

## 5. Ce dont j'ai besoin de votre part

1. Les résultats de l'étape 1 (taille des fichiers, place libre, second disque ou non).
2. Votre choix de destination hors du serveur (étape 5), et si l'hébergeur chiffre ses disques (étape 7).
3. Une fois les étapes 2 à 4 faites : « c'est fait, vérifie coolify ». Je relirai alors les variables, les journaux et
   l'état de la sauvegarde (en lecture seule ; aucune écriture dans Coolify sans votre autorisation explicite).

## 6. Ce qui reste ouvert

- **O-01** pourra être rouverte (SharePoint) ; d'ici là, les points 84 (édition en ligne), 98 (envoi au-delà de 250 Mo
  vers SharePoint) et 103 (essai sur un tenant) sont sans objet.
- **M22 / P-08** : destination hors du serveur, durées de conservation, perte de données tolérée (aujourd'hui : un jour,
  pour la base comme pour les fichiers).
- **Point 88** : chiffrement au repos, si l'hébergeur ne chiffre pas ses disques.
