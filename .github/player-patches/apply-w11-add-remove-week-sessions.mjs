import fs from 'node:fs';

const planningPath = 'app/(tabs)/planning.js';
const servicePath = 'src/services/weeklyPlanService.js';

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return source.replace(from, to);
}

let service = fs.readFileSync(servicePath, 'utf8');
service = replaceOnce(
  service,
  `  return normalizeWeekMoveResult(data);\n}\n\nexport async function updateWeekPlanItemContext`,
  `  return normalizeWeekMoveResult(data);\n}\n\nexport async function removeWeekPlanItem({\n  planItemId,\n  anchorDate = new Date(),\n} = {}) {\n  if (!planItemId) {\n    throw new Error('planItemId is required to remove a week item.');\n  }\n\n  const userId = await getAuthenticatedUserId();\n  const data = await runSupabaseRequestWithAuthRetry(() =>\n    supabase.rpc(\n      'week_remove_plan_item_v1',\n      {\n        p_user_id: userId,\n        p_plan_item_id: planItemId,\n        p_anchor_date: normalizeWeekDateInput(anchorDate, 'anchorDate'),\n      }\n    )\n  );\n\n  return normalizeWeekRemoveResult(data);\n}\n\nexport async function updateWeekPlanItemContext`,
  'weeklyPlanService remove export'
);
service = replaceOnce(
  service,
  `function normalizeDashboardSnapshot(data) {`,
  `function normalizeWeekRemoveResult(data) {\n  const source = data ?? {};\n  return {\n    contractVersion: source.contract_version ?? null,\n    planItemId: source.plan_item_id ?? null,\n    recommendedDate: source.recommended_date ?? null,\n    removed: Boolean(source.removed),\n    sessionAbandoned: Boolean(source.session_abandoned),\n    userDebtCreated: Boolean(source.user_debt_created),\n    contentDeleted: Boolean(source.content_deleted),\n    historyDeleted: Boolean(source.history_deleted),\n    refreshWith: source.refresh_with ?? 'week_read_contract_v2',\n    raw: source,\n  };\n}\n\nfunction normalizeDashboardSnapshot(data) {`,
  'weeklyPlanService remove normalizer'
);
fs.writeFileSync(servicePath, service);

let planning = fs.readFileSync(planningPath, 'utf8');
planning = replaceOnce(
  planning,
  `  getWeekReadContract,\n  moveWeekPlanItem,\n} from '../../src/services/weeklyPlanService';`,
  `  getWeekReadContract,\n  moveWeekPlanItem,\n  removeWeekPlanItem,\n} from '../../src/services/weeklyPlanService';`,
  'planning service import'
);
planning = replaceOnce(
  planning,
  `function getTone(item, palette) {`,
  `function canRemoveWeekItem(item) {\n  return Boolean(\n    item?.planItemId &&\n    (item?.displayState === 'PREVUE' || item?.displayState === 'PRETE')\n  );\n}\n\nfunction getTone(item, palette) {`,
  'canRemoveWeekItem helper'
);
planning = replaceOnce(
  planning,
  `function ActionButton({ label, icon, primary = false, palette, onPress }) {`,
  `function RemoveButton({ item, palette, disabled, onPress }) {\n  if (!canRemoveWeekItem(item)) return null;\n  return (\n    <TouchableOpacity\n      style={styles.removeButton}\n      onPress={() => !disabled && onPress?.(item)}\n      disabled={disabled}\n      accessibilityRole="button"\n      accessibilityLabel={\`Supprimer ${'${'}getShortSummary(item)}\`}\n      accessibilityHint="Retirer cette séance de la semaine sans créer de retard."\n    >\n      <Ionicons name="trash-outline" size={17} color={palette.textMuted} />\n    </TouchableOpacity>\n  );\n}\n\nfunction ActionButton({ label, icon, primary = false, palette, onPress }) {`,
  'remove button component'
);
planning = replaceOnce(
  planning,
  `  item, index, expanded, moving, exercises, palette, onToggle, onImport,\n  onDragStart, onDragMove, onDragDrop, onDragCancel, onOpenSession, openingSessionId,\n}) {`,
  `  item, index, expanded, moving, exercises, palette, onToggle, onImport,\n  onDragStart, onDragMove, onDragDrop, onDragCancel, onOpenSession, openingSessionId,\n  onRequestRemove, removingItemId,\n}) {`,
  'WeekObject props'
);
planning = replaceOnce(
  planning,
  `        <DragHandle\n          item={item}\n          palette={palette}\n          disabled={moving}\n          onStart={onDragStart}`,
  `        <RemoveButton\n          item={item}\n          palette={palette}\n          disabled={moving || removingItemId === item?.planItemId}\n          onPress={onRequestRemove}\n        />\n        <DragHandle\n          item={item}\n          palette={palette}\n          disabled={moving || removingItemId === item?.planItemId}\n          onStart={onDragStart}`,
  'WeekObject remove button placement'
);
planning = replaceOnce(
  planning,
  `  registerDayRef, onToggleItem, onToggleEmpty, onImport,\n  onDragStart, onDragMove, onDragDrop, onDragCancel, onOpenSession, openingSessionId,\n}) {`,
  `  registerDayRef, onToggleItem, onToggleEmpty, onImport,\n  onDragStart, onDragMove, onDragDrop, onDragCancel, onOpenSession, openingSessionId,\n  onRequestRemove, removingItemId,\n}) {`,
  'DaySection props'
);
planning = replaceOnce(
  planning,
  `              onOpenSession={onOpenSession}\n              openingSessionId={openingSessionId}\n            />`,
  `              onOpenSession={onOpenSession}\n              openingSessionId={openingSessionId}\n              onRequestRemove={onRequestRemove}\n              removingItemId={removingItemId}\n            />`,
  'DaySection WeekObject props pass'
);

const modals = `\nfunction AddSessionModal({ visible, days, todayKey, palette, currentCount, onClose, onSelectDay }) {\n  const atLimit = currentCount >= 5;\n  return (\n    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>\n      <Pressable style={styles.modalBackdrop} onPress={onClose}>\n        <Pressable style={[styles.importSheet, { backgroundColor: palette.surfaceRaised, borderColor: palette.border }]} onPress={() => {}}>\n          <View style={styles.sheetHandle} />\n          <Text style={[styles.sheetTitle, { color: palette.text }]}>AJOUTER UNE SÉANCE</Text>\n          <Text style={[styles.sheetIntro, { color: palette.textMuted }]}>\n            Ouvre un créneau supplémentaire cette semaine. UGEROD préparera une intention cohérente avec le reste de ta programmation.\n          </Text>\n          <View style={styles.addDayList}>\n            {days.map((day) => {\n              const pastOrToday = day.key <= todayKey;\n              const disabled = atLimit || pastOrToday;\n              const count = day.items?.length ?? 0;\n              return (\n                <TouchableOpacity\n                  key={day.key}\n                  style={[styles.addDayRow, { borderColor: palette.border }, disabled && styles.disabledRow]}\n                  disabled={disabled}\n                  onPress={() => onSelectDay?.(day.key)}\n                  accessibilityRole="button"\n                  accessibilityLabel={\`Ajouter une séance ${'${'}day.label} ${'${'}day.date.getDate()}\`}\n                >\n                  <View style={styles.addDayDate}>\n                    <Text style={[styles.addDayName, { color: disabled ? palette.textMuted : palette.text }]}>{day.label}</Text>\n                    <Text style={[styles.addDayNumber, { color: disabled ? palette.textMuted : palette.text }]}>{day.date.getDate()}</Text>\n                  </View>\n                  <View style={styles.addDayCopy}>\n                    <Text style={[styles.addDayTitle, { color: disabled ? palette.textMuted : palette.text }]}>\n                      {pastOrToday ? 'Déjà passé / aujourd’hui' : count > 0 ? \`${'${'}count} séance${'${'}count > 1 ? 's' : ''} déjà prévue${'${'}count > 1 ? 's' : ''}\` : 'Créneau disponible'}\n                    </Text>\n                    {!pastOrToday ? (\n                      <Text style={[styles.addDaySubtitle, { color: palette.textMuted }]}>Tu pourras préciser le contexte avant de la préparer.</Text>\n                    ) : null}\n                  </View>\n                  {!disabled ? <Ionicons name="chevron-forward" size={18} color={palette.textMuted} /> : null}\n                </TouchableOpacity>\n              );\n            })}\n          </View>\n          {atLimit ? (\n            <Text style={[styles.limitNote, { color: palette.textMuted }]}>5 séances sont déjà prévues cette semaine.</Text>\n          ) : null}\n          <TouchableOpacity style={[styles.sheetCloseButton, { borderColor: palette.border }]} onPress={onClose}>\n            <Text style={[styles.sheetCloseText, { color: palette.text }]}>FERMER</Text>\n          </TouchableOpacity>\n        </Pressable>\n      </Pressable>\n    </Modal>\n  );\n}\n\nfunction RemoveSessionModal({ item, visible, palette, removing, onClose, onConfirm }) {\n  return (\n    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => !removing && onClose?.()}>\n      <Pressable style={styles.modalBackdrop} onPress={() => !removing && onClose?.()}>\n        <Pressable style={[styles.removeSheet, { backgroundColor: palette.surfaceRaised, borderColor: palette.border }]} onPress={() => {}}>\n          <View style={[styles.removeIconWrap, { backgroundColor: palette.accentSoft }]}>\n            <Ionicons name="trash-outline" size={21} color={palette.orange} />\n          </View>\n          <Text style={[styles.removeTitle, { color: palette.text }]}>RETIRER CETTE SÉANCE ?</Text>\n          <Text style={[styles.removeText, { color: palette.textMuted }]}>\n            {item ? getShortSummary(item) : 'Cette séance'} disparaîtra de ta semaine. Aucun retard ni dette d’entraînement ne sera créé.\n          </Text>\n          <View style={styles.removeActions}>\n            <TouchableOpacity style={[styles.removeCancel, { borderColor: palette.border }]} disabled={removing} onPress={onClose}>\n              <Text style={[styles.removeCancelText, { color: palette.text }]}>ANNULER</Text>\n            </TouchableOpacity>\n            <TouchableOpacity style={[styles.removeConfirm, { backgroundColor: palette.orange }]} disabled={removing} onPress={onConfirm}>\n              <Text style={[styles.removeConfirmText, { color: '#FFFFFF' }]}>{removing ? 'RETRAIT…' : 'RETIRER'}</Text>\n            </TouchableOpacity>\n          </View>\n        </Pressable>\n      </Pressable>\n    </Modal>\n  );\n}\n`;
planning = replaceOnce(planning, `\nfunction ImportModal({ visible, dateKey, palette, shareValue, onShareValueChange, onClose }) {`, `${modals}\nfunction ImportModal({ visible, dateKey, palette, shareValue, onShareValueChange, onClose }) {`, 'add/remove modal components');

planning = replaceOnce(
  planning,
  `  const [importDay, setImportDay] = useState(null);\n  const [shareValue, setShareValue] = useState('');`,
  `  const [importDay, setImportDay] = useState(null);\n  const [shareValue, setShareValue] = useState('');\n  const [addSessionOpen, setAddSessionOpen] = useState(false);\n  const [removeItem, setRemoveItem] = useState(null);\n  const [removingItemId, setRemovingItemId] = useState(null);`,
  'planning modal state'
);
planning = replaceOnce(
  planning,
  `  const handleOpenSession = useCallback(async (item) => {`,
  `  const handleRemoveWeekItem = useCallback(async () => {\n    if (!removeItem?.planItemId || removingItemId) return;\n    const anchorDate = parseDateKey(contract?.weekStart) ?? new Date();\n    try {\n      setRemovingItemId(removeItem.planItemId);\n      await removeWeekPlanItem({ planItemId: removeItem.planItemId, anchorDate });\n      const refreshed = await getWeekReadContract({ anchorDate });\n      setContract(refreshed);\n      const ids = (refreshed?.visibleItems ?? []).map((entry) => entry?.sessionId).filter(Boolean);\n      setExercisePreviews(await getWeekSessionExercisePreviews(ids));\n      setExpandedKey(null);\n      setRemoveItem(null);\n      showMoveFeedback('Séance retirée de ta semaine.');\n    } catch (removeError) {\n      console.warn('[MaSemaine] remove failed', removeError);\n      showMoveFeedback('Impossible de retirer cette séance pour le moment.');\n    } finally {\n      setRemovingItemId(null);\n    }\n  }, [contract?.weekStart, removeItem, removingItemId, showMoveFeedback]);\n\n  const handleAddSessionDay = useCallback((dateKey) => {\n    setAddSessionOpen(false);\n    router.push({\n      pathname: '/workout/preparation',\n      params: { date: dateKey, entry: 'week_assisted', origin: 'week_additional' },\n    });\n  }, []);\n\n  const handleOpenSession = useCallback(async (item) => {`,
  'remove/add handlers'
);
planning = replaceOnce(
  planning,
  `                  onOpenSession={handleOpenSession}\n                  openingSessionId={openingSessionId}\n                />`,
  `                  onOpenSession={handleOpenSession}\n                  openingSessionId={openingSessionId}\n                  onRequestRemove={setRemoveItem}\n                  removingItemId={removingItemId}\n                />`,
  'Planning DaySection props pass'
);
planning = replaceOnce(
  planning,
  `            </View>\n          )}\n        </View>\n      </ScrollView>`,
  `            </View>\n          )}\n\n          {!loading && contract ? (\n            <View style={styles.addSessionSection}>\n              <TouchableOpacity\n                style={[\n                  styles.addSessionButton,\n                  { borderColor: visibleItems.length >= 5 ? palette.border : palette.accent },\n                  visibleItems.length >= 5 && styles.disabledRow,\n                ]}\n                disabled={visibleItems.length >= 5}\n                onPress={() => setAddSessionOpen(true)}\n                accessibilityRole="button"\n                accessibilityLabel="Ajouter une séance à cette semaine"\n              >\n                <Ionicons name="add-circle-outline" size={20} color={visibleItems.length >= 5 ? palette.textMuted : palette.accent} />\n                <Text style={[styles.addSessionButtonText, { color: visibleItems.length >= 5 ? palette.textMuted : palette.text }]}>AJOUTER UNE SÉANCE</Text>\n              </TouchableOpacity>\n              <Text style={[styles.addSessionHint, { color: palette.textMuted }]}>\n                {visibleItems.length >= 5 ? '5 séances sont déjà prévues.' : 'Pré-programmer une 4e ou 5e séance potentielle cette semaine.'}\n              </Text>\n            </View>\n          ) : null}\n        </View>\n      </ScrollView>`,
  'bottom add session CTA'
);
planning = replaceOnce(
  planning,
  `      <ImportModal\n        visible={Boolean(importDay)}`,
  `      <AddSessionModal\n        visible={addSessionOpen}\n        days={daysWithItems}\n        todayKey={todayKey}\n        palette={palette}\n        currentCount={visibleItems.length}\n        onClose={() => setAddSessionOpen(false)}\n        onSelectDay={handleAddSessionDay}\n      />\n\n      <RemoveSessionModal\n        visible={Boolean(removeItem)}\n        item={removeItem}\n        palette={palette}\n        removing={Boolean(removingItemId)}\n        onClose={() => !removingItemId && setRemoveItem(null)}\n        onConfirm={handleRemoveWeekItem}\n      />\n\n      <ImportModal\n        visible={Boolean(importDay)}`,
  'render add/remove modals'
);
planning = replaceOnce(
  planning,
  `  dragHandleSpacer: { width: 10 },`,
  `  dragHandleSpacer: { width: 10 },\n  removeButton: { width: 34, alignItems: 'center', justifyContent: 'center' },`,
  'remove button style'
);
planning = replaceOnce(
  planning,
  `  sheetCloseText: { fontFamily: fontFamilies.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.8 },\n});`,
  `  sheetCloseText: { fontFamily: fontFamilies.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.8 },\n  addSessionSection: { marginTop: 22, marginBottom: 6 },\n  addSessionButton: { minHeight: 50, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16 },\n  addSessionButtonText: { fontFamily: fontFamilies.bold, fontSize: 12, lineHeight: 16, letterSpacing: 0.8 },\n  addSessionHint: { fontFamily: fontFamilies.regular, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 7 },\n  disabledRow: { opacity: 0.46 },\n  addDayList: { gap: 8, marginTop: 2 },\n  addDayRow: { minHeight: 62, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 11 },\n  addDayDate: { width: 43, alignItems: 'center' },\n  addDayName: { fontFamily: fontFamilies.bold, fontSize: 9, lineHeight: 12, letterSpacing: 0.8 },\n  addDayNumber: { fontFamily: fontFamilies.bold, fontSize: 17, lineHeight: 21, marginTop: 1 },\n  addDayCopy: { flex: 1 },\n  addDayTitle: { fontFamily: fontFamilies.semiBold, fontSize: 12, lineHeight: 17 },\n  addDaySubtitle: { fontFamily: fontFamilies.regular, fontSize: 10, lineHeight: 15, marginTop: 2 },\n  limitNote: { fontFamily: fontFamilies.regular, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 10 },\n  removeSheet: { width: 'calc(100% - 40px)', maxWidth: 520, alignSelf: 'center', borderWidth: 1, borderRadius: 22, padding: 20 },\n  removeIconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },\n  removeTitle: { fontFamily: fontFamilies.display, fontSize: 26, lineHeight: 29, letterSpacing: 0.6 },\n  removeText: { fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20, marginTop: 7 },\n  removeActions: { flexDirection: 'row', gap: 9, marginTop: 18 },\n  removeCancel: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },\n  removeConfirm: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },\n  removeCancelText: { fontFamily: fontFamilies.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.7 },\n  removeConfirmText: { fontFamily: fontFamilies.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.7 },\n});`,
  'add/remove styles'
);
fs.writeFileSync(planningPath, planning);

console.log('W11 add/remove week sessions patch applied.');
