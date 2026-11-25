from pathlib import Path
import re

p = Path('app/(tabs)/planning.js')
s = p.read_text()

old_empty = '''function EmptyDay({ dateKey, expanded, palette, onToggle, onImport }) {
  return (
    <View style={styles.emptyDayWrap}>
      <Pressable style={styles.emptyDayPress} onPress={onToggle} accessibilityRole="button">
        <Text style={[styles.emptyDayText, { color: palette.textMuted }]}>Rien de prévu</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={palette.textMuted} />
      </Pressable>
      {expanded ? (
        <View style={[styles.emptyActionsPanel, { borderColor: palette.border }]}> 
          <CreationActions dateKey={dateKey} palette={palette} onImport={onImport} />
        </View>
      ) : null}
    </View>
  );
}'''

new_empty = '''function EmptyDay({ dateKey, expanded, isPast = false, palette, onToggle, onImport }) {
  if (isPast) {
    return (
      <View style={styles.emptyDayWrap}>
        <View style={styles.emptyDayPress}>
          <Text style={[styles.emptyDayText, { color: palette.textMuted }]}>Journée passée</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.emptyDayWrap}>
      <Pressable style={styles.emptyDayPress} onPress={onToggle} accessibilityRole="button">
        <Text style={[styles.emptyDayText, { color: palette.textMuted }]}>Rien de prévu</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={palette.textMuted} />
      </Pressable>
      {expanded ? (
        <View style={[styles.emptyActionsPanel, { borderColor: palette.border }]}> 
          <CreationActions dateKey={dateKey} palette={palette} onImport={onImport} />
        </View>
      ) : null}
    </View>
  );
}'''

if old_empty not in s:
    raise SystemExit('EmptyDay source block not found')
s = s.replace(old_empty, new_empty)

old_day_flags = "  const isToday = day.key === todayKey;\n  const isTarget = dropTarget === day.key;"
new_day_flags = "  const isToday = day.key === todayKey;\n  const isPast = day.key < todayKey;\n  const isTarget = dropTarget === day.key;"
if old_day_flags not in s:
    raise SystemExit('DaySection flags not found')
s = s.replace(old_day_flags, new_day_flags, 1)

old_day_press = "        onPress={() => day.items.length > 0 ? onToggleItem(day.items[0], 0) : onToggleEmpty(day.key)}"
new_day_press = """        onPress={() => {
          if (day.items.length > 0) onToggleItem(day.items[0], 0);
          else if (!isPast) onToggleEmpty(day.key);
        }}"""
if old_day_press not in s:
    raise SystemExit('DaySection press handler not found')
s = s.replace(old_day_press, new_day_press, 1)

old_empty_props = "            expanded={expandedKey === `empty:${day.key}`}\n            palette={palette}"
new_empty_props = "            expanded={expandedKey === `empty:${day.key}`}\n            isPast={isPast}\n            palette={palette}"
if old_empty_props not in s:
    raise SystemExit('EmptyDay props insertion not found')
s = s.replace(old_empty_props, new_empty_props, 1)

new_modal = '''function AddSessionModal({ visible, days, todayKey, palette, currentCount, onClose, onSelectDay }) {
  const atLimit = currentCount >= 5;
  const selectableDays = days.filter((day) => day.key >= todayKey);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={[styles.importSheet, { backgroundColor: palette.surfaceRaised, borderColor: palette.border }]} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: palette.text }]}>AJOUTER UNE SÉANCE</Text>
          <Text style={[styles.sheetIntro, { color: palette.textMuted }]}>
            Choisis un jour libre pour ajouter une 4e ou 5e séance. Les journées déjà programmées restent inchangées.
          </Text>
          <View style={styles.addDayList}>
            {selectableDays.map((day) => {
              const isToday = day.key === todayKey;
              const count = day.items?.length ?? 0;
              const occupied = count > 0;
              const disabled = atLimit || occupied;
              const title = occupied
                ? 'Séance déjà prévue'
                : isToday
                  ? 'Aujourd’hui · créneau disponible'
                  : 'Créneau disponible';
              const subtitle = atLimit
                ? 'Limite de 5 séances atteinte pour cette semaine.'
                : occupied
                  ? 'Cette journée est déjà programmée.'
                  : 'UGEROD préparera une intention cohérente avec le reste de ta semaine.';
              return (
                <TouchableOpacity
                  key={day.key}
                  style={[styles.addDayRow, { borderColor: palette.border }, disabled && styles.disabledRow]}
                  disabled={disabled}
                  onPress={() => onSelectDay?.(day.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ajouter une séance ${day.label} ${day.date.getDate()}`}
                >
                  <View style={styles.addDayDate}>
                    <Text style={[styles.addDayName, { color: disabled ? palette.textMuted : palette.text }]}>{day.label}</Text>
                    <Text style={[styles.addDayNumber, { color: disabled ? palette.textMuted : palette.text }]}>{day.date.getDate()}</Text>
                  </View>
                  <View style={styles.addDayCopy}>
                    <Text style={[styles.addDayTitle, { color: disabled ? palette.textMuted : palette.text }]}>{title}</Text>
                    <Text style={[styles.addDaySubtitle, { color: palette.textMuted }]}>{subtitle}</Text>
                  </View>
                  {!disabled ? <Ionicons name="chevron-forward" size={18} color={palette.textMuted} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
          {atLimit ? (
            <Text style={[styles.limitNote, { color: palette.textMuted }]}>5 séances sont déjà prévues cette semaine.</Text>
          ) : null}
          <TouchableOpacity style={[styles.sheetCloseButton, { borderColor: palette.border }]} onPress={onClose}>
            <Text style={[styles.sheetCloseText, { color: palette.text }]}>FERMER</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
'''

s, n = re.subn(
    r"function AddSessionModal\(\{ visible, days, todayKey, palette, currentCount, onClose, onSelectDay \}\) \{.*?\n\}\n\n(?=function RemoveSessionModal)",
    new_modal,
    s,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f'AddSessionModal patch count={n}')

needle = "  const todayKey = toLocalDateKey(new Date());\n"
replacement = """  const todayKey = toLocalDateKey(new Date());
  const planningSlotCount = useMemo(
    () => (contract?.items ?? []).filter((item) =>
      !['skipped', 'unrealized'].includes(String(item?.lifecycleStatus ?? '').toLowerCase())
    ).length,
    [contract?.items]
  );
"""
if needle not in s:
    raise SystemExit('todayKey insertion point not found')
s = s.replace(needle, replacement, 1)

s = s.replace('visibleItems.length >= 5', 'planningSlotCount >= 5')
s = s.replace('currentCount={visibleItems.length}', 'currentCount={planningSlotCount}')

p.write_text(s)
