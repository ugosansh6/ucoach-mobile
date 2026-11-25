# Politique de non-régression Composer

Consolidation du 25/11/2026, approuvée par le responsable produit. Source : [#30](https://github.com/ugosansh6/ucoach-mobile/issues/30). Le ticket #38 est la matrice de recette active. #29 est l'index fonctionnel. Ce document ne modifie aucune règle sportive ni le code.

- Réutiliser C2/C3/C4, leurs contrats, leurs gardes et les players existants ; aucun deuxième moteur.
- Avant chaque lot, relever la branche, le commit, la cible DEV et les contrats réellement touchés. Examiner les dépendances et les régressions possibles, puis tester les cas concernés et les cas historiques.
- Distinguer code versionné, migration appliquée, QA logicielle, déploiement et recette utilisateur réelle. Ne pas extrapoler un PASS ancien à un contrat modifié.
- Vérifier aperçu → sauvegarde → compilation → Player → résultats/historique, droits, reprise, idempotence, ancien brouillon et non-régression Aujourd'hui selon le périmètre.
- Tests SQL sur fixtures synthétiques en transaction ROLLBACK ; pas de données utilisateur/secrets dans Git. STAGING/PROD uniquement sur accord explicite.
- Les preuves historiques ci-dessous sont conservées dans leur contexte ; les états et listes de catalogue historiques ne sont pas une affirmation de l'état courant.

## Archive intégrale du ticket #30

<!-- backlog-consolidation-2026-11-19 -->
## État consolidé — 19/11/2026
**Priorité : Méthode transversale ; pas de lot de développement supplémentaire. État : Audit ciblé de consolidation effectué ; contrôles utiles à conserver par lot.**
Cadrage, couverture par besoin et ordre de traitement : **#29**, unique index du lot. Aucun nouveau ticket créé, aucune clôture effectuée par cette consolidation.

### Responsabilité unique de ce ticket
Règle de réutilisation et registre de preuves, sans reproduire l'orchestration #42 ou la recette #38.

### Déjà présent — conserver, ne pas redévelopper
- Code, tickets ouverts/clos, PR fusionnées pertinentes et définitions effectives DEV rapprochés ; six suites locales existantes PASS à la consolidation.
Sources historiques : [PR #23 fusionnée](https://github.com/ugosansh6/ucoach-mobile/pull/23), [PR #24 fusionnée](https://github.com/ugosansh6/ucoach-mobile/pull/24)

### Reste à traiter dans ce ticket
- [ ] À la reprise d'un lot autorisé, ne vérifier que les contrats touchés et leurs risques ; conserver les capacités conformes.
- [ ] Distinguer code, SQL appliqué, preuves logicielles, déploiement et recette appareil ; ne pas convertir un ancien PASS de règle différente en conformité actuelle.

### Frontières pour éviter les doublons
- Pas de nouvelle implémentation C2/C3/C4 ni d'audit global récurrent bloquant chaque tâche.
- #42 réalise le raccord manquant ; #38 possède la matrice de recette. Les défauts historiques ci-dessous ne sont pas tous encore à développer.

### Dépendances
Aucun nouveau développement technique préalable imposé par cette consolidation.
Relations de contrat/preuve, sans créer un deuxième chantier : #29, #42, #38.
Besoins tracés dans la matrice #29 : B13.
La conception des interfaces/critères peut être préparée ensemble ; l'implémentation suit ces responsabilités. La matrice de dépendances opérationnelles de #29 ne comporte pas de cycle.

## Base vérifiée et sens des statuts
Consolidation demandée explicitement par Ugo le 19/11/2026, après validation des besoins et inscription des tickets. **Aucun développement lancé par cette opération.**
Code contrôlé : `ux-navigation-coach-v1` à `7ec81ed` ; Supabase DEV ugoach ACTIVE_HEALTHY, lectures seules des politiques et des définitions effectives.
**Complète** = fonction présente dans le périmètre vérifié ; cela ne vaut pas recette physique. **Partielle** = socle présent, complément/raccord ou validation manquant. **Absente** = fonction demandée non raccordée dans ce parcours, même si des briques existent ailleurs.
Les six suites locales existantes matrice/éditeur/sélection/hydratation/shared-engine/présentation passent ; elles valident aussi d'anciennes règles et ne prouvent pas la conformité du nouveau cadrage. Aucun test nouveau codé, SQL de fixtures rejoué ou recette appareil réalisé pendant la consolidation.

## Prochaine action
Conserver les réalisations et ne prendre en charge que le reste indiqué ci-dessus, avec les contrôles ciblés et la recette centralisée #38.
Les formulations de l'historique qui contredisent le cadrage courant sont obsolètes pour le lot. Aucun changement de code applicatif, SQL, politique sportive ou déploiement par cette consolidation. Les clôtures restent soumises à l'accord explicite d'Ugo.


<details>
<summary>Historique conservé — état avant consolidation, accords, livraisons et preuves</summary>

L'état opérationnel et les responsabilités ci-dessus font autorité. Les anciennes tâches/qualifications ci-dessous ne constituent pas des développements à refaire lorsqu'elles sont couvertes ou transférées. Les preuves restent valables dans leur périmètre d'origine.

# MEC-AUDIT — Audit de réutilisation et non-régression (avant chaque lot)

## Décision produit (17 novembre 2026)
On **réutilise** systématiquement les mécaniques, contrats, solveurs, sécurité, progression et Players existants. **Aucune réécriture arbitraire** de C2/C3/C4. Pour chaque tâche, diagnostiquer le comportement réel, prouver un écart, définir le comportement attendu et les tests. Si la fonction est conforme, marquer **DÉJÀ COUVERT — aucune modification** et passer à la suivante.

## Référence technique de départ
- Branche: `ux-navigation-coach-v1`, commit **`cbd6cca04b5623c8782e230eb2064e2f48a47f7e`**.
- Supabase DEV : `fjjhzzwupjhcasoyerym`. Aucun changement de STAGING/PROD autorisé.
- Catalogue : 15 familles actives, 5 variantes, 2 overlays ; `STRENGTH` ancien alias désactivé.
- C4 possède déjà `c4_mechanic_composition_contract`, `c4_mechanic_duration_contract`, C3 simulation, C2 prescription, garde-fous et historique de variété.
- Anti-redondance DEV : fenêtre de **5** séances, déclenchement mécanique répétée **3** fois, changement seulement dans une bande de qualité contrôlée. **Ne pas créer une seconde stratégie 7/14/28 j sans preuve.**
- Politique `program_coach_v2.generation_mode=ACTIVE`, `mechanic_policy.apply_enabled=true` vérifiées ; la provenance des candidats doit encore être inspectée par scénario.
- Baseline de tests exécutés sans mutation DB depuis les fichiers de la branche : `qa-composer-intent-matrix` **PASS 72 intentions + 336 cas**, `qa-composer-architecture-editor` **PASS**, `qa-composer-editor-wiring` **PASS**. Ces tests reflètent les règles **antérieures** (Tabata facultatif) et doivent être re-spécifiés, pas simplement supprimés.

## Écarts avérés (à corriger après tickets)
- MEC-TAB : le Tabata abdos de 4 min n'est pas automatiquement injecté dans les **nouvelles** compositions `Ma semaine`, et peut être retiré. Nouvelle décision : Warm-up + Tabata obligatoires dans **toute nouvelle proposition**, inchangés dans les anciens brouillons.
- MEC-CONTRACT : la recommandation Composer peut proposer `CIRCUIT` avec **un seul exercice** ; le contrat C4 exige min **3**. Reproduction SQL lecture seule DEV avec EX001, 40/78 min.
- Le sélecteur Composer limite automatiquement WOD à 3 exercices ; le compilateur Composer utilise 5 tours max For Time / 4 tours max Circuit ; à expertiser sous MEC-LONG.
- Score Composer privilégie CIRCUIT uniquement à partir de 40 minutes ; revisiter après évaluation de candidats réellement faisables.

## Non-conformes présumés mais PAS autorisés à modifier sans diagnostic
- Plafonds durée des mécaniques C4 : 25–50 min ; repérer leurs usages (pénalité, exploration, sécurité) avant toute modification.
- Diversité C4 : fonctions déjà en place ; mesurer la couverture réelle des mécaniques et l'utilisation des chemins actifs.
- Mécaniques avancées : vérifier leur contrat + Player + historique E2E avant ouverture au Composer.

## Méthode obligatoire pour tout sous-ticket
1. État vérifié du code **et** de la fonction DEV, plus sha/versions.
2. **Problème reproductible** + comportement attendu mesurable.
3. Si déjà conforme → ne rien modifier.
4. Si modification : plus petit diff, tests baseline avant/après, scénarios supplémentaires, migration/versionnement seulement si nécessaire.
5. QA Jour J, Player, historique, sécurité et compatibilité des anciens brouillons, puis revue iPhone.
6. Aucun ticket clos sans validation explicite d'Ugo ; aucun passage STAGING/PROD sans accord.

## Dépendances et suivi
- [#29](https://github.com/ugosansh6/ucoach-mobile/issues/29) Composer — structures et décision Tabata du 17/11 à réconcilier.
- [#3](https://github.com/ugosansh6/ucoach-mobile/issues/3) Composer → Player et E2E ; [#26](https://github.com/ugosansh6/ucoach-mobile/issues/26) règle Aujourd'hui HOME Skill + WOD, séparée.
- [#27](https://github.com/ugosansh6/ucoach-mobile/issues/27) Dette historique Git/DEV, à traiter avant promotion.
- Reste à cadrer : MEC-DURATION, MEC-LONG, MEC-RECO, MEC-VARIETY, MEC-ADVANCED, MEC-E2E. **Pas de création de code sur ces lots avant leur audit ciblé**.


## Sous-tickets opérationnels
- [#31](https://github.com/ugosansh6/ucoach-mobile/issues/31) — MEC-TAB : rétablir Tabata obligatoire et non supprimable sur les nouvelles séances Ma semaine.
- [#32](https://github.com/ugosansh6/ucoach-mobile/issues/32) — MEC-CONTRACT : réutiliser le contrat C4 pour filtrer les mécaniques Composer.
Ces sous-tickets doivent être testés et documentés avant MEC-DURATION/MEC-LONG.


## Première livraison contrôlée (DEV — 17/11/2026)
- #31 : [`1f5a2d3`](https://github.com/ugosansh6/ucoach-mobile/commit/1f5a2d3c4662b8abdcdfa7da3b6ecda489e61b4a), nouvelles compositions Warm-up+Tabata obligatoires, historiques sans mutation ; tests QA 72 + 336, éditeur, UI **PASS** ; suivi ouvert.
- #32 : migration DEV `20261117145547`, [`eb7bd71`](https://github.com/ugosansh6/ucoach-mobile/commit/eb7bd71901f745e33c734a67b0c350f2ccd0d66a), recommandation de mécanique conforme au contrat C4 ; QA SQL 7 cas + long WOD **PASS**, suivi ouvert.
- E2E SQL en ROLLBACK **PASS** : architectures personnalisées, brouillons legacy, intent 20/60/90, TODAY HOME 30/45/60, autorité Strength C2/C4.
- Les tickets #31/#32 restent ouverts jusqu'à recette iPhone. Aucun déploiement STAGING/PROD. Ne pas relancer une réécriture globale du moteur.
- Prochain audit : séparer les plafonds C4 utilisés pour *recherche/ranking* des vrais garde-fous de sécurité, puis évaluer la construction réelle des WOD longs avant modification.

## Audit consolidé versionné
[UGEROD — Audit MEC (17/11/2026)](https://github.com/ugosansh6/ucoach-mobile/blob/ux-navigation-coach-v1/docs/MECANICS_AUDIT_2026-11-17.md), commit [`a5e64c8`](https://github.com/ugosansh6/ucoach-mobile/commit/a5e64c8baa84c721f0798d5a03e1f5efff5e6bc0). Tableau de tous les lots, statuts, problèmes, comportements attendus, preuves de QA et dépendances. Tickets fils : [#31](https://github.com/ugosansh6/ucoach-mobile/issues/31), [#32](https://github.com/ugosansh6/ucoach-mobile/issues/32), [#33](https://github.com/ugosansh6/ucoach-mobile/issues/33), [#34](https://github.com/ugosansh6/ucoach-mobile/issues/34), [#35](https://github.com/ugosansh6/ucoach-mobile/issues/35), [#36](https://github.com/ugosansh6/ucoach-mobile/issues/36), [#37](https://github.com/ugosansh6/ucoach-mobile/issues/37), [#38](https://github.com/ugosansh6/ucoach-mobile/issues/38).

## Contrôle de reprise — 17/11/2026
- Handoff initial dépassé : #31 et #32 étaient déjà codés au HEAD `a5e64c8`. Aucun redéveloppement.
- [bc9a8b4](https://github.com/ugosansh6/ucoach-mobile/commit/bc9a8b427f1d94c58fe12f07ac6b504c8cdd5776) ajoute uniquement des preuves QA et corrige la règle Tabata obsolète de `UGEROD.md` (4 fichiers). Vérification de la tête avant publication et mise à jour sans force avec `expected_sha`.
- DEV ACTIVE_HEALTHY ; définition RPC #32 conforme au SQL versionné ; 3 QA Composer, hydration Player, timer hold et nouveau runtime Tabata **PASS** ; 7 scripts SQL ciblés **PASS / ROLLBACK**, dont assertions de protocole et tests de rôles authentifié/inter-utilisateur/anonyme.
- #31/#32 restent **ouverts**, la recette physique iPhone et la fin réelle vers historique restant à valider. Les tests de logique du Player ne sont pas une recette E2E sur appareil.
- Aucune nouvelle migration, aucun changement de C2/C3/C4, aucune écriture STAGING/PROD. Prochaine action : recette ciblée décrite dans #31/#32, puis audit #33 ; ne pas modifier les plafonds WOD avant d'en établir les usages.


Publication web DEV du commit `bc9a8b4` : build Expo et déploiement **SUCCESS**, [run 44113273243](https://github.com/ugosansh6/ucoach-mobile/actions/runs/44113273243). Aucun résultat iPhone ou historique réel n'est ajouté à cette preuve.


</details>
