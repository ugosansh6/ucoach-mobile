# UGEROD — Autonomous Phase A→F status — 2026-08-11

## Guardrails used

- DEV Supabase only: `fjjhzzwupjhcasoyerym`
- No STAGING or PROD promotion
- No merge to `main`
- User-declared pain/discomfort stays an absolute hard gate
- Existing V1 generator kept operational during the transition
- New Performance/Session engines are introduced in shadow/simulation before production routing
- No numeric load is invented without confirmed capability + inventory information

## Phase A — DATA foundations — CLOSED / PASS

Current catalog state after warm-up enrichment:
- 157 exercises total
- 24 dedicated warm-up-only exercises (`EX421`→`EX444`)
- 43 warm-up-eligible exercises
- explicit warm-up roles: mobility / activation / movement prep / pulse raiser
- hard-gate pain coverage generated from authoritative body-zone mappings for all current preparation UI zones
- equipment quantity semantics, load semantics, body-zone safety, muscles and local-fatigue metadata available to the future Session Engine

Important invariants:
- pain hard gate executes before scoring/solver
- equipment requirements support ALL_OF / ANY_OF / OPTIONAL and quantity
- warm-up contract rejects high-fatigue/high-impact/strength-like entries
- `selection_weight` remains legacy preference data, not the future final decision engine

## Phase B — Performance Engine — CLOSED FOR ROADMAP / SHADOW-VALIDATED

Implemented:
- exact observation identity via `session_exercise_id`
- `performance_observation_contract`
- observation roles: STATE_ONLY_PAIN / CONTEXT_ONLY / NON_PERFORMANCE_OBSERVATION / CAPABILITY_EXCLUDED / CAPABILITY_CANDIDATE
- multidimensional observation quality
- fresh vs repeatable evidence
- capability families: reps / load+reps / time / pace / loaded distance / density / progressive
- confidence and freshness kept separate
- capability envelopes and Pareto/frontier logic
- proposal decisions: EXCLUDE / CONFIRM / EXPAND / ADD_FRONTIER_POINT / HOLD / RECALIBRATE
- shadow runtime with idempotent event/state storage
- exact repeated-exercise-instance bridge

Validation:
- historical logs are linked to exact session exercise instances
- duplicate same-exercise instances require explicit `session_exercise_id`
- shadow engine is idempotent
- 0 shadow errors in validation runs
- 0 real capability mutations during shadow tests
- real `user_exercise_capabilities` and capability update events remain untouched by Phase C simulations

The roadmap can therefore move to C while capability activation remains intentionally controlled.

## Phase C — Session Engine — IN PROGRESS

### C0 — Contracts + hard gates — ✅

Implemented before the intelligence layer:
- `progression_intent`: MAINTAIN / PROGRESS / CONSOLIDATE / DELOAD / RECALIBRATE / EXPLORE
- planning context JSON
- expected stimulus JSON
- mechanic JSON
- quality gate JSON
- per-exercise expected outcome / expected RPE / capacity snapshot / solver decision
- 16 active mechanics: 14 core + 2 overlays
- deterministic pain and equipment hard gates
- body-zone alias normalization

### C1 — Target stimulus contract — ✅

Migration: `20260811114803_phase_c1_session_stimulus_contract`

The engine now builds a structured target stimulus before selecting exercises:
- strength
- conditioning
- muscular endurance
- power
- stability
- mobility
- density
- local fatigue
- complexity
- RPE target

Inputs include:
- V1 goal
- duration
- readiness
- optional target region
- optional progression intent

Readiness modifies the requested session without silently changing the user goal.

### C2 — Coach Score + Solver simulation — ✅

Migrations:
- `20260811115832_phase_c2_coach_score_solver_simulation`
- `20260811115938_phase_c2_conditioning_anchor_guard`

C2 is explicitly simulation-only and does not replace the production generator.

Implemented:
- exercise stimulus proxy used only for simulation/calibration
- multiple hard-gated exercise candidates
- mechanic-fit scoring across automatic Free mechanics
- draft per-exercise prescription solver
- candidate-session generation from multiple exercise combinations and mechanics
- Coach Score components:
  - stimulus fit
  - progression fit
  - prescription fit
  - complexity fit
  - weekly coherence placeholder (neutral until Phase D)
  - fatigue fit
  - session similarity
- session-level pattern diversity
- primary-muscle redundancy penalty
- transition-cost visibility
- anti-repetition from recent completed sessions
- one-axis-at-a-time progression rule in solver output
- numeric load left unresolved unless capability/inventory evidence is confirmed

Safety/coherence tests:
- Conditioning + wrist pain + DB/KB/rope inventory: 0 pain-gate violations and 0 equipment-gate violations
- Conditioning scenario correctly ranks AMRAP / FOR_TIME / PROGRESSIVE_INTERVAL highly
- Strength scenario ranks STRENGTH first
- General Fitness scenario ranks CIRCUIT first
- no real capability state/event mutation from C2 simulation
- for Fat Loss + knee pain where no real Conditioning/Locomotion anchor survives hard gates, the engine returns `NO_SAFE_COHERENT_WOD` instead of forcing a poor session

Current C2 version: `c2-sim-v1.1`.

### C3 — NEXT: mechanic-specific whole-session simulation

Remaining Phase C intelligence to build next:
- AMRAP round-time estimation
- EMOM work/rest margin
- FOR_TIME fixed-volume + cap prediction
- Ladder/Pyramid cumulative-volume math
- Progressive Interval stop rule / expected stage
- whole-WOD expected rounds/time/volume/density
- local-fatigue accumulation over the entire candidate
- prescription/order adjustment after simulation
- candidate rejection when the whole session is incoherent even if each exercise is individually valid

This is the next roadmap step before production routing.

### C4 — later in Phase C

After C3 calibration:
- final Quality Gates
- final anti-redundancy calibration
- production-grade candidate selection
- progressive replacement of `bright-handler` by the new Session Engine

## Phase D — Weekly feedback loop — FOUNDATION PRESENT, NOT YET ACTIVATED

Existing foundations:
- weekly stimulus targets
- planned vs realized stimulus ledger
- flexible plan sequence / nullable recommended date

C2 deliberately keeps `weekly_coherence = neutral` until Phase D is connected.

## Phase E — Automatic UX contracts — FOUNDATION PRESENT

Existing backend contracts can describe what completion data the UI should request according to exercise/prescription.

No UI work is required during C2/C3 backend simulation tests.

## Phase F — External session import — FOUNDATION PRESENT

Staging/provenance contracts exist, but parser/import integration is later in the roadmap.

## Repository / environment state

Branch: `phase-a-f-autonomous-20260811`

DEV only. No merge to `main`, STAGING promotion or PROD deployment has been performed.

## Immediate next action

**C3 — build and stress-test mechanic-specific whole-session simulation in Supabase.**

Tests remain backend-only unless a future step actually touches the interface.
