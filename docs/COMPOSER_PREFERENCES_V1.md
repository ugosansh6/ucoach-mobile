# Composer preference contract — first #41 development increment

20 November 2026, based on `26b9510`. Working branch: `feat/composer-preferences-v1`.
This increment is isolated from the published reference branch until the missing
engine adapters are ready. The delivery/acceptance state remains in #41 and the
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

**Transport is not engine consumption.** The old scalar producers do not yet
interpret the whole multi-region preference or compose the requested Skill path.
Those adapters belong to #42 and #43 respectively. This increment must not be
activated on the published branch as though the complete new journey were ready.
The current default structures, Skill limit/dose and Player behavior are unchanged.

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

No device acceptance, complete #42 orchestration, #43 Skill progression or
end-to-end new journey is claimed by these checks.
