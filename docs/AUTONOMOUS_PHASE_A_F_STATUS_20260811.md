# UGEROD — Autonomous Phase A→F status — 2026-08-11

## Guardrails used

- DEV Supabase only: `fjjhzzwupjhcasoyerym`
- No STAGING or PROD promotion
- No merge to `main`
- No arbitrary physiological/scoring coefficients invented
- User-declared pain/discomfort stays absolute hard gate
- Existing V1/bright-handler kept operational; Phase C foundations are additive

## Phase A — DATA foundations — CLOSED / PASS

Final catalog state:
- 133 exercises
- 109 WOD-eligible
- 20 new strategic exercises (EX401→EX420), 18 WOD-eligible
- 0 critical null metadata
- 0 exercises without muscles / primary muscle / safety zones
- 0 invalid selection_weight
- 0 required equipment without A4 V2 semantics
- 0 tracked loads without explicit load semantics
- 0 prescription/tracking mismatches after A7 corrections

Corrections made during A7:
- 11 missing `starting_position` values filled
- Couch Stretch equipment corrected to optional; legacy Box gate removed
- Ankle Rocks and Shoulder CARs changed to `reps_unilateral`
- Tabata block rules enriched with `allowed_exercise_counts`: 4 min `[1,2]`, 8 min `[1,2,4]`

Safety × equipment stress tests:
- Every single declared discomfort zone leaves a usable WOD pool in every equipment profile
- Rare 2-zone combinations (mainly hip/groin + upper-limb zones) can leave 0–2 WODs; classified as legitimate refusal/coverage-gap cases, never reason to weaken safety

Local fatigue stress:
- 109 WODs = 5,886 pairs
- 5,476 pairs have different movement patterns
- 1,760 of those still share local muscular demand
- Confirms that pattern diversity alone cannot validate whole-WOD quality

Phase A final invariant audit: all critical checks = 0 errors.

## Phase B — Performance / Calibration — FOUNDATION IMPLEMENTED

Added:
- `user_exercise_capabilities`
- six capability envelopes: reps/load/time/distance/pace/density
- confidence/freshness/evidence metadata
- `exercise_logs` observation provenance and pain/skip fields
- `performance_observation_source` view (expected vs actual contract)
- `user_exercise_coach_state` view combining legacy progress + future capability envelopes

Important safety behavior:
- `effective_capability_eligible = false` for pain-affected/non-completed observations
- no automatic capability degradation from pain/skipped observations at this foundation layer

Current data smoke test:
- 9 exercise logs → 9 observation rows
- 0 pain eligibility leaks

Not implemented intentionally:
- capability update/calibration algorithm
- confidence/freshness formulas
- expected-vs-actual response coefficients
These require simulation/validation rather than arbitrary constants.

## Phase C — Session Engine — CONTRACTS + HARD GATES IMPLEMENTED

Added session contracts:
- `progression_intent`: MAINTAIN / PROGRESS / CONSOLIDATE / DELOAD / RECALIBRATE / EXPLORE
- planning context JSON
- expected stimulus JSON
- mechanic JSON
- quality gate JSON
- per-exercise expected outcome, expected RPE band, capacity snapshot, solver decision JSON

Mechanic referential:
- 16 active mechanics total
- 14 core mechanics + 2 overlays
- 8 Free automatic mechanics
- Premium manual compatibility field
- progressive interval family with Death By / Death By Couplet variants
- mechanic and progression-rule concepts kept separate

Deterministic hard-gate functions:
- `exercise_safe_for_zones`
- `exercise_equipment_compatible`
- `exercise_hard_gate_status`
- `session_hard_gate_candidates`

Equipment behavior tested:
- pair requirements are enforced
- ALL_OF and ANY_OF options work
- optional equipment does not block

Safety compatibility hardened:
- `body_zone_aliases`
- legacy labels such as `Genou`, `Poignet`, `Épaule`, etc. normalize to canonical A3 IDs
- unknown discomfort terms fail conservatively instead of silently passing

Not implemented intentionally:
- Coach Score coefficients
- rep/load/time/density solver formulas
- mechanic compatibility score thresholds
- full replacement of bright-handler
These need calibration and product/coach validation.

## Phase D — Weekly feedback loop — FOUNDATION IMPLEMENTED

Added:
- `weekly_stimulus_targets`
- `session_stimulus_ledger`
- `weekly_stimulus_balance` view
- `user_training_plan_items`

Key architecture preserved:
- planned stimulus != realized stimulus
- realized stimulus can later include external sessions
- recommended training date is nullable; plan sequence is primary

No arbitrary weekly target values were inserted.

## Phase E — Automatic UX data contracts — FOUNDATION IMPLEMENTED

Added:
- `exercise_completion_capture_schema`
- `user_auto_coach_snapshot`

Behavior:
- required fields derived automatically from exercise prescription
- load remains optional everywhere currently
- unilateral rep/time/distance semantics are exposed as per-side
- current catalog: 133 capture-schema rows, 0 missing required capture definitions

Not implemented intentionally:
- visual/UI redesign
- onboarding pain-zone selector update
- frontend integration with new views
These affect product UX and should be reviewed interactively.

## Phase F — External session import — STAGING FOUNDATION IMPLEMENTED

Added:
- `external_session_imports`
- `external_session_items`
- `external_import_review_queue`
- `external_import_ready_to_commit()`
- provenance links from exercise logs and stimulus ledger

Architecture:
- text/photo/voice input accepted as staging provenance
- parser output is never directly trusted as capability evidence
- import must be validated
- all items must be matched and confirmed before commit readiness
- no trigger updates user capability from AI/parser output

Not implemented intentionally:
- AI parser Edge Function
- OCR/photo pipeline
- voice transcription pipeline
- commit-to-session function/UI
These require integration choices and end-to-end tests.

## Remaining decisions / work for next interactive session

1. Decide/validate Phase B calibration formulas and evidence weighting through simulation.
2. Design Phase C Coach Score + prescription solver, then stress-test across goals/readiness/history.
3. Rebuild bright-handler/session generation to consume A3/A4/B/C foundations.
4. Migrate EX150 High Knees to timed-work semantic when the new Session engine supports it.
5. Update preparation/onboarding pain UI from 5 legacy zones to the 13-zone controlled referential.
6. Frontend support for exact equipment quantities/loads.
7. Wire expected outcome capture into session/completion flow.
8. Wire weekly ledger and flexible plan into Dashboard.
9. Build/import parser flow for Phase F.
10. Add exercise illustrations (`image_path` is still empty for EX401→EX420 and many catalog entries).
11. Generate a full reproducible DEV→STAGING migration/seed snapshot before any promotion. DDL migrations from A→F exist in DEV migration history, but several catalog/reference DML corrections/additions were executed directly in DEV and must be captured before STAGING.
12. Run end-to-end authenticated app tests after Session engine integration.

## Repository state

Branch created: `phase-a-f-autonomous-20260811`

This branch is intentionally isolated from `main`. No PR/merge/promotion has been performed.
