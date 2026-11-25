import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useSegments } from 'expo-router';
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

import { colors } from '../../constants';
import { useWorkout } from '../../contexts/WorkoutContext';
import dashboardHero from '../../assets/dashboard-dark-hero';
import { getCurrentProfile } from '../../services/profileService';
import { getDashboardSnapshot } from '../../services/weeklyPlanService';
import { reloadWorkoutSession } from '../../services/workoutService';
import DashboardHistoryCalendarBase from './DashboardHistoryCalendarBase';

const dashboardBackground = dashboardHero;
const brandIcon = require('../../../assets/branding/ugerod-icon.png');
const builderImage = require('../../../assets/branding/F5F16BEB-9979-4D87-B8E1-4D40B66EB361.jpeg');
const externalWorkoutImage = require('../../../assets/branding/mohamed-fareed-rbSNsoXk-3A-unsplash.jpg');

const DAY_LABELS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];

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
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
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

function NavButton({ icon, label, route, active = false }) {
  return (
    <Pressable
      onPress={() => router.push(route)}
      style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
    >
      <Ionicons
        name={icon}
        size={22}
        color={active ? colors.primaryLight : '#77859A'}
      />
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>
        {label}
      </Text>
      {active ? <View style={styles.navActiveDot} /> : null}
    </Pressable>
  );
}

function CoachCard({ headline, note }) {
  return (
    <View style={styles.coachCard}>
      <View style={styles.coachIcon}>
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={21}
          color={colors.primaryLight}
        />
      </View>

      <View style={styles.coachCopy}>
        <Text style={styles.coachHeadline}>{headline}</Text>
        <Text style={styles.coachNote} numberOfLines={3}>
          {note}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={19} color="#75849A" />
    </View>
  );
}

function CardPhoto({ source, cropStyle }) {
  return (
    <View style={styles.cardPhotoFrame}>
      <Image
        source={source}
        resizeMode="cover"
        style={[styles.cardPhoto, cropStyle]}
      />
    </View>
  );
}

function BuilderWorkoutCard() {
  return (
    <View style={styles.secondaryWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Créer ma séance"
        onPress={() => router.push('/workout/builder')}
        style={({ pressed }) => [styles.secondaryCard, pressed && styles.pressed]}
      >
        <CardPhoto source={builderImage} cropStyle={styles.builderPhotoCrop} />

        <View style={styles.secondaryContent}>
          <View style={styles.secondaryTitleRow}>
            <View style={styles.blueAccent} />
            <Text style={styles.secondaryTitle}>CRÉER MA SÉANCE</Text>
          </View>
          <Text style={styles.secondaryDescription}>
            Compose tes blocs et choisis tes exercices.
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={19} color="#8794A7" />
      </Pressable>
    </View>
  );
}

function ExternalWorkoutCard() {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.secondaryWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.secondaryCard, pressed && styles.pressed]}
      >
        <CardPhoto
          source={externalWorkoutImage}
          cropStyle={styles.externalPhotoCrop}
        />

        <View style={styles.secondaryContent}>
          <View style={styles.secondaryTitleRow}>
            <View style={styles.redAccent} />
            <Text style={styles.secondaryTitle}>TU VIENS DE T’ENTRAÎNER ?</Text>
          </View>
          <Text style={styles.secondaryDescription}>
            Ajoute une séance réalisée ailleurs.
          </Text>
        </View>

        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={19}
          color="#8794A7"
        />
      </Pressable>

      {open ? (
        <View style={styles.externalActions}>
          <Pressable
            onPress={() => router.push('/workout/external')}
            style={({ pressed }) => [
              styles.actionRow,
              pressed && styles.actionRowPressed,
            ]}
          >
            <View style={styles.actionIcon}>
              <Ionicons
                name="barbell-outline"
                size={19}
                color={colors.primaryLight}
              />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>SÉANCE RÉALISÉE</Text>
              <Text style={styles.actionDescription}>
                Box, salle ou entraînement perso.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#75849A" />
          </Pressable>

          <View style={styles.actionDivider} />

          <Pressable
            onPress={() => router.push('/progression/records?add=1')}
            style={({ pressed }) => [
              styles.actionRow,
              pressed && styles.actionRowPressed,
            ]}
          >
            <View style={[styles.actionIcon, styles.actionIconRed]}>
              <Ionicons
                name="trophy-outline"
                size={19}
                color={colors.brandRed}
              />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>RECORD / PR</Text>
              <Text style={styles.actionDescription}>
                Charge, reps, chrono ou référence.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#75849A" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function AdaptiveSpotlight({ learning }) {
  const isLearning = Boolean(learning?.visible);
  const title = isLearning
    ? 'UGEROD APPREND À TE CONNAÎTRE'
    : 'TA PROGRESSION';
  const body = isLearning
    ? learning?.text ??
      learning?.description ??
      'Chaque séance me donne de nouveaux repères pour mieux adapter les suivantes.'
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
          color={isLearning ? colors.primaryLight : '#A7C97C'}
        />
      </View>

      <View style={styles.spotlightCopy}>
        <Text style={styles.spotlightTitle}>{title}</Text>
        <Text style={styles.spotlightBody} numberOfLines={2}>
          {body}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={19} color="#75849A" />
    </Pressable>
  );
}

export default function DarkDashboardScreen() {
  const segments = useSegments();
  const insideTabs = segments?.[0] === '(tabs)';
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
      console.warn('Dark dashboard', loadError);
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
      console.warn('Dark dashboard resume session', resumeError);
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
        <ActivityIndicator size="large" color={colors.primaryLight} />
        <Text style={styles.loadingText}>CHARGEMENT DU DASHBOARD</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            insideTabs && styles.contentInsideTabs,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primaryLight}
              colors={[colors.primaryLight]}
              progressBackgroundColor="#111923"
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
                  'rgba(8,14,20,0.90)',
                  'rgba(8,14,20,0.64)',
                  'rgba(8,14,20,0.18)',
                ]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
              <LinearGradient
                colors={[
                  'rgba(8,14,20,0.06)',
                  'rgba(8,14,20,0.18)',
                  'rgba(8,14,20,0.76)',
                ]}
                locations={[0, 0.58, 1]}
                style={StyleSheet.absoluteFill}
              />

              <View style={styles.heroTopRow}>
                <Pressable
                  onPress={() => router.push('/profile')}
                  style={({ pressed }) => [
                    styles.profileButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name="person-outline"
                    size={21}
                    color={colors.brandWhite}
                  />
                </Pressable>

                <Image
                  source={brandIcon}
                  style={styles.brandIcon}
                  resizeMode="contain"
                />
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
              <ActivityIndicator size="small" color={colors.brandWhite} />
            ) : (
              <>
                <Text style={styles.primaryCtaText}>{primaryLabel}</Text>
                <Ionicons
                  name="arrow-forward"
                  size={24}
                  color={colors.brandWhite}
                />
              </>
            )}
          </Pressable>

          <BuilderWorkoutCard />
          <ExternalWorkoutCard />

          <DashboardHistoryCalendarBase
            week={week}
            completed={completedSessions}
            target={weeklyTarget}
            reached={goalReached}
            initialMonthSessions={snapshot?.monthSessions ?? []}
            onCompletedDayPress={handleCompletedDayPress}
          />

          <AdaptiveSpotlight learning={learning} />

          {error ? (
            <Pressable onPress={loadDashboard} style={styles.inlineError}>
              <Ionicons
                name="cloud-offline-outline"
                size={17}
                color={colors.brandRed}
              />
              <Text style={styles.inlineErrorText}>
                Certaines données n’ont pas été synchronisées. Réessayer.
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      {!insideTabs ? (
        <View style={styles.previewNav}>
          <NavButton icon="home-outline" label="Accueil" route="/(tabs)" active />
          <NavButton
            icon="stats-chart-outline"
            label="Progression"
            route="/(tabs)/progression"
          />
          <NavButton
            icon="trophy-outline"
            label="Programmes"
            route="/(tabs)/programmes"
          />
          <NavButton
            icon="barbell-outline"
            label="Bibliothèque"
            route="/(tabs)/library"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0B1219',
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 118,
  },
  contentInsideTabs: {
    paddingBottom: 38,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: '#0B1219',
  },
  loadingText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    letterSpacing: 1,
    color: '#8190A4',
  },
  heroShell: {
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: '#101922',
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
    backgroundColor: 'rgba(12,20,29,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
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
    color: '#9DA9BB',
  },
  greetingLine: {
    width: 34,
    height: 3,
    marginTop: 8,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  heroTitle: {
    marginTop: 16,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 55,
    lineHeight: 56,
    letterSpacing: 1.7,
    color: colors.brandWhite,
    textShadowColor: 'rgba(0,0,0,0.22)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  coachCard: {
    minHeight: 116,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(15,25,35,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(116,141,168,0.22)',
  },
  coachIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,104,255,0.10)',
  },
  coachCopy: {
    flex: 1,
  },
  coachHeadline: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.25,
    color: colors.primaryLight,
  },
  coachNote: {
    marginTop: 6,
    fontFamily: 'Oswald_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#F0F3F7',
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
    backgroundColor: colors.primary,
  },
  primaryCtaPressed: {
    transform: [{ scale: 0.992 }],
    opacity: 0.94,
  },
  primaryCtaDisabled: {
    opacity: 0.68,
  },
  primaryCtaText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 25,
    lineHeight: 29,
    letterSpacing: 1.2,
    color: colors.brandWhite,
  },
  secondaryWrap: {
    marginTop: 14,
  },
  secondaryCard: {
    minHeight: 96,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#121B24',
    borderWidth: 1,
    borderColor: 'rgba(143,158,177,0.18)',
    paddingRight: 14,
  },
  cardPhotoFrame: {
    alignSelf: 'stretch',
    width: 118,
    minHeight: 96,
    overflow: 'hidden',
    backgroundColor: '#0A1016',
  },
  cardPhoto: {
    width: '100%',
    height: '100%',
  },
  builderPhotoCrop: {
    transform: [{ scale: 1.08 }],
  },
  externalPhotoCrop: {
    transform: [{ scale: 1.06 }],
  },
  secondaryContent: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  secondaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  blueAccent: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.primary,
  },
  redAccent: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.brandRed,
  },
  secondaryTitle: {
    flex: 1,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.65,
    color: '#E8EDF3',
  },
  secondaryDescription: {
    marginTop: 6,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: '#8E9AAD',
  },
  externalActions: {
    overflow: 'hidden',
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: '#101821',
    borderWidth: 1,
    borderColor: 'rgba(143,158,177,0.16)',
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
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,104,255,0.10)',
  },
  actionIconRed: {
    backgroundColor: 'rgba(255,59,59,0.08)',
  },
  actionCopy: {
    flex: 1,
  },
  actionTitle: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.55,
    color: '#E8EDF3',
  },
  actionDescription: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 15,
    color: '#7F8C9F',
  },
  actionDivider: {
    height: 1,
    marginLeft: 64,
    backgroundColor: 'rgba(255,255,255,0.055)',
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
    backgroundColor: '#121B24',
    borderWidth: 1,
    borderColor: 'rgba(143,158,177,0.16)',
  },
  spotlightIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  spotlightCopy: {
    flex: 1,
  },
  spotlightTitle: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.75,
    color: '#F0F3F7',
  },
  spotlightBody: {
    marginTop: 5,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: '#8E9AAD',
  },
  inlineError: {
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 14,
    backgroundColor: 'rgba(255,59,59,0.06)',
  },
  inlineErrorText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: '#B8C1CD',
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
    backgroundColor: 'rgba(11,18,25,0.98)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(143,158,177,0.16)',
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
    color: '#77859A',
  },
  navLabelActive: {
    color: colors.primaryLight,
  },
  navActiveDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primaryLight,
  },
  pressed: {
    opacity: 0.78,
  },
});
