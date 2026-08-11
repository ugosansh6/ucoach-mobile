# UGEROD — Autonomous Phase A→F status — 2026-08-11

## Guardrails used

- DEV Supabase only: `fjjhzzwupjhcasoyerym`
- No STAGING or PROD promotion
- No merge to `main`
- User-declared pain/discomfort stays an absolute hard gate
- No numeric load is invented without confirmed capability + inventory information
- Backend tests are executed in Supabase; app tests are reserved for interface-facing behavior and the final A→F pass

## Phase A — DATA foundations — CLOSED / PASS

Current catalog state:
- 157 exercises total
- 24 dedicated warm-up-only exercises (`EX421`→`EX444`)
- 43 warm-up-eligible exercises
- explicit warm-up roles: mobility / activation / movement prep / pulse raiser
- pain hard-gate coverage for all current preparation UI zones
- equipment quantity semantics, load semantics, body-zone safety, muscles and local-fatigue metadata

Important invariants:
- pain executes before scoring/solver
- equipment supports ALL_OF / ANY_OF / OPTIONAL + quantity
- warm-up rejects high-fatigue/high-impact/strength-like entries
- legacy `selection_weight` is not the final Session Engine decision

## Phase B — Performance Engine — CLOSED FOR ROADMAP / SHADOW-VALIDATED

Implemented:
- exact observation identity via `session_exercise_id`
- observation contract + quality roles
- reps/load/time/distance/pace/density/progressive capability families
- confidence and freshness separated
- capability envelopes + frontier logic
- CONFIRM / EXPAND / HOLD / RECALIBRATE proposal decisions
- idempotent shadow runtime
- exact repeated-exercise-instance bridge

Validation:
- duplicate exercise instances require exact identity
- shadow runs are idempotent
- 0 shadow errors in validation runs
- no real capability mutation during B/C backend tests

## Phase C — Session Engine — CLOSED FOR ROADMAP / DEV ROUTED

### C0 — Contracts + hard gates — ✅

- progression intents
- planning / expected stimulus / mechanic / quality-gate JSON contracts
- per-exercise expected outcome / expected RPE / capacity snapshot / solver decision
- mechanic referential
- deterministic pain + equipment + technical hard gates

### C1 — Target stimulus — ✅

Migration: `20260811114803_phase_c1_session_stimulus_contract`

The engine builds the target stimulus before exercise choice:
- strength
- conditioning
- muscular endurance
- power
- stability
- mobility
- density
- local fatigue
- complexity
- RPE band

Inputs: V1 goal, duration, readiness, optional target region, optional progression intent.

### C2 — Candidates + Coach Score — ✅

Migrations:
- `20260811115832_phase_c2_coach_score_solver_simulation`
- `20260811115938_phase_c2_conditioning_anchor_guard`

Implemented:
- hard-gated candidate pool
- exercise stimulus fit
- progression / prescription / complexity / fatigue / similarity scores
- mechanic fit
- multiple candidate WODs
- pattern and primary-muscle diversity
- recent-session anti-repetition
- one-axis progression budget
- Conditioning/Fat Loss anchor requirement
- `NO_SAFE_COHERENT_WOD` rather than forcing an incoherent workout

### C3 — Whole-WOD simulation — ✅

Migrations:
- `20260811121155_phase_c3_whole_wod_simulation`
- `20260811121336_phase_c3_duration_and_muscle_ledger_refinement`

Implemented for AMRAP / EMOM / FOR_TIME / CIRCUIT / STRENGTH / LADDER / PYRAMID / PROGRESSIVE_INTERVAL:
- time / round / set projection
- EMOM work-rest margin
- For Time cap feasibility
- cumulative ladder/pyramid/progressive volume
- whole-WOD reps/distance/hold/active-work volume
- density
- time utilization
- primary-muscle exposure ledger
- local-fatigue concentration
- whole-WOD fit
- underfill / overfill / infeasibility signals

### C4 — Final solver + Quality Gates + DEV routing — ✅

DEV migrations applied:
- `20260811122720_phase_c4_final_solver_quality_gates`
- `20260811122852_phase_c4_block_rules_region_coherence`
- `20260811123006_phase_c4_conditioning_region_balance`
- `20260811123104_phase_c4_conditioning_target_region_rule`
- `20260811123231_phase_c4_final_duration_gate`
- `20260811123400_phase_c4_strength_time_solver`
- `phase_c4_version_coherence`

Canonical solver: `solve_session_engine_c4(...)` → `c4-final-v1.5`.

Implemented:
- final mechanic-specific rep/round/set/time corrections
- strict block-rule exercise counts
- explicit target-region coherence without destroying Conditioning/Full-Body requirements
- final underfill/overfill rejection
- AMRAP transition gate
- EMOM complexity/fatigue/rest gates
- For Time heavy Hinge + heavy Jump incompatibility
- max Jump / max high-impact safeguards
- readiness caps
- final anti-redundancy over the last completed sessions
- exact anchors may repeat when physiologically useful
- final ranking = Coach Score + whole-WOD fit + anti-redundancy
- explicit mechanic overlays for Ladder / Pyramid / Progressive Interval
- legacy equipment-name bridge with quantity semantics; no numeric load inference
- persisted expected stimulus / mechanic / quality gate / solver decision / capability snapshot contracts

Stress validation in Supabase:
- General Fitness 30/60 → READY
- Fat Loss 45/60 including wrist discomfort → READY where a safe coherent WOD exists
- Conditioning 45/60 including wrist discomfort → READY
- Muscle Gain 60/90 → READY
- Strength 60/75 → READY
- legitimate Fat Loss + knee-pain coverage gap → `NO_SAFE_COHERENT_WOD`
- selected candidates pass final Quality Gate and duration coherence
- 0 real capability rows/events created by C4 tests

### Production-facing routing in DEV

`coach-handler` has been upgraded to `coach-handler-v2.0-c4` and deployed as Edge Function version 2.

Architecture now used by DEV generation:
1. `bright-handler` builds the non-WOD scaffold (Warm-up / optional Tabata / optional Skill + time architecture).
2. `coach-handler` audits non-WOD pain + warm-up contract.
3. C1→C4 is authoritative for the WOD.
4. C4 replaces the legacy WOD, writes exact `workout_session_exercises`, expected outcome, RPE band, capacity snapshot and solver decision.
5. Warm-up/Skill post-processing is applied against the final C4 WOD.
6. `generated_workout`, expected stimulus, mechanic and quality-gate contracts remain coherent in `workout_sessions`.

The frontend response shape is intentionally preserved, so no page redesign was required for C4. Existing session rendering can display the new mechanic structure text. Full application regression remains scheduled after Phase F.

## Phase D — Weekly feedback loop — NEXT

Existing foundations:
- `weekly_stimulus_targets`
- planned vs realized stimulus ledger
- flexible plan sequence / nullable recommended date

Phase D must now replace the neutral weekly-coherence placeholder used during C2–C4.

## Phase E — Automatic UX contracts — FOUNDATION PRESENT

Existing backend contracts describe what completion data should be requested from the user according to the exercise/prescription. Production-facing frontend/service changes will be made when needed.

## Phase F — External session import — FOUNDATION PRESENT

Staging/provenance contracts exist. Parser/import integration remains later in the roadmap.

## Repository / environment state

Branch: `phase-a-f-autonomous-20260811`

DEV only. No merge to `main`, STAGING promotion or PROD deployment.

## Immediate next action

**Phase D — connect weekly planned vs realized stimulus to Session Engine decisions and progression intents.**
