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
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';
import {
  getDashboardSnapshot,
} from '../../src/services/weeklyPlanService';
import {
  getCurrentProfile,
} from '../../src/services/profileService';
import {
  reloadWorkoutSession,
} from '../../src/services/workoutService';
import {
  useWorkout,
} from '../../src/contexts/WorkoutContext';
import DashboardHistoryCalendar from '../../src/components/dashboard/DashboardHistoryCalendar';
import AddToUgerodCard from '../../src/components/dashboard/AddToUgerodCard';

const dashboardBackground = require('../../assets/backgrounds/welcome-default.jpg');
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

function parseDateKey(dateKey) {
  const [year, month, day] =
    String(dateKey ?? '')
      .split('-')
      .map(Number);

  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(
    year,
    month - 1,
    day
  );

  date.setHours(0, 0, 0, 0);
  return date;
}

function getMonday(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);

  const day = result.getDay();
  const difference =
    day === 0 ? 6 : day - 1;

  result.setDate(
    result.getDate() - difference
  );

  return result;
}

function createFallbackWeek() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monday = getMonday(today);

  return Array.from(
    { length: 7 },
    (_, index) => {
      const date = new Date(monday);
      date.setDate(
        monday.getDate() + index
      );
      date.setHours(0, 0, 0, 0);

      return {
        key: formatDateKey(date),
        day: DAY_LABELS[date.getDay()],
        date: String(
          date.getDate()
        ).padStart(2, '0'),
        completed: false,
        sessionId: null,
        today:
          formatDateKey(date) ===
          formatDateKey(today),
      };
    }
  );
}

function createCurrentWeek(weekDays) {
  if (
    !Array.isArray(weekDays) ||
    weekDays.length !== 7
  ) {
    return createFallbackWeek();
  }

  const todayKey =
    formatDateKey(new Date());

  return weekDays.map((item) => {
    const date =
      parseDateKey(item?.date);

    return {
      key:
        item?.date ??
        `day-${Math.random()}`,
      day: date
        ? DAY_LABELS[date.getDay()]
        : '',
      date: date
        ? String(
            date.getDate()
          ).padStart(2, '0')
        : '--',
      completed:
        Boolean(item?.completed),
      sessionId:
        item?.session_id ?? null,
      today:
        item?.date === todayKey,
    };
  });
}

function getCurrentMonthLabel() {
  return new Date()
    .toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    })
    .toUpperCase();
}

function formatSessionDate(dateKey) {
  const date =
    parseDateKey(dateKey);

  if (!date) {
    return 'DERNIÈRE SÉANCE';
  }

  return date
    .toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    })
    .replace(/\./g, '')
    .toUpperCase();
}

function formatMonthName(dateKey) {
  const date =
    parseDateKey(dateKey);

  if (!date) {
    return 'CE MOIS';
  }

  return date
    .toLocaleDateString('fr-FR', {
      month: 'long',
    })
    .toUpperCase();
}

function humanizeDashboardLabel(value) {
  if (!value) {
    return null;
  }

  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function formatLastWorkoutSummary(session) {
  if (!session) {
    return 'SÉANCE TERMINÉE';
  }

  const mechanic =
    humanizeDashboardLabel(
      session?.mechanic
    );
  const dominant =
    humanizeDashboardLabel(
      session?.target_region ??
        session?.focus
    );

  if (mechanic && dominant) {
    return `${mechanic} · ${dominant}`;
  }

  return (
    mechanic ??
    dominant ??
    'SÉANCE TERMINÉE'
  );
}

export default function DashboardScreen() {
  const { width } =
    useWindowDimensions();

  const {
    setGeneratedWorkout,
  } = useWorkout();

  const [snapshot, setSnapshot] =
    useState(null);
  const [firstName, setFirstName] =
    useState('');
  const [loading, setLoading] =
    useState(true);
  const [refreshing, setRefreshing] =
    useState(false);
  const [loadError, setLoadError] =
    useState(null);
  const [showStickyCta, setShowStickyCta] =
    useState(false);
  const [resuming, setResuming] =
    useState(false);
  const [heroBottomY, setHeroBottomY] =
    useState(260);

  const loadDashboard = useCallback(
    async () => {
      try {
        setLoadError(null);

        const [data, profile] =
          await Promise.all([
            getDashboardSnapshot(),
            getCurrentProfile().catch(
              () => null
            ),
          ]);

        setSnapshot(data);
        setFirstName(
          profile?.firstname?.trim() ?? ''
        );
      } catch (error) {
        console.warn(
          'Dashboard E2 snapshot',
          error
        );

        setLoadError(
          error instanceof Error
            ? error.message
            : 'Impossible de charger le tableau de bord.'
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      loadDashboard();
    }, [loadDashboard])
  );

  const handleRefresh = useCallback(
    async () => {
      setRefreshing(true);

      try {
        await loadDashboard();
      } finally {
        setRefreshing(false);
      }
    },
    [loadDashboard]
  );

  const completedSessions =
    snapshot?.completedThisWeek ?? 0;
  const totalCompletedSessions =
    snapshot?.totalCompletedSessions ?? 0;
  const weeklyTarget =
    snapshot?.weeklyTarget ?? 0;
  const consecutiveGoalWeeks =
    snapshot?.consecutiveGoalWeeks ?? 0;
  const hasCompletedWorkout =
    totalCompletedSessions > 0;
  const goalReached =
    weeklyTarget > 0 &&
    completedSessions >= weeklyTarget;
  const week =
    createCurrentWeek(
      snapshot?.weekDays
    );
  const monthLabel =
    getCurrentMonthLabel();
  const lastWorkout =
    snapshot?.recentSessions?.[0] ??
    null;
  const coachNote =
    snapshot?.coachNote?.text ??
    'J’ai préparé quelque chose pour toi aujourd’hui. Fais-moi confiance.';
  const coachHeadline =
    snapshot?.coachNote?.headline ??
    'LE MOT DU COACH';
  const learning =
    snapshot?.profileLearning ?? null;
  const formVisible =
    snapshot?.formSamples7d >= 2 &&
    snapshot?.formTrend7d != null;
  const activeSessionId =
    snapshot?.activeSessionToday
      ?.sessionId ?? null;
  const hasActiveSessionToday =
    Boolean(activeSessionId);
  const monthlyActivity =
    snapshot?.monthlyActivity?.length > 0
      ? snapshot.monthlyActivity
      : [
          {
            monthStart:
              `${new Date().getFullYear()}-${String(
                new Date().getMonth() + 1
              ).padStart(2, '0')}-01`,
            completedSessions: 0,
          },
        ];

  const lastWorkoutSummary =
    formatLastWorkoutSummary(lastWorkout);

  const metricCardWidth =
    useMemo(
      () =>
        Math.max(
          138,
          (width -
            spacing.xl * 2 -
            12) /
            2
        ),
      [width]
    );

  function handleProfile() {
    router.push('/profile');
  }

  async function handlePrimaryAction() {
    if (!activeSessionId) {
      router.push(
        '/workout/preparation'
      );
      return;
    }

    try {
      setResuming(true);

      const restored =
        await reloadWorkoutSession({
          sessionId:
            activeSessionId,
        });

      setGeneratedWorkout(restored);

      router.push(
        '/workout/session'
      );
    } catch (error) {
      console.warn(
        'Dashboard resume session',
        error
      );

      router.push(
        '/workout/preparation'
      );
    } finally {
      setResuming(false);
    }
  }

  function handlePlanning() {
    router.push(
      '/(tabs)/planning'
    );
  }

  function handleDayPress(item) {
    if (
      !item.completed ||
      !item.sessionId
    ) {
      return;
    }

    router.push(
      `/workout/${item.sessionId}`
    );
  }

  function handleLastWorkout() {
    if (!lastWorkout?.session_id) {
      return;
    }

    router.push(
      `/workout/${lastWorkout.session_id}`
    );
  }

  const primaryLabel =
    hasActiveSessionToday
      ? 'REPRENDRE MA SÉANCE'
      : hasCompletedWorkout
        ? 'PRÉPARER MA SÉANCE'
        : 'CRÉER MA PREMIÈRE SÉANCE';

  if (loading && !snapshot) {
    return <DashboardSkeleton />;
  }

  if (loadError && !snapshot) {
    return (
      <View style={styles.screen}>
        <ImageBackground
          source={dashboardBackground}
          style={styles.background}
          resizeMode="cover"
        >
          <View style={styles.darkOverlay} />
          <LinearGradient
            colors={[
              'rgba(7,9,12,0.45)',
              'rgba(7,9,12,0.92)',
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
                onPress={loadDashboard}
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
        source={dashboardBackground}
        style={styles.background}
        resizeMode="cover"
      >
        <View style={styles.darkOverlay} />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.32)',
            'rgba(7,9,12,0.20)',
            'rgba(7,9,12,0.70)',
            'rgba(7,9,12,0.98)',
          ]}
          locations={[0, 0.3, 0.62, 1]}
          style={StyleSheet.absoluteFill}
        />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.55)',
            'rgba(7,9,12,0.08)',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <ScrollView
            contentContainerStyle={
              styles.content
            }
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.primaryLight}
                colors={[colors.primaryLight]}
                progressBackgroundColor={colors.surface}
              />
            }
            scrollEventThrottle={16}
            onScroll={(event) => {
              const offset =
                event.nativeEvent
                  .contentOffset.y;

              setShowStickyCta(
                offset >
                  Math.max(
                    220,
                    heroBottomY - 8
                  )
              );
            }}
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
                <Text style={styles.greeting}>
                  {firstName
                    ? `BONJOUR ${firstName.toUpperCase()}`
                    : 'BONJOUR'}
                </Text>

                <Text style={styles.name}>
                  {hasCompletedWorkout
                    ? 'PRÊT À T’ENTRAÎNER ?'
                    : 'PRÊT À COMMENCER ?'}
                </Text>
              </View>

              <Image
                source={brandIcon}
                style={styles.brandIcon}
                resizeMode="contain"
              />
            </View>

            {!hasCompletedWorkout ? (
              <>
                {learning?.visible && (
                  <LearningCard
                    learning={learning}
                    featured
                  />
                )}

                <View
                  style={styles.firstWorkoutCard}
                  onLayout={(event) => {
                    const { y, height: cardHeight } =
                      event.nativeEvent.layout;
                    setHeroBottomY(
                      y + cardHeight
                    );
                  }}
                >
                  <View style={styles.firstWorkoutTop}>
                    <View style={styles.firstBadge}>
                      <Ionicons
                        name="flag-outline"
                        size={15}
                        color={colors.brandWhite}
                      />

                      <Text style={styles.firstBadgeText}>
                        PREMIÈRE SÉANCE
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.firstWorkoutTitle}>
                    PRÊT À DÉCOUVRIR
                    {'\n'}
                    TA PREMIÈRE SÉANCE
                    <Text style={styles.blueDot}>.</Text>
                  </Text>

                  <CoachNote
                    headline={coachHeadline}
                    note={coachNote}
                  />

                  <PrimaryButton
                    label={primaryLabel}
                    loading={resuming}
                    onPress={handlePrimaryAction}
                    style={styles.heroPrimaryButton}
                  />
                </View>

                <DashboardHistoryCalendar
                  week={week}
                  completed={completedSessions}
                  target={weeklyTarget}
                  reached={goalReached}
                  initialMonthSessions={snapshot?.monthSessions}
                  onCompletedDayPress={handleDayPress}
                />

                <AddToUgerodCard />
              </>
            ) : (
              <>
                {learning?.visible && (
                  <LearningCard
                    learning={learning}
                    featured
                  />
                )}

                <View
                  style={styles.workoutCard}
                  onLayout={(event) => {
                    const { y, height: cardHeight } =
                      event.nativeEvent.layout;
                    setHeroBottomY(
                      y + cardHeight
                    );
                  }}
                >
                  <View style={styles.workoutTopLine}>
                    <View style={styles.redMarker} />

                    <Text style={styles.cardEyebrow}>
                      SÉANCE DU JOUR
                    </Text>
                  </View>

                  <Text style={styles.workoutTitle}>
                    PRÊT À DÉCOUVRIR
                    {'\n'}
                    TA SÉANCE
                    <Text style={styles.blueDot}>.</Text>
                  </Text>

                  <CoachNote
                    headline={coachHeadline}
                    note={coachNote}
                  />

                  <PrimaryButton
                    label={primaryLabel}
                    loading={resuming}
                    onPress={handlePrimaryAction}
                    style={styles.heroPrimaryButton}
                  />
                </View>

                <DashboardHistoryCalendar
                  week={week}
                  completed={completedSessions}
                  target={weeklyTarget}
                  reached={goalReached}
                  initialMonthSessions={snapshot?.monthSessions}
                  onCompletedDayPress={handleDayPress}
                />

                <View style={styles.regularitySection}>
                  <Text style={styles.sectionTitle}>
                    TA RÉGULARITÉ
                  </Text>

                  <View style={styles.metricsGrid}>
                    <StreakMetricCard
                      width={metricCardWidth}
                      weeks={consecutiveGoalWeeks}
                    />

                    <MonthMetricCarousel
                      width={metricCardWidth}
                      months={monthlyActivity}
                    />
                  </View>
                </View>

                <AddToUgerodCard />

                {formVisible && (
                  <View style={styles.formSection}>
                    <Text style={styles.sectionTitle}>
                      FORME 7 JOURS
                    </Text>

                    <View style={styles.formCard}>
                      <View>
                        <Text style={styles.formValue}>
                          {snapshot.formTrend7d.toFixed(1).replace('.', ',')}
                          <Text style={styles.formTarget}> / 10</Text>
                        </Text>
                        <Text style={styles.formLabel}>
                          FORME MOYENNE
                        </Text>
                      </View>

                      <Ionicons
                        name="pulse-outline"
                        size={25}
                        color={colors.primaryLight}
                      />
                    </View>
                  </View>
                )}

                {lastWorkout && (
                  <View style={styles.lastWorkoutSection}>
                    <Text style={styles.sectionTitle}>
                      DERNIÈRE SÉANCE
                    </Text>

                    <Pressable
                      onPress={handleLastWorkout}
                      style={({ pressed }) => [
                        styles.lastWorkoutCard,
                        pressed && styles.lastWorkoutCardPressed,
                      ]}
                    >
                      <View style={styles.lastWorkoutLeft}>
                        <View style={styles.completedIcon}>
                          <Ionicons
                            name="checkmark"
                            size={17}
                            color={colors.brandWhite}
                          />
                        </View>

                        <View style={styles.lastWorkoutText}>
                          <Text style={styles.lastWorkoutDate}>
                            {formatSessionDate(lastWorkout.date)}
                          </Text>
                          <Text
                            style={styles.lastWorkoutStatus}
                            numberOfLines={1}
                          >
                            {lastWorkoutSummary}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.lastWorkoutLink}>
                        <Text style={styles.lastWorkoutLinkText}>
                          RÉCAP
                        </Text>
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color={colors.primaryLight}
                        />
                      </View>
                    </Pressable>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {showStickyCta && (
            <View style={styles.stickyCtaShell}>
              <Pressable
                disabled={resuming}
                onPress={handlePrimaryAction}
                style={({ pressed }) => [
                  styles.stickyCta,
                  pressed && styles.primaryButtonPressed,
                ]}
              >
                {resuming ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.brandWhite}
                  />
                ) : (
                  <>
                    <Text style={styles.stickyCtaText}>
                      {primaryLabel}
                    </Text>
                    <Ionicons
                      name="arrow-forward"
                      size={18}
                      color={colors.brandWhite}
                    />
                  </>
                )}
              </Pressable>
            </View>
          )}
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function DashboardSkeleton() {
  return (
    <View style={styles.screen}>
      <ImageBackground
        source={dashboardBackground}
        style={styles.background}
        resizeMode="cover"
      >
        <View style={styles.darkOverlay} />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.38)',
            'rgba(7,9,12,0.72)',
            'rgba(7,9,12,0.98)',
          ]}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <View style={styles.skeletonContent}>
            <View style={styles.skeletonHeader}>
              <View style={styles.skeletonAvatar} />

              <View style={styles.skeletonHeaderText}>
                <View
                  style={[
                    styles.skeletonLine,
                    styles.skeletonLineShort,
                  ]}
                />
                <View
                  style={[
                    styles.skeletonLine,
                    styles.skeletonLineMedium,
                  ]}
                />
              </View>

              <View style={styles.skeletonLogo} />
            </View>

            <View style={styles.skeletonHero}>
              <View
                style={[
                  styles.skeletonLine,
                  styles.skeletonEyebrow,
                ]}
              />
              <View
                style={[
                  styles.skeletonLine,
                  styles.skeletonTitle,
                ]}
              />
              <View
                style={[
                  styles.skeletonLine,
                  styles.skeletonTitleSecondary,
                ]}
              />

              <View style={styles.skeletonCoach}>
                <View style={styles.skeletonCoachIcon} />
                <View style={styles.skeletonCoachText}>
                  <View
                    style={[
                      styles.skeletonLine,
                      styles.skeletonLineShort,
                    ]}
                  />
                  <View
                    style={[
                      styles.skeletonLine,
                      styles.skeletonLineLong,
                    ]}
                  />
                  <View
                    style={[
                      styles.skeletonLine,
                      styles.skeletonLineMedium,
                    ]}
                  />
                </View>
              </View>

              <View style={styles.skeletonButton} />
            </View>

            <View style={styles.skeletonSectionHeader}>
              <View>
                <View
                  style={[
                    styles.skeletonLine,
                    styles.skeletonLineShort,
                  ]}
                />
                <View
                  style={[
                    styles.skeletonLine,
                    styles.skeletonMonth,
                  ]}
                />
              </View>

              <View style={styles.skeletonScore} />
            </View>

            <View style={styles.skeletonWeek} />

            <View style={styles.skeletonMetrics}>
              <View style={styles.skeletonMetricCard} />
              <View style={styles.skeletonMetricCard} />
            </View>
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function StreakMetricCard({
  weeks,
  width,
}) {
  const active = weeks > 0;

  return (
    <View
      style={[
        styles.metricCard,
        { width },
      ]}
    >
      <View style={styles.streakTopLine}>
        <View
          style={[
            styles.streakIcon,
            active &&
              styles.streakIconActive,
          ]}
        >
          <Ionicons
            name={
              active
                ? 'flame'
                : 'flame-outline'
            }
            size={18}
            color={
              active
                ? colors.brandRed
                : colors.textMuted
            }
          />
        </View>

        <Text
          style={[
            styles.metricValue,
            !active &&
              styles.metricValueMuted,
          ]}
        >
          {active ? weeks : '—'}
        </Text>
      </View>

      <Text style={styles.metricLabel}>
        {active
          ? weeks === 1
            ? 'SEMAINE D’AFFILÉE'
            : 'SEMAINES D’AFFILÉE'
          : 'SÉRIE À CONSTRUIRE'}
      </Text>
    </View>
  );
}

function PrimaryButton({
  label,
  loading,
  onPress,
  style,
}) {
  return (
    <Pressable
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        style,
        pressed && styles.primaryButtonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={colors.brandWhite}
        />
      ) : (
        <>
          <Text style={styles.primaryButtonText}>
            {label}
          </Text>
          <Ionicons
            name="arrow-forward"
            size={19}
            color={colors.brandWhite}
          />
        </>
      )}
    </Pressable>
  );
}

function CoachNote({
  headline,
  note,
}) {
  return (
    <View style={styles.coachBubble}>
      <View style={styles.coachBubbleIcon}>
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={20}
          color={colors.primaryLight}
        />
      </View>

      <View style={styles.coachBubbleMain}>
        <Text style={styles.coachNoteLabel}>
          {headline}
        </Text>
        <Text style={styles.coachNoteText}>
          {note}
        </Text>
      </View>
    </View>
  );
}

function WeekScore({
  completed,
  target,
  reached,
}) {
  return (
    <View style={styles.weekScore}>
      <Text
        style={[
          styles.weekScoreValue,
          {
            color: reached
              ? colors.primaryLight
              : colors.brandRed,
          },
        ]}
      >
        {completed}
      </Text>
      <Text style={styles.weekScoreDivider}>/</Text>
      <Text style={styles.weekScoreTarget}>
        {target}
      </Text>
    </View>
  );
}

function WeekCard({
  week,
  interactive,
  onDayPress,
  compact = false,
}) {
  const Wrapper = compact
    ? styles.firstWeekCard
    : styles.weekCard;

  return (
    <View style={Wrapper}>
      {week.map((item) => (
        <Pressable
          key={item.key}
          disabled={!interactive || !item.completed}
          onPress={() => onDayPress(item)}
          style={[
            styles.dayItem,
            item.today && styles.dayItemToday,
          ]}
        >
          <Text
            style={[
              styles.dayName,
              item.today && styles.dayNameToday,
            ]}
          >
            {item.day}
          </Text>

          <View
            style={[
              styles.dateCircle,
              item.completed && styles.dateCircleCompleted,
              item.today &&
                !item.completed &&
                styles.dateCircleToday,
            ]}
          >
            {item.completed ? (
              <Ionicons
                name="checkmark"
                size={17}
                color={colors.brandWhite}
              />
            ) : (
              <Text
                style={[
                  styles.dateText,
                  item.today && styles.dateTextToday,
                ]}
              >
                {item.date}
              </Text>
            )}
          </View>

          {item.today && (
            <View style={styles.todayDot} />
          )}
        </Pressable>
      ))}
    </View>
  );
}

function MetricCard({
  value,
  label,
  width,
}) {
  return (
    <View
      style={[
        styles.metricCard,
        { width },
      ]}
    >
      <Text style={styles.metricValue}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>
        {label}
      </Text>
    </View>
  );
}

function MonthMetricCarousel({
  months,
  width,
}) {
  const [index, setIndex] =
    useState(0);

  return (
    <View
      style={[
        styles.monthCarousel,
        { width },
      ]}
    >
      <ScrollView
        horizontal
        pagingEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          const next = Math.round(
            event.nativeEvent.contentOffset.x /
              width
          );
          setIndex(next);
        }}
      >
        {months.map((item) => (
          <View
            key={item.monthStart}
            style={[
              styles.monthMetricPage,
              { width },
            ]}
          >
            <Text style={styles.metricValue}>
              {item.completedSessions}
            </Text>
            <Text style={styles.metricLabel}>
              SÉANCES EN {formatMonthName(item.monthStart)}
            </Text>
          </View>
        ))}
      </ScrollView>

      {months.length > 1 && (
        <View style={styles.carouselDots}>
          {months.slice(0, 6).map((item, dotIndex) => (
            <View
              key={`dot-${item.monthStart}`}
              style={[
                styles.carouselDot,
                dotIndex === index && styles.carouselDotActive,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function LearningCard({
  learning,
  featured = false,
}) {
  return (
    <View
      style={[
        styles.learningCard,
        featured &&
          styles.learningCardFeatured,
      ]}
    >
      <View style={styles.learningIcon}>
        <Ionicons
          name="sparkles-outline"
          size={20}
          color={colors.primaryLight}
        />
      </View>

      <View style={styles.learningMain}>
        <Text style={styles.learningTitle}>
          {learning.title}
        </Text>
        <Text style={styles.learningText}>
          {learning.text}
        </Text>
      </View>
    </View>
  );
}

function FirstStep({
  number,
  icon,
  title,
  description,
}) {
  return (
    <View style={styles.firstStep}>
      <View style={styles.firstStepNumber}>
        <Text style={styles.firstStepNumberText}>
          {number}
        </Text>
      </View>
      <View style={styles.firstStepIcon}>
        <Ionicons
          name={icon}
          size={18}
          color={colors.primaryLight}
        />
      </View>
      <View style={styles.firstStepMain}>
        <Text style={styles.firstStepTitle}>
          {title}
        </Text>
        <Text style={styles.firstStepDescription}>
          {description}
        </Text>
      </View>
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
    backgroundColor: 'rgba(0,0,0,0.26)',
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 12,
    paddingBottom: 126,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: 12,
    paddingBottom: 40,
  },
  skeletonHeader: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  skeletonAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  skeletonHeaderText: {
    flex: 1,
    gap: 8,
  },
  skeletonLogo: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  skeletonLine: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  skeletonLineShort: {
    width: '34%',
    height: 9,
  },
  skeletonLineMedium: {
    width: '62%',
    height: 12,
  },
  skeletonLineLong: {
    width: '90%',
    height: 11,
  },
  skeletonHero: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderRadius: 19,
    backgroundColor: 'rgba(17,21,26,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  skeletonEyebrow: {
    width: '28%',
    height: 10,
  },
  skeletonTitle: {
    width: '78%',
    height: 25,
    marginTop: 18,
  },
  skeletonTitleSecondary: {
    width: '58%',
    height: 25,
    marginTop: 8,
  },
  skeletonCoach: {
    minHeight: 86,
    marginTop: 20,
    borderRadius: 15,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  skeletonCoachIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  skeletonCoachText: {
    flex: 1,
    gap: 8,
  },
  skeletonButton: {
    height: 52,
    marginTop: 22,
    borderRadius: 12,
    backgroundColor: 'rgba(8,104,255,0.24)',
  },
  skeletonSectionHeader: {
    marginTop: 32,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  skeletonMonth: {
    width: 96,
    height: 17,
    marginTop: 7,
  },
  skeletonScore: {
    width: 54,
    height: 27,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  skeletonWeek: {
    height: 82,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  skeletonMetrics: {
    marginTop: 32,
    flexDirection: 'row',
    gap: 12,
  },
  skeletonMetricCard: {
    flex: 1,
    height: 92,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.07)',
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
    fontSize: 13,
    letterSpacing: 0.8,
    color: colors.textPrimary,
  },
  retryButton: {
    minHeight: 40,
    paddingHorizontal: 18,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.7,
    color: colors.brandWhite,
  },

  header: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  greeting: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1,
    color: colors.textSecondary,
  },
  name: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 23,
    lineHeight: 26,
    letterSpacing: 1.3,
    color: colors.textPrimary,
  },
  brandIcon: {
    width: 46,
    height: 46,
  },
  blueDot: {
    color: colors.primary,
  },

  firstWorkoutCard: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderRadius: 19,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  firstWorkoutTop: {
    flexDirection: 'row',
  },
  firstBadge: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  firstBadgeText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.brandWhite,
  },
  firstWorkoutTitle: {
    ...typography.display,
    fontSize: 36,
    lineHeight: 39,
    letterSpacing: 1.6,
    color: colors.textPrimary,
    marginTop: 16,
  },
  coachBubble: {
    marginTop: 20,
    borderRadius: 15,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.22)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  coachBubbleIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(8,104,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachBubbleMain: {
    flex: 1,
  },
  coachNoteText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 15,
    lineHeight: 21,
    color: colors.textPrimary,
    marginTop: 4,
  },
  heroPrimaryButton: {
    marginTop: 22,
  },

  workoutCard: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderRadius: 19,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  workoutTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  redMarker: {
    width: 4,
    height: 16,
    borderRadius: 2,
    backgroundColor: colors.brandRed,
  },
  cardEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.brandRed,
  },
  workoutTitle: {
    ...typography.display,
    fontSize: 36,
    lineHeight: 39,
    letterSpacing: 1.7,
    color: colors.textPrimary,
    marginTop: 16,
  },
  coachNoteLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.8,
    color: colors.primaryLight,
  },
  primaryButton: {
    height: 52,
    marginTop: 16,
    borderRadius: 12,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },
  primaryButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 18,
    letterSpacing: 1.1,
    color: colors.brandWhite,
  },

  sectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },
  firstCalendarSection: {
    marginTop: 32,
  },
  calendarSection: {
    marginTop: 32,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthLabel: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 22,
    letterSpacing: 1.2,
    color: colors.textSecondary,
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
  weekCard: {
    height: 82,
    borderRadius: 15,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 5,
    paddingVertical: 8,
    flexDirection: 'row',
  },
  firstWeekCard: {
    height: 76,
    borderRadius: 14,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 5,
    paddingVertical: 7,
    flexDirection: 'row',
  },
  dayItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 9,
  },
  dayItemToday: {
    backgroundColor: 'rgba(255,59,59,0.06)',
  },
  dayName: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.3,
    color: colors.textMuted,
  },
  dayNameToday: {
    color: colors.brandRed,
  },
  dateCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCircleCompleted: {
    backgroundColor: colors.primary,
  },
  dateCircleToday: {
    borderWidth: 1.5,
    borderColor: colors.brandRed,
  },
  dateText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    color: colors.textSecondary,
  },
  dateTextToday: {
    color: colors.brandWhite,
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.brandRed,
  },
  weekHint: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
    marginTop: 10,
  },
  planningShortcut: {
    minHeight: 34,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  planningShortcutText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.6,
    color: colors.textMuted,
  },

  regularitySection: {
    marginTop: 32,
  },
  metricsGrid: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 12,
  },
  metricCard: {
    height: 92,
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'space-between',
  },
  streakTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  streakIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakIconActive: {
    backgroundColor: 'rgba(255,59,59,0.10)',
  },
  metricValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 31,
    lineHeight: 33,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  metricValueMuted: {
    color: colors.textMuted,
  },
  metricLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.4,
    color: colors.textSecondary,
  },
  monthCarousel: {
    height: 92,
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  monthMetricPage: {
    height: 90,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  carouselDots: {
    position: 'absolute',
    right: 12,
    top: 12,
    flexDirection: 'row',
    gap: 5,
  },
  carouselDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  carouselDotActive: {
    backgroundColor: colors.primaryLight,
  },

  learningCard: {
    marginTop: 0,
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.22)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  learningCardFeatured: {
    marginBottom: 18,
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: 'rgba(8,104,255,0.11)',
    borderColor: 'rgba(8,104,255,0.30)',
  },
  learningIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(8,104,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  learningMain: {
    flex: 1,
  },
  learningTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.6,
    color: colors.textPrimary,
  },
  learningText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 2,
  },

  formSection: {
    marginTop: 32,
  },
  formCard: {
    minHeight: 78,
    marginTop: 12,
    borderRadius: 15,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  formValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 31,
    lineHeight: 34,
    color: colors.textPrimary,
  },
  formTarget: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 13,
    color: colors.textMuted,
  },
  formLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: colors.textSecondary,
    marginTop: 2,
  },

  lastWorkoutSection: {
    marginTop: 32,
  },
  lastWorkoutCard: {
    height: 64,
    marginTop: 12,
    borderRadius: 15,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lastWorkoutCardPressed: {
    backgroundColor: 'rgba(23,28,34,0.94)',
    transform: [{ scale: 0.99 }],
  },
  lastWorkoutLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 10,
  },
  lastWorkoutText: {
    flex: 1,
  },
  completedIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastWorkoutDate: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.5,
    color: colors.textPrimary,
  },
  lastWorkoutStatus: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.7,
    color: colors.primaryLight,
    marginTop: 2,
  },
  lastWorkoutLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  lastWorkoutLinkText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color: colors.primaryLight,
  },

  firstStepsSection: {
    marginTop: 32,
  },
  firstStepsCard: {
    marginTop: 12,
    borderRadius: 15,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(17,21,26,0.91)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  firstStep: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  firstStepDivider: {
    height: 1,
    marginLeft: 72,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  firstStepNumber: {
    width: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  firstStepNumberText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 15,
    lineHeight: 17,
    color: colors.brandWhite,
  },
  firstStepIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(8,104,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  firstStepMain: {
    flex: 1,
  },
  firstStepTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 0.5,
    color: colors.textPrimary,
  },
  firstStepDescription: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
    marginTop: 1,
  },

  stickyCtaShell: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: 10,
    paddingTop: 8,
  },
  stickyCta: {
    minHeight: 48,
    borderRadius: 13,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 9,
  },
  stickyCtaText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 18,
    letterSpacing: 1.1,
    color: colors.brandWhite,
  },
  pressed: {
    opacity: 0.65,
  },
});