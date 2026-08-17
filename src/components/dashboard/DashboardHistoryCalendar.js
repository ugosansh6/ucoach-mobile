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

import { colors } from '../../constants';
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
    .toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    })
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

  for (let i = 0; i < firstDayIndex; i += 1) {
    cells.push({ type: 'empty', key: `empty-start-${i}` });
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);
    const dateKey = formatDateKey(date);
    const session = sessionMap.get(dateKey);

    cells.push({
      type: 'day',
      key: dateKey,
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

export default function DashboardHistoryCalendar({
  week,
  completed,
  target,
  reached,
  initialMonthSessions,
  onCompletedDayPress,
}) {
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
      console.warn('Dashboard history calendar month', error);
      setMonthSessions([]);
      setMonthError(true);
    } finally {
      setMonthLoading(false);
    }
  }

  function goPreviousMonth() {
    loadMonth(
      new Date(
        displayedMonth.getFullYear(),
        displayedMonth.getMonth() - 1,
        1
      )
    );
  }

  function goNextMonth() {
    loadMonth(
      new Date(
        displayedMonth.getFullYear(),
        displayedMonth.getMonth() + 1,
        1
      )
    );
  }

  function goToday() {
    loadMonth(new Date());
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
            <Text
              style={[
                styles.weekScoreValue,
                { color: reached ? colors.primaryLight : colors.brandRed },
              ]}
            >
              {completed}
            </Text>
            <Text style={styles.weekScoreDivider}>/</Text>
            <Text style={styles.weekScoreTarget}>{target}</Text>
          </View>

          <Pressable
            onPress={() => setCalendarOpen((current) => !current)}
            style={({ pressed }) => [
              styles.calendarButton,
              calendarOpen && styles.calendarButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={calendarOpen ? 'close' : 'calendar-outline'}
              size={21}
              color={calendarOpen ? colors.primaryLight : colors.textSecondary}
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
            style={[
              styles.dayItem,
              item.today && styles.dayItemToday,
            ]}
          >
            <Text
              style={[
                styles.dayLabel,
                item.today && styles.dayLabelToday,
              ]}
            >
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
                <Ionicons
                  name="checkmark"
                  size={18}
                  color={colors.brandWhite}
                />
              ) : (
                <Text
                  style={[
                    styles.dayNumber,
                    item.today && styles.dayNumberToday,
                  ]}
                >
                  {item.date}
                </Text>
              )}
            </View>

            {item.today && <View style={styles.todayDot} />}
          </Pressable>
        ))}
      </View>

      {calendarOpen && (
        <View style={styles.fullCalendar}>
          <View style={styles.fullCalendarHeader}>
            <Pressable
              onPress={goPreviousMonth}
              hitSlop={10}
              style={({ pressed }) => [
                styles.monthNavigationButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name="chevron-back"
                size={21}
                color={colors.textPrimary}
              />
            </Pressable>

            <Pressable onPress={goToday} style={styles.calendarMonthCenter}>
              <Text style={styles.fullCalendarMonth}>
                {getMonthLabel(displayedMonth)}
              </Text>
              <Text style={styles.todayShortcut}>AUJOURD’HUI</Text>
            </Pressable>

            <Pressable
              onPress={goNextMonth}
              hitSlop={10}
              style={({ pressed }) => [
                styles.monthNavigationButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name="chevron-forward"
                size={21}
                color={colors.textPrimary}
              />
            </Pressable>
          </View>

          <View style={styles.calendarWeekLabels}>
            {CALENDAR_DAY_LABELS.map((label, index) => (
              <Text
                key={`${label}-${index}`}
                style={styles.calendarWeekLabel}
              >
                {label}
              </Text>
            ))}
          </View>

          {monthLoading ? (
            <View style={styles.monthLoading}>
              <ActivityIndicator size="small" color={colors.primaryLight} />
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
                        item.today &&
                          !item.completed &&
                          styles.calendarDateToday,
                        item.completed && styles.calendarDateCompleted,
                        item.today &&
                          item.completed &&
                          styles.calendarDateCompletedToday,
                      ]}
                    >
                      {item.completed ? (
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color={colors.brandWhite}
                        />
                      ) : (
                        <Text
                          style={[
                            styles.calendarDateText,
                            item.today && styles.calendarDateTextToday,
                          ]}
                        >
                          {item.day}
                        </Text>
                      )}
                    </View>

                    {item.completed && (
                      <Text style={styles.calendarCompletedNumber}>
                        {item.day}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.calendarLegend}>
            <View style={styles.legendItem}>
              <View style={styles.legendCompleted}>
                <Ionicons
                  name="checkmark"
                  size={11}
                  color={colors.brandWhite}
                />
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 32,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },
  monthLabel: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 21,
    lineHeight: 24,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  weekScore: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  weekScoreValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 27,
  },
  weekScoreDivider: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    color: colors.textMuted,
    marginHorizontal: 3,
  },
  weekScoreTarget: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 21,
    color: colors.textSecondary,
  },
  calendarButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarButtonActive: {
    backgroundColor: 'rgba(8,104,255,0.12)',
    borderColor: 'rgba(8,104,255,0.35)',
  },
  weekCard: {
    minHeight: 94,
    borderRadius: 17,
    backgroundColor: 'rgba(17,21,26,0.91)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
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
  dayItemToday: {
    backgroundColor: 'rgba(255,59,59,0.06)',
  },
  dayLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.3,
    color: colors.textMuted,
  },
  dayLabelToday: {
    color: colors.brandRed,
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleCompleted: {
    backgroundColor: colors.primary,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: colors.brandRed,
  },
  dayNumber: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 13,
    color: colors.textSecondary,
  },
  dayNumberToday: {
    color: colors.brandWhite,
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.brandRed,
  },
  fullCalendar: {
    marginTop: 12,
    borderRadius: 18,
    padding: 15,
    backgroundColor: 'rgba(13,17,22,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.28)',
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
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarMonthCenter: {
    alignItems: 'center',
  },
  fullCalendarMonth: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: 1.3,
    color: colors.textPrimary,
  },
  todayShortcut: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 0.7,
    color: colors.primaryLight,
    marginTop: 2,
  },
  calendarWeekLabels: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  calendarWeekLabel: {
    width: '14.2857%',
    textAlign: 'center',
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 13,
    color: colors.textMuted,
  },
  monthLoading: {
    minHeight: 216,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
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
  calendarDateToday: {
    borderWidth: 1.5,
    borderColor: colors.brandRed,
  },
  calendarDateCompleted: {
    backgroundColor: colors.primary,
  },
  calendarDateCompletedToday: {
    borderWidth: 2,
    borderColor: colors.brandRed,
  },
  calendarDateText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    color: colors.textSecondary,
  },
  calendarDateTextToday: {
    color: colors.brandWhite,
  },
  calendarCompletedNumber: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 8,
    lineHeight: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  calendarLegend: {
    marginTop: 16,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendCompleted: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendToday: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.brandRed,
  },
  legendText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 8,
    letterSpacing: 0.5,
    color: colors.textMuted,
  },
  calendarInstruction: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 13,
  },
  pressed: {
    opacity: 0.65,
  },
});
