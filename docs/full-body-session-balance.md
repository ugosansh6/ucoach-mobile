# Full Body session balance — 28 October 2026

Full Body previously meant that no single regional restriction was applied.
A session could combine a core Tabata, an eight-minute core curriculum and
additional core WOD stations, or omit upper-body work entirely, while passing
the existing WOD quality gate.

The final active C4 V2 consumer now complements the protected Skill and Tabata
inside the WOD. It includes both blocks when measuring regional exposure and
groups all core patterns together. Movement pattern and family take precedence
over the generic `Full Body` catalog label, so a jump does not manufacture
upper-body coverage. Generic conditioning/mixed exercises are not credited
with unproven coverage of every region.

The exposure value divides block time across exercises. It is a programming
proxy, not measured active work, muscle load or a physiological score. Regional
coverage takes priority over distribution; distribution is a soft comparison,
not a forced equal split. If no safe, coherent improvement meets the existing
quality-delta floor, the original plan remains available with a diagnostic.

The search loads the candidate pool once and compiles at most twelve diverse
changes per pass, with at most three passes. Every accepted WOD is recompiled
and rechecked against the existing equipment, pain, readiness, technical level,
mechanic, workload and functional-group gates. Preparation and its final target
metadata are then rebuilt from the final exercises. Unchanged multi-drill Skill
curricula remain intact, including target + optional exploration in one family.

Upper, Lower, Core, failed plans and exact retests retain their contracts.
The new helpers are invoker functions with fixed search paths and no client RPC
permissions. The existing authenticated C4 wrapper remains the entry point.

## Validation

All draft changes were tested in transactions that were rolled back:

- Reported 60-minute bodyweight/core stacking case: Crunch replaced with a
  complementary upper-body exercise; Skill and Tabata preserved byte for byte.
- Fresh 60-minute low-readiness Strength generation: upper/lower/core coverage,
  WOD hard gates and unchanged-session safeguards passed.
- HOME, 30 minutes, normal readiness, bodyweight: passed full plan contract.
- HOME, 45 minutes, normal readiness, resistance band: passed full plan contract.
- BOX, 45 minutes, high readiness, resistance band: passed full plan contract.
- Regional session no-ops, exact retest protection, cross-user denial and
  internal helper permissions passed.
- The real adaptive generation/persistence route passed in a rolled-back
  transaction, including persisted exercise rows and an exact match between
  the final regional diagnostic and the final exercises.
- Recalculation continuity cannot restore an old core-heavy WOD at the expense
  of the new balance. A parent fixture containing Crunch was tested against a
  freshly generated child; all inserted fixture rows were rolled back.

Recalculation previously ran after planning and could restore old exercises.
It now compares each proposed restoration against current whole-session
coverage and distribution. Equally balanced continuity is retained; a
restoration that loses a region or increases concentration is rejected. The
diagnostic is refreshed from the final persisted exercises afterwards.

The existing `backend_core_regression.sql` also ran against the unchanged DEV
baseline. It stops at a pre-existing SAFE-001 catalog failure: EX578, EX579,
EX580 and EX581 lack required hard-gate metadata. That independent catalog debt
is not modified by this fix; the entire backend suite is not claimed green.

Run the targeted suites with an existing QA profile:

```sql
select set_config('ugerod.qa_user_id','<QA profile uuid>',false);
-- Then run supabase/tests/full_body_session_balance.sql and
-- supabase/tests/full_body_balance_matrix.sql, followed by
-- supabase/tests/full_body_recalculation_continuity.sql in the same connection.
```

The migration checks the inspected C4 wrapper hash before replacing it. A
different environment or intervening backend change requires a rebase rather
than silently overwriting its wrapper. Existing generated or started sessions
are not rewritten by the migration; a new generation consumes the fix.

## Full Body warm-up coverage

The 45-minute follow-up exposed another gap: the three-slot warm-up prepared
two core Skill patterns before the WOD's upper-body movement, leaving its
lunge without preparation. Whole-session WOD balance alone did not fix that.

The preparation consumer now prioritizes final WOD targets for Full Body and
covers distinct regions before spending a second slot on the same region.
Core and anti-extension are grouped together. Explicit Upper/Lower/Core
sessions retain their Skill-first target ordering. Candidate safety,
regression and equipment selection still use the existing preparation engine.

The reported warm-up changes from Flutter Kicks / knee plank / Pike Hold to
Pike Hold / reverse lunge reach / Flutter Kicks. The Skill, Tabata, WOD,
prescriptions outside the warm-up and block durations remain unchanged.
A targeted suite verifies regional coverage, existing safety caps, explicit
regional ordering and parity between persisted rows and the session payload.
The earlier Full Body generation suite also passed with this consumer.

The additional migration is active on DEV. The reported, still unstarted
session's warm-up was refreshed after its status was locked and checked; all
other blocks were verified unchanged. Future generations and recalculation
warm-up refreshes share the corrected consumer. A targeted Skill remains a
learning block; Full Body describes the distribution of the complete session.
