# Composer WOD — shared prescription delivery

DEV `ugoach` (`fjjhzzwupjhcasoyerym`), 19 November 2026. Scope authorized by Ugo: finish the current mechanics work. Reference branch `ux-navigation-coach-v1`, baseline `248ea49`. Issues #33–#38 remain open; code, deployment and device acceptance are distinct.

## Delivered behavior

New compositions use `week_composer_wod_authority_v2` for both preview and Day-J compilation. The adapter builds the stimulus with the existing `c1-default` policy, C2 prescriptions and athlete volume context, then calls C4 preparation/finalization and its quality/workload gates. No substitute movements, new dose formula, new thresholds or sporting weights.

`week_composer_mechanic_recommendations_v2` evaluates real candidates, reuses C2 mechanic fit and C4 quality-band/anti-redundancy/freshness policies, and returns one primary proposal plus available/unavailable alternatives. The former fixed Composer ranking and +44 Circuit bonus do not apply to V2. The existing catalogue controls Free/Premium rights; variants are distinct from parent mechanics. The UI shows reasons for count, entitlement, workload and duration failures. No compatible candidate means an explanation and return to movements/structure, not a fabricated selection.

The reserved block budget stays unchanged. `c4_finalize_candidate_pre_m72` skips its preferred-duration truncation only for authenticated `W11_COMPOSER_V2` candidates carrying the matching user ID. Final workload/readiness guards still run. Standard Today and historical draft behavior are preserved. Existing C4 ceilings can still shorten a workload: for example, the 78-minute fixture compiles 20 Circuit rounds (about 45 minutes), while For Time is capped at 78 minutes and estimated to finish earlier. These differences are now explicit; the adapter does not raise existing volume ceilings to fill the slot. HIIT can likewise execute fewer complete cycles than the reserved budget.

The exact C4 prescription and parameters reach generated JSON and exercise instances. Variant metadata survives hydration. Deck additionally uses the existing `c4_build_deck_plan_v2` and athlete suit caps; its safe draw is persisted once and reused on retry. No standalone Penalty or Buy-in/Cash-out activation. Outdoor running contracts are unchanged.

Historical drafts without `wod_engine_version=C4_COMPOSER_V2` retain legacy compilation. A deliberate WOD edit requests V2 options; other blocks/identities/order stay user-owned. New proposal Warm-up and protected 4-minute Tabata rules remain unchanged. Restoring a saved draft loads the equipment reference for its saved environment.

## Applied migrations

These are incremental migrations, not a replay of the historical migration folder. The first guards the observed definitions against concurrent overwrite. Subsequent migrations correct integration details discovered during DEV verification; none rewrites an applied migration.

| File suffix | Applied DEV version | Effect |
| --- | --- | --- |
| `20261119152103_composer_shared_wod_authority_v2.sql` | `20261119152659` | Shared authority, catalogue, real recommendations, conditional preview/Day J, explicit Composer budget |
| `20261119152735_composer_wod_stimulus_policy_v2.sql` | `20261119152751` | Use the existing stimulus policy `c1-default` |
| `20261119153057_composer_wod_runtime_contract_v2.sql` | `20261119153101` | Safe Deck draw, exact duration field, freshness metadata |
| `20261119153420_composer_wod_technical_gate_v2.sql` | `20261119153427` | Reuse the existing format-recompile complexity gate: low 3 / otherwise 5 |
| `20261119154645_composer_wod_athlete_context_v2.sql` | `20261119154653` | Pass actual athlete-relative volume context to finite-workload compilers |

The connector assigned the DEV versions shown above; local CLI filenames are retained. This records the mapping without repairing or replaying the historical registry (#27).

Three new RPCs deny anon/PUBLIC and allow authenticated/service_role, with an exact authenticated user check. A recommendation was executed successfully under SQL role `authenticated`; other-user calls were refused. No Edge deployment, STAGING or production change.

## Executed verification

| Check | Result and scope |
| --- | --- |
| `composer_shared_wod_v2_rollback.sql` | 140 scenarios: 15 core families + 5 variants × 8/12/17/22/40/60/78 minutes. 114 PREVIEW→READY with equal parameters, prescriptions, IDs/order, budget and variant; 26 rejected consistently by preview and Day J. Same inputs/readiness 6. Idempotent recompilation checked; safe Deck order materialized. Advanced synthetic profile, not proof that every athlete can execute every format. |
| `composer_wod_context_v2_rollback.sql` | 960 contexts: 4 environments × 3 readiness × 4 durations × 4 counts × 5 original formats. 572 READY, 388 explicit incompatibilities. Budgets preserved; equipment, pain, other-user and Premium gates PASS. Free has 6 entitled families. No new doctrine inferred from the acceptance rate. |
| `composer_v2_protected_blocks_rollback.sql` | Real draft save + preview + Day J at 20/30 min. V2 marker, warm-up, Tabata 240 s, Skill/WOD order and instances preserved. |
| `qa-composer-wod-runtime.cjs` with compiler outputs | 34 full/partial replays from 17 compiled protocol identities: existing Player duration helpers, actual builders and status derivation; then real start/reveal/start-WOD/`complete_workout_session_v2`, history protocol/ratios, exercise reps/status, log counts and idempotent completion. All PASS with transaction rollback. Software replay, not gestures or physical training. |
| Legacy SQL regressions | HOME classic Skill+WOD, custom architecture, mandatory Tabata baseline, cross-block instance identity, shared Strength, block preservation, legacy five-format selection: all PASS. |
| Existing JS suite | 72 intent contexts + 336 targets; 13 selection cases; editor/wiring/presentation/shared-engine/hydration/visibility/Tabata; 15-family partial/full helper audit: PASS. New variant/dose/duration and catalogue entitlement checks: PASS. |
| UI/build | Expo web export PASS; actual-component SSR fixtures render in both themes. Chromium could not launch in this execution environment (`socket() Operation not permitted`); no overflow, visual browser, interactive or iPhone success claimed. |

All SQL data is synthetic and rolled back. Completion/history tests replay actual compiler outputs through the existing JS builders, then the actual backend completion RPC; they do not bypass the lifecycle. They do not validate sounds, reload behavior on a physical device, or a connected browser session.

Reproduce the runtime replay: execute `composer_shared_wod_v2_rollback.sql`, save its **audit object** as JSON, then run:

```
node scripts/qa-composer-wod-runtime.cjs /path/to/audit.json /tmp/runtime-history.sql
```

Execute the generated SQL on DEV; it opens a transaction, uses only its dedicated synthetic identity and ends with ROLLBACK. Do not run on another environment without authorization. The optional audit JSON is not a production user export.

## Diversity audit (#36)

The active full solver and exact-cache wrapper both call `c4_apply_mechanic_freshness_tiebreak_v1`. `mechanic_variety_history_rollback.sql` tests 1/3/5/10/20 qualifying completed sessions across 20 days. In controlled comparable candidates, no switch at 1, switch from 3, window remains 5; a materially inferior alternative never wins for variety. Real full and cache generations are READY at all five histories and return the freshness policy. The real fixture keeps EMOM because its history consists of Circuit, not because rotation is missing. Accepted pools are 6/8/8/8/4 after processing; the first case rejects 2 Circuit candidates for workload. No change to the existing history window, trigger or weights.

## Performance observations

Seven Free recommendation probes with 8–78 minute WODs: approximately 0.079–0.094 seconds SQL runtime in the final run. The advanced Premium 20-option probe: approximately 0.22 seconds. These are small synthetic DEV observations, excluding network/UI; not production percentiles. Five full Today solver probes with 8 initial candidates and 1–20 historical sessions: 2.72–2.90 seconds; cache replays READY. No policy changes to Today or loss of its cache path. The earlier legacy-only recommendation was not a comparable full prescription workload, so no claimed percentage speedup.

## Acceptance still open

DEV integration is delivered; final iPhone/Safari acceptance in both themes, actual gesture flow, sound, pause/reload/resume and history screens remain unverified. Three progressive catalogue identities (`PROGRESSIVE_INTERVAL` base, `PROGRESSIVE_GENERIC`, `DEATH_BY_COUPLET`) were rejected throughout this particular matrix by existing frontier guards; their mere catalogue presence is not a promise of eligibility. No guard was weakened to make their fixtures green. The two overlays are still excluded. Broader Today duration-policy changes and actual production promotion are outside this Composer delivery. Tickets remain open pending the corresponding acceptance criteria and Ugo's explicit closure agreement.
