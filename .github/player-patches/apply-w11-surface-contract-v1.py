from pathlib import Path

# ---- weeklyPlanService.js ----
service = Path('src/services/weeklyPlanService.js')
s = service.read_text()

old = """  const items = Array.isArray(source.items)\n    ? source.items.map(normalizeWeekReadItem)\n    : [];\n\n  return {\n"""
new = """  const items = Array.isArray(source.items)\n    ? source.items.map(normalizeWeekReadItem)\n    : [];\n  const contextItems = Array.isArray(source.context_items)\n    ? source.context_items.map(normalizeWeekReadItem)\n    : [];\n\n  return {\n"""
if old not in s:
    raise SystemExit('weeklyPlanService items block not found')
s = s.replace(old, new, 1)

old = """    completedActualCount: Number(source.completed_actual_count ?? 0),\n    items,\n    visibleItems: items.filter(\n"""
new = """    completedActualCount: Number(source.completed_actual_count ?? 0),\n    planningSlotCount:\n      source.planning_slot_count == null\n        ? items.length + contextItems.length\n        : Number(source.planning_slot_count),\n    items,\n    contextItems,\n    visibleItems: items.filter(\n"""
if old not in s:
    raise SystemExit('weeklyPlanService contract count block not found')
s = s.replace(old, new, 1)

old = """      futureContextExcludesReadinessAndPain:\n        semantics.future_context_excludes_readiness_and_pain !== false,\n"""
new = """      futureContextExcludesReadinessAndPain:\n        semantics.future_context_excludes_readiness_and_pain !== false,\n      itemsAreSurfaceVisibleOnly:\n        semantics.items_are_surface_visible_only === true,\n      contextItemsNeverRenderAsSessions:\n        semantics.context_items_never_render_as_sessions === true,\n"""
if old not in s:
    raise SystemExit('weeklyPlanService semantics block not found')
s = s.replace(old, new, 1)
service.write_text(s)

# ---- planning.js ----
planning = Path('app/(tabs)/planning.js')
p = planning.read_text()

old = """  if (isPast) {\n    return (\n      <View style={styles.emptyDayWrap}>\n        <View style={styles.emptyDayPress}>\n          <Text style={[styles.emptyDayText, { color: palette.textMuted }]}>Journée passée</Text>\n        </View>\n      </View>\n    );\n  }\n"""
new = """  if (isPast) {\n    return (\n      <View style={styles.emptyDayWrap}>\n        <View style={[styles.pastDayCard, { backgroundColor: palette.pastDay, borderColor: palette.border }]}>\n          <View style={[styles.pastDayIcon, { backgroundColor: palette.pastDayIcon }]}>\n            <Ionicons name=\"time-outline\" size={16} color={palette.textMuted} />\n          </View>\n          <View style={styles.pastDayCopy}>\n            <Text style={[styles.pastDayTitle, { color: palette.textMuted }]}>Journée passée</Text>\n            <Text style={[styles.pastDaySubtitle, { color: palette.textMuted }]}>Ce jour n’est plus disponible.</Text>\n          </View>\n        </View>\n      </View>\n    );\n  }\n"""
if old not in p:
    raise SystemExit('planning EmptyDay past block not found')
p = p.replace(old, new, 1)

old = """  const isToday = day.key === todayKey;\n  const isPast = day.key < todayKey;\n  const isTarget = dropTarget === day.key;\n"""
new = """  const isToday = day.key === todayKey;\n  const isPast = day.key < todayKey;\n  const isUnavailablePast = isPast && day.items.length === 0;\n  const isTarget = dropTarget === day.key;\n"""
if old not in p:
    raise SystemExit('planning DaySection flags block not found')
p = p.replace(old, new, 1)

old = """        styles.daySection,\n        { borderBottomColor: palette.border },\n        isTarget && { backgroundColor: palette.dropTarget, borderLeftColor: palette.accent, borderLeftWidth: 3 },\n"""
new = """        styles.daySection,\n        { borderBottomColor: palette.border },\n        isUnavailablePast && { opacity: 0.78 },\n        isTarget && { backgroundColor: palette.dropTarget, borderLeftColor: palette.accent, borderLeftWidth: 3 },\n"""
if old not in p:
    raise SystemExit('planning daySection style block not found')
p = p.replace(old, new, 1)

old = """        <Text style={[styles.dayName, { color: isToday ? palette.accent : palette.textMuted }]}>{day.label}</Text>\n        <View style={[styles.dayNumberWrap, isToday && { backgroundColor: palette.accent }]}> \n          <Text style={[styles.dayNumber, { color: isToday ? palette.onAccent : palette.text }]}>{day.date.getDate()}</Text>\n        </View>\n"""
new = """        <Text style={[styles.dayName, { color: isToday ? palette.accent : palette.textMuted }]}>{day.label}</Text>\n        <View style={[\n          styles.dayNumberWrap,\n          isToday && { backgroundColor: palette.accent },\n          isUnavailablePast && { backgroundColor: palette.pastDayIcon },\n        ]}> \n          <Text style={[styles.dayNumber, { color: isToday ? palette.onAccent : isUnavailablePast ? palette.textMuted : palette.text }]}>{day.date.getDate()}</Text>\n        </View>\n"""
if old not in p:
    raise SystemExit('planning date display block not found')
p = p.replace(old, new, 1)

old = """    orange: '#FF6B19', onAccent: '#081009', intent: '#7D8A77', intentSoft: '#141A15',\n    session: '#A5B29E', done: '#778078', dropTarget: 'rgba(135,151,127,0.12)',\n"""
new = """    orange: '#FF6B19', onAccent: '#081009', intent: '#7D8A77', intentSoft: '#141A15',\n    session: '#A5B29E', done: '#778078', dropTarget: 'rgba(135,151,127,0.12)',\n    pastDay: '#111511', pastDayIcon: '#202620',\n"""
if old not in p:
    raise SystemExit('planning dark palette block not found')
p = p.replace(old, new, 1)

old = """    orange: '#FF6B19', onAccent: '#FFFFFF', intent: '#8A9684', intentSoft: '#EEF0EA',\n    session: '#646F5E', done: '#899087', dropTarget: 'rgba(100,111,94,0.08)',\n"""
new = """    orange: '#FF6B19', onAccent: '#FFFFFF', intent: '#8A9684', intentSoft: '#EEF0EA',\n    session: '#646F5E', done: '#899087', dropTarget: 'rgba(100,111,94,0.08)',\n    pastDay: '#ECEAE4', pastDayIcon: '#DFDDD5',\n"""
if old not in p:
    raise SystemExit('planning light palette block not found')
p = p.replace(old, new, 1)

old = """  const planningSlotCount = useMemo(\n    () => (contract?.items ?? []).filter((item) =>\n      !['skipped', 'unrealized'].includes(String(item?.lifecycleStatus ?? '').toLowerCase())\n    ).length,\n    [contract?.items]\n  );\n"""
new = """  const planningSlotCount = useMemo(\n    () => Number.isFinite(contract?.planningSlotCount)\n      ? contract.planningSlotCount\n      : (contract?.items ?? []).filter((item) =>\n          !['skipped', 'unrealized'].includes(String(item?.lifecycleStatus ?? '').toLowerCase())\n        ).length,\n    [contract?.items, contract?.planningSlotCount]\n  );\n"""
if old not in p:
    raise SystemExit('planning slot count block not found')
p = p.replace(old, new, 1)

old = """  emptyDayWrap: { minHeight: 52, justifyContent: 'center' },\n  emptyDayPress: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 },\n  emptyDayText: { fontFamily: fontFamilies.medium, fontSize: 13, lineHeight: 19 },\n"""
new = """  emptyDayWrap: { minHeight: 52, justifyContent: 'center' },\n  emptyDayPress: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 },\n  emptyDayText: { fontFamily: fontFamilies.medium, fontSize: 13, lineHeight: 19 },\n  pastDayCard: { minHeight: 56, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 11, paddingVertical: 9 },\n  pastDayIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },\n  pastDayCopy: { flex: 1, minWidth: 0 },\n  pastDayTitle: { fontFamily: fontFamilies.semiBold, fontSize: 12, lineHeight: 17 },\n  pastDaySubtitle: { fontFamily: fontFamilies.regular, fontSize: 10, lineHeight: 14, marginTop: 1 },\n"""
if old not in p:
    raise SystemExit('planning emptyDay styles block not found')
p = p.replace(old, new, 1)

planning.write_text(p)
