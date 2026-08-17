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
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../src/constants';
import { getDashboardSnapshot } from '../../src/services/weeklyPlanService';
import { getCurrentProfile } from '../../src/services/profileService';
import { reloadWorkoutSession } from '../../src/services/workoutService';
import { getProgramCoachSnapshot } from '../../src/services/programCoachService';
import { useWorkout } from '../../src/contexts/WorkoutContext';

const dashboardBackground = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

const DAY_LABELS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey ?? '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function humanize(value) {
  if (!value) return null;
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function formatShortDate(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return '--';
  return String(date.getDate()).padStart(2, '0');
}

function formatDayLong(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return 'JOUR';
  return date
    .toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'short' })
    .replace(/\./g, '')
    .toUpperCase();
}

function intentLabel(value) {
  switch (value) {
    case 'PROGRESS': return 'PROGRESSION';
    case 'CONSOLIDATE': return 'CONSOLIDATION';
    case 'RECALIBRATE': return 'RECALIBRATION';
    case 'DELOAD': return 'ALLÈGEMENT';
    default: return 'ENTRETIEN';
  }
}

function createWeek(weekDays) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (Array.isArray(weekDays) ? weekDays : []).map((item) => {
    const date = parseDateKey(item?.date);
    return {
      key: item?.date,
      dateKey: item?.date,
      day: date ? DAY_LABELS[date.getDay()] : '',
      number: formatShortDate(item?.date),
      today: date ? date.getTime() === today.getTime() : false,
      completed: Boolean(item?.completed),
      planned: Boolean(item?.planned),
      sessionId: item?.session_id ?? null,
      focus: item?.planned_focus ?? null,
      targetRegion: item?.planned_target_region ?? null,
      progressionIntent: item?.planned_progression_intent ?? null,
      planStatus: item?.plan_status ?? null,
    };
  });
}

export default function DashboardScreen() {
  const { setGeneratedWorkout } = useWorkout();
  const [snapshot, setSnapshot] = useState(null);
  const [program, setProgram] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [weekOpen, setWeekOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [resuming, setResuming] = useState(false);

  const load = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      const [data, profile, programData] = await Promise.all([
        getDashboardSnapshot(),
        getCurrentProfile().catch(() => null),
        getProgramCoachSnapshot().catch(() => null),
      ]);

      setSnapshot(data);
      setProgram(programData);
      setFirstName(profile?.firstname?.trim() ?? '');
    } catch (loadError) {
      setError(loadError?.message ?? 'Impossible de charger le tableau de bord.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const week = useMemo(() => createWeek(snapshot?.weekDays), [snapshot?.weekDays]);
  const plannedDays = week.filter((item) => item.planned || item.completed);
  const activeSessionId = snapshot?.activeSessionToday?.sessionId ?? null;
  const hasCompletedWorkout = (snapshot?.totalCompletedSessions ?? 0) > 0;
  const completedThisWeek = snapshot?.completedThisWeek ?? 0;
  const weeklyTarget = snapshot?.weeklyTarget ?? 0;
  const block = program?.block ?? null;
  const nextPlan = snapshot?.nextPlanItem ?? {};

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
      console.warn('Dashboard resume session', resumeError);
      router.push('/workout/preparation');
    } finally {
      setResuming(false);
    }
  }

  function handleDayPress(item) {
    if (item.completed && item.sessionId) {
      router.push(`/workout/${item.sessionId}`);
    }
  }

  if (loading && !snapshot) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <Image source={brandIcon} style={styles.loadingLogo} resizeMode="contain" />
        <ActivityIndicator color={colors.primaryLight} />
        <Text style={styles.loadingText}>UGEROD PRÉPARE TON COCKPIT...</Text>
      </SafeAreaView>
    );
  }

  const primaryLabel = activeSessionId
    ? 'REPRENDRE MA SÉANCE'
    : hasCompletedWorkout
      ? 'PRÉPARER MA SÉANCE'
      : 'CRÉER MA PREMIÈRE SÉANCE';

  return (
    <View style={styles.screen}>
      <ImageBackground source={dashboardBackground} style={styles.background} resizeMode="cover">
        <View style={styles.darkOverlay} />
        <LinearGradient
          colors={['rgba(7,9,12,0.30)', 'rgba(7,9,12,0.64)', 'rgba(7,9,12,0.98)']}
          locations={[0, 0.44, 1]}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => load({ refresh: true })}
                tintColor={colors.primaryLight}
              />
            }
          >
            <View style={styles.header}>
              <Pressable onPress={() => router.push('/profile')} style={styles.profileButton}>
                <Ionicons name="person-outline" size={20} color={colors.textPrimary} />
              </Pressable>
              <View style={styles.headerText}>
                <Text style={styles.greeting}>
                  {firstName ? `BONJOUR ${firstName.toUpperCase()}` : 'BONJOUR'}
                </Text>
                <Text style={styles.headerTitle}>TON COACH, AUJOURD’HUI.</Text>
              </View>
              <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
            </View>

            {error ? (
              <View style={styles.errorCard}>
                <Ionicons name="cloud-offline-outline" size={19} color={colors.brandRed} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.heroCard}>
              <View style={styles.heroTopLine}>
                <View style={styles.redMarker} />
                <Text style={styles.heroEyebrow}>SÉANCE DU JOUR</Text>
              </View>
              <Text style={styles.heroTitle}>
                {activeSessionId ? 'TA SÉANCE T’ATTEND' : 'PRÊT À T’ENTRAÎNER'}<Text style={styles.blueDot}>.</Text>
              </Text>

              <View style={styles.coachNote}>
                <Ionicons name="sparkles-outline" size={18} color={colors.primaryLight} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.coachLabel}>{snapshot?.coachNote?.headline ?? 'LE MOT DU COACH'}</Text>
                  <Text style={styles.coachText}>
                    {snapshot?.coachNote?.text ?? 'Je prends en compte ton programme, ta récupération et ce que tu as réellement fait.'}
                  </Text>
                </View>
              </View>

              <Pressable disabled={resuming} onPress={handlePrimaryAction} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                {resuming ? (
                  <ActivityIndicator size="small" color={colors.brandWhite} />
                ) : (
                  <>
                    <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.brandWhite} />
                  </>
                )}
              </Pressable>
            </View>

            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>CETTE SEMAINE</Text>
                <Text style={styles.sectionSubtitle}>DATES RECOMMANDÉES, JAMAIS IMPOSÉES</Text>
              </View>
              <Text style={styles.weekScore}>{completedThisWeek} / {weeklyTarget}</Text>
            </View>

            <View style={styles.weekCard}>
              <View style={styles.weekStrip}>
                {week.map((item) => (
                  <Pressable key={item.key} onPress={() => handleDayPress(item)} style={styles.dayItem}>
                    <Text style={[styles.dayLabel, item.today && styles.dayLabelToday]}>{item.day}</Text>
                    <View
                      style={[
                        styles.dayCircle,
                        item.completed && styles.dayCircleCompleted,
                        item.today && !item.completed && styles.dayCircleToday,
                        item.planned && !item.completed && !item.today && styles.dayCirclePlanned,
                      ]}
                    >
                      {item.completed ? (
                        <Ionicons name="checkmark" size={15} color={colors.brandWhite} />
                      ) : (
                        <Text style={[styles.dayNumber, item.today && styles.dayNumberToday]}>{item.number}</Text>
                      )}
                    </View>
                    {item.planned && !item.completed ? <View style={styles.planDot} /> : <View style={styles.planDotGhost} />}
                  </Pressable>
                ))}
              </View>

              <Pressable onPress={() => setWeekOpen((value) => !value)} style={styles.expandWeekButton}>
                <Text style={styles.expandWeekText}>{weekOpen ? 'RÉDUIRE LA SEMAINE' : 'DÉROULER MA SEMAINE'}</Text>
                <Ionicons name={weekOpen ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textMuted} />
              </Pressable>

              {weekOpen ? (
                <View style={styles.weekDetails}>
                  {plannedDays.length > 0 ? plannedDays.map((item, index) => (
                    <Pressable
                      key={`detail-${item.key}`}
                      onPress={() => handleDayPress(item)}
                      style={[styles.weekDetailRow, index < plannedDays.length - 1 && styles.rowBorder]}
                    >
                      <View style={[styles.detailState, item.completed && styles.detailStateDone]}>
                        <Ionicons
                          name={item.completed ? 'checkmark' : item.today ? 'radio-button-on' : 'ellipse-outline'}
                          size={14}
                          color={item.completed ? colors.brandWhite : colors.primaryLight}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailDate}>{formatDayLong(item.dateKey)}</Text>
                        <Text style={styles.detailTitle}>
                          {item.completed
                            ? 'SÉANCE RÉALISÉE'
                            : `${humanize(item.targetRegion) ?? 'FULL BODY'} · ${humanize(item.focus) ?? 'ENTRAÎNEMENT'}`}
                        </Text>
                        {!item.completed && item.progressionIntent ? (
                          <Text style={styles.detailMeta}>{intentLabel(item.progressionIntent)}</Text>
                        ) : null}
                      </View>
                      {item.completed ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
                    </Pressable>
                  )) : (
                    <Text style={styles.weekEmpty}>UGEROD n’a pas encore de séance recommandée sur cette semaine.</Text>
                  )}
                  <Text style={styles.weekHint}>Si ton rythme change, le Coach Engine réorganise la suite sans créer de « dette » d’entraînement.</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>TON PROGRAMME</Text>
              <Pressable onPress={() => router.push('/(tabs)/program')}>
                <Text style={styles.sectionLink}>OUVRIR</Text>
              </Pressable>
            </View>

            <Pressable onPress={() => router.push('/(tabs)/program')} style={({ pressed }) => [styles.programCard, pressed && styles.pressed]}>
              <View style={styles.programIcon}>
                <Ionicons name="navigate-circle-outline" size={23} color={colors.primaryLight} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.programEyebrow}>
                  {program?.isActive ? `SEMAINE ${block?.currentWeekIndex ?? 1} / ${block?.nominalWeeks ?? 4}` : 'CALIBRATION EN COURS'}
                </Text>
                <Text style={styles.programTitle}>{humanize(block?.primaryGoal ?? snapshot?.primaryGoal ?? 'PROGRAMME ADAPTATIF')}</Text>
                <Text style={styles.programText}>
                  {nextPlan?.planned_target_region
                    ? `Prochaine intention : ${humanize(nextPlan.planned_target_region)} · ${humanize(nextPlan.planned_focus)}`
                    : 'UGEROD construit ta trajectoire à partir de tes objectifs et de tes preuves réelles.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>AJOUTER</Text>
              <Text style={styles.sectionSubtitle}>CE QUE TU AS FAIT AILLEURS</Text>
            </View>

            <Pressable onPress={() => setAddOpen(true)} style={({ pressed }) => [styles.addCard, pressed && styles.pressed]}>
              <View style={styles.addIcon}>
                <Ionicons name="add" size={24} color={colors.brandWhite} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.addTitle}>+ AJOUTER À MON HISTORIQUE</Text>
                <Text style={styles.addText}>Séance en box, avec un coach, record personnel...</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>

            {hasCompletedWorkout ? (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>REPÈRES RAPIDES</Text>
                  <Pressable onPress={() => router.push('/(tabs)/progression')}>
                    <Text style={styles.sectionLink}>PROGRESSION</Text>
                  </Pressable>
                </View>

                <View style={styles.quickGrid}>
                  <QuickMetric label="OBJECTIF SEMAINE" value={`${completedThisWeek}/${weeklyTarget}`} />
                  <QuickMetric label="SÉRIES DE SEMAINES" value={snapshot?.consecutiveGoalWeeks ?? 0} />
                  <QuickMetric
                    label="FORME 7 JOURS"
                    value={snapshot?.formTrend7d != null && (snapshot?.formSamples7d ?? 0) >= 2 ? `${Number(snapshot.formTrend7d).toFixed(1)}/10` : '—'}
                  />
                </View>
              </>
            ) : null}

            <View style={styles.bottomSpace} />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>

      <AddHistoryModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onExternal={() => {
          setAddOpen(false);
          router.push('/workout/external');
        }}
        onPr={() => {
          setAddOpen(false);
          router.push({ pathname: '/progression/records', params: { add: '1' } });
        }}
      />
    </View>
  );
}

function QuickMetric({ label, value }) {
  return (
    <View style={styles.quickCard}>
      <Text style={styles.quickValue}>{value}</Text>
      <Text style={styles.quickLabel}>{label}</Text>
    </View>
  );
}

function AddHistoryModal({ visible, onClose, onExternal, onPr }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>MON HISTORIQUE</Text>
              <Text style={styles.modalTitle}>QUE VEUX-TU AJOUTER ?</Text>
            </View>
            <Pressable onPress={onClose} style={styles.modalClose}>
              <Ionicons name="close" size={21} color={colors.textPrimary} />
            </Pressable>
          </View>

          <AddAction
            icon="people-outline"
            title="UNE SÉANCE RÉALISÉE AILLEURS"
            text="Box, coach ou entraînement personnel."
            onPress={onExternal}
          />
          <AddAction
            icon="trophy-outline"
            title="UN RECORD / PR"
            text="Charge, reps, chrono ou benchmark."
            onPress={onPr}
          />
          <AddAction
            icon="camera-outline"
            title="IMPORTER UNE PHOTO"
            text="Lecture automatique de séance."
            disabled
            badge="BIENTÔT"
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AddAction({ icon, title, text, onPress, disabled, badge }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.modalAction, disabled && styles.modalActionDisabled]}>
      <View style={styles.modalActionIcon}>
        <Ionicons name={icon} size={20} color={disabled ? colors.textMuted : colors.primaryLight} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.modalActionTitleRow}>
          <Text style={[styles.modalActionTitle, disabled && styles.modalActionTitleDisabled]}>{title}</Text>
          {badge ? <Text style={styles.soonBadge}>{badge}</Text> : null}
        </View>
        <Text style={styles.modalActionText}>{text}</Text>
      </View>
      {!disabled ? <Ionicons name="chevron-forward" size={17} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  background: { flex: 1 },
  darkOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,6,9,0.48)' },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 100 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  loadingLogo: { width: 48, height: 48 },
  loadingText: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 11, letterSpacing: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  profileButton: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  headerText: { flex: 1 },
  greeting: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 1 },
  headerTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 15, marginTop: 1 },
  brandIcon: { width: 39, height: 39 },
  errorCard: { flexDirection: 'row', gap: 10, padding: 13, borderRadius: 14, backgroundColor: 'rgba(180,35,45,0.12)', borderWidth: 1, borderColor: 'rgba(255,90,100,0.18)', marginBottom: 12 },
  errorText: { flex: 1, color: colors.textSecondary, fontFamily: 'Oswald_400Regular', fontSize: 12 },
  heroCard: { padding: 20, borderRadius: 21, backgroundColor: 'rgba(10,14,19,0.93)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  heroTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  redMarker: { width: 4, height: 16, borderRadius: 999, backgroundColor: colors.brandRed },
  heroEyebrow: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 1.1 },
  heroTitle: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 34, lineHeight: 38, marginTop: 8 },
  blueDot: { color: colors.primaryLight },
  coachNote: { flexDirection: 'row', gap: 11, padding: 13, borderRadius: 14, backgroundColor: 'rgba(73,157,255,0.08)', marginTop: 13 },
  coachLabel: { color: colors.primaryLight, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.7 },
  coachText: { color: colors.textSecondary, fontFamily: 'Oswald_400Regular', fontSize: 12, lineHeight: 18, marginTop: 3 },
  primaryButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, backgroundColor: colors.primaryLight, marginTop: 16 },
  primaryButtonText: { color: colors.brandWhite, fontFamily: 'Oswald_600SemiBold', fontSize: 11, letterSpacing: 0.7 },
  pressed: { opacity: 0.78 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 25, marginBottom: 9 },
  sectionTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 14, letterSpacing: 0.7 },
  sectionSubtitle: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 8, letterSpacing: 0.45 },
  sectionLink: { color: colors.primaryLight, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.6 },
  weekScore: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 24 },
  weekCard: { borderRadius: 18, padding: 14, backgroundColor: 'rgba(11,15,20,0.91)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  weekStrip: { flexDirection: 'row', justifyContent: 'space-between' },
  dayItem: { flex: 1, alignItems: 'center' },
  dayLabel: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 8, marginBottom: 7 },
  dayLabelToday: { color: colors.primaryLight },
  dayCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)' },
  dayCircleToday: { borderWidth: 1, borderColor: colors.primaryLight, backgroundColor: 'rgba(73,157,255,0.08)' },
  dayCirclePlanned: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.11)' },
  dayCircleCompleted: { backgroundColor: colors.primaryLight },
  dayNumber: { color: colors.textSecondary, fontFamily: 'Oswald_500Medium', fontSize: 11 },
  dayNumberToday: { color: colors.primaryLight },
  planDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primaryLight, marginTop: 7 },
  planDotGhost: { width: 4, height: 4, marginTop: 7 },
  expandWeekButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingTop: 13, marginTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  expandWeekText: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.5 },
  weekDetails: { marginTop: 8 },
  weekDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  detailState: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(73,157,255,0.09)' },
  detailStateDone: { backgroundColor: colors.primaryLight },
  detailDate: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 8 },
  detailTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 11, marginTop: 2 },
  detailMeta: { color: colors.primaryLight, fontFamily: 'Oswald_500Medium', fontSize: 8, marginTop: 2 },
  weekHint: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 9, lineHeight: 14, marginTop: 9 },
  weekEmpty: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 11, paddingVertical: 10 },
  programCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, backgroundColor: 'rgba(14,20,27,0.92)', borderWidth: 1, borderColor: 'rgba(73,157,255,0.14)' },
  programIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(73,157,255,0.10)' },
  programEyebrow: { color: colors.primaryLight, fontFamily: 'Oswald_600SemiBold', fontSize: 8, letterSpacing: 0.6 },
  programTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 13, marginTop: 2 },
  programText: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 10, marginTop: 3 },
  addCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  addIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  addTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 11 },
  addText: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 10, marginTop: 2 },
  quickGrid: { flexDirection: 'row', gap: 8 },
  quickCard: { flex: 1, minHeight: 88, justifyContent: 'center', padding: 11, borderRadius: 15, backgroundColor: 'rgba(11,15,20,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  quickValue: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 25 },
  quickLabel: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 7, marginTop: 5 },
  bottomSpace: { height: 25 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.68)' },
  modalSheet: { backgroundColor: '#0B0F14', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
  modalHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 15 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalEyebrow: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 1 },
  modalTitle: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 28 },
  modalClose: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  modalAction: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  modalActionDisabled: { opacity: 0.45 },
  modalActionIcon: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  modalActionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  modalActionTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 11 },
  modalActionTitleDisabled: { color: colors.textMuted },
  modalActionText: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 10, marginTop: 2 },
  soonBadge: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 7, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' },
});
