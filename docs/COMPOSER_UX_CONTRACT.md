# Composer avec UGEROD — UX/UI contract

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

## Final test

For every visible state ask:

> Does this look like a Coach who has already thought and is proposing something?

If it instead looks like software waiting for the user to configure it, the design is wrong.
