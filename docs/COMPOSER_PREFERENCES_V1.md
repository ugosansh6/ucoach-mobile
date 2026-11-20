# Composer preferences and shared Skill adapter contracts

20 November 2026. Initial transport based on `26b9510`; Skill adapter based on
`c47c9e4`. Working branch: `ux-navigation-coach-v1`, following Ugo's explicit
20 November instruction to return the work to the usual branch. New guided
creation remains disabled by `composerReleasePolicy.js` until its missing
execution adapters are ready. The delivery/acceptance state remains in #41 and the
single backlog index #29; this file describes the wire contract, not a new backlog.

## Payload and legacy compatibility

The existing authored draft gains one versioned object:

```json
{
  "preferences": {
    "version": "composer-preferences-v1",
    "preferred_regions": ["Back", "Lower"],
    "skill_target_path_key": "HANDSTAND_HSPU"
  },
  "target_region": null
}
```

The legacy scalar is preserved for one region and is null for automatic or
multiple regions. Multiple regions are never reduced to the first one or to an
invented dominant region. The array is the authoritative preference, separate
from pain zones/exclusions. `Full Body` is the explicit whole-body alternative.
Choosing it clears narrower preferences; choosing a narrower region replaces
that whole-body alternative. No fatigue, weights or dose rules are added here.

An old draft containing only `target_region` reads as one preference in memory.
Reading does not rewrite the draft, insert blocks or upgrade its WOD engine.
An explicit empty `preferred_regions` array means automatic and does not revive
an older scalar. Unknown edit-contract versions are refused, while the Player
keeps the persisted snapshot when resuming an already generated workout.

The target key comes from the existing authenticated `skill_paths` catalogue,
not a second list of invented movements. The selector is immediately visible for
TECHNIQUE/COACH_TECHNIQUE and optional otherwise. A selected optional target does
not change the orientation. Failed catalogue loads retain the saved key and
provide a retry; they do not replace it silently.

## Persistence and current boundary

The existing save/read RPCs retain the entire draft. The deployed Day-J compiler
already copies it to `workout_sessions.planning_context_json.composer_draft`.
The client reloads that snapshot into `meta.composer_preferences`; the check-in
also carries it independently of today's pain/readiness.

No schema change, RPC replacement or new ACL is required for this transport.
Existing catalogue SELECT permissions/RLS were checked for authenticated users.

The candidate adapter queries the existing catalogue/scoring path for every
preferred region, unions the results by exercise identity and keeps the best
existing score. Preference order is immaterial; scores are never summed and no
new sporting weights or exercise quotas are introduced. An explicit automatic
choice does not revive the old scalar. This adapter does not claim to replace
the remaining local ranking/architecture decisions with a shared authority.

## Shared Skill producer

New drafts opt into `skill_engine_version: C4_COMPOSER_SKILL_V1`. An old draft
without this marker remains on its previous prescription path when reopened or
saved. Its blocks, order and realized session are never silently migrated.

`week_composer_skill_authority_v1` is used for the initial Skill proposal, its
preview and Day-J compilation. `week_composer_skill_context_v1` carries the same
preferences and explicit block to preview/compilation; Day J adds actual readiness,
pain and confirmed equipment. An incompatibility fails instead of changing the
authored exercises. Only an explicit refresh action applies a new lesson.

For a technical target, the existing Skill Path selection is narrowed to that
path and retains its trajectory, entry-step and progression logic. The existing
curriculum and duration-fit functions are called. Lessons over three exercises
are refused with an explicit reason and never truncated. A valid first step may
contain only one exercise; no extra movement is manufactured to fill a quota.
This does not claim new prerequisite rules or a new mastery model.

Without a technical target, C2 prescribes the selected exercises with the existing
Skill contract and duration-fit authorities. Ordinary practice carries the explicit
`practice_only` flag: it does not automatically become a recalibration test.
Existing callers without that flag keep their previous contract. The stimulus
uses `c1-default`, as the existing Strength adapter does, not the C4 engine policy.
Séries, reps/time/distance, per-side semantics, rest and load stay engine-owned.

The new Skill contract permits up to three selected exercises in UI and backend.
The initial automatic shortlist of a manually composed Skill keeps at most two
defaults; explicit additions allow three. A curated lesson may choose fewer.
Unchosen preparation exercises are selected again after the actual lesson is
known, using the existing selector with fixed main-block choices. Explicit user
choices are preserved. Preview and compilation retain the exact prescription
JSON, including the progression metadata. Skill state is reset between blocks so
it cannot leak into a following WOD.

**Integration boundary:** the published interface is not activated by these SQL
adapters. The Composer Player still routes Skill to its simplified exercise
validation. Detailed execution of sets/holds/rest, partial results and resume is
not certified by backend READY. The full #42 orchestration, default architecture,
Salle adapter and Player integration/acceptance remain separate work. Keep the
new-creation release switch disabled until the executable journey is verified.

## Verification

- `qa-composer-preferences.cjs`: backward compatibility, multi-zone edits,
  explicit automatic choice, conditional target, preserved blocks/WOD version,
  request freshness and actual service payload round-trip.
- `qa-composer-preferences-ui.cjs`: 12 SSR cases of the actual controls in both
  existing palettes; icons/unchanged silhouette stubbed. This does not verify
  browser geometry, gestures, loading effects or a physical device.
- `composer_preferences_transport_rollback.sql`: four synthetic HOME/BOX cases
  through real save/read/preview/compile/idempotence; exact preferences, blocks
  and orientation preserved, old draft unchanged. Fixtures rolled back and zero
  synthetic users verified afterwards. These fixtures test transport, not sporting
  correctness, target progression or the new default architecture.
- Existing Composer regression suites and Expo web export must remain green.
- `qa-composer-shared-skill.cjs`: actual service multi-zone lookup, unchanged
  scores, order independence, automatic reset and authenticated proposal payload.
- `composer_shared_skill_contract_rollback.sql`: eight synthetic HOME/BOX cases
  with exact proposal/preview/persisted-dose parity, including a Skill followed
  by an AMRAP; three-exercise acceptance, four-exercise refusal, unavailable
  target, foreign-athlete rejection and idempotence. All fixtures roll back.

No physical-device acceptance, complete #42 orchestration, full progression
matrix or Player execution of the new journey is claimed by these checks.
