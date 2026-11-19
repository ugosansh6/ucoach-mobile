# Composer : sélection, dose WOD et mécaniques existantes

Audit ciblé des [#34](https://github.com/ugosansh6/ucoach-mobile/issues/34) et [#37](https://github.com/ugosansh6/ucoach-mobile/issues/37), effectué le 19/11/2026. Les issues restent le suivi de référence ; ce document conserve les mesures et limites de l'audit.

## Périmètre et preuves

- Base Git vérifiée : `ux-navigation-coach-v1`, `52330bb4227e11fbb0e08d1bbde92dffdc5c34d8`.
- Base interrogée : DEV `ugoach`, `fjjhzzwupjhcasoyerym`, ACTIVE_HEALTHY. Aucun STAGING/PROD.
- Fonctions effectives lues via `pg_get_functiondef`, pas déduites des seuls fichiers de migrations. Aucune migration, politique, ACL, donnée réelle ou fonction backend changée.
- [Matrice dose](../supabase/qa/composer_wod_dose_audit_rollback.sql) : **320 cas**, 4 lieux × 20/40/60/78 minutes WOD × 2/3/4/6 mouvements × 5 formats ; 316 READY, 4 rejets de densité. Exécution finale environ 4.51 s. Les rejets sont les For Time de 20 min à six mouvements, dans les quatre lieux ; c'est un refus du moteur, pas un test à rendre artificiellement vert.
- Fixtures synthétiques sans historique, 80 kg, niveau par défaut de la base, mouvements à faible complexité et matériel compatible. Ce sont des cas de caractérisation, pas des programmes recommandés ni une validation sportive individuelle. WOD seuls legacy pour isoler le bloc, sans appliquer les nouveaux compléments aux anciens drafts.
- [Sécurité](../supabase/qa/composer_wod_safety_audit_rollback.sql) : 8 cas et un contrôle HIIT technique. Readiness 1/6/10 accepté ; readiness/douleurs/matériel manquants et exercice incompatible matériel/douleur rejetés ; HIIT à complexité élevée indisponible. Pour cette fixture CIRCUIT, readiness 1 et 10 produisent la même prescription : adaptation sportive WOD encore à traiter, pas certifiée par le contrôle de présence du check-in.
- [Mécaniques avancées](../supabase/qa/composer_advanced_mechanics_audit_rollback.sql) : **40 cas**, 15 familles + 5 variantes sur deux tiers administrativement préparés dans la transaction, puis appels avec l'identité synthétique. 10 compilations READY (cinq familles × deux tiers), 30 rejets W11 attendus. Préparation/finalisation C4 testée séparément ; ses rejets de cohérence/charge sont conservés. Ce ne sont pas des générations Today ni des appels E2E depuis un appareil.
- ROLLBACK et absence des utilisateurs, plans et séances synthétiques contrôlés après exécution. Les échecs initiaux de construction de fixture (enum/surface/structure ou ambiguïté de variable) ont été corrigés avant ces résultats ; ils ne constituent pas des défauts produit.
- [Accès aux contrats](../supabase/qa/composer_wod_selection_contracts_rollback.sql) vérifié séparément sous le rôle SQL `authenticated` avec son identité de test : RPC de recommandation puis `c4_mechanic_composition_contract`, six mouvements n'exposant que Circuit. Aucun besoin de nouveau privilège, RPC ou schéma.

## #34 : sélection manuelle

Le sélecteur de l'écran avait un plafond constant de trois, alors que les contrats C4 déjà appliqués au choix des formats définissent :

| Format Composer actuel | Minimum | Cible existante | Maximum |
| --- | ---: | ---: | ---: |
| AMRAP | 2 | 3 | 5 |
| EMOM | 2 | 3 | 4 |
| For Time | 2 | 3 | 5 |
| Circuit | 3 | 4 | 6 |
| HIIT | 2 | 3 | 5 |

Correction : lire les formats exposés par le RPC Composer existant, puis leurs contrats C4. Le plafond de **sélection manuelle** est le maximum de ces contrats, sans ouvrir le reste du catalogue. Après sélection, le RPC existant ne propose que les formats compatibles avec le nombre réel de mouvements, le lieu, la durée et la complexité. Six mouvements conduisent actuellement à Circuit ; EMOM reste limité à quatre. Le serveur continue à vérifier la séance avant exécution.

La proposition automatique reste inchangée : aucun ajout automatique pour remplir un nouveau plafond. En cas d'indisponibilité des contrats, l'ancien plafond de trois reste le repli pour les nouveaux ajouts, avec état d'erreur et réessai. Remplacer un mouvement d'un ancien choix plus large conserve les autres identités et leur ordre ; l'ancien `slice(0, max - 1)` pouvait les supprimer.

Tests : [qa-composer-wod-selection.cjs](../scripts/qa-composer-wod-selection.cjs) couvre les capacités 4/5/6 issues des contrats, le repli, les ajouts et remplacements immuables, le vrai service de lecture et la sortie d'un Circuit partiel à six mouvements. Les contraintes C4, la sauvegarde, les droits et les calculs backend ne sont pas changés.

## #34 : le volume long n'est pas résolu par le plafond

Mesure C3 des prescriptions **effectivement compilées** (temps actif + transitions, récupération de 45 s entre tours pour Circuit), fixture HOME à trois mouvements :

| Format | Budget WOD (min) | Tours Composer | Estimation C3 (min) | Part du budget |
| --- | ---: | ---: | ---: | ---: |
| FOR_TIME | 20 | 5 | 4.50 | 22.5% |
| CIRCUIT | 20 | 4 | 5.85 | 29.25% |
| FOR_TIME | 40 | 5 | 4.50 | 11.25% |
| CIRCUIT | 40 | 4 | 5.85 | 14.63% |
| FOR_TIME | 60 | 5 | 4.50 | 7.5% |
| CIRCUIT | 60 | 4 | 5.85 | 9.75% |
| FOR_TIME | 78 | 5 | 4.50 | 5.77% |
| CIRCUIT | 78 | 4 | 5.85 | 7.5% |

Ce sont des **estimations de modèle**, pas le temps réalisé par un sportif. Pour For Time, le temps affiché est un cap et ne doit pas être assimilé à du travail effectif. Néanmoins, un protocole de cinq tours reste identique de 20 à 78 minutes ici. Le Circuit termine ses quatre tours via le Player ; aucun chronométrage de 78 minutes n'ajoute des tours manquants.

Le C4 général peut déjà construire plus de tours (sur la même fixture à 20 minutes : For Time 16 et Circuit 11), mais ce n'est pas un adaptateur directement interchangeable :

- `c4_finalize_candidate_pre_m72` réduit encore 78 minutes à 40 pour For Time et 50 pour Circuit avant finalisation.
- Le contrat générique conserve aussi son plafond existant `max_final_rounds=20` et ses enveloppes de charge/cohérence. Aucun de ces garde-fous n'a été relevé.
- Sur 78 minutes, la comparaison C4 Circuit renvoie 20 tours, budget interne 50 minutes, estimation 1 935 s (32,25 min), état de durée UNDERFILLED. Le brancher tel quel changerait le budget choisi tout en laissant un écart de durée.
- Le Composer ne traverse pas actuellement toutes les validations globales C4 : dans l'autre fixture de #37, des candidats rejetés par C4 pour charge/rôle peuvent compiler READY via W11. Cela décrit une lacune d'intégration ; cela ne prouve ni blessure ni danger d'une séance utilisateur particulière.

**Reste dans #34/#33/#35** : un adaptateur de prescription WOD partagé preview/Jour J utilisant les contrats et garde-fous existants, préservant les choix et le budget, puis vérification des temps, volumes totaux/par tour, récupération et adaptation au check-in. Pas de multiplication arbitraire du volume pour atteindre 78 minutes, pas de suppression globale des caps C4, pas de réallocation silencieuse. La correction de sélection n'est pas une annonce de résolution du dosage long.

## #37 : couverture observée

Lecture du catalogue courant. « Auto Free » est le **flag d'éligibilité**, pas la preuve qu'une génération Today l'a effectivement choisi. « Manuel F/P » décrit les droits catalogue ; W11 impose encore son allowlist actuelle. « C4 fixture » est le résultat d'une seule fixture froide avec les contraintes existantes, pas le verdict général sur la famille. « Player » sépare la présence de branche et les calculs testés d'une recette interactive. Persistance réelle et historique n'ont pas été recettés.

| Famille / overlay | État catalogue | Auto Free | Manuel F/P | C4 fixture | W11 fixture | Player / suivi | Historique réel |
| --- | --- | --- | --- | --- | --- | --- | --- |
| STRENGTH | inactif | non | non / non | non testé | non testé | non vérifié | non vérifié |
| AMRAP | core | oui | oui / oui | WORKLOAD_OR_ROLE_REJECTED | READY | branche V3 + sortie synthétique | non vérifié |
| EMOM | core | oui | oui / oui | OK | READY | branche V3 + sortie synthétique | non vérifié |
| FOR_TIME | core | oui | oui / oui | WORKLOAD_OR_ROLE_REJECTED | READY | branche V3 + sortie synthétique | non vérifié |
| CIRCUIT | core | oui | oui / oui | OK | READY | branche V3 + sortie synthétique | non vérifié |
| LADDER | core | oui | oui / oui | LADDER_NOT_COHERENT_AT_ATHLETE_VOLUME | bloqué | branche V3 + sortie synthétique | non vérifié |
| PYRAMID | core | oui | non / oui | WORKLOAD_OR_ROLE_REJECTED | bloqué | branche V3 + sortie synthétique | non vérifié |
| PENALTY | overlay | non | non / oui | non testé | non testé | non vérifié | non vérifié |
| CHIPPER | core | non | non / oui | OK | bloqué | branche V3 + sortie synthétique | non vérifié |
| EVERY_X_MINUTES | core | non | non / oui | OK | bloqué | branche V3 + sortie synthétique | non vérifié |
| ODD_EVEN | core | non | non / oui | OK | bloqué | branche V3 + sortie synthétique | non vérifié |
| REP_TARGET | core | non | non / oui | WORKLOAD_OR_ROLE_REJECTED | bloqué | branche V3 + sortie synthétique | non vérifié |
| COUPLET | core | non | non / oui | WORKLOAD_OR_ROLE_REJECTED | bloqué | branche V3 + sortie synthétique | non vérifié |
| PROGRESSIVE_INTERVAL | core | oui | non / oui | MECHANIC_COHERENCE_REJECTED | bloqué | branche V3 + sortie synthétique | non vérifié |
| BUY_IN_CASH_OUT | overlay | non | non / oui | non testé | non testé | non vérifié | non vérifié |
| HIIT | core | oui | oui / oui | OK | READY | branche V3 + sortie synthétique | non vérifié |
| SETS_REPS | core | oui | non / oui | OK | bloqué | branche V3 + sortie synthétique | non vérifié |
| DECK | core | non | non / oui | OK | bloqué | branche V3 + sortie synthétique | non vérifié |

| Variante | Famille | Manuel F/P | C4 fixture | W11 | Player variante | Historique réel |
| --- | --- | --- | --- | --- | --- | --- |
| PROGRESSIVE_GENERIC | PROGRESSIVE_INTERVAL | non / oui | MECHANIC_COHERENCE_REJECTED | bloqué | famille présente, variante non recettée | non vérifié |
| DEATH_BY | PROGRESSIVE_INTERVAL | non / oui | OK | bloqué | famille présente, variante non recettée | non vérifié |
| DEATH_BY_COUPLET | PROGRESSIVE_INTERVAL | non / oui | MECHANIC_COHERENCE_REJECTED | bloqué | famille présente, variante non recettée | non vérifié |
| ASCENDING_COUPLET | COUPLET | non / oui | WORKLOAD_OR_ROLE_REJECTED | bloqué | famille présente, variante non recettée | non vérifié |
| DESCENDING_COUPLET | COUPLET | non / oui | WORKLOAD_OR_ROLE_REJECTED | bloqué | famille présente, variante non recettée | non vérifié |

[qa-wod-protocol-audit.cjs](../scripts/qa-wod-protocol-audit.cjs) exécute les vrais helpers de durée du Player V3 et les builders d'actuals/statuts : **15 familles et 30 scénarios synthétiques partiels/complets**. Il ne teste pas les gestes, le son, la reprise, les overlays, les règles de chaque variante ni la persistance backend. Il ne suffit pas à autoriser une famille au Composer.

Écart avéré : les 40 previews renvoient PREVIEW, y compris pour les familles que Jour J bloque ensuite. Le formulaire courant n'expose que les cinq familles compilables ; ce n'est donc pas une ouverture d'exécution Premium. Le futur adaptateur doit faire converger preview, droits et compilation avant de proposer les nouvelles familles.

**Aucune activation avancée dans ce lot.** Le catalogue et les branches Player sont largement réutilisables ; le compilateur W11, ses variantes, le suivi puis l'historique doivent être raccordés et recettés famille par famille. Chipper/Every X/Odd-Even disposent de candidats C4 OK dans la fixture, mais restent Premium et non compilables W11. Ladder est manuel Free au catalogue mais a échoué au contrat de cohérence de cette fixture : sa présence ne justifie pas une activation immédiate.

## Empreintes des définitions DEV lues

MD5 de `pg_get_functiondef` au moment de l'audit, utiles pour comparer les fonctions réellement inspectées sans exporter toute la base :

| Fonction | MD5 |
| --- | --- |
| `c3_simulate_candidate_wod` | `e1e2f1b7cab622c0e58b5e57b8661082` |
| `c3_simulate_candidate_wod_raw` | `2970a5ae9d5b5b357c5ab6fdf9becd69` |
| `c4_mechanic_composition_contract` | `a21f658ff388f927b0415d11923bbd24` |
| `c4_mechanic_duration_contract` | `fd88c946bac0564557910ac700ec6bb4` |
| `week_compile_composer_day_j_v1` | `fc620affc9322ca5bb56cc474b32f567` |
| `week_composer_prescription_preview_v1` | `b4ed89aa70512840958166e487609fc2` |
| `c4_candidate_quality_gate_v2` | `315b977b4f64440672796baa64ac6c30` |
| `c4_finalize_candidate` | `679e46926c7dcc7540c5887a4a07ab68` |
| `c4_finalize_candidate_pre_m72` | `65a61f241142a9258d505349a15fd786` |

## Limites de livraison

Correction limitée au sélecteur et à la conservation des choix, QA et preuves versionnées. Aucun nouveau moteur, aucune migration backend, aucune politique Today modifiée. Build web et tests locaux distincts de la recette iPhone en clair/sombre, sauvegarde → préparation → Player → fin → historique. #34 et #37 restent ouverts.

