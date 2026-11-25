# MEC-DURATION #33 — audit des durées et de leurs consommateurs

État du 17/11/2026. Source : `ux-navigation-coach-v1`, commit `bc9a8b427f1d94c58fe12f07ac6b504c8cdd5776`. Cible : Supabase DEV `fjjhzzwupjhcasoyerym`, ACTIVE_HEALTHY. Audit autorisé par Ugo ; aucune règle sportive, fonction, politique, permission ou migration modifiée. Aucun accès STAGING/PROD.

Suivi : [#33](https://github.com/ugosansh6/ucoach-mobile/issues/33). Les décisions et clôtures restent dans les tickets. Cette preuve technique ne vaut pas validation iPhone ou sportive.

## Résultat

Les plafonds 25/35/40/50 minutes ne sont pas seulement des préférences : un wrapper encore actif tronque les budgets WOD explicites avant leur compilation. Les contrats de sémantique des durées et les garde-fous de faisabilité existent déjà et doivent être réutilisés.

Cette troncature est reproductible, mais elle n'explique pas seule la sélection automatique actuelle. Sur les 24 plans complets contrôlés, le candidat finalement retenu ne déclenche aucun de ces plafonds. Le Composer suit un autre chemin : il conserve la durée du bloc, avec des plafonds locaux de tours qui restent le sujet de #34.

## Cartographie de l'existant déployé

| Composant | Consommation réelle | Qualification |
| --- | --- | --- |
| `c4_mechanic_wod_cap_minutes` | Lit `wod_duration_caps_minutes`, fallback DEFAULT/50, puis borne le résultat entre 10 et 50. Aucun paramètre niveau, charge, fatigue ou matériel. | Plafond de politique par nom de mécanique ; augmenter seulement la configuration au-delà de 50 serait sans effet. |
| `c2_mechanic_fit` | Compare ce plafond au **budget WOD cible de l'architecture**, dérivé de la durée totale. Soustrait `1.20 × dépassement`. | Préférence de classement, susceptible de modifier les mécaniques explorées. Ce n'est pas un rejet de prescription. |
| `c2_mechanic_fit_mechanic_policy_shadow_v1` / simulation C2 | Réutilisent le fit de base ; la politique active élargit la recherche puis conserve le score de base pour l'autorité finale. | Effet sur l'exploration et le classement ; les fonctions nommées « shadow » ne sont pas toutes inactives. |
| `c4_finalize_candidate_pre_m72` | Transmet `least(p_exact_wod_minutes, cap)` au compilateur inférieur. | **Troncature dure avant compilation**, encore dans le chemin public actif. Le champ `cap_applied` en garde la trace. |
| `c4_plan_full_session_pre_skill_contract_final_mechanic_policy_s` | Lit le cap pour renseigner les métadonnées d'architecture après avoir obtenu la prescription. | Consommateur de diagnostic ; sa seule lecture du cap ne raccourcit pas le WOD. Appelé dans les traces complètes. |
| `c4_plan_full_session_pre_skill_contract_final_v2` | Même lecture pour métadonnées dans l'autre branche de composition. | Branche conservée, non appelée dans les 24 traces contrôlées. Ne pas supprimer sur ce seul constat. |
| `c3_wod_budget_minutes` | Si budget explicite valide : le conserve ; sinon allocation par défaut 45 % de la séance, généralement bornée 12–30 min. Séances supportées : 20–90 min. | Allocation par défaut et limites techniques d'entrée, distinctes du plafond par mécanique. |
| `c4_apply_session_architecture_v2` / réinvestissement | Budget restant après préparation/Skill/transitions ; réduction selon readiness ; essais décroissants ; recompilation, qualité et récupération. | Construction de séance et exploration faisable. Ne pas confondre chaque réduction avec le plafond de famille. |
| `c4_mechanic_duration_contract` / qualité C4 | Distingue `fixed_duration`, `time_cap`, `target_duration`, `finite_workload` et leur traitement du sous-remplissage. | **Déjà couvert : aucune nouvelle sémantique à développer.** Conserver les contrôles de dépassement et les autres hard gates. |
| Preview / Jour J Composer | Prescriptions C2 ; pour le WOD, paramètres locaux AMRAP/EMOM/For Time/Circuit/HIIT. Réutilisation C4 pour Strength. Le chemin WOD testé n'appelle pas le wrapper du cap. | Durées longues conservées ; ni preuve de dose réaliste ni équivalence avec le solveur WOD complet C4. |
| `WodProtocolPlayerV3.totalSecondsForMechanic` | AMRAP : durée compilée ; For Time : cap en secondes ; EMOM/HIIT : protocole compilé ; Circuit : parcours par tours. | Aucun plafond supplémentaire 25/35/40/50 dans ce helper. Son test ne prouve pas le rendu, la fin de séance ou l'historique sur appareil. |

La recherche dans les corps de fonctions DEV identifie les consommateurs directs ci-dessus. La joignabilité statique a été vérifiée depuis `d_generate_adaptive_session_v3` et les entrées Composer ; les noms SQL de plus de 63 caractères sont normalisés dans cette recherche. Les branches conditionnelles et le SQL dynamique limitent ce que prouve un graphe statique. Les appels effectifs des deux consommateurs principaux sont aussi prouvés par `pg_stat_xact_user_functions` avec tracking transactionnel.

Chemin HOME/BOX relu : `workoutGenerationService` → Edge `coach-handler` déployée v20 → `d_generate_adaptive_session_v3` → wrappers V2 → `c4_generate_full_session` → planification C4. Le handler démarre à **8 candidats**, avec possibilité d'élargissement SQL. L'autre Edge `environment-session-handler` v3 concerne GYM/OUTDOOR et n'a pas été exercée.

## Reproductions du plafond

Mêmes trois exercices catalogue et prescriptions C2, séance de 90 minutes, budgets WOD distincts. Le test isolé omet volontairement le contexte athlète du candidat : il prouve le chemin de durée, pas la sécurité d'une séance.

| Mécanique | Demande WOD | Budget final C4 | Budget conservé par Composer |
| --- | --- | --- | --- |
| AMRAP | 40 min | 35 min | 40 min |
| AMRAP | 60 min | 35 min | 60 min |
| For Time | 60 min | 40 min | 60 min |
| Circuit | 60 min | 50 min | 60 min |

Avec une demande explicite, la troncature est la même sur les fixtures de forme basse/haute et sans matériel/avec élastiques. Le statut technique `OK` ou `READY` n'est pas une validation sportive.

**Cas sans budget explicite :** HIIT, séance 90 min, `p_exact_wod_minutes=NULL` → budget C3 de 30 min malgré un cap de politique de 25 ; `cap_applied=false`. Le wrapper ne borne que l'argument explicite. Ce plafond n'est donc pas un invariant universel du moteur. Le test constate cette asymétrie ; il ne recommande pas d'ajouter un nouveau plafond au chemin par défaut.

## Effet réel de la pénalité C2

En maintenant toutes les qualités du stimulus constantes et en variant seulement la durée totale de séance entre 20/30/45/60/75/90 minutes :

- AMRAP, EMOM, For Time et Circuit : score inchangé dans ce probe. Le budget cible de l'architecture ne dépasse pas leurs caps.
- HIIT : score 67,6 jusqu'à 60 min, 61,6 à 75 min, 55,6 à 90 min, soit des pénalités de 6 et 12 points.

Il serait donc incorrect d'attribuer à cette pénalité une exclusion générale de l'AMRAP long dans la politique actuelle. Le bonus Circuit du RPC Composer est un mécanisme distinct, suivi par #35.

## Campagne contrôlée et résultats

| Contrôle | Couverture | Résultat / limite |
| --- | --- | --- |
| Finaliseur isolé | 5 mécaniques × 7 budgets explicites × 2 readiness × 2 inventaires = **140 cas**, plus **4 cas NULL** | Assertions sur le budget effectif et la trace du cap conformes au comportement actuel. Ne constitue pas une prescription athlète complète. |
| Composer | 3 mécaniques × 7 budgets × 2 readiness × 2 inventaires = **84 cas** | Sauvegarde, preview, Jour J READY, durées et ordre préservés. Durée totale de la fixture = WOD + 16 min (préparation 11 + transitions 5), donc 24–76 min ; ce ne sont pas de nouvelles options UI. |
| Planificateur complet HOME | 6 durées de séance 20/30/45/60/75/90 × 2 readiness × 2 inventaires = **24 cas** | READY, budgets totaux et matériel compatibles. Recherche contrôlée à 20 candidats, distincte de la largeur initiale 8 du handler HOME/BOX. Aucun cap appliqué au candidat retenu. |
| Largeur initiale HOME/BOX | 30 min / low et 90 min / high, **8 candidats** | READY ; wrapper de cap effectivement appelé. Ce sont des probes directs du planner, pas des appels Edge complets. |
| Matériel requis | Band Row sans puis avec élastiques | Jour J refuse `COMPOSER_EXERCISE_INCOMPATIBLE_EX321` sans matériel, puis READY avec matériel. La preview seule ne prouve donc pas cette compatibilité. |
| Player, logique sans rendu | Durées 8/12/17/22/35/40/60, stations et cap | Helper réel conforme aux paramètres compilés ; aucun arrêt implicite à 35/40 min. Circuit reste piloté par ses tours. |
| Baseline Composer | 72 scénarios, 336 contrôles, éditeur et raccord UI | PASS. Aucun code applicatif modifié par cet audit. |

Budgets WOD des 24 plans complets (minutes) :

| Séance | Low / aucun matériel | Low / élastiques | High / aucun matériel | High / élastiques |
| --- | --- | --- | --- | --- |
| 20 | 9 | 9 | 11 | 11 |
| 30 | 12 | 12 | 10 | 10 |
| 45 | 15 | 15 | 17 | 17 |
| 60 | 20 | 20 | 27 | 27 |
| 75 | 20 | 20 | 33 | 34 |
| 90 | 20 | 20 | 40 | 41 |

Le probe 30 min/low/8 candidats est `CONSOLIDATE`, pas `CLASSIC` : l'absence de Skill dans ce cas ne démontre pas une régression du contrat HOME CLASSIC #26. La politique de ce contrat n'a pas été changée.

**Métadonnées décalées :** sur le plan 90 min/high sans matériel, le bloc WOD, l'architecture principale et le candidat final indiquent 40 min, mais `architecture.wod_duration_guardrail.final_wod_minutes` conserve 43. Ce champ intermédiaire ne doit pas être utilisé seul pour mesurer la prescription finale. Observation consignée, sans correction dans cet audit.

## Mesures de temps et garde-fous à préserver

Les 24 plans à 20 candidats sont mesurés séquentiellement en DEV avec `track_functions=all` ; les temps bruts sont conservés dans la preuve JSON. Il s'agit de contextes différents, pas de répétitions contrôlées d'un benchmark de production. Les probes à 8 candidats ne sont pas mélangés à ces statistiques. Aucun avant/après n'est annoncé puisqu'aucune fonction n'a changé.

Échantillon à 20 candidats : minimum **4,61 s**, médiane **11,14 s**, p95 empirique au rang supérieur **18,05 s**, maximum **18,50 s** (n=24). Probes à 8 candidats : **4,16 s** pour 30 min/low et **9,93 s** pour 90 min/high ; deux cas ne permettent pas de conclure à un gain général ni de calculer un p95 représentatif. Le helper de cap totalise environ **213 ms de temps propre** sur les 24 plans, contre 259,7 s de temps total observé.

Le plafond de famille ne remplace pas : budget total restant, simulation C3, marges EMOM, contrôle du dépassement, faisabilité/charge/fatigue, enveloppe athlète, douleur, équipement, droits, ordre des blocs et identité de séance. `c4_finalize_candidate` n'applique l'enveloppe athlète que si le candidat porte un `c4_runtime_context.user_id` ; une future correction doit vérifier la présence de ce contexte chez ses appelants, au lieu de déduire la sécurité d'un test de finaliseur isolé.

Le temps du helper de cap est mesuré séparément dans les traces ; ces observations ne démontrent pas que ses valeurs constituent une limite de performance nécessaire. La suppression de la troncature peut néanmoins augmenter le travail exploré : mesurer à nouveau après une éventuelle correction.

## Décision technique et prochaine étape

1. **Déjà conforme :** sémantiques de durée distinctes et absence d'obligation universelle de remplir un For Time ; conserver les fonctions existantes.
2. **Écart prouvé :** `least(exact, cap)` dans `c4_finalize_candidate_pre_m72` traite une durée de politique comme une restriction dure. C'est le point de modification ciblée identifié pour #33 ; aucune correction appliquée ici.
3. **Pas de correction aveugle :** ni suppression globale des caps/gates, ni augmentation de la seule configuration, ni application du même clamp au Composer, ni nouvelle pondération de score.
4. **Prochain travail recommandé :** audit #34 des doses réelles et du raccord aux compilateurs C4 existants ; puis corriger l'utilisation dure du plafond avec preuve des contextes athlètes et non-régression, avant de revoir le classement #35. Cela évite d'allonger seulement une durée déclarée ou de conserver artificiellement 4/5 tours sur un WOD long.

#33 reste ouvert : diagnostic acquis, correction fonctionnelle et validation finale non réalisées. GYM/BOX/OUTDOOR, athlètes avec historique, HTTP/Edge, exécution physique, completion/historique et performances après modification restent hors des preuves de cette campagne. Aucune clôture automatique.

## Reproduction et sources

- [Runner SQL transactionnel](../../supabase/qa/mechanic_duration_audit_rollback.sql) : PURE par défaut ; injecter les `SET LOCAL ugerod.qa_mec33_*` indiqués dans son en-tête immédiatement après `BEGIN` pour chaque scénario. Les résultats `AUDIT_ERROR` doivent être traités comme un échec ; `ROLLBACK` termine tous les modes. Aucun DDL.
- [Preuves structurées](mec-duration-audit-evidence.json) : configurations utiles, empreintes des définitions, observations par cas et traces d'appels. Aucun export de données utilisateur.
- [QA du helper Player](../../scripts/qa-mechanic-duration-player.cjs) : `node scripts/qa-mechanic-duration-player.cjs`, depuis la racine du dépôt.
- Origine historique des caps : [migration](../../supabase/migrations/20260812094033_qa_v1_mechanic_specific_wod_duration_caps.sql). Le fit C2 a évolué depuis sa migration historique : les empreintes DEV sont la référence observée ; cet audit ne résout pas la reproductibilité globale #27.
- [RPC de recommandation Composer](../../supabase/migrations/20261117145547_composer_c4_mechanic_invariants_v1.sql) ; [helper Player](../../src/components/workout/WodProtocolPlayerV3.js) ; [service de génération](../../src/services/workoutGenerationService.js).
