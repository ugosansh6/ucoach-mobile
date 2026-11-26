# Tabata performance — DEV

Paired benchmark on same populated context, no user writes, transaction rollback. Exact score, all four Tabata outputs, and GYM plan blocks compared. Evidence:

```json
{
  "status": "PASS",
  "plan_after_ms": 5098,
  "plan_before_ms": 8893,
  "score_after_ms": 67,
  "scores_checked": 43,
  "ownership_guard": true,
  "score_before_ms": 2602,
  "builders_after_ms": 390,
  "builders_before_ms": 13898,
  "four_builders_equal": true,
  "gym_plan_blocks_equal": true
}
```

No change to weights, selection conditions, prescriptions, or history. Client/Edge end-to-end timing still requires device recipe. Only DEV migration applied.