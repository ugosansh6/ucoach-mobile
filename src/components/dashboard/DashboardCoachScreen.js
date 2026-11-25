import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useSegments } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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

const KAKI = '#646F5E';
const KAKI_LIGHT = '#909C89';
const ORANGE = '#FF6B19';
const BACKGROUND = '#0A0E0C';
const SURFACE = '#111713';
const SURFACE_ELEVATED = '#151D17';
const TEXT = '#F4F5F1';
const TEXT_MUTED = '#98A197';
const BORDER = 'rgba(173,184,170,0.16)';

const brandIcon = require('../../../assets/branding/ugerod-icon.png');

function NavButton({ icon, label, route, active = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(route)}
      style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
    >
      <Ionicons
        name={icon}
        size={22}
        color={active ? KAKI_LIGHT : '#778178'}
      />
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>
        {label}
      </Text>
      {active ? <View style={styles.navActiveDot} /> : null}
    </Pressable>
  );
}

function UgerodTrack() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.track}>
      <View style={[styles.trackSegment, styles.trackSegmentPrimary]} />
      <View style={[styles.trackSegment, styles.trackSegmentSecondary]} />
      <View style={[styles.trackSegment, styles.trackSegmentGhost]} />
    </View>
  );
}

function CoachMessage({ headline, note }) {
  return (
    <View style={styles.coachMessage}>
      <View style={styles.coachMessageRail} />
      <View style={styles.coachMessageCopy}>
        <View style={styles.coachMessageLabelRow}>
          <Ionicons name="chatbubble-ellipses-outline" size={15} color={KAKI_LIGHT} />
          <Text style={styles.coachMessageLabel}>{headline}</Text>
        </View>
        <Text style={styles.coachMessageText}>{note}</Text>
      </View>
    </View>
  );
}

function ContextualSlot({ learning }) {
  if (!learning?.visible) return null;

  const title = learning?.title ?? 'UGEROD APPREND À TE CONNAÎTRE';
  const text =
    learning?.text ??
    'Chaque séance me donne de nouveaux repères pour mieux adapter les suivantes.';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${text}`}
      onPress={() => router.push('/(tabs)/progression')}
      style={({ pressed }) => [styles.contextSlot, pressed && styles.pressed]}
    >
      <View style={styles.contextIcon}>
        <Ionicons name="sparkles-outline" size={19} color={KAKI_LIGHT} />
      </View>
      <View style={styles.contextCopy}>
        <Text style={styles.contextEyebrow}>CE QUI COMPTE EN CE MOMENT</Text>
        <Text style={styles.contextTitle}>{title}</Text>
        <Text style={styles.contextText} numberOfLines={2}>
          {text}
        </Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={TEXT_MUTED} />
    </Pressable>
  );
}

function AddAction({ icon, title, subtitle, onPress, accent = KAKI_LIGHT }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.addAction, pressed && styles.addActionPressed]}
    >
      <View style={styles.addActionIcon}>
        <Ionicons name={icon} size={19} color={accent} />
      </View>
      <View style={styles.addActionCopy}>
        <Text style={styles.addActionTitle}>{title}</Text>
        <Text style={styles.addActionSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#798279" />
    </Pressable>
  );
}

function AddTools({ open, onToggle }) {
  return (
    <View style={styles.addToolsWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ajouter ou créer une séance"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.addLauncher, pressed && styles.pressed]}
      >
        <View style={styles.addLauncherIcon}>
          <Ionicons name={open ? 'close' : 'add'} size={20} color={TEXT} />
        </View>
        <View style={styles.addLauncherCopy}>
          <Text style={styles.addLauncherTitle}>AJOUTER</Text>
          <Text style={styles.addLauncherSubtitle}>
            Créer, enregistrer une séance ou un PR
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={TEXT_MUTED}
        />
      </Pressable>

      {open ? (
        <View style={styles.addPanel}>
          <AddAction
            icon="construct-outline"
            title="CRÉER MA SÉANCE"
            subtitle="Compose tes blocs et choisis tes exercices."
            onPress={() => router.push('/workout/builder')}
          />
          <View style={styles.addDivider} />
          <AddAction
            icon="barbell-outline"
            title="SÉANCE RÉALISÉE AILLEURS"
            subtitle="Box, salle ou entraînement perso."
            onPress={() => router.push('/workout/external')}
          />
          <View style={styles.addDivider} />
          <AddAction
            icon="trophy-outline"
            title="RECORD / PR"
            subtitle="Charge, reps, chrono ou référence."
            accent={ORANGE}
            onPress={() => router.push('/progression/records?add=1')}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function DashboardCoachScreen() {
  const segments = useSegments();
  const insideTabs = segments?.[0] === '(tabs)';
  const { setGeneratedWorkout } = useWorkout();

  const [snapshot, setSnapshot] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [resuming, setResuming] = useState(false);
  const [addToolsOpen, setAddToolsOpen] = useState(false);

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
      console.warn('Coach dashboard', loadError);
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

  const heroEyebrow = hasActiveSessionToday ? 'SÉANCE EN COURS' : 'COACH NOW';
  const heroTitle = hasActiveSessionToday ? 'ON CONTINUE ?' : 'PRÊT À\nT’ENTRAÎNER ?';
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
      console.warn('Coach dashboard resume session', resumeError);
      router.push('/workout/preparation');
    } finally {
      setResuming(false);
    }
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
        <ActivityIndicator size="large" color={KAKI_LIGHT} />
        <Text style={styles.loadingText}>UGEROD PRÉPARE TON COACHING</Text>
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
              tintColor={KAKI_LIGHT}
              colors={[KAKI]}
              progressBackgroundColor={SURFACE}
            />
          }
        >
          <View style={styles.topBar}>
            <View style={styles.brandLockup}>
              <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
              <Text style={styles.brandName}>UGEROD</Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ouvrir mon profil"
              onPress={() => router.push('/profile')}
              style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
            >
              <Ionicons name="person-outline" size={20} color={TEXT} />
            </Pressable>
          </View>

          <View style={styles.heroStage}>
            <View pointerEvents="none" style={styles.heroPhotoWrap}>
              <Image source={dashboardHero} resizeMode="cover" style={styles.heroPhoto} />
              <LinearGradient
                colors={[BACKGROUND, 'rgba(10,14,12,0.80)', 'rgba(10,14,12,0.06)']}
                locations={[0, 0.38, 1]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
              <LinearGradient
                colors={['rgba(10,14,12,0.00)', BACKGROUND]}
                locations={[0.55, 1]}
                style={StyleSheet.absoluteFill}
              />
            </View>

            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>{heroEyebrow}</Text>
              <Text style={styles.heroTitle}>{heroTitle}</Text>
              <UgerodTrack />

              <Text style={styles.greeting}>
                {firstName ? `Bonjour ${firstName}.` : 'Bonjour.'}
              </Text>

              <CoachMessage headline={coachHeadline} note={coachNote} />
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
            onPress={handlePrimaryAction}
            disabled={resuming}
            style={({ pressed }) => [
              styles.primaryCta,
              pressed && !resuming && styles.primaryCtaPressed,
              resuming && styles.primaryCtaDisabled,
            ]}
          >
            <View style={styles.primaryCtaAccent} />
            {resuming ? (
              <ActivityIndicator size="small" color={TEXT} />
            ) : (
              <>
                <Text style={styles.primaryCtaText}>{primaryLabel}</Text>
                <Ionicons name="arrow-forward" size={22} color={TEXT} />
              </>
            )}
          </Pressable>

          <ContextualSlot learning={learning} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voir le détail de cette semaine"
            onPress={() => router.push('/(tabs)/planning')}
            style={({ pressed }) => [styles.weekRow, pressed && styles.pressed]}
          >
            <View style={styles.weekLeft}>
              <Text style={styles.weekEyebrow}>CETTE SEMAINE</Text>
              {goalReached ? <Text style={styles.weekStatus}>RYTHME ATTEINT</Text> : null}
            </View>
            <View style={styles.weekRight}>
              <Text style={styles.weekValue}>
                {weeklyTarget > 0
                  ? `${completedSessions} / ${weeklyTarget}`
                  : `${completedSessions}`}
              </Text>
              <Text style={styles.weekUnit}>
                {completedSessions > 1 ? 'SÉANCES' : 'SÉANCE'}
              </Text>
              <Ionicons name="chevron-forward" size={17} color={TEXT_MUTED} />
            </View>
          </Pressable>

          <AddTools
            open={addToolsOpen}
            onToggle={() => setAddToolsOpen((current) => !current)}
          />

          {error ? (
            <Pressable onPress={loadDashboard} style={styles.inlineError}>
              <Ionicons name="cloud-offline-outline" size={17} color={ORANGE} />
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
    backgroundColor: BACKGROUND,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 118,
  },
  contentInsideTabs: {
    paddingBottom: 34,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: BACKGROUND,
  },
  loadingText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 10,
    letterSpacing: 1.1,
    color: TEXT_MUTED,
  },
  topBar: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  brandIcon: {
    width: 34,
    height: 34,
  },
  brandName: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    letterSpacing: 1.5,
    color: TEXT,
  },
  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(100,111,94,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(144,156,137,0.24)',
  },
  heroStage: {
    minHeight: 425,
    position: 'relative',
    overflow: 'hidden',
    marginHorizontal: -18,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 26,
  },
  heroPhotoWrap: {
    position: 'absolute',
    top: 0,
    right: -38,
    width: '58%',
    height: 345,
    overflow: 'hidden',
  },
  heroPhoto: {
    width: '100%',
    height: '100%',
  },
  heroCopy: {
    width: '78%',
    zIndex: 2,
  },
  heroEyebrow: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 10,
    letterSpacing: 1.8,
    color: KAKI_LIGHT,
  },
  heroTitle: {
    marginTop: 12,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 57,
    lineHeight: 55,
    letterSpacing: 1.15,
    color: TEXT,
  },
  track: {
    height: 3,
    marginTop: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    width: 112,
  },
  trackSegment: {
    height: 2,
    borderRadius: 1,
  },
  trackSegmentPrimary: {
    width: 50,
    backgroundColor: KAKI,
  },
  trackSegmentSecondary: {
    width: 28,
    backgroundColor: 'rgba(144,156,137,0.48)',
  },
  trackSegmentGhost: {
    width: 18,
    backgroundColor: 'rgba(144,156,137,0.18)',
  },
  greeting: {
    marginTop: 27,
    fontFamily: 'Manrope_700Bold',
    fontSize: 14,
    lineHeight: 20,
    color: '#D7DCD4',
  },
  coachMessage: {
    marginTop: 14,
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 10,
  },
  coachMessageRail: {
    width: 2,
    marginRight: 13,
    borderRadius: 1,
    backgroundColor: KAKI,
  },
  coachMessageCopy: {
    flex: 1,
  },
  coachMessageLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  coachMessageLabel: {
    flex: 1,
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 1.15,
    color: KAKI_LIGHT,
    textTransform: 'uppercase',
  },
  coachMessageText: {
    marginTop: 7,
    fontFamily: 'Manrope_500Medium',
    fontSize: 15,
    lineHeight: 22,
    color: TEXT,
  },
  primaryCta: {
    minHeight: 64,
    overflow: 'hidden',
    paddingHorizontal: 21,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    backgroundColor: KAKI,
  },
  primaryCtaAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: ORANGE,
    opacity: 0.72,
  },
  primaryCtaPressed: {
    transform: [{ scale: 0.992 }],
    opacity: 0.94,
  },
  primaryCtaDisabled: {
    opacity: 0.65,
  },
  primaryCtaText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 23,
    lineHeight: 27,
    letterSpacing: 1.05,
    color: TEXT,
  },
  contextSlot: {
    minHeight: 112,
    marginTop: 24,
    paddingVertical: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
  },
  contextIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(100,111,94,0.14)',
  },
  contextCopy: {
    flex: 1,
  },
  contextEyebrow: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 1.15,
    color: KAKI_LIGHT,
  },
  contextTitle: {
    marginTop: 4,
    fontFamily: 'Manrope_700Bold',
    fontSize: 13,
    lineHeight: 18,
    color: TEXT,
  },
  contextText: {
    marginTop: 4,
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: TEXT_MUTED,
  },
  weekRow: {
    minHeight: 76,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  weekLeft: {
    flex: 1,
  },
  weekEyebrow: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 9,
    letterSpacing: 1.25,
    color: TEXT_MUTED,
  },
  weekStatus: {
    marginTop: 4,
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: KAKI_LIGHT,
  },
  weekRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
  },
  weekValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 26,
    lineHeight: 30,
    color: TEXT,
  },
  weekUnit: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 8,
    letterSpacing: 0.8,
    color: TEXT_MUTED,
  },
  addToolsWrap: {
    marginTop: 17,
  },
  addLauncher: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 13,
    borderRadius: 15,
    backgroundColor: 'rgba(17,23,19,0.62)',
    borderWidth: 1,
    borderColor: BORDER,
  },
  addLauncherIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: KAKI,
  },
  addLauncherCopy: {
    flex: 1,
  },
  addLauncherTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 10,
    letterSpacing: 1,
    color: TEXT,
  },
  addLauncherSubtitle: {
    marginTop: 2,
    fontFamily: 'Manrope_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: TEXT_MUTED,
  },
  addPanel: {
    overflow: 'hidden',
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: SURFACE_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
  },
  addAction: {
    minHeight: 70,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  addActionPressed: {
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  addActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(100,111,94,0.14)',
  },
  addActionCopy: {
    flex: 1,
  },
  addActionTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.6,
    color: TEXT,
  },
  addActionSubtitle: {
    marginTop: 3,
    fontFamily: 'Manrope_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: TEXT_MUTED,
  },
  addDivider: {
    height: 1,
    marginLeft: 62,
    backgroundColor: BORDER,
  },
  inlineError: {
    marginTop: 16,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 13,
    backgroundColor: 'rgba(255,107,25,0.06)',
  },
  inlineErrorText: {
    flex: 1,
    fontFamily: 'Manrope_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: '#B8C0B6',
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
    backgroundColor: 'rgba(10,14,12,0.98)',
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
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    color: '#778178',
  },
  navLabelActive: {
    color: KAKI_LIGHT,
  },
  navActiveDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: ORANGE,
  },
  pressed: {
    opacity: 0.74,
  },
});
