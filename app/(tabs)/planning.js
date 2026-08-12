import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useCallback,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';
import { getDashboardSnapshot } from '../../src/services/weeklyPlanService';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

const DAY_LABELS = [
  'DIM',
  'LUN',
  'MAR',
  'MER',
  'JEU',
  'VEN',
  'SAM',
];

const CALENDAR_DAY_LABELS = [
  'L',
  'M',
  'M',
  'J',
  'V',
  'S',
  'D',
];

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey ?? '')
    .split('-')
    .map(Number);

  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getMonday(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);

  const day = result.getDay();
  const difference = day === 0 ? 6 : day - 1;
  result.setDate(result.getDate() - difference);

  return result;
}

function createFallbackWeek() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = getMonday(today);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    date.setHours(0, 0, 0, 0);

    return {
      key: formatDateKey(date),
      day: DAY_LABELS[date.getDay()],
      number: String(date.getDate()).padStart(2, '0'),
      completed: false,
      sessionId: null,
      today: formatDateKey(date) === formatDateKey(today),
      date,
    };
  });
}

function createWeek(weekDays) {
  if (!Array.isArray(weekDays) || weekDays.length !== 7) {
    return createFallbackWeek();
  }

  const todayKey = formatDateKey(new Date());

  return weekDays.map((item) => {
    const date = parseDateKey(item?.date);

    return {
      key: item?.date ?? String(Math.random()),
      day: date ? DAY_LABELS[date.getDay()] : '',
      number: date
        ? String(date.getDate()).padStart(2, '0')
        : '--',
      completed: Boolean(item?.completed),
      sessionId: item?.session_id ?? null,
      today: item?.date === todayKey,
      date,
    };
  });
}

function getWeekMonthLabel(week) {
  if (!week.length || !week[0]?.date || !week[6]?.date) {
    return '';
  }

  const firstDay = week[0].date;
  const lastDay = week[6].date;

  const firstMonth = firstDay.toLocaleDateString('fr-FR', {
    month: 'long',
  });

  const lastMonth = lastDay.toLocaleDateString('fr-FR', {
    month: 'long',
  });

  const year = lastDay.getFullYear();

  if (firstMonth === lastMonth) {
    return `${firstMonth} ${year}`.toUpperCase();
  }

  return `${firstMonth} — ${lastMonth} ${year}`.toUpperCase();
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

  const firstDayIndex =
    firstDay.getDay() === 0
      ? 6
      : firstDay.getDay() - 1;

  const sessionMap = new Map(
    (Array.isArray(monthSessions) ? monthSessions : [])
      .filter((item) => item?.date)
      .map((item) => [item.date, item])
  );

  const cells = [];

  for (let i = 0; i < firstDayIndex; i += 1) {
    cells.push({
      type: 'empty',
      key: `empty-start-${i}`,
    });
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);

    const dateKey = formatDateKey(date);
    const session = sessionMap.get(dateKey);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    cells.push({
      type: 'day',
      key: dateKey,
      day,
      date,
      dateKey,
      today: date.getTime() === today.getTime(),
      completed: Boolean(session),
      sessionId: session?.session_id ?? null,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      type: 'empty',
      key: `empty-end-${cells.length}`,
    });
  }

  return cells;
}

function formatHistoryDate(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return 'SÉANCE';

  return date
    .toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    })
    .replace(/\./g, '')
    .toUpperCase();
}

function formatHistoryTitle(region) {
  switch (region) {
    case 'Upper':
      return 'UPPER BODY';
    case 'Lower':
      return 'LOWER BODY';
    case 'Core':
      return 'CORE';
    default:
      return 'FULL BODY';
  }
}

function formatMechanic(value) {
  return String(value ?? 'CIRCUIT')
    .replace(/_/g, ' ')
    .toUpperCase();
}

function normalizeHistory(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .slice(0, 3)
    .map((session) => ({
      id: session.session_id,
      day: formatHistoryDate(session.date),
      title: formatHistoryTitle(session.target_region),
      format: formatMechanic(session.mechanic),
      duration: `${session.duration_minutes ?? 45} MIN`,
    }));
}

export default function PlanningScreen() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [displayedMonth, setDisplayedMonth] = useState(new Date());

  const loadPlanning = useCallback(async () => {
    try {
      setLoadError(null);
      const data = await getDashboardSnapshot({
        monthDate: displayedMonth,
      });
      setSnapshot(data);
    } catch (error) {
      console.warn('Planning E snapshot', error);
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Impossible de charger le planning.'
      );
    } finally {
      setLoading(false);
    }
  }, [displayedMonth]);

  useFocusEffect(
    useCallback(() => {
      loadPlanning();
    }, [loadPlanning])
  );

  const week = createWeek(snapshot?.weekDays);
  const weekMonthLabel = getWeekMonthLabel(week);

  const monthCells = useMemo(
    () =>
      createMonthCalendar(
        displayedMonth,
        snapshot?.monthSessions
      ),
    [displayedMonth, snapshot?.monthSessions]
  );

  const history = useMemo(
    () => normalizeHistory(snapshot?.recentSessions),
    [snapshot?.recentSessions]
  );

  const completedSessions = snapshot?.completedThisWeek ?? 0;
  const weeklyTarget = snapshot?.weeklyTarget ?? 0;
  const goalReached =
    weeklyTarget > 0 && completedSessions >= weeklyTarget;
  const remainingSessions = Math.max(
    0,
    weeklyTarget - completedSessions
  );

  function handleProfile() {
    router.push('/profile');
  }

  function handlePrepareWorkout() {
    router.push('/workout/preparation');
  }

  function handleCompletedDay(item) {
    if (!item.completed || !item.sessionId) {
      return;
    }

    router.push(`/workout/${item.sessionId}`);
  }

  function handleHistoryPress(session) {
    if (!session?.id) return;
    router.push(`/workout/${session.id}`);
  }

  function handleCalendarDayPress(item) {
    if (
      item.type !== 'day' ||
      !item.completed ||
      !item.sessionId
    ) {
      return;
    }

    router.push(`/workout/${item.sessionId}`);
  }

  function goPreviousMonth() {
    setDisplayedMonth((current) =>
      new Date(
        current.getFullYear(),
        current.getMonth() - 1,
        1
      )
    );
  }

  function goNextMonth() {
    setDisplayedMonth((current) =>
      new Date(
        current.getFullYear(),
        current.getMonth() + 1,
        1
      )
    );
  }

  function goToday() {
    setDisplayedMonth(new Date());
  }

  if (loading && !snapshot) {
    return (
      <View style={styles.screen}>
        <ImageBackground
          source={backgroundImage}
          resizeMode="cover"
          style={styles.background}
        >
          <View style={styles.darkOverlay} />
          <LinearGradient
            colors={[
              'rgba(7,9,12,0.45)',
              'rgba(7,9,12,0.96)',
            ]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.loadingState}>
            <ActivityIndicator
              size="small"
              color={colors.primaryLight}
            />
          </View>
        </ImageBackground>
      </View>
    );
  }

  if (loadError && !snapshot) {
    return (
      <View style={styles.screen}>
        <ImageBackground
          source={backgroundImage}
          resizeMode="cover"
          style={styles.background}
        >
          <View style={styles.darkOverlay} />
          <LinearGradient
            colors={[
              'rgba(7,9,12,0.45)',
              'rgba(7,9,12,0.96)',
            ]}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.errorState}>
              <Ionicons
                name="cloud-offline-outline"
                size={28}
                color={colors.textSecondary}
              />
              <Text style={styles.errorTitle}>
                SYNCHRONISATION IMPOSSIBLE
              </Text>
              <Pressable
                onPress={loadPlanning}
                style={styles.retryButton}
              >
                <Text style={styles.retryButtonText}>
                  RÉESSAYER
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </ImageBackground>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={backgroundImage}
        resizeMode="cover"
        style={styles.background}
      >
        <View style={styles.darkOverlay} />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.34)',
            'rgba(7,9,12,0.52)',
            'rgba(7,9,12,0.82)',
            'rgba(7,9,12,0.98)',
          ]}
          locations={[0, 0.22, 0.58, 1]}
          style={StyleSheet.absoluteFill}
        />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.48)',
            'rgba(7,9,12,0.05)',
            'rgba(7,9,12,0.28)',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <Pressable
                onPress={handleProfile}
                style={({ pressed }) => [
                  styles.profileButton,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name="person-outline"
                  size={21}
                  color={colors.textPrimary}
                />
              </Pressable>

              <View style={styles.headerText}>
                <Text style={styles.headerEyebrow}>
                  TON RYTHME
                </Text>

                <Text style={styles.headerTitle}>
                  PLANNING
                  <Text style={styles.blueDot}>.</Text>
                </Text>
              </View>

              <Image
                source={brandIcon}
                style={styles.brandIcon}
                resizeMode="contain"
              />
            </View>

            <View style={styles.goalCard}>
              <View style={styles.goalLeft}>
                <Text style={styles.goalEyebrow}>
                  OBJECTIF DE LA SEMAINE
                </Text>

                <View style={styles.goalScore}>
                  <Text
                    style={[
                      styles.goalCurrent,
                      {
                        color: goalReached
                          ? colors.primaryLight
                          : colors.brandRed,
                      },
                    ]}
                  >
                    {completedSessions}
                  </Text>

                  <Text style={styles.goalDivider}>/</Text>

                  <Text style={styles.goalTarget}>
                    {weeklyTarget}
                  </Text>
                </View>
              </View>

              <View style={styles.goalRight}>
                <View style={styles.goalIcon}>
                  <Ionicons
                    name={
                      goalReached
                        ? 'checkmark'
                        : 'fitness-outline'
                    }
                    size={21}
                    color={
                      goalReached
                        ? colors.primaryLight
                        : colors.textPrimary
                    }
                  />
                </View>

                <Text style={styles.goalMessage}>
                  {goalReached
                    ? 'OBJECTIF ATTEINT'
                    : `${remainingSessions} ${
                        remainingSessions === 1
                          ? 'SÉANCE'
                          : 'SÉANCES'
                      } À TON RYTHME`}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.calendarTitleRow}>
                <View>
                  <Text style={styles.sectionTitle}>
                    CETTE SEMAINE
                  </Text>

                  <Text style={styles.monthLabel}>
                    {weekMonthLabel}
                  </Text>
                </View>

                <Pressable
                  onPress={() =>
                    setCalendarOpen((current) => !current)
                  }
                  style={({ pressed }) => [
                    styles.calendarButton,
                    calendarOpen && styles.calendarButtonActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={calendarOpen ? 'close' : 'calendar-outline'}
                    size={21}
                    color={
                      calendarOpen
                        ? colors.primaryLight
                        : colors.textSecondary
                    }
                  />
                </Pressable>
              </View>

              <View style={styles.weekCard}>
                {week.map((item) => (
                  <Pressable
                    key={item.key}
                    onPress={() => handleCompletedDay(item)}
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
                        item.today &&
                          !item.completed &&
                          styles.dayCircleToday,
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
                          {item.number}
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

                    <Pressable
                      onPress={goToday}
                      style={styles.calendarMonthCenter}
                    >
                      <Text style={styles.fullCalendarMonth}>
                        {getMonthLabel(displayedMonth)}
                      </Text>

                      <Text style={styles.todayShortcut}>
                        AUJOURD’HUI
                      </Text>
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

                  <View style={styles.calendarGrid}>
                    {monthCells.map((item) => {
                      if (item.type === 'empty') {
                        return (
                          <View
                            key={item.key}
                            style={styles.calendarCell}
                          />
                        );
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
                              item.completed &&
                                styles.calendarDateCompleted,
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
                                  item.today &&
                                    styles.calendarDateTextToday,
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

                  <View style={styles.calendarLegend}>
                    <View style={styles.legendItem}>
                      <View style={styles.legendCompleted}>
                        <Ionicons
                          name="checkmark"
                          size={11}
                          color={colors.brandWhite}
                        />
                      </View>

                      <Text style={styles.legendText}>
                        SÉANCE RÉALISÉE
                      </Text>
                    </View>

                    <View style={styles.legendItem}>
                      <View style={styles.legendToday} />

                      <Text style={styles.legendText}>
                        AUJOURD’HUI
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.calendarInstruction}>
                    Appuie sur un jour coché pour revoir la séance réalisée.
                  </Text>
                </View>
              )}

              <Text style={styles.calendarHint}>
                Les jours sans séance restent libres. UGEROD s’adapte à ton rythme réel.
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                PROCHAINE SÉANCE
              </Text>

              <View style={styles.nextWorkoutCard}>
                <View style={styles.nextWorkoutIcon}>
                  <Ionicons
                    name="flash-outline"
                    size={23}
                    color={colors.primaryLight}
                  />
                </View>

                <View style={styles.nextWorkoutText}>
                  <Text style={styles.nextWorkoutTitle}>
                    PRÊTE QUAND TU L’ES
                  </Text>

                  <Text style={styles.nextWorkoutDescription}>
                    Pas de jour imposé. Lance ta prochaine séance quand ton emploi du temps le permet.
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={handlePrepareWorkout}
                style={({ pressed }) => [
                  styles.prepareButton,
                  pressed && styles.prepareButtonPressed,
                ]}
              >
                <Text style={styles.prepareButtonText}>
                  PRÉPARER MA SÉANCE
                </Text>

                <Ionicons
                  name="arrow-forward"
                  size={19}
                  color={colors.brandWhite}
                />
              </Pressable>
            </View>

            <View style={styles.section}>
              <View style={styles.historyHeader}>
                <Text style={styles.sectionTitle}>
                  HISTORIQUE
                </Text>

                <Text style={styles.historyCount}>
                  {history.length} DERNIÈRES
                </Text>
              </View>

              {history.length > 0 ? (
                <View style={styles.historyList}>
                  {history.map((session) => (
                    <Pressable
                      key={session.id}
                      onPress={() => handleHistoryPress(session)}
                      style={({ pressed }) => [
                        styles.historyCard,
                        pressed && styles.historyCardPressed,
                      ]}
                    >
                      <View style={styles.historyCheck}>
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color={colors.brandWhite}
                        />
                      </View>

                      <View style={styles.historyMain}>
                        <Text style={styles.historyDate}>
                          {session.day}
                        </Text>

                        <Text style={styles.historyTitle}>
                          {session.title}
                        </Text>

                        <View style={styles.historyMeta}>
                          <Text style={styles.historyMetaText}>
                            {session.format}
                          </Text>

                          <View style={styles.metaDot} />

                          <Text style={styles.historyMetaText}>
                            {session.duration}
                          </Text>
                        </View>
                      </View>

                      <Ionicons
                        name="chevron-forward"
                        size={20}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyHistoryCard}>
                  <Text style={styles.emptyHistoryText}>
                    Tes séances terminées apparaîtront ici.
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.bottomSpace} />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  background: {
    flex: 1,
  },

  safeArea: {
    flex: 1,
  },

  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },

  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 8,
  },

  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: 14,
  },

  errorTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },

  retryButton: {
    minWidth: 130,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  retryButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 17,
    letterSpacing: 1,
    color: colors.brandWhite,
  },

  header: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerText: {
    flex: 1,
  },

  headerEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color: colors.textSecondary,
  },

  headerTitle: {
    ...typography.display,
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 1.7,
    color: colors.textPrimary,
  },

  blueDot: {
    color: colors.primary,
  },

  brandIcon: {
    width: 46,
    height: 46,
  },

  goalCard: {
    minHeight: 114,
    marginTop: 8,
    borderRadius: 18,
    padding: 16,
    backgroundColor: 'rgba(17,21,26,0.91)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  goalLeft: {
    flex: 1,
  },

  goalEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },

  goalScore: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 5,
  },

  goalCurrent: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 42,
    lineHeight: 44,
  },

  goalDivider: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 17,
    color: colors.textMuted,
    marginHorizontal: 5,
  },

  goalTarget: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 30,
    color: colors.textPrimary,
  },

  goalRight: {
    width: 125,
    alignItems: 'flex-end',
  },

  goalIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(7,9,12,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  goalMessage: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.5,
    color: colors.textSecondary,
    textAlign: 'right',
    marginTop: 7,
  },

  section: {
    marginTop: 26,
  },

  sectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },

  calendarTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  monthLabel: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 21,
    lineHeight: 24,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    marginTop: 1,
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

  calendarHint: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textMuted,
    marginTop: 9,
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

  nextWorkoutCard: {
    marginTop: 10,
    minHeight: 98,
    borderRadius: 17,
    padding: 15,
    backgroundColor: 'rgba(17,21,26,0.91)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },

  nextWorkoutIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(8,104,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  nextWorkoutText: {
    flex: 1,
  },

  nextWorkoutTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    lineHeight: 25,
    letterSpacing: 1,
    color: colors.textPrimary,
  },

  nextWorkoutDescription: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 3,
  },

  prepareButton: {
    minHeight: 52,
    marginTop: 10,
    borderRadius: 13,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  prepareButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },

  prepareButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: 1.1,
    color: colors.brandWhite,
  },

  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  historyCount: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.7,
    color: colors.textMuted,
  },

  historyList: {
    marginTop: 10,
    gap: 10,
  },

  historyCard: {
    minHeight: 90,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(17,21,26,0.91)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  historyCardPressed: {
    backgroundColor: 'rgba(23,28,34,0.95)',
    transform: [{ scale: 0.99 }],
  },

  historyCheck: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  historyMain: {
    flex: 1,
  },

  historyDate: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.7,
    color: colors.primaryLight,
  },

  historyTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 21,
    lineHeight: 24,
    letterSpacing: 0.9,
    color: colors.textPrimary,
    marginTop: 2,
  },

  historyMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },

  historyMetaText: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textSecondary,
  },

  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
  },

  emptyHistoryCard: {
    minHeight: 74,
    marginTop: 10,
    borderRadius: 16,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(17,21,26,0.91)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    justifyContent: 'center',
  },

  emptyHistoryText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
  },

  bottomSpace: {
    height: 34,
  },

  pressed: {
    opacity: 0.65,
  },
});