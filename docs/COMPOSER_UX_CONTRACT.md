# Composer avec UGEROD — UX/UI contract

## Précision appliquée — 21 novembre 2026

En Maison et Box, les nouvelles cartes de proposition font varier la répartition Skill + WOD : conseillée, équilibrée, plus de temps pour l’autre bloc lorsque les durées le permettent. Les cartes Force/Renforcement seul et Skill seul ne sont plus proposées dans ces lieux. Le retrait explicite du Skill pour un WOD seul et les ajustements manuels restent disponibles. Les anciennes compositions enregistrées sont conservées ; Salle et Extérieur gardent leurs alternatives propres. La répartition conseillée lit les champs réels C4 `skill_target_minutes` et `wod_target_minutes`, avec vérification de leur présence.

## Cadrage courant — 19 novembre 2026

Le [ticket #29](https://github.com/ugosansh6/ucoach-mobile/issues/29) conserve le suivi unique de la stabilisation : besoins, couverture réelle, propriétaires, dépendances et preuves. Les règles ci-dessous sont acceptées ; leur présence dans ce contrat ne signifie pas qu'elles sont toutes implémentées ni que le développement a été lancé.

- Conserver les pages et composants existants : UGEROD propose, l'utilisateur garde ou ajuste. Aucun nouvel assistant obligatoire en sept étapes.
- Maison et Box restent deux lieux distincts. Skill + WOD est proposé par défaut dans chacun, mais la structure reste ajustable depuis Format : retrait/rétablissement du Skill et répartition des durées, sous validation moteur.
- Orientation, zones privilégiées multiples et cible de mouvement sont séparées. La cible apparaît directement en orientation technique et reste optionnelle pour force/conditionnement.
- Skill désigne un bloc, pas systématiquement un apprentissage technique : force/maîtrise ou progression spécifique, jusqu'à trois exercices, selon les contrats existants.
- Le sélecteur guidé explore zone/objectif/famille sans imposer trois menus ; choix et remplacement explicites, prescriptions réelles et détails à la demande. Réutiliser les cartes compactes et l'aperçu sous la mécanique sélectionnée.
- Mécaniques au choix parmi les compatibles : raisons et droits distingués, ajustement proposé seulement s'il est réellement évalué, aucune mutation silencieuse.
- Salle garde sa logique séries et cardio facultatif avant/après. Le contrat CARDIO n'est pas remplacé par un WOD.
- Les autorités moteur existantes déterminent proposition, dosage et faisabilité. L'interface n'invente pas de règles sportives ; le Player n'ajoute pas de volume. Budget, estimation et cap restent distincts.
- Préparation/Tabata protégé des nouvelles propositions, choix/versions des anciennes séances et réalisé conservés. Adaptations et réparations explicites.

Les sections historiques ci-dessous conservent les principes et preuves utiles. Le cadrage du 19 novembre prévaut sur leurs formulations incompatibles, notamment l'ancienne priorité structurelle par intention, l'assimilation Skill/Technique et toute lecture non ajustable du défaut Maison/Box.

## Raccord du parcours — 20 novembre 2026

Les nouveaux brouillons utilisent les propositions d’architecture serveur fondées sur `c4_session_architecture_targets_v2`. Maison et Box recommandent Skill + WOD quelle que soit l’orientation ; un créneau incompatible ne sélectionne pas une autre structure à la place de l’utilisateur. La structure reste ajustable. Les brouillons précédents gardent leur version et leurs choix.

Le Cardio Salle est un bloc distinct produit par `gym_build_cardio_block_v2`, ajouté ou retiré depuis Format, puis placé avant ou après le renforcement. Il conserve ses prescriptions et identités dans l’aperçu, la compilation et le Player natif ; il ne remplace pas la préparation ni le WOD. Le changement de machine passe actuellement par le matériel et le recalcul du protocole.

Le sélecteur et la bibliothèque partagent les filtres de zone, objectif, famille et favoris. La bibliothèque et les fiches lisent les identifiants et consignes du catalogue réel ; les favoris utilisent les préférences explicites existantes du moteur. Aucun dosage générique ni fiche de remplacement silencieuse n’est affiché pour un identifiant inconnu. Les détails sont accessibles à la demande. Un remplacement vise un mouvement explicitement désigné ; un bloc complet ne remplace plus automatiquement sa dernière ligne.

Le Player consomme les séries, répétitions, maintiens, distances, côtés et repos prescrits. Les maintiens et mouvements par côté du renforcement utilisent le même exécuteur de prescriptions, sans nouveau dosage. Charge facultative initialement vide ; seules les séries confirmées deviennent du réalisé. L’arrêt partiel conserve le détail exécuté.

La progression Composer est sauvegardée séparément des prescriptions, par utilisateur, séance et identité d’instance : cache local, synchronisation serveur avec révision, curseur, séries, saisies, repos et runtimes. Une révision périmée ne peut pas écraser une autre fenêtre. Un ajustement explicite du non-réalisé peut raccorder la sauvegarde si les prescriptions et protocoles déjà commencés restent identiques ; sinon la reprise est refusée avec conservation du réalisé. Une simple recharge n’accepte pas silencieusement un contrat modifié. Une composition déjà générée mais non commencée se modifie par une sauvegarde atomique avec confirmation : ancienne génération conservée comme remplacée, nouveau brouillon réexécutable au prochain lancement. Une séance commencée ou terminée ne passe jamais par ce remplacement. Les séances terminées relisent leurs résultats définitifs.

Vérifications automatisées et DEV détaillées dans #3/#38 ; elles ne remplacent pas la recette complète sur téléphone. Aucun ticket clos par ces changements.

## Principes et historique conservés

> **Lecture historique encadrée — consolidation du 13/11/2026.** Ce contrat du 14/10 reste utile pour les principes d'interaction, mais plusieurs détails ont évolué : voir [PRODUCT_REFERENCE.md](PRODUCT_REFERENCE.md), notamment les décisions du 26–27/10 et la séparation Aujourd'hui / Ma semaine du 12/11. Les choix de blocs enregistrés font autorité ; ne pas ajouter Warm-up/Tabata pour appliquer une ancienne formulation universelle. La date appartient à Ma semaine et le CTA cible a été actualisé en « Valider ma séance ». Ce bandeau ne demande aucune modification d'écran.

Status: LOCKED — 2026-10-14
Scope: MSW-032 → MSW-039

## Product rule

> UGEROD propose. L’utilisateur confirme ou corrige. La séance prend forme sous ses yeux.

Never:

> UGEROD asks → user fills a form → UGEROD calculates at the end.

The Composer is a guided composition workshop, not a programming wizard and not a static generated preview.

## Core interaction model

Seven functional decisions may exist, but they must not become seven visible wizard steps. The UI should feel like one continuous coaching experience.

The progress indicator is the workout itself: confirmed decisions compact into a quiet summary while the current decision occupies the visual focus.

Canonical transition:

1. UGEROD arrives with its best current proposal.
2. The user keeps it, adjusts it, replaces it, or asks for another option.
3. The confirmed decision contracts into the stable summary.
4. UGEROD reveals the next prepared decision.

No stepper, no `Step X/Y`, no progress bar and no generic `Next` CTA.

## Visual hierarchy

Every active Composer state has three levels:

1. **Already decided** — compact, stable, quiet.
2. **Current Coach proposal** — large, editorial, dominant.
3. **Take-back-control actions** — secondary and progressively disclosed.

At the end, this hierarchy disappears in favor of the payoff: the completed workout.

## Moment 1 — Frame

The Composer starts from context UGEROD already knows.

Typical surface:

- date;
- intended Coach direction if one already exists;
- planned duration;
- planned environment;
- available equipment summary.

Preferred copy:

> ON PART LÀ-DESSUS.
>
> 45 MIN
> BOX
>
> Barre · Haltères · Rameur

The main action confirms the frame. `Ajuster` is secondary.

Do not expose duration chips, environment grids or equipment selectors by default. Adjustment opens temporary UI such as a bottom sheet.

If an intent already exists in Ma semaine, it is the Coach frame and must not be arbitrarily challenged.

If the day is empty, UGEROD should still propose before asking wherever the backend has enough evidence. Missing information may be requested only when it cannot be inferred reliably.

## Moment 2 — Architecture

UGEROD proposes one primary architecture first. Alternatives are hidden until requested.

Preferred interaction:

> Voilà comment je construirais ta séance.

Primary architecture → contextual CTA such as `GARDER CETTE STRUCTURE`.

Secondary action: `Voir une autre option`.

Never present six equivalent format cards.

The time budget is managed by UGEROD, not by the user. A quiet estimated duration is enough. If a change would exceed the available time, the Coach explains the consequence and offers a correction.

## Moment 3 — Composition

UGEROD already chooses the recommended exercises and mechanics.

Exercise pattern:

> POUR LE STRENGTH
>
> BACK SQUAT
> 4 × 6

Primary action: `GARDER`.
Secondary: `Remplacer`.

Only after `Remplacer`, show a short engine-provided shortlist. The full library stays behind `Autre exercice`.

Mechanics follow the same rule. A mechanic is not a mandatory step. If UGEROD can choose a coherent EMOM / AMRAP / For Time / Circuit itself, it should show that choice directly. `Changer le format` progressively reveals compatible alternatives.

`Choisis pour moi` is only useful after the user has opened customization and wants to hand control back to the Coach.

The front must never recreate ranking/scoring logic or invent recommendations.

## Time budget

The user must not manage a technical time budget.

Allowed:

- `≈ 52 MIN`;
- a subtle visual distribution;
- a contextual warning when an edit creates a real conflict.

Forbidden:

- permanent `42 / 60 minutes used` counters;
- percentages;
- KPI dashboards;
- technical capacity bars.

Coach intervention example:

> Ça dépasserait ton créneau. Je garderais 45 min en réduisant le renforcement.

The intervention appears at the cause, contains a solution, and disappears after resolution.

## Coach voice

Performance Editorial, not chatbot.

Use short editorial annotations, potentially with a kaki left rule. No avatar, robot, speech bubble, sparkles, or `recommended by AI` label.

Coach advice is optional. Silence is valid.

## Motion

Motion is part of the coaching feeling.

On confirmation:

1. current proposal contracts;
2. it joins the stable summary;
3. next workout element appears already prepared by UGEROD.

The feeling must be `I confirm → UGEROD keeps building`, not `I click next → another form page`.

Transitions must remain implementable in React Native / Expo.

## Moment 4 — Completed workout

The final state is a reward, not a checkout summary.

Preferred hierarchy:

> TA SÉANCE EST PRÊTE.

Then show intention, duration, environment, blocks, exercises and mechanic in a fast-to-scan workout view.

Primary action in week-planning context: `AJOUTER À MA SEMAINE`.

Secondary actions when relevant:

- `Enregistrer dans Mes séances`;
- `Lancer maintenant`.

## Stability contract

After validation:

- blocks are stable;
- exercises are stable;
- mechanic is stable.

Day-J adaptation primarily changes dose:

- reps;
- load;
- volume;
- rest;
- fine intensity.

Do not silently rebuild the workout.

## Day-J Preparation handoff

Preparation must not ask again for context that is already known and unchanged.

Do not re-ask:

- duration;
- place;
- equipment;
- intent;
- structure;
- exercises;
- mechanic.

Day-J should mainly confirm:

- readiness;
- pain/discomfort;
- actual context changes.

## Reuse from Preparation

Composer and Preparation belong to the same design system and should share:

- header language;
- Manrope typography hierarchy;
- light/dark theme tokens;
- quiet elevated surfaces;
- bottom sheets;
- secondary choice controls;
- equipment choice rows;
- existing duration control when the user explicitly adjusts duration.

Do not reuse Preparation’s form-like information architecture.

In Composer, chips and selectors live behind `Ajuster`, `Remplacer`, or `Voir d’autres options`, not on the primary surface.

## Explicitly forbidden

- visible wizard / stepper;
- progress bar;
- generic `Suivant` on every state;
- permanent `Composer une séance` title on every state;
- open question when UGEROD already has a reliable answer;
- grids of chips everywhere;
- six equal format cards;
- equipment form visible by default;
- checkout-style recap;
- `Recommandé par IA`;
- systematic `Choisis pour moi`;
- orange primary CTA on every decision;
- fake/hardcoded Coach recommendations;
- frontend recommendation scoring.

## Clarifications accepted on 18 November 2026 (#29, #3, #40)

- Alternatives preserving the selected goal are separate from `Composer une autre structure`. Classification reuses #29's existing majority of main-block time; it adds no training score or new weighting. Free structures and saved drafts stay available without automatic rewriting.
- Structure descriptions explain the actual time allocation. A WOD's name or duration alone does not establish an endurance stimulus or guarantee alignment with a force goal.
- Movement cards display the existing backend Strength prescription (sets, reps or timed work, load when available, rest). A result from a different selection, duration, equipment or context is never presented as current. Other block prescriptions remain available in the validated recap; WOD dosage also appears with its format when the existing preview succeeds.
- `Min prévues` is a time budget. The backend estimate includes work, recoveries, installation, transitions and load changes. An underfilled block is diagnosed without silently adding exercises or sets; the existing structure editor remains directly accessible.
- The movement action says `Remplacer` at the current capacity limit. Since 19 November (#34), the manual WOD ceiling reads the existing C4 composition contracts for the formats exposed by the Composer RPC (currently up to six movements for Circuit). This does not activate advanced/Premium formats. Automatic defaults stay unchanged; selection count is distinct from prescribed volume. If contracts cannot be read, the previous ceiling of three applies to new additions, with retry; replacing an older larger selection preserves every other selected movement.
- Formats are exclusive radio choices. Compact cards explain execution, and a selected protocol uses only the current backend preview. Existing server compatibility/ranking and preview/save/Player gates remain authoritative; no new mechanic is advertised as executable by this UI change.

## Final test

For every visible state ask:

> Does this look like a Coach who has already thought and is proposing something?

If it instead looks like software waiting for the user to configure it, the design is wrong.

## WOD adapter delivered in DEV on 19 November 2026 (#33–#38)

This supersedes the five-format-only implementation note above for **new** compositions:

- `wod_engine_version=C4_COMPOSER_V2` opts a new draft into one shared C2/C3/C4 prescription authority, used by recommendations, preview and Day J. Historical drafts without this marker retain their compiler; explicitly editing their WOD uses the new format confirmation. Saved blocks, IDs, order and started sessions are never silently migrated.
- The server catalogue exposes active core formats and variants with their existing Free/Premium rights and composition contracts. Capacity comes from **entitled** contracts (currently up to 6 Free / 7 Premium), not a fixed quota of 3. Default exercise choices are unchanged. An incompatible format stays unavailable with an explanation; one real compatible protocol is recommended first and alternatives remain behind `Voir d’autres formats`.
- Identity is **mechanic + variant** throughout selection, draft, compilation and Player hydration. Couplet ascendant and descendant cannot select each other accidentally.
- Explicit Composer WOD budgets bypass the old preferred-duration truncation **only in the authenticated V2 context**. Athlete workload, readiness, pain, equipment, technical, complete-cycle and C4 quality gates still apply. Today/default and historical cap behavior are unchanged. No sporting threshold or weighting was raised.
- Display reserved minutes separately from the calculated estimate and any hard time cap. Show actual rounds/cycles/rest, the per-movement dose, progression or finite volume. Finishing before a budget is legitimate for a finite workload; never add repetitions just to fill it. At Day J, readiness and pain can change compatibility; the user's architecture is not rebuilt to hide a failure.
- Deck uses the existing safe, persistent card draw before execution; reopening/retrying retains it. Penalty and Buy-in/Cash-out remain overlays, not standalone choices; they are not enabled by this adapter. Running Outdoor is unchanged.

Software verification and its limits: [shared WOD delivery report](COMPOSER_SHARED_WOD_V2.md). Physical iPhone, sound and interactive resume still require device acceptance; DEV availability is not production promotion or ticket closure.

## Preview placement and hierarchy — 19 November 2026 (#40)

Ugo validated the compact WOD preview and explicitly requested it immediately below the selected mechanic. Keep the selected option first, with its preview directly after the radio card and before complementary options. Use one main protocol instruction, a concise time line, aligned movement/dose rows and a short Day-J note. Reserved-time explanations belong behind an accessible information control. Preserve computed quantities, per-side semantics, loading/stale/error guards and both theme palettes. This is a presentation change, not a new prescription rule.
