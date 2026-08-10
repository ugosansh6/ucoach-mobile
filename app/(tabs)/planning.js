import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import {
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

/*
 * TEMPORAIRE AVANT SUPABASE
 *
 * Plus tard, cette liste viendra de workout_sessions.
 * date = YYYY-MM-DD
 * sessionId = id réel de la séance
 */
const SESSION_DATES = [
  {
    date: '2026-08-03',
    sessionId: 'session-2',
  },
  {
    date: '2026-08-05',
    sessionId: 'session-1',
  },
  {
    date: '2026-07-31',
    sessionId: 'session-3',
  },
  {
    date: '2026-07-27',
    sessionId: 'session-4',
  },
  {
    date: '2026-07-22',
    sessionId: 'session-5',
  },
  {
    date: '2026-06-18',
    sessionId: 'session-6',
  },
];

const HISTORY = [
  {
    id: 'session-1',
    day: 'MER 05 AOÛT',
    title: 'FULL BODY',
    format: 'AMRAP',
    duration: '45 MIN',
  },
  {
    id: 'session-2',
    day: 'LUN 03 AOÛT',
    title: 'LOWER BODY',
    format: 'FOR TIME',
    duration: '45 MIN',
  },
  {
    id: 'session-3',
    day: 'VEN 31 JUIL',
    title: 'UPPER BODY',
    format: 'EMOM',
    duration: '60 MIN',
  },
];

function formatDateKey(date) {
  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, '0');

  const day = String(
    date.getDate()
  ).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getMonday(date) {
  const result = new Date(date);

  result.setHours(0, 0, 0, 0);

  const day = result.getDay();
  const difference = day === 0 ? 6 : day - 1;

  result.setDate(result.getDate() - difference);

  return result;
}

function createWeek() {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  const monday = getMonday(today);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);

    date.setDate(monday.getDate() + index);
    date.setHours(0, 0, 0, 0);

    const dateKey = formatDateKey(date);

    const session = SESSION_DATES.find(
      (item) => item.date === dateKey
    );

    return {
      key: date.toISOString(),
      day: DAY_LABELS[date.getDay()],
      number: String(date.getDate()).padStart(2, '0'),
      completed: Boolean(session),
      sessionId: session?.sessionId || null,
      today: date.getTime() === today.getTime(),
      date,
    };
  });
}

function getWeekMonthLabel(week) {
  if (!week.length) return '';

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

function createMonthCalendar(displayedMonth) {
  const year = displayedMonth.getFullYear();
  const month = displayedMonth.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  /*
   * JS :
   * dimanche = 0
   *
   * Notre calendrier :
   * lundi = première colonne
   */
  const firstDayIndex =
    firstDay.getDay() === 0
      ? 6
      : firstDay.getDay() - 1;

  const totalDays = lastDay.getDate();

  const cells = [];

  for (let i = 0; i < firstDayIndex; i += 1) {
    cells.push({
      type: 'empty',
      key: `empty-start-${i}`,
    });
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(year, month, day);

    date.setHours(0, 0, 0, 0);

    const dateKey = formatDateKey(date);

    const session = SESSION_DATES.find(
      (item) => item.date === dateKey
    );

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
      sessionId: session?.sessionId || null,
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

export default function PlanningScreen() {
  const week = createWeek();
  const weekMonthLabel = getWeekMonthLabel(week);

  const [calendarOpen, setCalendarOpen] = useState(false);

  const [displayedMonth, setDisplayedMonth] = useState(
    new Date()
  );

  const monthCells = useMemo(
    () => createMonthCalendar(displayedMonth),
    [displayedMonth]
  );

  /*
   * TEMPORAIRE AVANT SUPABASE
   */
  const completedSessions = 2;
  const weeklyTarget = 4;

  const goalReached =
    completedSessions >= weeklyTarget;

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
    setDisplayedMonth((current) => {
      return new Date(
        current.getFullYear(),
        current.getMonth() - 1,
        1
      );
    });
  }

  function goNextMonth() {
    setDisplayedMonth((current) => {
      return new Date(
        current.getFullYear(),
        current.getMonth() + 1,
        1
      );
    });
  }

  function goToday() {
    setDisplayedMonth(new Date());
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={backgroundImage}
        resizeMode="cover"
        style={styles.background}
      >
        {/* VOILE NOIR */}
        <View style={styles.darkOverlay} />

        {/* DÉGRADÉ VERTICAL */}
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

        {/* DÉGRADÉ LATÉRAL */}
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
            {/* HEADER */}
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

            {/* OBJECTIF */}
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

                  <Text style={styles.goalDivider}>
                    /
                  </Text>

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
                    : `${weeklyTarget - completedSessions} SÉANCES À TON RYTHME`}
                </Text>
              </View>
            </View>

            {/* SEMAINE */}
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

                {/* BOUTON CALENDRIER */}
                <Pressable
                  onPress={() =>
                    setCalendarOpen((current) => !current)
                  }
                  style={({ pressed }) => [
                    styles.calendarButton,
                    calendarOpen &&
                      styles.calendarButtonActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={
                      calendarOpen
                        ? 'close'
                        : 'calendar-outline'
                    }
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
                    onPress={() =>
                      handleCompletedDay(item)
                    }
                    style={[
                      styles.dayItem,
                      item.today &&
                        styles.dayItemToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayLabel,
                        item.today &&
                          styles.dayLabelToday,
                      ]}
                    >
                      {item.day}
                    </Text>

                    <View
                      style={[
                        styles.dayCircle,

                        item.completed &&
                          styles.dayCircleCompleted,

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
                            item.today &&
                              styles.dayNumberToday,
                          ]}
                        >
                          {item.number}
                        </Text>
                      )}
                    </View>

                    {item.today && (
                      <View style={styles.todayDot} />
                    )}
                  </Pressable>
                ))}
              </View>

              {/* CALENDRIER DÉPLIANT */}
              {calendarOpen && (
                <View style={styles.fullCalendar}>
                  {/* NAVIGATION MOIS */}
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

                  {/* JOURS SEMAINE */}
                  <View style={styles.calendarWeekLabels}>
                    {CALENDAR_DAY_LABELS.map(
                      (label, index) => (
                        <Text
                          key={`${label}-${index}`}
                          style={styles.calendarWeekLabel}
                        >
                          {label}
                        </Text>
                      )
                    )}
                  </View>

                  {/* GRILLE MOIS */}
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
                          onPress={() =>
                            handleCalendarDayPress(item)
                          }
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
                            <Text
                              style={
                                styles.calendarCompletedNumber
                              }
                            >
                              {item.day}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* LÉGENDE */}
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

            {/* PROCHAINE SÉANCE */}
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
                  pressed &&
                    styles.prepareButtonPressed,
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

            {/* HISTORIQUE */}
            <View style={styles.section}>
              <View style={styles.historyHeader}>
                <Text style={styles.sectionTitle}>
                  HISTORIQUE
                </Text>

                <Text style={styles.historyCount}>
                  {HISTORY.length} DERNIÈRES
                </Text>
              </View>

              <View style={styles.historyList}>
                {HISTORY.map((session) => (
                  <Pressable
                    key={session.id}
                    onPress={() =>
                      handleHistoryPress(session)
                    }
                    style={({ pressed }) => [
                      styles.historyCard,
                      pressed &&
                        styles.historyCardPressed,
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

  /* HEADER */

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

  /* OBJECTIF */

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

  /* SECTIONS */

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

  /* SEMAINE */

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

  /* GRAND CALENDRIER */

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

  /* PROCHAINE SÉANCE */

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

  /* HISTORIQUE */

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

  bottomSpace: {
    height: 34,
  },

  pressed: {
    opacity: 0.65,
  },
});