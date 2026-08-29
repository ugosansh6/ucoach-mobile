# BASE-005 — DEV ↔ Git migration history audit — 2026-08-29

## Scope

DEV Supabase project migration ledger compared with branch `ux-navigation-coach-v1`, directory `supabase/migrations`.

## DEV ledger

At audit time, `supabase_migrations.schema_migrations` contains **563 applied migrations**, from `20260808231549` through `20260829195316`.

Daily DEV counts:

- 2026-08-08: 1
- 2026-08-11: 79
- 2026-08-12: 48
- 2026-08-13: 7
- 2026-08-14: 54
- 2026-08-15: 33
- 2026-08-16: 36
- 2026-08-17: 17
- 2026-08-18: 21
- 2026-08-19: 37
- 2026-08-20: 26
- 2026-08-21: 28
- 2026-08-22: 22
- 2026-08-24: 15
- 2026-08-25: 2
- 2026-08-26: 32
- 2026-08-27: 45
- 2026-08-28: 34
- 2026-08-29: 26

## Confirmed migration-history drift

The Git migration tree is **not a 1:1 replay of the current DEV migration ledger**.

Confirmed examples:

- No Git migration path with prefix `20260814`, while DEV has 54 migrations that day.
- No Git migration path with prefix `20260815`, while DEV has 33 migrations that day.
- No Git migration path with prefix `20260816`, while DEV has 36 migrations that day.
- No Git migration path with prefix `20260824`, while DEV has 15 migrations that day.
- No Git migration path with prefix `20260825`, while DEV has 2 migrations that day.
- No Git migration path with prefix `20260826`, while DEV has 32 migrations that day.
- No Git migration path with prefix `20260827`, while DEV has 45 migrations that day.
- Partial-day drift also exists: for example DEV starts 2026-08-17 at `20260817051157`, while that version is absent from the Git migration tree.

Therefore the problem is historical migration packaging/replay drift, not merely one missing recent migration.

## Current backend status

This audit does **not** indicate that DEV runtime is inconsistent. The current DEV schema/functions were tested directly through the backend E2E suite, including HOME/BOX/GYM/OUTDOOR, actual completion, stimulus ledger, external-session N→N+1, provenance, safety metadata, and program replanning.

Recent backend closure migrations created during the 2026-08-28 / 2026-08-29 closure work are synchronized individually in Git, including SEC-001, ENV-007, exact GYM set factors, PRG-007..014, performance/security hardening, PREF-001 Swap/Undo provenance, and EXT-004 external execution-factor normalization.

## Decision / release gate

- **DEV frontend work may continue against the current DEV backend.**
- Do **not** claim the repository migration directory alone can rebuild the current DEV database from scratch.
- **Before any STAGING or PROD migration/merge, migration history must be reconciled or a validated fresh schema baseline/replay package must be produced and tested on a clean database.**
- Do not fabricate historical migration files from assumptions. Any reconciliation must use the exact SQL recorded/applied in DEV or a verified schema dump/baseline.

Status: `AUDITED_WITH_HISTORICAL_REPLAY_DEBT`.
