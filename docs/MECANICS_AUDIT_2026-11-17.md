# UGEROD — Audit et ordre d'intégration du chantier MEC
_2026-11-17 · Baseline f093630 · DEV only · Document de suivi (ne vaut pas clôture des tickets)_

## Doctrine produit validée
- **Réutilisation obligatoire** des mécaniques, contrats, C2/C3/C4, moteur de progression, contrôles de sécurité et Players existants. Chaque ticket commence par un diagnostic vérifiable : si la règle existe et fonctionne, aucun développement.
- Les mécaniques ne possèdent **pas de durée sportive maximale arbitraire**. Les sémantiques existantes (`fixed_duration`, `time_cap`, `target_duration`, `finite_workload`) sont conservées ; les durées préférées restent des **signaux souples** tant que la prescription est cohérente. Ne pas supprimer aveuglément les caps existants avant d'avoir compris leurs usages de sécurité/performance.
- Respect des invariants des mécaniques (ex. Couplet 2 mouvements, Deck 4), du niveau, de la fatigue locale, du matériel, de l'environnement et de la compatibilité Player. Aucune séance fictivement allongée pour remplir un créneau.
- **Aujourd'hui HOME** automatique : règle Skill + WOD conservée (#26). **Ma semaine** : blocs choisis par l'utilisateur conservés dans l'ordre, y compris Renforcement seul (#3).
- **Nouvel arbitrage 17/11** : dans **toute nouvelle proposition Ma semaine**, Warm-up **et** Tabata abdos 4 min automatiques et non supprimables ; les anciens brouillons déjà sauvegardés ne sont jamais réécrits.
- Aucune modification de STAGING/PROD, pas de clôture sans recette iPhone et accord explicite d'Ugo.

## Baseline de réutilisation
- **15** mécaniques principales actives, **5** variantes, **2** overlays ; alias `STRENGTH` du catalogue désactivé. Rien à recréer.
- `c4_mechanic_composition_contract` centralise les contraintes des mouvements et variantes ; `c4_mechanic_duration_contract` les sémantiques de durée.
- C2 `c2_mechanic_fit` et solveur de dose, C3 simulateur de durée/densité/fatigue, C4 garde-fous équipement, douleur, readiness, volume et compatibilité.
- Politique DEV : `program_coach_v2.generation_mode=ACTIVE` et `mechanic_policy.apply_enabled=true`; la diversité existe déjà (qualité proche, anti-redondance, fenêtre cinq séances, autre mécanique après trois répétitions si alternative quasi équivalente). **Chemins réellement traversés à tester**.
- Situation pré-correctif : Composer WOD 3 exercices maximum, recommendation de 5 mécaniques avec bonus Circuit dès 40 min, Jour J For Time 5 tours et Circuit 4 tours max, HIIT 40/20.

## Statuts et problèmes / comportements attendus

| Ticket | Problème prouvé ou contrôle manquant | Comportement attendu | Statut 17/11 |
|---|---|---|---|
| [#30 MEC-AUDIT](https://github.com/ugosansh6/ucoach-mobile/issues/30) | Risque de refonte inutile et régressions entre C2/C3/C4, Composer et Player | Audit préalable + baseline + plus petit changement vérifié | **Socle établi**, suivi ouvert |
| [#31 MEC-TAB](https://github.com/ugosansh6/ucoach-mobile/issues/31) | Tabata absent par défaut et supprimable dans les **nouvelles** compositions | Warm-up + Tabata 4 min automatiques, protégés ; legacy inchangé | **Corrigé DEV**, QA PASS, iPhone restant |
| [#32 MEC-CONTRACT](https://github.com/ugosansh6/ucoach-mobile/issues/32) | CIRCUIT recommandé à 1 mouvement alors que C4 exige 3 ; min/max non partagés | Éligibilité basée sur contrat C4, indisponibilité expliquée sans mouvement ajouté silencieusement | **Corrigé DEV**, QA PASS, iPhone restant |
| [#33 MEC-DURATION](https://github.com/ugosansh6/ucoach-mobile/issues/33) | `wod_duration_caps_minutes` 25–50 et `c2_mechanic_fit` pénalisent la durée, Composer autorise 3–90 ; rôle des plafonds à préciser | Préférences de durée souples, limites de calcul/sécurité explicitement conservées | **AUDIT** avant code |
| [#34 MEC-LONG](https://github.com/ugosansh6/ucoach-mobile/issues/34) | 3 mouvements WOD, 5 tours For Time, 4 Circuit, prescriptions et HIIT simplifiés dans le Composer | Tours/répétitions/volumes/recovery adaptés, For Time volumineux et AMRAP long possibles si réellement faisables | **AUDIT/QA SPORTIVE** avant code |
| [#35 MEC-RECO](https://github.com/ugosansh6/ucoach-mobile/issues/35) | Classement au seul nom de mécanique + bonus Circuit à partir de 40 min | Comparer des séances calculées et faisables, préserver C2/C3/C4, expliquer le choix | **AUDIT** avant code |
| [#36 MEC-VARIETY](https://github.com/ugosansh6/ucoach-mobile/issues/36) | Diversité ressentie faible malgré une politique C4 déjà active | Identifier pool, refus et effet réel de la politique ; ne changer que la règle insuffisante prouvée | **QA uniquement** pour commencer |
| [#37 MEC-ADVANCED](https://github.com/ugosansh6/ucoach-mobile/issues/37) | Mécaniques avancées déjà présentes mais non toutes prises en charge par le Composer/Player W11 | Tester chaque format, contrats et droits avant activation ciblée | **E2E préalable**, aucun nouveau moteur |
| [#38 MEC-E2E](https://github.com/ugosansh6/ucoach-mobile/issues/38) | Couverture incomplète sur WOD long, Player réel, actuals, historique, iPhone et temps d'exécution | Recette continue et preuves de non-régression, iPhone avant clôture | **Transversal ouvert** |

## Preuves déjà acquises
- Baseline JavaScript **PASS** : `qa-composer-intent-matrix.cjs` (72 cas + 336 variantes), `qa-composer-architecture-editor.cjs`, `qa-composer-editor-wiring.cjs`.
- Correction #31 : commit [`1f5a2d3`](https://github.com/ugosansh6/ucoach-mobile/commit/1f5a2d3c4662b8abdcdfa7da3b6ecda489e61b4a), nouvelle structure WARMUP+TABATA4, éditeur protégé ; [QA nouvelle séance 20/30 min](../supabase/qa/composer_mandatory_tabata_new_plans_rollback.sql) **PASS** preview C2 + Day J READY.
- Correction #32 : migration DEV `20261117145547_composer_c4_mechanic_invariants_v1`, commit [`eb7bd71`](https://github.com/ugosansh6/ucoach-mobile/commit/eb7bd71901f745e33c734a67b0c350f2ccd0d66a), [QA SQL 7 cas](../supabase/qa/composer_mechanic_c4_invariants_rollback.sql) **PASS** + 78 min à un mouvement impossible.
- QA non-régression DEV avec **ROLLBACK** **PASS** : `composer_custom_architecture`, `composer_dayj_preserves_user_blocks`, `composer_intent_dayj`, `composer_shared_strength_authority`, `home_classic_skill_wod` (30/45/60 min). Aucune donnée d'essai persistée.
- GitHub Pages : [run 44108561848](https://github.com/ugosansh6/ucoach-mobile/actions/runs/44108561848) **SUCCESS** au commit `eb7bd71`.
- ACL du RPC des mécaniques inchangées : `authenticated` peut exécuter, `anon` ne le peut pas. Aucune modification de RLS, table, données utilisateurs ou historique.

## Points de vigilance non résolus
1. Le RPC de recommandation Composer respecte désormais min/max de composition, mais les **anciens drafts enregistrés** peuvent encore être compilés selon leur contrat historique par Jour J. Ne pas leur appliquer rétroactivement un rejet sans migration explicite de version.
2. Un WOD Circuit 78 min **compilable** n'est pas une preuve de dose réaliste ; le compilateur W11 conserve des tours plafonnés et ne partage pas encore tous les calculs C3/C4.
3. Ne pas remplacer la recommandation « Circuit long » par une autre règle arbitraire sans évaluer plusieurs WOD candidats complets.
4. Une réussite GitHub Pages / SQL rollback ne remplace pas une recette sur le **Player iPhone** et le suivi réel d'exécution.
5. La dette Git / DEV ancienne est suivie par [#27](https://github.com/ugosansh6/ucoach-mobile/issues/27) ; ne pas supposer que tout le backend est reproductible en dehors des migrations vérifiées de ce lot.

## Ordre des étapes suivantes
1. Valider le parcours iPhone des #31/#32, sans clore avant accord.
2. Auditer #33 (caps et leur rôle effectif dans l'exploration/scoring/sécurité).
3. Mesurer puis traiter #34 (dose réelle WOD longs et Player), puis #35 (recommandation fondée sur la qualité).
4. Mesurer #36 (diversité existante), corriger seulement si la preuve démontre une lacune.
5. Réaliser #37 et #38 (mécaniques avancées/recette transversale), ticket par ticket.

Toute tâche « déjà conforme » se termine **sans modification**, avec preuve de vérification.
