import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect, useSegments } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
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

import { useUgerodTheme } from '../../contexts/UgerodThemeContext';
import { useWorkout } from '../../contexts/WorkoutContext';
import dashboardDarkHero from '../../assets/dashboard-dark-hero';
import dashboardLightHero from '../../assets/dashboard-light-hero';
import { getCurrentProfile } from '../../services/profileService';
import { getDashboardSnapshot } from '../../services/weeklyPlanService';
import { reloadWorkoutSession } from '../../services/workoutService';
import DashboardHistoryCalendarCoach from './DashboardHistoryCalendarCoach';

const darkBrandIcon = require('../../../assets/branding/ugerod-icon.png');
const lightBrandIcon = require('../../../assets/branding/LOGO VERSION NOIR.png');
const DAY_LABELS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];

const DARK_PALETTE = {
  background: '#0A0E0C',
  surface: '#111713',
  surfaceElevated: '#151D17',
  text: '#F4F5F1',
  textSecondary: '#C9D0C6',
  textMuted: '#8F998E',
  textOnAccent: '#FFFFFF',
  border: 'rgba(173,184,170,0.16)',
  accent: '#646F5E',
  accentSoft: 'rgba(100,111,94,0.15)',
  accentBorder: 'rgba(144,156,137,0.34)',
  orange: '#FF6B19',
  orangeSoft: 'rgba(255,107,25,0.08)',
  heroFade: '#0A0E0C',
};

const LIGHT_PALETTE = {
  background: '#F4F2ED',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  text: '#1D211C',
  textSecondary: '#5F655C',
  textMuted: '#81877E',
  textOnAccent: '#FFFFFF',
  border: 'rgba(54,61,52,0.13)',
  accent: '#646F5E',
  accentSoft: 'rgba(100,111,94,0.11)',
  accentBorder: 'rgba(100,111,94,0.28)',
  orange: '#FF6B19',
  orangeSoft: 'rgba(255,107,25,0.08)',
  heroFade: '#F4F2ED',
};

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey ?? '').split('-').map(Number);
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

function CoachMessage({ headline, note, styles, palette }) {
  return (
    <View style={styles.coachMessage}>
      <View style={styles.coachRail} />
      <View style={styles.coachCopy}>
        <View style={styles.coachLabelRow}>
          <Ionicons name="chatbubble-ellipses-outline" size={14} color={palette.accent} />
          <Text style={styles.coachLabel}>{headline}</Text>
        </View>
        <Text style={styles.coachText}>{note}</Text>
      </View>
    </View>
  );
}

function ContextualSlot({ learning, styles, palette }) {
  if (!learning?.visible) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/(tabs)/progression')}
      style={({ pressed }) => [styles.contextSlot, pressed && styles.pressed]}
    >
      <View style={styles.contextIcon}>
        <Ionicons name="sparkles-outline" size={19} color={palette.accent} />
      </View>
      <View style={styles.contextCopy}>
        <Text style={styles.contextEyebrow}>CE QUI COMPTE EN CE MOMENT</Text>
        <Text style={styles.contextTitle}>
          {learning?.title ?? 'UGEROD APPREND À TE CONNAÎTRE'}
        </Text>
        <Text style={styles.contextText} numberOfLines={2}>
          {learning?.text ?? 'Chaque séance affine les prochaines décisions du Coach.'}
        </Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={palette.textMuted} />
    </Pressable>
  );
}

function ExternalWorkoutPrompt({ styles, palette }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ajouter une séance réalisée ailleurs"
      onPress={() => router.push('/workout/external')}
      style={({ pressed }) => [styles.externalPrompt, pressed && styles.pressed]}
    >
      <View style={styles.externalIcon}>
        <Ionicons name="barbell-outline" size={19} color={palette.orange} />
      </View>
      <View style={styles.externalCopy}>
        <Text style={styles.externalEyebrow}>TU VIENS DE T’ENTRAÎNER ?</Text>
        <Text style={styles.externalText}>Ajoute une séance réalisée ailleurs.</Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={palette.textMuted} />
    </Pressable>
  );
}

function MoreTools({ open, onToggle, styles, palette }) {
  return (
    <View style={styles.moreToolsWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.moreToolsLauncher, pressed && styles.pressed]}
      >
        <View style={styles.moreToolsIcon}>
          <Ionicons name={open ? 'close' : 'add'} size={18} color={palette.text} />
        </View>
        <Text style={styles.moreToolsTitle}>AUTRES ACTIONS</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={17} color={palette.textMuted} />
      </Pressable>

      {open ? (
        <View style={styles.moreToolsPanel}>
          <Pressable
            onPress={() => router.push('/workout/builder')}
            style={({ pressed }) => [styles.toolRow, pressed && styles.pressed]}
          >
            <Ionicons name="construct-outline" size={19} color={palette.accent} />
            <View style={styles.toolCopy}>
              <Text style={styles.toolTitle}>CRÉER MA SÉANCE</Text>
              <Text style={styles.toolText}>Compose manuellement ta séance.</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={palette.textMuted} />
          </Pressable>
          <View style={styles.toolDivider} />
          <Pressable
            onPress={() => router.push('/progression/records?add=1')}
            style={({ pressed }) => [styles.toolRow, pressed && styles.pressed]}
          >
            <Ionicons name="trophy-outline" size={19} color={palette.orange} />
            <View style={styles.toolCopy}>
              <Text style={styles.toolTitle}>RECORD / PR</Text>
              <Text style={styles.toolText}>Ajoute une charge, des reps ou un chrono.</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={palette.textMuted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function DashboardCoachV2Screen() {
  const segments = useSegments();
  const insideTabs = segments?.[0] === '(tabs)';
  const { isDark } = useUgerodTheme();
  const { setGeneratedWorkout } = useWorkout();
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
  const heroImage = isDark ? dashboardDarkHero : dashboardLightHero;
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;

  const [snapshot, setSnapshot] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [resuming, setResuming] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);

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
      console.warn('Coach dashboard v2', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger le dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDashboard();
    }, [loadDashboard])
  );

  const week = useMemo(() => createCurrentWeek(snapshot?.weekDays), [snapshot?.weekDays]);
  const completedSessions = snapshot?.completedThisWeek ?? 0;
  const weeklyTarget = snapshot?.weeklyTarget ?? 0;
  const goalReached = weeklyTarget > 0 && completedSessions >= weeklyTarget;
  const learning = snapshot?.profileLearning ?? null;
  const activeSessionId = snapshot?.activeSessionToday?.sessionId ?? null;
  const hasActiveSessionToday = Boolean(activeSessionId);

  const coachNote = snapshot?.coachNote?.text ?? 'J’ai préparé quelque chose pour toi aujourd’hui.';
  const coachHeadline = snapshot?.coachNote?.headline ?? 'LE MOT DU COACH';
  const heroEyebrow = hasActiveSessionToday ? 'SÉANCE EN COURS' : 'COACH NOW';
  const heroTitle = hasActiveSessionToday ? 'ON CONTINUE ?' : 'PRÊT À\nT’ENTRAÎNER ?';
  const primaryLabel = hasActiveSessionToday ? 'REPRENDRE MA SÉANCE' : 'PRÉPARER MA SÉANCE';

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
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color={palette.accent} />
        <Text style={styles.loadingText}>UGEROD PRÉPARE TON COACHING</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, insideTabs && styles.contentInsideTabs]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={palette.accent}
              colors={[palette.accent]}
              progressBackgroundColor={palette.surface}
            />
          }
        >
          <View style={styles.heroStage}>
            <View pointerEvents="none" style={styles.heroPhotoWrap}>
              <Image source={heroImage} resizeMode="cover" style={styles.heroPhoto} />
              <LinearGradient
                colors={
                  isDark
                    ? ['rgba(10,14,12,0.94)', 'rgba(10,14,12,0.68)', 'rgba(10,14,12,0.05)']
                    : ['rgba(244,242,237,0.97)', 'rgba(244,242,237,0.72)', 'rgba(244,242,237,0.08)']
                }
                locations={[0, 0.48, 1]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
              <LinearGradient
                colors={['rgba(0,0,0,0)', palette.heroFade]}
                locations={[0.55, 1]}
                style={StyleSheet.absoluteFill}
              />
            </View>

            <View style={styles.heroTopRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ouvrir mon profil"
                onPress={() => router.push('/profile')}
                style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
              >
                <Ionicons name="person-outline" size={20} color={palette.text} />
              </Pressable>
              <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
            </View>

            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>{heroEyebrow}</Text>
              <Text style={styles.heroTitle}>{heroTitle}</Text>
              <View style={styles.track}>
                <View style={styles.trackPrimary} />
                <View style={styles.trackSecondary} />
                <View style={styles.trackGhost} />
              </View>
              <Text style={styles.greeting}>{firstName ? `Bonjour ${firstName}.` : 'Bonjour.'}</Text>
              <CoachMessage
                headline={coachHeadline}
                note={coachNote}
                styles={styles}
                palette={palette}
              />
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
              <ActivityIndicator size="small" color={palette.textOnAccent} />
            ) : (
              <>
                <Text style={styles.primaryCtaText}>{primaryLabel}</Text>
                <Ionicons name="arrow-forward" size={22} color={palette.textOnAccent} />
              </>
            )}
          </Pressable>

          <DashboardHistoryCalendarCoach
            week={week}
            completed={completedSessions}
            target={weeklyTarget}
            reached={goalReached}
            initialMonthSessions={snapshot?.monthSessions ?? []}
            onCompletedDayPress={handleCompletedDayPress}
            palette={palette}
          />

          <ContextualSlot learning={learning} styles={styles} palette={palette} />
          <ExternalWorkoutPrompt styles={styles} palette={palette} />
          <MoreTools
            open={moreToolsOpen}
            onToggle={() => setMoreToolsOpen((current) => !current)}
            styles={styles}
            palette={palette}
          />

          {error ? (
            <Pressable onPress={loadDashboard} style={styles.inlineError}>
              <Ionicons name="cloud-offline-outline" size={17} color={palette.orange} />
              <Text style={styles.inlineErrorText}>
                Certaines données n’ont pas été synchronisées. Réessayer.
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function createStyles(p, isDark) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.background },
    safeArea: { flex: 1 },
    content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 118 },
    contentInsideTabs: { paddingBottom: 34 },
    loadingScreen: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      backgroundColor: p.background,
    },
    loadingText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      letterSpacing: 1.1,
      color: p.textMuted,
    },
    heroStage: {
      minHeight: 438,
      position: 'relative',
      overflow: 'hidden',
      marginHorizontal: -18,
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 24,
    },
    heroPhotoWrap: {
      position: 'absolute',
      top: 52,
      right: -36,
      width: '60%',
      height: 345,
      overflow: 'hidden',
    },
    heroPhoto: { width: '100%', height: '100%' },
    heroTopRow: {
      height: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      zIndex: 3,
    },
    profileButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.accentSoft,
      borderWidth: 1,
      borderColor: p.accentBorder,
    },
    brandIcon: { width: 48, height: 48 },
    heroCopy: { width: '79%', zIndex: 2, marginTop: 28 },
    heroEyebrow: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 10,
      letterSpacing: 1.8,
      color: p.accent,
    },
    heroTitle: {
      marginTop: 11,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 57,
      lineHeight: 55,
      letterSpacing: 1.1,
      color: p.text,
    },
    track: {
      height: 3,
      marginTop: 17,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      width: 112,
    },
    trackPrimary: { width: 50, height: 2, borderRadius: 1, backgroundColor: p.accent },
    trackSecondary: { width: 28, height: 2, borderRadius: 1, backgroundColor: p.accentBorder },
    trackGhost: { width: 18, height: 2, borderRadius: 1, backgroundColor: p.border },
    greeting: {
      marginTop: 25,
      fontFamily: 'Manrope_700Bold',
      fontSize: 14,
      lineHeight: 20,
      color: p.text,
    },
    coachMessage: {
      marginTop: 13,
      minHeight: 102,
      flexDirection: 'row',
      alignItems: 'stretch',
      paddingVertical: 8,
    },
    coachRail: { width: 2, marginRight: 13, borderRadius: 1, backgroundColor: p.accent },
    coachCopy: { flex: 1 },
    coachLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    coachLabel: {
      flex: 1,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      lineHeight: 13,
      letterSpacing: 1.05,
      color: p.accent,
      textTransform: 'uppercase',
    },
    coachText: {
      marginTop: 7,
      fontFamily: 'Manrope_500Medium',
      fontSize: 15,
      lineHeight: 22,
      color: p.text,
    },
    primaryCta: {
      minHeight: 64,
      overflow: 'hidden',
      paddingHorizontal: 21,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: 16,
      backgroundColor: p.accent,
      shadowColor: isDark ? '#000000' : '#646F5E',
      shadowOpacity: isDark ? 0.18 : 0.14,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 7 },
    },
    primaryCtaAccent: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 3,
      backgroundColor: p.orange,
      opacity: 0.78,
    },
    primaryCtaPressed: { transform: [{ scale: 0.992 }], opacity: 0.94 },
    primaryCtaDisabled: { opacity: 0.65 },
    primaryCtaText: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 23,
      lineHeight: 27,
      letterSpacing: 1.05,
      color: p.textOnAccent,
    },
    contextSlot: {
      minHeight: 108,
      marginTop: 24,
      paddingVertical: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: p.border,
    },
    contextIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.accentSoft,
    },
    contextCopy: { flex: 1 },
    contextEyebrow: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 8,
      lineHeight: 12,
      letterSpacing: 1.1,
      color: p.accent,
    },
    contextTitle: {
      marginTop: 4,
      fontFamily: 'Manrope_700Bold',
      fontSize: 13,
      lineHeight: 18,
      color: p.text,
    },
    contextText: {
      marginTop: 4,
      fontFamily: 'Manrope_400Regular',
      fontSize: 12,
      lineHeight: 17,
      color: p.textMuted,
    },
    externalPrompt: {
      minHeight: 82,
      marginTop: 18,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: p.border,
    },
    externalIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.orangeSoft,
    },
    externalCopy: { flex: 1 },
    externalEyebrow: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      letterSpacing: 0.9,
      color: p.text,
    },
    externalText: {
      marginTop: 4,
      fontFamily: 'Manrope_400Regular',
      fontSize: 12,
      color: p.textMuted,
    },
    moreToolsWrap: { marginTop: 6 },
    moreToolsLauncher: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
    },
    moreToolsIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.accentSoft,
    },
    moreToolsTitle: {
      flex: 1,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      letterSpacing: 0.9,
      color: p.textSecondary,
    },
    moreToolsPanel: {
      overflow: 'hidden',
      borderRadius: 15,
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.border,
      marginBottom: 6,
    },
    toolRow: {
      minHeight: 67,
      paddingHorizontal: 15,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    toolCopy: { flex: 1 },
    toolTitle: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      letterSpacing: 0.65,
      color: p.text,
    },
    toolText: {
      marginTop: 3,
      fontFamily: 'Manrope_400Regular',
      fontSize: 11,
      color: p.textMuted,
    },
    toolDivider: { height: 1, marginLeft: 46, backgroundColor: p.border },
    inlineError: {
      marginTop: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderRadius: 13,
      backgroundColor: p.orangeSoft,
    },
    inlineErrorText: {
      flex: 1,
      fontFamily: 'Manrope_400Regular',
      fontSize: 11,
      lineHeight: 16,
      color: p.textSecondary,
    },
    pressed: { opacity: 0.72 },
  });
}
