import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect, useSegments } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useUgerodTheme } from '../../contexts/UgerodThemeContext';
import { useWorkout } from '../../contexts/WorkoutContext';
import dashboardDarkHero from '../../assets/dashboard-dark-hero';
import { getCurrentProfile } from '../../services/profileService';
import { getDashboardSnapshot } from '../../services/weeklyPlanService';
import { reloadWorkoutSession } from '../../services/workoutService';
import DashboardHistoryCalendarCoach from './DashboardHistoryCalendarCoach';

const darkBrandIcon = require('../../../assets/branding/ugerod-icon.png');
const lightBrandIcon = require('../../../assets/branding/LOGO VERSION NOIR.png');

const lightCoachPhoto = require('../../../assets/branding/D63D5DFF-3FC3-4338-8B37-0394114880F6.jpeg');
const buildPhoto = require('../../../assets/branding/F5F16BEB-9979-4D87-B8E1-4D40B66EB361.jpeg');
const activityPhoto = require('../../../assets/branding/mohamed-fareed-rbSNsoXk-3A-unsplash.jpg');

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
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={14}
            color={palette.accent}
          />
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

function PagerTrack({ activeIndex, onSelect, styles }) {
  return (
    <View
      style={styles.track}
      accessibilityRole="tablist"
      accessibilityLabel="Choisir une action"
    >
      {[0, 1, 2].map((index) => (
        <Pressable
          key={index}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeIndex === index }}
          accessibilityLabel={
            index === 0
              ? 'Séance du Coach'
              : index === 1
                ? 'Créer ma séance'
                : 'Ajouter une séance réalisée'
          }
          onPress={() => onSelect(index)}
          hitSlop={10}
          style={[
            styles.trackSegment,
            activeIndex === index
              ? styles.trackSegmentActive
              : styles.trackSegmentInactive,
          ]}
        />
      ))}
    </View>
  );
}

function HeroPhoto({ source, isDark, palette, styles }) {
  return (
    <View pointerEvents="none" style={styles.heroPhotoWrap}>
      <Image source={source} resizeMode="cover" style={styles.heroPhoto} />
      <LinearGradient
        colors={
          isDark
            ? ['rgba(10,14,12,0.93)', 'rgba(10,14,12,0.58)', 'rgba(10,14,12,0.08)']
            : ['rgba(244,242,237,0.98)', 'rgba(244,242,237,0.62)', 'rgba(244,242,237,0.05)']
        }
        locations={[0, 0.46, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(0,0,0,0)', palette.heroFade]}
        locations={[0.58, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function HeroPanel({
  width,
  photo,
  firstName,
  headline,
  note,
  ctaLabel,
  onPress,
  loading = false,
  showPrAction = false,
  isDark,
  palette,
  styles,
}) {
  return (
    <View style={[styles.heroPanel, { width }]}>
      <HeroPhoto
        source={photo}
        isDark={isDark}
        palette={palette}
        styles={styles}
      />

      <View style={styles.heroPanelContent}>
        <Text style={styles.greeting}>
          {firstName ? `Bonjour ${firstName}.` : 'Bonjour.'}
        </Text>

        <CoachMessage
          headline={headline}
          note={note}
          styles={styles}
          palette={palette}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          onPress={onPress}
          disabled={loading}
          style={({ pressed }) => [
            styles.primaryCta,
            pressed && !loading && styles.primaryCtaPressed,
            loading && styles.primaryCtaDisabled,
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={palette.textOnAccent} />
          ) : (
            <>
              <Text style={styles.primaryCtaText}>{ctaLabel}</Text>
              <Ionicons
                name="arrow-forward"
                size={22}
                color={palette.textOnAccent}
              />
            </>
          )}
        </Pressable>

        {showPrAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ajouter seulement un record ou PR"
            onPress={() => router.push('/progression/records?add=1')}
            style={({ pressed }) => [
              styles.prAction,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="trophy-outline" size={17} color={palette.orange} />
            <Text style={styles.prActionText}>AJOUTER SEULEMENT UN PR</Text>
            <Ionicons
              name="arrow-forward"
              size={16}
              color={palette.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function DashboardCoachV3Screen() {
  const segments = useSegments();
  const insideTabs = segments?.[0] === '(tabs)';
  const { width: viewportWidth } = useWindowDimensions();
  const pagerRef = useRef(null);

  const { isDark } = useUgerodTheme();
  const { setGeneratedWorkout } = useWorkout();

  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
  const styles = useMemo(
    () => createStyles(palette, isDark),
    [palette, isDark]
  );

  const panelWidth = Math.max(viewportWidth - 36, 280);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;

  const [snapshot, setSnapshot] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [resuming, setResuming] = useState(false);
  const [activePanel, setActivePanel] = useState(0);

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
      console.warn('Coach dashboard v3', loadError);
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
      setActivePanel(0);
      pagerRef.current?.scrollTo?.({ x: 0, animated: false });
      loadDashboard();
    }, [loadDashboard])
  );

  const week = useMemo(
    () => createCurrentWeek(snapshot?.weekDays),
    [snapshot?.weekDays]
  );

  const completedSessions = snapshot?.completedThisWeek ?? 0;
  const weeklyTarget = snapshot?.weeklyTarget ?? 0;
  const goalReached =
    weeklyTarget > 0 && completedSessions >= weeklyTarget;
  const learning = snapshot?.profileLearning ?? null;
  const activeSessionId = snapshot?.activeSessionToday?.sessionId ?? null;
  const hasActiveSessionToday = Boolean(activeSessionId);

  const coachNote =
    snapshot?.coachNote?.text ??
    'J’ai préparé quelque chose pour toi aujourd’hui.';
  const coachHeadline =
    snapshot?.coachNote?.headline ?? 'LE MOT DU COACH';
  const primaryLabel = hasActiveSessionToday
    ? 'REPRENDRE MA SÉANCE'
    : 'PRÉPARER MA SÉANCE';

  const coachPhoto = isDark ? dashboardDarkHero : lightCoachPhoto;

  async function handlePrimaryAction() {
    if (!activeSessionId) {
      router.push('/workout/preparation');
      return;
    }

    try {
      setResuming(true);
      const restored = await reloadWorkoutSession({
        sessionId: activeSessionId,
      });
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

  function goToPanel(index) {
    const safeIndex = Math.max(0, Math.min(2, index));
    setActivePanel(safeIndex);
    pagerRef.current?.scrollTo?.({
      x: safeIndex * panelWidth,
      animated: true,
    });
  }

  function handleMomentumEnd(event) {
    const offsetX = event?.nativeEvent?.contentOffset?.x ?? 0;
    const nextIndex = Math.max(
      0,
      Math.min(2, Math.round(offsetX / panelWidth))
    );
    setActivePanel(nextIndex);
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
          contentContainerStyle={[
            styles.content,
            insideTabs && styles.contentInsideTabs,
          ]}
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
          <View style={styles.heroShell}>
            <View style={styles.heroTopRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ouvrir mon profil"
                onPress={() => router.push('/profile')}
                style={({ pressed }) => [
                  styles.profileButton,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={palette.text}
                />
              </Pressable>

              <Image
                source={brandIcon}
                style={styles.brandIcon}
                resizeMode="contain"
              />
            </View>

            <PagerTrack
              activeIndex={activePanel}
              onSelect={goToPanel}
              styles={styles}
            />

            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              bounces={false}
              snapToInterval={panelWidth}
              decelerationRate="fast"
              onMomentumScrollEnd={handleMomentumEnd}
              style={styles.heroPager}
            >
              <HeroPanel
                width={panelWidth}
                photo={coachPhoto}
                firstName={firstName}
                headline={coachHeadline}
                note={coachNote}
                ctaLabel={primaryLabel}
                onPress={handlePrimaryAction}
                loading={resuming}
                isDark={isDark}
                palette={palette}
                styles={styles}
              />

              <HeroPanel
                width={panelWidth}
                photo={buildPhoto}
                firstName={firstName}
                headline="LE MOT DU COACH"
                note="Tu préfères construire ta séance toi-même ? Compose tes blocs, choisis tes exercices et garde la main sur le format."
                ctaLabel="CRÉER MA SÉANCE"
                onPress={() => router.push('/workout/builder')}
                isDark={isDark}
                palette={palette}
                styles={styles}
              />

              <HeroPanel
                width={panelWidth}
                photo={activityPhoto}
                firstName={firstName}
                headline="LE MOT DU COACH"
                note="Tu t’es entraîné ailleurs ? Enregistre ce que tu as réellement fait pour que je garde ton parcours et tes prochaines décisions à jour."
                ctaLabel="J’AI FAIT UNE SÉANCE"
                onPress={() => router.push('/workout/external')}
                showPrAction
                isDark={isDark}
                palette={palette}
                styles={styles}
              />
            </ScrollView>
          </View>

          <DashboardHistoryCalendarCoach
            week={week}
            completed={completedSessions}
            target={weeklyTarget}
            reached={goalReached}
            initialMonthSessions={snapshot?.monthSessions ?? []}
            onCompletedDayPress={handleCompletedDayPress}
            palette={palette}
          />

          <ContextualSlot
            learning={learning}
            styles={styles}
            palette={palette}
          />

          {error ? (
            <Pressable
              onPress={loadDashboard}
              style={({ pressed }) => [
                styles.inlineError,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name="cloud-offline-outline"
                size={17}
                color={palette.orange}
              />
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
    screen: {
      flex: 1,
      backgroundColor: p.background,
    },
    safeArea: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 18,
      paddingTop: 8,
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
      backgroundColor: p.background,
    },
    loadingText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      letterSpacing: 1.1,
      color: p.textMuted,
    },

    heroShell: {
      marginHorizontal: -18,
      overflow: 'hidden',
      minHeight: 510,
    },
    heroTopRow: {
      minHeight: 74,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      zIndex: 10,
    },
    profileButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark
        ? 'rgba(100,111,94,0.15)'
        : 'rgba(100,111,94,0.08)',
      borderWidth: 1,
      borderColor: p.accentBorder,
    },
    brandIcon: {
      width: 46,
      height: 46,
    },

    track: {
      position: 'absolute',
      top: 96,
      left: 38,
      zIndex: 20,
      height: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    trackSegment: {
      height: 3,
      borderRadius: 2,
    },
    trackSegmentActive: {
      width: 50,
      backgroundColor: p.orange,
    },
    trackSegmentInactive: {
      width: 28,
      backgroundColor: isDark
        ? 'rgba(144,156,137,0.28)'
        : 'rgba(100,111,94,0.22)',
    },

    heroPager: {
      minHeight: 426,
    },
    heroPanel: {
      minHeight: 426,
      position: 'relative',
      overflow: 'hidden',
      paddingHorizontal: 38,
      paddingTop: 60,
      paddingBottom: 22,
    },
    heroPhotoWrap: {
      position: 'absolute',
      top: 0,
      right: -22,
      width: '63%',
      height: 360,
      overflow: 'hidden',
    },
    heroPhoto: {
      width: '100%',
      height: '100%',
    },
    heroPanelContent: {
      width: '79%',
      zIndex: 2,
      paddingTop: 36,
    },
    greeting: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 15,
      lineHeight: 21,
      color: p.text,
      marginBottom: 16,
    },

    coachMessage: {
      minHeight: 112,
      flexDirection: 'row',
      alignItems: 'stretch',
      paddingVertical: 8,
      marginBottom: 20,
    },
    coachRail: {
      width: 2,
      marginRight: 13,
      borderRadius: 1,
      backgroundColor: p.accent,
    },
    coachCopy: {
      flex: 1,
    },
    coachLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    coachLabel: {
      flex: 1,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      lineHeight: 13,
      letterSpacing: 1.15,
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
      minHeight: 66,
      paddingHorizontal: 22,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: 17,
      backgroundColor: p.accent,
      shadowColor: '#000000',
      shadowOpacity: isDark ? 0.14 : 0.10,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
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
      color: p.textOnAccent,
    },

    prAction: {
      minHeight: 42,
      marginTop: 9,
      paddingHorizontal: 5,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    prActionText: {
      flex: 1,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      letterSpacing: 0.8,
      color: p.textSecondary,
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
    contextCopy: {
      flex: 1,
    },
    contextEyebrow: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 8,
      lineHeight: 12,
      letterSpacing: 1.15,
      color: p.textMuted,
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

    inlineError: {
      marginTop: 18,
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: p.orangeSoft,
      borderWidth: 1,
      borderColor: 'rgba(255,107,25,0.25)',
    },
    inlineErrorText: {
      flex: 1,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      color: p.textSecondary,
    },
    pressed: {
      opacity: 0.72,
    },
  });
}
