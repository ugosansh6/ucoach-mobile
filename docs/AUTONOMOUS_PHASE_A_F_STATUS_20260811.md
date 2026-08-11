# UGEROD — Autonomous Phase A→F status — 2026-08-11

## Guardrails used

- DEV Supabase only: `fjjhzzwupjhcasoyerym`
- No STAGING or PROD promotion
- No merge to `main`
- User-declared pain/discomfort stays an absolute hard gate
- No numeric load is invented without confirmed capability + inventory information
- Backend tests are executed in Supabase; app tests are reserved for interface-facing behavior and the final A→F pass

## Phase A — DATA foundations — CLOSED / PASS WITH TWO FOLLOW-UP GAPS

Current catalog state:
- 157 exercises total
- 24 dedicated warm-up-only exercises (`EX421`→`EX444`)
- 43 warm-up-eligible exercises
- explicit warm-up roles: mobility / activation / movement prep / pulse raiser
- pain hard-gate coverage for all current preparation UI zones
- equipment quantity semantics, load semantics, body-zone safety, muscles and local-fatigue metadata
- 109 WOD exercises with no missing critical catalogue metadata

Important invariants:
- pain executes before scoring/solver
- equipment supports ALL_OF / ANY_OF / OPTIONAL + quantity
- warm-up rejects high-fatigue/high-impact/strength-like entries
- legacy `selection_weight` is not the final Session Engine decision

Known follow-up gaps found during the A→F audit:
- the application still sends mostly equipment names instead of the full `user_equipment_inventory` quantity/load model
- the C4 `joint_impact >= 5` safeguard is currently dead because the WOD catalogue maximum is 4; it must be recalibrated rather than kept as a false safeguard

## Phase B — Performance Engine — LIVE ACTIVATION IN DEV / CONTROLLED DUAL RUN

### B2.1→B2.6 — observation + capability architecture — ✅

Implemented:
- exact observation identity via `session_exercise_id`
- observation contract + quality roles
- per-exercise capability families: reps / load+reps / time / pace / loaded distance
- confidence and freshness separated
- capability envelopes + Pareto/frontier logic
- CONFIRM / EXPAND / HOLD / RECALIBRATE proposal decisions
- idempotent shadow runtime
- exact repeated-exercise-instance bridge
- warm-up / skill / WOD / tabata quality differences
- pain and contextual skips excluded from capability regression

### B2.7 — real capability loop + protocol capability split — ✅ backend activation

DEV migrations:
- `20260811132942_phase_b27_live_exercise_capability_loop`
- `20260811133129_phase_b27_protocol_capability_foundation`
- `20260811133840_phase_b27_restrict_live_rpc_execution`
- `20260811134027_phase_b27_progressive_protocol_boundary`

Implemented:
- active policy `b2.7-live-default` / engine `b2.7-live-1`
- `run_capability_live_session(...)` applies exact observations to real `user_exercise_capabilities`
- live application is idempotent by `exercise_log_id + capability_family + capability_mode`
- legacy `user_exercise_progress` remains in parallel during transition
- B2.6 shadow remains in parallel for comparison/debugging
- failures in the new live engine are non-blocking for session completion and logged separately
- `hyper-api-instance` DEV upgraded to `hyper-api-instance-v2-b27` and routes completion through legacy + live + shadow

Protocol capability is now explicitly separated from one-exercise capability:
- `user_protocol_capabilities`
- `protocol_capability_events`
- deterministic protocol signature built from mechanic + variant + parameters + ordered exercise prescriptions
- `actual_protocol_outcome_json` on the session

Death By / Death By Couplet are modeled as a **progressive protocol boundary**, not as two unrelated exercise scores:
- independent `start_reps` / `increment_reps` per exercise are part of the protocol signature
- `last_completed_stage` is the main capability boundary
- partial work on the failed next interval can be supplied per exercise and normalized within the exact protocol
- one lower attempt does not immediately regress the stored best
- if the athlete reaches the programmed time cap without failing, the result is stored as a **right-censored lower bound** (`capability >= reached stage`) rather than pretending the true failure point was observed

Supabase-only validation:
- existing completed session: first live pass → 18 proposals; second pass → 0 new proposals / 18 idempotent skips
- test was wrapped in a transaction and rolled back; no historical capability rows were polluted
- synthetic Death By Couplet: observed failure boundary initialized correctly
- lower subsequent result → `HOLD_BEST_RECALIBRATION_PENDING`
- later successful time-cap completion → `EXPAND_PROTOCOL_LOWER_BOUND`
- partial next-stage ratio is computed from both exercises when `partial_reps_by_exercise` is present
- all synthetic protocol tests rolled back

Current production-data state intentionally remains clean until the next real completed session:
- no historical backfill has been forced
- real capability/protocol rows will start accumulating prospectively through the normal completion path

Security hardening:
- new SECURITY DEFINER RPCs are not executable by `anon`
- only authenticated completion flow may invoke live/protocol update RPCs

### Remaining B/C bridge to preserve

The Session Engine already reads capability state in candidate/prescription logic, but the full envelope-driven prescription calibration (reps/time/load chosen directly from mature capability envelopes) will be tightened during the C4.2 composition/prescription solver pass rather than duplicating logic inside B.

## Phase C — Session Engine — CORE C1→C4 DONE, AUDIT GAPS MUST CLOSE BEFORE D

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

### C2 — Candidates + Coach Score — ✅ core

Implemented:
- hard-gated candidate pool
- exercise stimulus fit
- progression / prescription / complexity / fatigue / similarity scores
- mechanic fit
- multiple candidate WODs
- pattern and primary-muscle diversity
- recent-session anti-repetition
- one-axis progression rule
- Conditioning/Fat Loss anchor requirement
- `NO_SAFE_COHERENT_WOD` rather than forcing an incoherent workout

### C3 — Whole-WOD simulation — ✅ core

Implemented for the currently compiled automatic mechanics:
- AMRAP
- EMOM
- FOR_TIME
- CIRCUIT
- STRENGTH
- LADDER
- PYRAMID
- PROGRESSIVE_INTERVAL

Simulation includes time, rounds/sets, EMOM rest margin, For Time cap, cumulative progressive volume, density, time utilization, muscle exposure and local-fatigue concentration.

### C4 — Final solver + DEV routing — ✅ core / not full catalogue

Canonical solver: `solve_session_engine_c4(...)` → `c4-final-v1.5`.

`coach-handler` DEV routes the WOD through C1→C4 while the legacy generator still supplies the non-WOD scaffold.

Audit gaps that must be closed before Phase D:

#### C4.1 — complete mechanic compiler

Catalogue mechanics exist but are not all compiled by C4 yet. Add full solver/simulation support for:
- Chipper
- Every X Minutes
- Rep Target
- Odd / Even
- Ascending / Descending Couplet
- Death By
- Death By Couplet
- Deck-style strict
- compatible overlays such as Buy-in / Cash-out and Penalty

Ladder/Pyramid/Progressive must support **per-exercise** starts/increments rather than one global increment.

#### C4.2 — dynamic composition + capability-aware prescription

- exercise count becomes a solver variable driven by duration/mechanic/stimulus/available patterns, not an initial fixed 3-exercise combination repaired afterward
- use mature capability envelopes + freshness/confidence to calibrate reps/time/load conservatively
- keep one-axis-at-a-time progression
- improve exercise-specific work-time estimates beyond only global prescription-type constants

#### C4.3 — one Session Engine for the entire session

- C becomes the orchestrator for Warm-up / optional Tabata / optional Skill / WOD
- preserve the proven warm-up/tabata/skill builders but remove the old generator as the authority
- persist expected outcome contracts consistently across all blocks

#### C4.4 — Swap + format change must re-enter the solver

- use exact `session_exercise_id`
- after a swap, re-simulate the complete WOD so EMOM margins, fatigue and timing remain valid
- compatible/adaptable/not-recommended format conversion must use the same mechanic compiler, not a second conversion engine
- add mechanic/structure diversity to anti-redundancy without allowing a weaker mechanic merely for variety

## Phase D — Weekly feedback loop — WAITING FOR C4.1→C4.4

Existing foundations:
- `weekly_stimulus_targets`
- planned vs realized stimulus ledger
- flexible plan sequence / nullable recommended date

D will replace the neutral weekly-coherence placeholder only after the audited Session Engine gaps above are closed.

## Phase E — Automatic UX contracts — FOUNDATION PRESENT

Existing backend contracts describe what completion data should be requested from the user according to the exercise/prescription.

Death By / Death By Couplet will eventually need minimal protocol completion capture such as:
- last completed interval/stage
- whether the user failed or reached the programmed time cap
- partial work in the next failed interval when useful

The backend B2.7 storage/learning model is already ready for this; the interface will be updated when these mechanics become production-facing.

## Phase F — External session import — FOUNDATION PRESENT

Staging/provenance contracts exist. Parser/import integration remains later in the roadmap.

## Repository / environment state

Branch: `phase-a-f-autonomous-20260811`

DEV only. No merge to `main`, STAGING promotion or PROD deployment.

## Immediate next action

**C4.1 — finish the full mechanic compiler, starting with Chipper / Every X Minutes / Rep Target / Odd-Even / Couplet variants / Death By + Death By Couplet / Deck-style.**
