import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { getDashboardSnapshot } from '../../services/weeklyPlanService';

const CALENDAR_DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthLabel(date) {
  return date
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    .toUpperCase();
}

function createMonthCalendar(displayedMonth, monthSessions) {
  const year = displayedMonth.getFullYear();
  const month = displayedMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const firstDayIndex = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const sessionMap = new Map(
    (Array.isArray(monthSessions) ? monthSessions : [])
      .filter((item) => item?.date)
      .map((item) => [item.date, item])
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cells = [];

  for (let index = 0; index < firstDayIndex; index += 1) {
    cells.push({ type: 'empty', key: `empty-start-${index}` });
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);
    const key = formatDateKey(date);
    const session = sessionMap.get(key);
    cells.push({
      type: 'day',
      key,
      day,
      today: date.getTime() === today.getTime(),
      completed: Boolean(session),
      sessionId: session?.session_id ?? null,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ type: 'empty', key: `empty-end-${cells.length}` });
  }

  return cells;
}

function isSameMonth(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  );
}

export default function DashboardHistoryCalendarCoach({
  week,
  completed,
  target,
  reached,
  initialMonthSessions,
  onCompletedDayPress,
  palette,
}) {
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [displayedMonth, setDisplayedMonth] = useState(new Date());
  const [monthSessions, setMonthSessions] = useState(
    Array.isArray(initialMonthSessions) ? initialMonthSessions : []
  );
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState(false);

  useEffect(() => {
    if (isSameMonth(displayedMonth, new Date())) {
      setMonthSessions(
        Array.isArray(initialMonthSessions) ? initialMonthSessions : []
      );
    }
  }, [displayedMonth, initialMonthSessions]);

  const monthCells = useMemo(
    () => createMonthCalendar(displayedMonth, monthSessions),
    [displayedMonth, monthSessions]
  );

  async function loadMonth(nextMonth) {
    setDisplayedMonth(nextMonth);

    if (isSameMonth(nextMonth, new Date())) {
      setMonthSessions(
        Array.isArray(initialMonthSessions) ? initialMonthSessions : []
      );
      setMonthError(false);
      return;
    }

    try {
      setMonthLoading(true);
      setMonthError(false);
      const data = await getDashboardSnapshot({ monthDate: nextMonth });
      setMonthSessions(data?.monthSessions ?? []);
    } catch (error) {
      console.warn('Coach dashboard calendar month', error);
      setMonthSessions([]);
      setMonthError(true);
    } finally {
      setMonthLoading(false);
    }
  }

  function handleCalendarDayPress(item) {
    if (!item.completed || !item.sessionId) return;
    router.push(`/workout/${item.sessionId}`);
  }

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <View>
          <Text style={styles.sectionTitle}>CETTE SEMAINE</Text>
          <Text style={styles.monthLabel}>{getMonthLabel(new Date())}</Text>
        </View>

        <View style={styles.headerActions}>
          <View style={styles.weekScore}>
            <Text style={[styles.weekScoreValue, reached && styles.weekScoreReached]}>
              {completed}
            </Text>
            <Text style={styles.weekScoreDivider}>/</Text>
            <Text style={styles.weekScoreTarget}>{target}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={calendarOpen ? 'Fermer le calendrier' : 'Ouvrir le calendrier'}
            onPress={() => setCalendarOpen((current) => !current)}
            style={({ pressed }) => [
              styles.calendarButton,
              calendarOpen && styles.calendarButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={calendarOpen ? 'close' : 'calendar-outline'}
              size={20}
              color={calendarOpen ? palette.accent : palette.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      <View style={styles.weekCard}>
        {week.map((item) => (
          <Pressable
            key={item.key}
            disabled={!item.completed}
            onPress={() => onCompletedDayPress(item)}
            style={[styles.dayItem, item.today && styles.dayItemToday]}
          >
            <Text style={[styles.dayLabel, item.today && styles.dayLabelToday]}>
              {item.day}
            </Text>

            <View
              style={[
                styles.dayCircle,
                item.completed && styles.dayCircleCompleted,
                item.today && !item.completed && styles.dayCircleToday,
              ]}
            >
              {item.completed ? (
                <Ionicons name="checkmark" size={17} color={palette.textOnAccent} />
              ) : (
                <Text style={[styles.dayNumber, item.today && styles.dayNumberToday]}>
                  {item.date}
                </Text>
              )}
            </View>

            {item.today ? <View style={styles.todayDot} /> : null}
          </Pressable>
        ))}
      </View>

      {reached ? <Text style={styles.rhythmReached}>RYTHME CIBLE ATTEINT</Text> : null}

      {calendarOpen ? (
        <View style={styles.fullCalendar}>
          <View style={styles.fullCalendarHeader}>
            <Pressable
              onPress={() =>
                loadMonth(
                  new Date(
                    displayedMonth.getFullYear(),
                    displayedMonth.getMonth() - 1,
                    1
                  )
                )
              }
              hitSlop={10}
              style={({ pressed }) => [styles.monthNavigationButton, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-back" size={20} color={palette.text} />
            </Pressable>

            <Pressable onPress={() => loadMonth(new Date())} style={styles.calendarMonthCenter}>
              <Text style={styles.fullCalendarMonth}>{getMonthLabel(displayedMonth)}</Text>
              <Text style={styles.todayShortcut}>AUJOURD’HUI</Text>
            </Pressable>

            <Pressable
              onPress={() =>
                loadMonth(
                  new Date(
                    displayedMonth.getFullYear(),
                    displayedMonth.getMonth() + 1,
                    1
                  )
                )
              }
              hitSlop={10}
              style={({ pressed }) => [styles.monthNavigationButton, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-forward" size={20} color={palette.text} />
            </Pressable>
          </View>

          <View style={styles.calendarWeekLabels}>
            {CALENDAR_DAY_LABELS.map((label, index) => (
              <Text key={`${label}-${index}`} style={styles.calendarWeekLabel}>
                {label}
              </Text>
            ))}
          </View>

          {monthLoading ? (
            <View style={styles.monthLoading}>
              <ActivityIndicator size="small" color={palette.accent} />
            </View>
          ) : (
            <View style={styles.calendarGrid}>
              {monthCells.map((item) => {
                if (item.type === 'empty') {
                  return <View key={item.key} style={styles.calendarCell} />;
                }

                return (
                  <Pressable
                    key={item.key}
                    onPress={() => handleCalendarDayPress(item)}
                    disabled={!item.completed}
                    style={styles.calendarCell}
                  >
                    <View
                      style={[
                        styles.calendarDateCircle,
                        item.today && !item.completed && styles.calendarDateToday,
                        item.completed && styles.calendarDateCompleted,
                        item.today && item.completed && styles.calendarDateCompletedToday,
                      ]}
                    >
                      {item.completed ? (
                        <Ionicons name="checkmark" size={15} color={palette.textOnAccent} />
                      ) : (
                        <Text style={[styles.calendarDateText, item.today && styles.calendarDateTextToday]}>
                          {item.day}
                        </Text>
                      )}
                    </View>
                    {item.completed ? (
                      <Text style={styles.calendarCompletedNumber}>{item.day}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.calendarLegend}>
            <View style={styles.legendItem}>
              <View style={styles.legendCompleted}>
                <Ionicons name="checkmark" size={10} color={palette.textOnAccent} />
              </View>
              <Text style={styles.legendText}>SÉANCE RÉALISÉE</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.legendToday} />
              <Text style={styles.legendText}>AUJOURD’HUI</Text>
            </View>
          </View>

          <Text style={styles.calendarInstruction}>
            {monthError
              ? 'Impossible de charger ce mois. Réessaie avec les flèches.'
              : 'Appuie sur un jour coché pour revoir la séance réalisée.'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(p) {
  return StyleSheet.create({
    section: { marginTop: 26 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      marginBottom: 11,
    },
    sectionTitle: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 10,
      letterSpacing: 1.2,
      color: p.text,
    },
    monthLabel: {
      marginTop: 2,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 10,
      letterSpacing: 0.65,
      color: p.textMuted,
    },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    weekScore: { flexDirection: 'row', alignItems: 'baseline' },
    weekScoreValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 27,
      lineHeight: 29,
      color: p.text,
    },
    weekScoreReached: { color: p.accent },
    weekScoreDivider: {
      marginHorizontal: 3,
      fontFamily: 'Manrope_500Medium',
      fontSize: 12,
      color: p.textMuted,
    },
    weekScoreTarget: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 21,
      color: p.textSecondary,
    },
    calendarButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    calendarButtonActive: {
      backgroundColor: p.accentSoft,
      borderColor: p.accentBorder,
    },
    weekCard: {
      minHeight: 92,
      borderRadius: 17,
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.border,
      paddingHorizontal: 6,
      paddingVertical: 10,
      flexDirection: 'row',
    },
    dayItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 11,
    },
    dayItemToday: { backgroundColor: p.orangeSoft },
    dayLabel: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 8,
      letterSpacing: 0.35,
      color: p.textMuted,
    },
    dayLabelToday: { color: p.orange },
    dayCircle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayCircleCompleted: { backgroundColor: p.accent },
    dayCircleToday: { borderWidth: 1.5, borderColor: p.orange },
    dayNumber: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 12,
      color: p.textSecondary,
    },
    dayNumberToday: { color: p.text },
    todayDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: p.orange,
    },
    rhythmReached: {
      marginTop: 8,
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      letterSpacing: 0.8,
      color: p.accent,
    },
    fullCalendar: {
      marginTop: 12,
      borderRadius: 18,
      padding: 15,
      backgroundColor: p.surfaceElevated,
      borderWidth: 1,
      borderColor: p.accentBorder,
    },
    fullCalendarHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 17,
    },
    monthNavigationButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    calendarMonthCenter: { alignItems: 'center' },
    fullCalendarMonth: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 24,
      lineHeight: 27,
      letterSpacing: 1.2,
      color: p.text,
    },
    todayShortcut: {
      marginTop: 2,
      fontFamily: 'Manrope_700Bold',
      fontSize: 8,
      letterSpacing: 0.7,
      color: p.accent,
    },
    calendarWeekLabels: { flexDirection: 'row', marginBottom: 8 },
    calendarWeekLabel: {
      width: '14.2857%',
      textAlign: 'center',
      fontFamily: 'Manrope_700Bold',
      fontSize: 8,
      color: p.textMuted,
    },
    monthLoading: { minHeight: 216, alignItems: 'center', justifyContent: 'center' },
    calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calendarCell: {
      width: '14.2857%',
      minHeight: 54,
      alignItems: 'center',
      justifyContent: 'center',
    },
    calendarDateCircle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    calendarDateToday: { borderWidth: 1.5, borderColor: p.orange },
    calendarDateCompleted: { backgroundColor: p.accent },
    calendarDateCompletedToday: { borderWidth: 2, borderColor: p.orange },
    calendarDateText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: p.textSecondary,
    },
    calendarDateTextToday: { color: p.text },
    calendarCompletedNumber: {
      marginTop: 2,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 8,
      color: p.textMuted,
    },
    calendarLegend: {
      marginTop: 16,
      paddingTop: 13,
      borderTopWidth: 1,
      borderTopColor: p.border,
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 20,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendCompleted: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    legendToday: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: p.orange,
    },
    legendText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 8,
      letterSpacing: 0.45,
      color: p.textMuted,
    },
    calendarInstruction: {
      marginTop: 13,
      fontFamily: 'Manrope_400Regular',
      fontSize: 10,
      lineHeight: 15,
      color: p.textSecondary,
      textAlign: 'center',
    },
    pressed: { opacity: 0.68 },
  });
}
