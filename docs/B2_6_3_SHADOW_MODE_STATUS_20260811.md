# UGEROD — B2.6.3 Shadow Mode — 2026-08-11

## Statut

B2.6.3 = PASS en DEV uniquement.

## Objectif

Faire tourner le moteur B2.5 sur les observations réelles sans modifier `user_exercise_capabilities` ni `capability_update_events`.

## Migrations

- `20260811082917_phase_b263_shadow_mode.sql`
- `20260811083150_phase_b263_shadow_runtime.sql`

## Architecture

`exercise_logs` -> `performance_observation_contract` -> `build_capability_observation_inputs()` -> `propose_capability_state_update()` -> état shadow isolé.

Le shadow runtime persiste uniquement dans :

- `user_exercise_capabilities_shadow`
- `capability_shadow_events`
- `capability_shadow_run_errors`

Il ne touche jamais les capacités réelles.

## Déclenchement automatique

À partir de cette étape, lorsqu'une `workout_session` passe à `completed`, un trigger exécute le shadow runtime. Une erreur shadow est capturée dans `capability_shadow_run_errors` afin de ne jamais bloquer la clôture de la séance réelle.

## Identité d'observation

Le trigger `trg_resolve_exercise_log_instance` complète automatiquement `exercise_logs.session_exercise_id` lorsqu'il existe exactement une instance compatible dans `workout_session_exercises`.

Si plusieurs instances du même exercice existent dans une séance, l'insertion est refusée tant que `session_exercise_id` n'est pas fourni explicitement. Cela évite les associations silencieusement ambiguës.

## Idempotence

Les événements shadow sont uniques par :

`exercise_log_id + capability_family + capability_mode`

Le même principe a corrigé l'index du futur moteur réel : l'idempotence doit distinguer `fresh` et `repeatable`.

Smoke test :

- premier replay de la séance DEV historique : 18 propositions traitées ;
- second replay : 0 proposition retraitée, 18 ignorées comme déjà traitées ;
- 0 mutation des capacités réelles.

Les données shadow du smoke test ont ensuite été supprimées pour laisser le shadow runtime propre pour les prochaines vraies séances DEV.

## Stress-test pur B2.5 sous Shadow Mode

Séquence positive reps repeatable :

1. 10 reps @ RPE 7 -> `CONFIRM / INITIALIZE`
2. 12 reps @ RPE 7 -> `HOLD / POSITIVE`
3. 12 reps @ RPE 7 -> `EXPAND / POSITIVE`, confirmation atteinte

Enveloppe finale : 12 reps.

Séquence négative ensuite :

1. 10 reps @ RPE 9 -> `HOLD / NEGATIVE`
2. 10 reps @ RPE 9 -> `HOLD / NEGATIVE`
3. 10 reps @ RPE 9 -> `RECALIBRATE / NEGATIVE`, confirmation atteinte

L'enveloppe historique reste à 12 reps. Un `recalibration_candidate` à 10 reps est enregistré dans l'état proposé. La capacité historique n'est donc pas écrasée brutalement.

## État après tests

- `user_exercise_capabilities` : 0 ligne
- `capability_update_events` : 0 ligne
- shadow tables : nettoyées après smoke test

Le prochain vrai passage d'une séance DEV à `completed` alimentera automatiquement le Shadow Mode.

## Prochaine étape

B2.6.4 — E2E réel sur une nouvelle séance DEV : génération -> exécution -> completion -> logs -> shadow events -> contrôle des décisions par contexte et de l'absence de mutation réelle.
