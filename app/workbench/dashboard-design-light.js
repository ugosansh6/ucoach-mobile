import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { getDashboardSnapshot } from '../../src/services/weeklyPlanService';
import { getCurrentProfile } from '../../src/services/profileService';
import { reloadWorkoutSession } from '../../src/services/workoutService';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import dashboardHero from '../../src/assets/dashboard-light-hero';

const dashboardBackground = dashboardHero;
const brandIcon = require('../../assets/branding/ugerod-icon.png');

const KHAKI = '#646F5E';
const KHAKI_DARK = '#4F594A';
const KHAKI_SOFT = '#E4E8E1';
const ORANGE = '#FF6B19';
const ORANGE_SOFT = '#FFF0E7';
const PAPER = '#F4F2ED';
const SURFACE = '#FFFFFF';
const SURFACE_SOFT = '#ECEAE4';
const TEXT = '#1D211C';
const TEXT_SECONDARY = '#5F655C';
const TEXT_MUTED = '#8A8F86';
const BORDER = 'rgba(54,61,52,0.13)';

const DAY_LABELS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
const CALENDAR_DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

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

  if (!year || !month || !day) return null;

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
      date: String(date.getDate()).padStart(2, '0'),
      completed: false,
      sessionId: null,
      today: formatDateKey(date) === formatDateKey(today),
    };
  });
}

function createCurrentWeek(weekDays) {
  if (!Array.isArray(weekDays) || weekDays.length !== 7) {
    return createFallbackWeek();
  }

  const todayKey = formatDateKey(new Date());

  return weekDays.map((item) => {
    const date = parseDateKey(item?.date);

    return {
      key: item?.date ?? `day-${Math.random()}`,
      day: date ? DAY_LABELS[date.getDay()] : '',
      date: date ? String(date.getDate()).padStart(2, '0') : '--',
      completed: Boolean(item?.completed),
      sessionId: item?.session_id ?? null,
      today: item?.date === todayKey,
    };
  });
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

  for (let index = 0; index < firstDayIndex; index += 1) {
    cells.push({ type: 'empty', key: `empty-start-${index}` });
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

function NavButton({ icon, label, route, active = false }) {
  return (
    <Pressable
      onPress={() => router.push(route)}
      style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
    >
      <Ionicons
        name={icon}
        size={22}
        color={active ? KHAKI : TEXT_MUTED}
      />
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text>
      {active && <View style={styles.navActiveDot} />}
    </Pressable>
  );
}

function CoachCard({ headline, note }) {
  return (
    <View style={styles.coachCard}>
      <View style={styles.coachIcon}>
        <Ionicons name="chatbubble-ellipses-outline" size={21} color={KHAKI} />
      </View>

      <View style={styles.coachCopy}>
        <Text style={styles.coachHeadline}>{headline}</Text>
        <Text style={styles.coachNote} numberOfLines={3}>{note}</Text>
      </View>

      <Ionicons name="chevron-forward" size={19} color={TEXT_MUTED} />
    </View>
  );
}

function ExternalWorkoutCard() {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.externalWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.externalCard, pressed && styles.pressed]}
      >
        <Image source={dashboardBackground} style={styles.externalImage} resizeMode="cover" />

        <View style={styles.externalContent}>
          <View style={styles.externalTitleRow}>
            <View style={styles.orangeAccent} />
            <Text style={styles.externalTitle}>TU VIENS DE T’ENTRAÎNER ?</Text>
          </View>
          <Text style={styles.externalDescription}>Ajoute une séance réalisée ailleurs.</Text>
        </View>

        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={19}
          color={TEXT_MUTED}
        />
      </Pressable>

      {open && (
        <View style={styles.externalActions}>
          <Pressable
            onPress={() => router.push('/workout/external')}
            style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
          >
            <View style={styles.actionIcon}>
              <Ionicons name="barbell-outline" size={19} color={KHAKI} />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>SÉANCE RÉALISÉE</Text>
              <Text style={styles.actionDescription}>Box, salle ou entraînement perso.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={TEXT_MUTED} />
          </Pressable>

          <View style={styles.actionDivider} />

          <Pressable
            onPress={() => router.push('/progression/records?add=1')}
            style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
          >
            <View style={[styles.actionIcon, styles.actionIconOrange]}>
              <Ionicons name="trophy-outline" size={19} color={ORANGE} />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>RECORD / PR</Text>
              <Text style={styles.actionDescription}>Charge, reps, chrono ou référence.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={TEXT_MUTED} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function AdaptiveSpotlight({ learning }) {
  const isLearning = Boolean(learning?.visible);

  const title = isLearning
    ? 'UGEROD APPREND À TE CONNAÎTRE'
    : 'TA PROGRESSION';

  const body = isLearning
    ? learning?.text ?? learning?.description ?? 'Chaque séance me donne de nouveaux repères pour mieux adapter les suivantes.'
    : 'Retrouve ce qui évolue et les prochaines étapes identifiées par ton coach.';

  return (
    <Pressable
      onPress={() => router.push('/(tabs)/progression')}
      style={({ pressed }) => [styles.spotlightCard, pressed && styles.pressed]}
    >
      <View style={styles.spotlightIcon}>
        <Ionicons
          name={isLearning ? 'sparkles-outline' : 'trending-up-outline'}
          size={22}
          color={KHAKI}
        />
      </View>

      <View style={styles.spotlightCopy}>
        <Text style={styles.spotlightTitle}>{title}</Text>
        <Text style={styles.spotlightBody} numberOfLines={2}>{body}</Text>
      </View>

      <Ionicons name="chevron-forward" size={19} color={TEXT_MUTED} />
    </Pressable>
  );
}

function LightHistoryCalendar({
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
    } catch (loadError) {
      console.warn('Light dashboard history calendar month', loadError);
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
    <View style={styles.calendarSection}>
      <View style={styles.calendarTitleRow}>
        <View>
          <Text style={styles.calendarSectionTitle}>CETTE SEMAINE</Text>
          <Text style={styles.calendarMonthLabel}>{getMonthLabel(new Date())}</Text>
        </View>

        <View style={styles.calendarHeaderActions}>
          <View style={styles.weekScore}>
            <Text
              style={[
                styles.weekScoreValue,
                { color: reached ? KHAKI : ORANGE },
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
              color={calendarOpen ? KHAKI : TEXT_SECONDARY}
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
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
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
              style={({ pressed }) => [styles.monthNavigationButton, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-back" size={21} color={TEXT} />
            </Pressable>

            <Pressable onPress={goToday} style={styles.calendarMonthCenter}>
              <Text style={styles.fullCalendarMonth}>{getMonthLabel(displayedMonth)}</Text>
              <Text style={styles.todayShortcut}>AUJOURD’HUI</Text>
            </Pressable>

            <Pressable
              onPress={goNextMonth}
              hitSlop={10}
              style={({ pressed }) => [styles.monthNavigationButton, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-forward" size={21} color={TEXT} />
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
              <ActivityIndicator size="small" color={KHAKI} />
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
                        <Ionicons name="checkmark" size={16} color="#FFFFFF" />
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
                      <Text style={styles.calendarCompletedNumber}>{item.day}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.calendarLegend}>
            <View style={styles.legendItem}>
              <View style={styles.legendCompleted}>
                <Ionicons name="checkmark" size={11} color="#FFFFFF" />
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

export default function DashboardDesignLightWorkbench() {
  const { setGeneratedWorkout } = useWorkout();

  const [snapshot, setSnapshot] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [resuming, setResuming] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);

      const [data, profile] = await Promise.all([
        getDashboardSnapshot(),
        getCurrentProfile().catch(() => null),
      ]);

      setSnapshot(data);
      setFirstName(profile?.firstname?.trim() ?? '');
    } catch (loadError) {
      console.warn('Dashboard light design workbench', loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Impossible de charger le dashboard.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDashboard();
    }, [loadDashboard])
  );

  const week = useMemo(
    () => createCurrentWeek(snapshot?.weekDays),
    [snapshot?.weekDays]
  );

  const completedSessions = snapshot?.completedThisWeek ?? 0;
  const weeklyTarget = snapshot?.weeklyTarget ?? 0;
  const goalReached = weeklyTarget > 0 && completedSessions >= weeklyTarget;
  const learning = snapshot?.profileLearning ?? null;
  const activeSessionId = snapshot?.activeSessionToday?.sessionId ?? null;
  const hasActiveSessionToday = Boolean(activeSessionId);

  const coachNote =
    snapshot?.coachNote?.text ??
    'J’ai préparé quelque chose pour toi aujourd’hui. Fais-moi confiance.';
  const coachHeadline = snapshot?.coachNote?.headline ?? 'LE MOT DU COACH';

  const primaryLabel = hasActiveSessionToday
    ? 'REPRENDRE MA SÉANCE'
    : 'PRÉPARER MA SÉANCE';

  async function handlePrimaryAction() {
    if (!activeSessionId) {
      router.push('/workout/preparation');
      return;
    }

    try {
      setResuming(true);
      const restored = await reloadWorkoutSession({ sessionId: activeSessionId });
      setGeneratedWorkout(restored);
      router.push('/workout/session');
    } catch (resumeError) {
      console.warn('Dashboard light design resume session', resumeError);
      router.push('/workout/preparation');
    } finally {
      setResuming(false);
    }
  }

  function handleCompletedDayPress(item) {
    if (!item.completed || !item.sessionId) return;
    router.push(`/workout/${item.sessionId}`);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadDashboard();
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !snapshot) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={KHAKI} />
        <Text style={styles.loadingText}>CHARGEMENT DU DASHBOARD</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />

      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={KHAKI}
              colors={[KHAKI]}
              progressBackgroundColor={SURFACE}
            />
          }
        >
          <View style={styles.heroShell}>
            <ImageBackground
              source={dashboardBackground}
              resizeMode="cover"
              style={styles.heroImage}
              imageStyle={styles.heroImageAsset}
            >
              <LinearGradient
                colors={[
                  'rgba(247,245,240,0.96)',
                  'rgba(247,245,240,0.72)',
                  'rgba(247,245,240,0.10)',
                ]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
              <LinearGradient
                colors={[
                  'rgba(247,245,240,0.04)',
                  'rgba(247,245,240,0.03)',
                  'rgba(247,245,240,0.74)',
                ]}
                locations={[0, 0.58, 1]}
                style={StyleSheet.absoluteFill}
              />

              <View style={styles.heroTopRow}>
                <Pressable
                  onPress={() => router.push('/profile')}
                  style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
                >
                  <Ionicons name="person-outline" size={21} color={TEXT} />
                </Pressable>

                <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
              </View>

              <View style={styles.heroCopy}>
                <Text style={styles.greeting}>
                  {firstName ? `BONJOUR ${firstName.toUpperCase()}` : 'BONJOUR'}
                </Text>
                <View style={styles.greetingLine} />
                <Text style={styles.heroTitle}>PRÊT À{`\n`}T’ENTRAÎNER ?</Text>
              </View>

              <CoachCard headline={coachHeadline} note={coachNote} />
            </ImageBackground>
          </View>

          <Pressable
            onPress={handlePrimaryAction}
            disabled={resuming}
            style={({ pressed }) => [
              styles.primaryCta,
              pressed && !resuming && styles.primaryCtaPressed,
              resuming && styles.primaryCtaDisabled,
            ]}
          >
            {resuming ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.primaryCtaText}>{primaryLabel}</Text>
                <Ionicons name="arrow-forward" size={24} color="#FFFFFF" />
              </>
            )}
          </Pressable>

          <ExternalWorkoutCard />

          <LightHistoryCalendar
            week={week}
            completed={completedSessions}
            target={weeklyTarget}
            reached={goalReached}
            initialMonthSessions={snapshot?.monthSessions ?? []}
            onCompletedDayPress={handleCompletedDayPress}
          />

          <AdaptiveSpotlight learning={learning} />

          {error && (
            <Pressable onPress={loadDashboard} style={styles.inlineError}>
              <Ionicons name="cloud-offline-outline" size={17} color={ORANGE} />
              <Text style={styles.inlineErrorText}>
                Certaines données n’ont pas été synchronisées. Réessayer.
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>

      <View style={styles.previewNav}>
        <NavButton icon="home-outline" label="Accueil" route="/(tabs)" active />
        <NavButton icon="stats-chart-outline" label="Progression" route="/(tabs)/progression" />
        <NavButton icon="trophy-outline" label="Programmes" route="/(tabs)/programmes" />
        <NavButton icon="barbell-outline" label="Bibliothèque" route="/(tabs)/library" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: PAPER,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 118,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: PAPER,
  },
  loadingText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    letterSpacing: 1,
    color: TEXT_MUTED,
  },
  heroShell: {
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: '#DEDCD6',
    borderWidth: 1,
    borderColor: BORDER,
  },
  heroImage: {
    minHeight: 530,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
    justifyContent: 'space-between',
  },
  heroImageAsset: {
    borderRadius: 24,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.74)',
    borderWidth: 1,
    borderColor: 'rgba(54,61,52,0.14)',
  },
  brandIcon: {
    width: 47,
    height: 47,
  },
  heroCopy: {
    marginTop: 58,
    maxWidth: 330,
  },
  greeting: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1.7,
    color: TEXT_SECONDARY,
  },
  greetingLine: {
    width: 34,
    height: 3,
    marginTop: 8,
    borderRadius: 2,
    backgroundColor: KHAKI,
  },
  heroTitle: {
    marginTop: 16,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 55,
    lineHeight: 56,
    letterSpacing: 1.7,
    color: TEXT,
    textShadowColor: 'rgba(255,255,255,0.20)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  coachCard: {
    minHeight: 116,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(100,111,94,0.20)',
  },
  coachIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: KHAKI_SOFT,
  },
  coachCopy: {
    flex: 1,
  },
  coachHeadline: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.25,
    color: KHAKI_DARK,
  },
  coachNote: {
    marginTop: 6,
    fontFamily: 'Oswald_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: TEXT,
  },
  primaryCta: {
    minHeight: 70,
    marginTop: 16,
    paddingHorizontal: 24,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: KHAKI,
  },
  primaryCtaPressed: {
    transform: [{ scale: 0.992 }],
    opacity: 0.92,
  },
  primaryCtaDisabled: {
    opacity: 0.68,
  },
  primaryCtaText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 25,
    lineHeight: 29,
    letterSpacing: 1.2,
    color: '#FFFFFF',
  },
  externalWrap: {
    marginTop: 14,
  },
  externalCard: {
    minHeight: 92,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    paddingRight: 14,
  },
  externalImage: {
    alignSelf: 'stretch',
    width: 112,
    minHeight: 92,
  },
  externalContent: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  externalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  orangeAccent: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: ORANGE,
  },
  externalTitle: {
    flex: 1,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.65,
    color: TEXT,
  },
  externalDescription: {
    marginTop: 6,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: TEXT_SECONDARY,
  },
  externalActions: {
    overflow: 'hidden',
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  actionRow: {
    minHeight: 69,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionRowPressed: {
    backgroundColor: SURFACE_SOFT,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: KHAKI_SOFT,
  },
  actionIconOrange: {
    backgroundColor: ORANGE_SOFT,
  },
  actionCopy: {
    flex: 1,
  },
  actionTitle: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.55,
    color: TEXT,
  },
  actionDescription: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 15,
    color: TEXT_SECONDARY,
  },
  actionDivider: {
    height: 1,
    marginLeft: 64,
    backgroundColor: BORDER,
  },
  calendarSection: {
    marginTop: 32,
  },
  calendarTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calendarSectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.7,
    color: TEXT,
  },
  calendarMonthLabel: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 21,
    lineHeight: 24,
    letterSpacing: 1.2,
    color: TEXT_SECONDARY,
    marginTop: 1,
  },
  calendarHeaderActions: {
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
    color: TEXT_MUTED,
    marginHorizontal: 3,
  },
  weekScoreTarget: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 21,
    color: TEXT_SECONDARY,
  },
  calendarButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarButtonActive: {
    backgroundColor: KHAKI_SOFT,
    borderColor: 'rgba(100,111,94,0.35)',
  },
  weekCard: {
    minHeight: 94,
    borderRadius: 17,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
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
    backgroundColor: ORANGE_SOFT,
  },
  dayLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.3,
    color: TEXT_MUTED,
  },
  dayLabelToday: {
    color: ORANGE,
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleCompleted: {
    backgroundColor: KHAKI,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: ORANGE,
  },
  dayNumber: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 13,
    color: TEXT_SECONDARY,
  },
  dayNumberToday: {
    color: TEXT,
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: ORANGE,
  },
  fullCalendar: {
    marginTop: 12,
    borderRadius: 18,
    padding: 15,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: 'rgba(100,111,94,0.24)',
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
    backgroundColor: SURFACE_SOFT,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarMonthCenter: {
    alignItems: 'center',
  },
  fullCalendarMonth: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 23,
    lineHeight: 26,
    letterSpacing: 1.1,
    color: TEXT,
  },
  todayShortcut: {
    marginTop: 1,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 8,
    lineHeight: 11,
    letterSpacing: 0.75,
    color: KHAKI,
  },
  calendarWeekLabels: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  calendarWeekLabel: {
    width: '14.2857%',
    textAlign: 'center',
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 8,
    lineHeight: 11,
    color: TEXT_MUTED,
  },
  monthLoading: {
    height: 170,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: '14.2857%',
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDateCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDateToday: {
    borderWidth: 1.5,
    borderColor: ORANGE,
  },
  calendarDateCompleted: {
    backgroundColor: KHAKI,
  },
  calendarDateCompletedToday: {
    borderWidth: 2,
    borderColor: ORANGE,
  },
  calendarDateText: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 11,
    color: TEXT_SECONDARY,
  },
  calendarDateTextToday: {
    color: ORANGE,
  },
  calendarCompletedNumber: {
    marginTop: 2,
    fontFamily: 'Oswald_500Medium',
    fontSize: 7,
    lineHeight: 9,
    color: TEXT_MUTED,
  },
  calendarLegend: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    flexDirection: 'row',
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendCompleted: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: KHAKI,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendToday: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: ORANGE,
  },
  legendText: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 8,
    lineHeight: 11,
    color: TEXT_MUTED,
  },
  calendarInstruction: {
    marginTop: 11,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: TEXT_SECONDARY,
  },
  spotlightCard: {
    minHeight: 106,
    marginTop: 24,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  spotlightIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: KHAKI_SOFT,
  },
  spotlightCopy: {
    flex: 1,
  },
  spotlightTitle: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.75,
    color: TEXT,
  },
  spotlightBody: {
    marginTop: 5,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  inlineError: {
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 14,
    backgroundColor: ORANGE_SOFT,
  },
  inlineErrorText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: TEXT_SECONDARY,
  },
  previewNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 82,
    paddingHorizontal: 10,
    paddingTop: 8,
    flexDirection: 'row',
    backgroundColor: 'rgba(250,249,246,0.98)',
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 4,
  },
  navLabel: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 10,
    lineHeight: 14,
    color: TEXT_MUTED,
  },
  navLabelActive: {
    color: KHAKI_DARK,
  },
  navActiveDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: KHAKI,
  },
  pressed: {
    opacity: 0.78,
  },
});