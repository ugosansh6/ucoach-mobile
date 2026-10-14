from pathlib import Path

p = Path('app/(tabs)/planning.js')
s = p.read_text()

old_visible = "  const visibleItems = contract?.visibleItems ?? [];\n"
new_visible = """  const visibleItems = useMemo(
    () => (contract?.visibleItems ?? []).filter((item) =>
      item?.surfaceVisibility !== 'CONTEXT_ONLY' &&
      item?.displayState !== 'CLOSED_SILENT'
    ),
    [contract?.visibleItems]
  );
"""
if old_visible not in s:
    raise SystemExit('visibleItems declaration not found')
s = s.replace(old_visible, new_visible, 1)

old_loop = """    for (const day of weekDays) {
      const rect = dayRects.current[day.key];
      if (!rect) continue;
"""
new_loop = """    for (const day of weekDays) {
      if (day.key < todayKey) continue;
      const rect = dayRects.current[day.key];
      if (!rect) continue;
"""
if old_loop not in s:
    raise SystemExit('resolveDropTarget loop not found')
s = s.replace(old_loop, new_loop, 1)

old_dep = "  }, [weekDays]);\n\n  const clearDrag"
new_dep = "  }, [todayKey, weekDays]);\n\n  const clearDrag"
if old_dep not in s:
    raise SystemExit('resolveDropTarget dependency not found')
s = s.replace(old_dep, new_dep, 1)

old_guard = """  const performMove = useCallback(async (item, targetDate) => {
    if (!canMoveWeekItem(item) || !targetDate) { clearDrag(); return; }
    if (item.recommendedDate === targetDate) { clearDrag(); return; }
"""
new_guard = """  const performMove = useCallback(async (item, targetDate) => {
    if (!canMoveWeekItem(item) || !targetDate) { clearDrag(); return; }
    if (targetDate < todayKey) {
      clearDrag();
      showMoveFeedback('Impossible de déplacer une séance sur une journée passée.');
      return;
    }
    if (item.recommendedDate === targetDate) { clearDrag(); return; }
"""
if old_guard not in s:
    raise SystemExit('performMove guard not found')
s = s.replace(old_guard, new_guard, 1)

old_move_dep = "  }, [clearDrag, contract?.weekStart, showMoveFeedback]);\n"
new_move_dep = "  }, [clearDrag, contract?.weekStart, showMoveFeedback, todayKey]);\n"
if old_move_dep not in s:
    raise SystemExit('performMove dependency not found')
s = s.replace(old_move_dep, new_move_dep, 1)

p.write_text(s)
