# Full Body — Skill + WOD policy

This document describes the current rule, superseding the broader exposure and
warm-up region-quota interpretation in the earlier migrations.

## Product rule

- The signature Tabata remains abs/core/gainage focused and independent.
- Full Body balance concerns Skill + WOD, or the equivalent native training
  blocks. Warm-up, Unlock, signature Tabata and separate cardio are excluded.
- Cover upper and lower body and avoid concentrating the selectable training
  work on one region. Core Skill work counts when present, but there is no
  additional core quota in Skill/WOD: signature Tabata already has that role.
- Preserve the selected learning target. Complement it through the WOD while
  respecting pain, equipment, readiness, level, mechanics, workload and duration.
- Derive specific preparation from the final Skill anchor and WOD exercises.
  There is no independent Full Body region quota for the warm-up.

The distribution value divides block time across exercises. It is a selection
proxy, not measured active work, muscle load or a physiological score. It ranks
safe alternatives; it does not override the existing C4 quality-delta floor.
Unknown/mixed catalog movements are not credited with invented regional coverage.

## Shared consumers

| Environment | Selection blocks | Active consumer |
|---|---|---|
| Home / Box | Skill + WOD | Final C4 V2 planner and recalculation continuity |
| Gym | Strength, the native equivalent of the WOD | Gym candidate ranking, repair and style recompilation |
| Outdoor Functional Fitness | Gym/street Skill when present + final WOD | Final Outdoor V4 assembly under Outdoor equipment/surface gates |

The signature Tabata is excluded in every case. Dedicated running-only formats
keep their running protocol; when the selected format contains no functional
WOD, the diagnostic explicitly reports that the Skill/WOD balance is not
applicable. Running is not silently converted into a different workout format.

Gym repair is recompiled through the Gym style compiler and checked again
before adoption. Outdoor balancing uses the actual assembled street Skill and
WOD, rather than a reference Skill that is absent from the delivered session.
Separate running/cardio and signature blocks remain unchanged.

## Preparation and continuity

The final C4 consumer rebuilds preparation after the final exercise choices.
For Full Body, the actual Skill anchor is prepared first, followed by distinct
final WOD patterns before secondary Skill drills. Explicit regional sessions
retain their prior ordering. Regression, equipment, environment and pain
selection remain delegated to the existing preparation engine.

Recalculation continuity may retain old exercises only while preserving the
current Skill/WOD coverage and distribution. The final persisted diagnostic is
recomputed from the delivered exercises.

## Validation

Targeted DEV checks passed in rolled-back transactions:

- Tabata duration/content, Warm-up and Unlock cannot alter Skill/WOD exposure.
- No extra core exercise is required in an otherwise balanced upper/lower WOD.
- Gym Strength and Outdoor Skill aliases use the common policy.
- Preparation references final Skill/WOD targets, with no regional quota or
  regional quota; signature families are excluded to avoid repeating the Tabata.
- Full generation in Home, Box, Gym and Outdoor Functional Fitness preserves
  core Tabata, regional coverage, declared equipment and final diagnostics.
- Gym and Outdoor generation/persistence retain the policy in session payloads
  and canonical exercise rows.
- Authenticated public Gym/Supersets and Outdoor gateways were exercised, using
  an allowed Outdoor surface; private internal functions remain non-public.
- The reported core-stacking fixture, explicit regional no-ops, exact retests,
  user ownership checks and recalculation continuity passed.

Run with an existing DEV QA profile, in the same connection:

```sql
select set_config('ugerod.qa_user_id','<QA profile uuid>',false);
-- supabase/tests/full_body_skill_wod_policy.sql
-- supabase/tests/full_body_environments_policy.sql
-- supabase/tests/full_body_environment_persistence.sql
-- supabase/tests/full_body_session_balance.sql
-- supabase/tests/full_body_recalculation_continuity.sql
```

The global backend regression suite remains blocked by pre-existing SAFE-001
metadata gaps on EX578–EX581; the full backend suite is not claimed green.

The migration targets DEV and checks the inspected function hashes before
replacing consumers. It preserves existing function security settings and
permissions and does not expose a new client RPC. Other environments require
their own inspected migration baseline. Started and completed sessions are not
rewritten.
