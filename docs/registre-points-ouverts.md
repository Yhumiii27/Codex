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
1. Codes identiques à des codes de département (FIN, HSE, COM) : on obtient FIN-FIN-0001, HSE-HSE-0001… Garder ou renommer ?
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
