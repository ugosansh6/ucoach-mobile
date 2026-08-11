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

### C3 — Whole-WOD mechanic simulation — ✅

Migrations:
- `20260811121155_phase_c3_whole_wod_simulation`
- `20260811121336_phase_c3_duration_and_muscle_ledger_refinement`

C3 remains read-only/simulation-only and does not route into the production generator yet.

Implemented:
- WOD time budget with optional exact block-duration override
- per-exercise work-time estimate from the C2 prescription
- explicit operational pacing assumptions stored in policy instead of hidden constants
- AMRAP round-time + expected round range + total volume
- EMOM station work + minimum rest-margin feasibility
- FOR_TIME fixed-volume projection + cap feasibility
- CIRCUIT rounds + inter-round recovery estimate
- STRENGTH sets + recovery-time feasibility
- LADDER cumulative-volume/time projection
- PYRAMID cumulative-volume/time projection
- Progressive Interval expected stage + stop rule; progressive rep volume includes stage increments
- whole-WOD predicted reps / distance / hold time / active work
- density measured across the complete WOD
- time-utilization fit against the selected mechanic
- explicit primary-muscle weighted exposure ledger
- local-fatigue concentration across the whole WOD
- whole-WOD fit that combines density, local-fatigue and duration coherence
- underfilled mechanics are exposed to C4 with an adjustment hint instead of silently passing as optimal
- infeasible candidates are removed; if none survive the engine returns a no-feasible-WOD status

Validation examples:
- Conditioning + wrist pain, 60 min: AMRAP remains first, 27 min WOD budget, 100% time utilization, coherent muscle concentration, all tested candidates feasible
- General Fitness, 45 min: CIRCUIT remains first, 20 min WOD budget, ~94% time utilization
- Strength, 75 min: STRENGTH remains first, 30 min WOD budget and coherent set/recovery projection
- Fat Loss + knee pain with no safe Conditioning/Locomotion anchor still returns `NO_SAFE_COHERENT_WOD`
- mechanic stress test covers AMRAP / EMOM / FOR_TIME / CIRCUIT / STRENGTH / LADDER / PYRAMID / PROGRESSIVE_INTERVAL
- LADDER/PYRAMID underfill is detected and handed to C4 for volume adjustment
- an impossible Progressive Interval start is rejected
- 0 real capability rows/events created by C3 simulation

Current C3 candidate simulation version: `c3-whole-wod-v1.1`.

### C4 — NEXT: final Quality Gates + production-grade solver

Next Phase C work:
- convert C3 adjustment hints into actual rep/round/set/distance/time corrections
- final mechanic-specific Quality Gates
- final anti-redundancy calibration using whole-WOD exposure, not only exercise-level diversity
- final session ordering rules
- finalize expected outcome / mechanic / solver decision contracts for persistence
- production-grade winner selection
- progressively route the real `coach-handler` through the new C1→C4 Session Engine while preserving fallback safety
- update frontend/services only if the production output contract changes; backend-only tests remain in Supabase

## Phase D — Weekly feedback loop — FOUNDATION PRESENT, NOT YET ACTIVATED

Existing foundations:
- weekly stimulus targets
- planned vs realized stimulus ledger
- flexible plan sequence / nullable recommended date

C2 deliberately keeps `weekly_coherence = neutral` until Phase D is connected.

## Phase E — Automatic UX contracts — FOUNDATION PRESENT

Existing backend contracts can describe what completion data the UI should request according to exercise/prescription.

UI/service changes are made during C→F whenever a backend contract becomes production-facing; the final full application pass remains scheduled after F.

## Phase F — External session import — FOUNDATION PRESENT

Staging/provenance contracts exist, but parser/import integration is later in the roadmap.

## Repository / environment state

Branch: `phase-a-f-autonomous-20260811`

DEV only. No merge to `main`, STAGING promotion or PROD deployment has been performed.

## Immediate next action

**C4 — production-grade adjustment + Quality Gates + final winner selection.**

Tests remain backend-only unless a step changes the production-facing interface contract.