import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

import { colors, spacing } from '../../src/constants';
import { getProgressionDataContract } from '../../src/services/progressionDataService';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');

const PERIODS = [
  { id: '4w', label: '4 SEM.' },
  { id: '3m', label: '3 MOIS' },
  { id: '1y', label: '1 AN' },
];

const SECTIONS = {
  evolution: {
    eyebrow: 'TES RÉFÉRENCES',
    title: 'TON ÉVOLUTION',
  },
  coach: {
    eyebrow: 'COACH UGEROD',
    title: 'PROCHAINES ÉTAPES',
  },
  activity: {
    eyebrow: 'TON RYTHME',
    title: 'RÉGULARITÉ & ACTIVITÉ',
  },
  athletic: {
    eyebrow: 'TON PROFIL',
    title: 'PROFIL ATHLÉTIQUE',
  },
};

function percent01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return `${Math.round(Math.max(0, Math.min(1, number)) * 100)}%`;
}

function formatMinutes(value) {
  const total = Math.max(0, Math.round(Number(value ?? 0)));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours} h`;
  return `${hours} h ${minutes}`;
}

function formatWeekLabel(value) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
  })
    .format(new Date(`${value}T12:00:00`))
    .replace('.', '')
    .toUpperCase();
}

function formatSessionDate(value) {
  if (!value) return '';

  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
    .format(new Date(`${value}T12:00:00`))
    .replace('.', '')
    .toUpperCase();
}

function signalLabel(value) {
  switch (value) {
    case 'PROGRESSING': return 'EN PROGRESSION';
    case 'RECALIBRATING': return 'À RECALIBRER';
    case 'STABLE': return 'STABLE';
    default: return 'EN APPRENTISSAGE';
  }
}

function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function SectionTitle({ title, meta }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

function Metric({ value, label }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export default function ProgressionDetailScreen() {
  const params = useLocalSearchParams();
  const section = String(params?.section ?? 'evolution');
  const config = SECTIONS[section] ?? SECTIONS.evolution;

  const [period, setPeriod] = useState('4w');
  const [progression, setProgression] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      const data = await getProgressionDataContract(period);
      setProgression(data);
    } catch (loadError) {
      setError(loadError?.message ?? 'Impossible de charger cette analyse.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const movementCapabilities = progression?.movement_capabilities ?? [];
  const coachSignals = progression?.coach_signals ?? [];
  const athleteDimensions = progression?.athlete_profile?.dimensions ?? [];
  const athleticEvidence = progression?.athletic_evidence ?? [];
  const activity = progression?.activity ?? {};
  const activitySummary = activity?.summary ?? {};
  const currentWeek = activity?.current_week ?? {};
  const activePlanConsistency = activity?.active_plan_consistency ?? {};
  const consistencyWeeks = activity?.consistency_history?.weeks ?? [];
  const weeklyLoad = activity?.weekly_load ?? [];
  const recentSessions = activity?.recent_sessions ?? [];
  const profile = progression?.profile ?? {};
  const overall = progression?.overall ?? {};
  const maturity = progression?.maturity ?? {};

  const evidenceByDimension = useMemo(
    () => new Map(athleticEvidence.map((item) => [item.dimension, item])),
    [athleticEvidence]
  );

  const currentWeekRatio = Number(currentWeek.completion_ratio ?? 0);
  const currentWeekPercent = Number.isFinite(currentWeekRatio)
    ? Math.round(Math.max(0, Math.min(1, currentWeekRatio)) * 100)
    : 0;
  const weeklyTarget = Number(
    currentWeek.target_sessions ?? profile.weekly_session_target ?? 0
  );
  const currentWeekSessions = Number(currentWeek.realized_sessions ?? 0);

  if (loading && !progression) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color={colors.primaryLight} />
        <Text style={styles.loadingText}>ANALYSE DE TA PROGRESSION...</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <ImageBackground source={backgroundImage} style={styles.background} resizeMode="cover">
        <View style={styles.darkOverlay} />
        <LinearGradient
          colors={['rgba(7,9,12,0.42)', 'rgba(7,9,12,0.86)', 'rgba(7,9,12,0.99)']}
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
              <Pressable onPress={() => router.back()} style={styles.backButton}>
                <Ionicons name="arrow-back" size={21} color={colors.textPrimary} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>{config.eyebrow}</Text>
                <Text style={styles.title}>{config.title}<Text style={styles.blueDot}>.</Text></Text>
              </View>
            </View>

            <View style={styles.periodRow}>
              {PERIODS.map((item) => {
                const selected = item.id === period;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setPeriod(item.id)}
                    style={[styles.periodButton, selected && styles.periodButtonActive]}
                  >
                    <Text style={[styles.periodText, selected && styles.periodTextActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {error ? (
              <Card style={styles.errorCard}>
                <Ionicons name="alert-circle-outline" size={19} color={colors.brandRed} />
                <Text style={styles.errorText}>{error}</Text>
              </Card>
            ) : null}

            {section === 'evolution' ? (
              <>
                <Card style={styles.heroCard}>
                  <Text style={styles.cardEyebrow}>LECTURE UGEROD</Text>
                  <Text style={styles.heroTitle}>
                    {overall.state === 'PROGRESSING'
                      ? 'DES SIGNAUX DE PROGRESSION SE CONFIRMENT.'
                      : overall.state === 'RECALIBRATING'
                        ? 'CERTAINES RÉFÉRENCES SONT À RECALIBRER.'
                        : maturity.stage === 'ESTABLISHED'
                          ? 'TON PROFIL SE CONSOLIDE.'
                          : 'UGEROD APPREND ENCORE TON PROFIL.'}
                  </Text>
                  <Text style={styles.bodyText}>
                    {overall.text ?? 'Les prochaines séances permettront de rendre cette lecture plus fiable.'}
                  </Text>
                </Card>

                <View style={styles.metricRow}>
                  <Metric value={activitySummary.completed_sessions ?? 0} label="SÉANCES" />
                  <Metric value={formatMinutes(activitySummary.total_minutes)} label="TEMPS" />
                  <Metric value={`${currentWeekPercent}%`} label="RYTHME SEMAINE" />
                </View>

                <SectionTitle title="MOUVEMENTS QUI ÉVOLUENT" meta="PREUVES RÉELLES" />
                {movementCapabilities.length ? movementCapabilities.slice(0, 8).map((item) => (
                  <Card key={item.exercise_id}>
                    <View style={styles.rowBetween}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemTitle}>{item.name}</Text>
                        <Text style={styles.signalText}>{signalLabel(item.signal)}</Text>
                      </View>
                      <Text style={styles.confidenceText}>{percent01(item.confidence) ?? '—'}</Text>
                    </View>
                    <Text style={styles.itemMeta}>
                      {item.valid_evidence_count ?? 0} référence(s) valide(s) · fraîcheur {percent01(item.freshness) ?? '—'} · confiance de l’analyse
                    </Text>
                  </Card>
                )) : (
                  <Card><Text style={styles.bodyText}>Pas encore assez de références mouvement par mouvement.</Text></Card>
                )}
              </>
            ) : null}

            {section === 'coach' ? (
              <>
                <Card style={styles.heroCard}>
                  <Text style={styles.cardEyebrow}>PRINCIPE</Text>
                  <Text style={styles.heroTitle}>UNE RECOMMANDATION DOIT ÊTRE EXPLICABLE.</Text>
                  <Text style={styles.bodyText}>
                    UGEROD distingue ce qui progresse, ce qui doit être recalibré et ce qui manque encore de données. Une absence de référence n’est pas assimilée à une faiblesse.
                  </Text>
                </Card>

                <SectionTitle title="CE QU’UGEROD OBSERVE" meta="SIGNAL → ACTION" />
                {coachSignals.length ? coachSignals.map((signal, index) => (
                  <Card key={`${signal.type}-${index}`}>
                    <Text style={styles.itemTitle}>{signal.title}</Text>
                    <Text style={styles.bodyText}>{signal.text}</Text>
                  </Card>
                )) : (
                  <Card><Text style={styles.bodyText}>Aucune recommandation suffisamment fiable pour l’instant.</Text></Card>
                )}

                <SectionTitle title="PROCHAINES RÉFÉRENCES" meta="MOUVEMENTS" />
                {movementCapabilities
                  .filter((item) => ['PROGRESSING', 'RECALIBRATING'].includes(item.signal))
                  .slice(0, 6)
                  .map((item) => (
                    <Card key={item.exercise_id}>
                      <View style={styles.rowBetween}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemTitle}>{item.name}</Text>
                          <Text style={styles.signalText}>{signalLabel(item.signal)}</Text>
                        </View>
                        <Text style={styles.confidenceText}>{percent01(item.confidence) ?? '—'}</Text>
                      </View>
                      <Text style={styles.itemMeta}>
                        {item.valid_evidence_count ?? 0} référence(s) valide(s). UGEROD n’augmente pas la difficulté sur une seule observation isolée.
                      </Text>
                    </Card>
                  ))}
              </>
            ) : null}

            {section === 'activity' ? (
              <>
                <View style={styles.metricRow}>
                  <Metric value={activitySummary.completed_sessions ?? 0} label="SÉANCES" />
                  <Metric value={formatMinutes(activitySummary.total_minutes)} label="VOLUME" />
                  <Metric value={activitySummary.avg_rpe ?? '—'} label="RPE MOY." />
                </View>

                <SectionTitle title="RYTHME ACTUEL" meta={`OBJECTIF ${weeklyTarget} / SEM.`} />
                <Card>
                  <View style={styles.rowBetween}>
                    <View>
                      <Text style={styles.itemTitle}>CETTE SEMAINE</Text>
                      <Text style={styles.itemMeta}>{currentWeekSessions} séance(s) réalisée(s) sur {weeklyTarget}</Text>
                    </View>
                    <Text style={styles.confidenceText}>{currentWeekPercent}%</Text>
                  </View>
                  <View style={[styles.progressTrack, styles.currentWeekTrack]}>
                    <View style={[styles.progressFill, { width: `${currentWeekPercent}%` }]} />
                  </View>
                </Card>

                <SectionTitle title="RÉGULARITÉ DE LA PÉRIODE" meta="SEMAINES AVEC PLAN ACTIF" />
                <Card>
                  {consistencyWeeks.length ? consistencyWeeks.map((item) => {
                    const ratio = Math.max(0, Math.min(1, Number(item.completion_ratio ?? 0)));
                    return (
                      <View key={item.week_start} style={styles.progressRow}>
                        <Text style={styles.progressLabel}>{formatWeekLabel(item.week_start)}</Text>
                        <View style={styles.progressTrack}>
                          <View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%` }]} />
                        </View>
                        <Text style={styles.progressValue}>{item.realized_sessions}/{item.target_sessions}</Text>
                      </View>
                    );
                  }) : (
                    <Text style={styles.bodyText}>Pas encore assez de semaines planifiées pour afficher une tendance de régularité.</Text>
                  )}
                  <Text style={styles.footnote}>
                    Sur cette période : {activePlanConsistency.realized_sessions ?? 0}/{activePlanConsistency.target_sessions ?? 0} séance(s) réalisées sur les semaines réellement planifiées. Les semaines sans plan ne créent pas de dette.
                  </Text>
                </Card>

                <SectionTitle title="CHARGE D’ENTRAÎNEMENT" meta="DURÉE × RPE" />
                <Card>
                  {weeklyLoad.length ? weeklyLoad.map((item) => (
                    <View key={item.week_start} style={styles.loadRow}>
                      <Text style={styles.progressLabel}>{formatWeekLabel(item.week_start)}</Text>
                      <Text style={styles.loadValue}>{Math.round(item.load ?? 0)}</Text>
                    </View>
                  )) : (
                    <Text style={styles.bodyText}>Pas encore assez de charge enregistrée sur cette période.</Text>
                  )}
                  <Text style={styles.footnote}>Cette charge sert à comparer ton évolution à ton propre historique, pas à te noter.</Text>
                </Card>

                <SectionTitle title="DERNIÈRES SÉANCES" />
                {recentSessions.length ? recentSessions.map((session) => (
                  <Pressable
                    key={session.session_id}
                    onPress={() => router.push(`/workout/${session.session_id}`)}
                  >
                    <Card>
                      <View style={styles.rowBetween}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemTitle}>{session.target_region ?? session.focus ?? 'SÉANCE'}</Text>
                          <Text style={styles.itemMeta}>{formatSessionDate(session.session_date)}</Text>
                        </View>
                        <Text style={styles.signalText}>
                          {session.duration_minutes != null ? `${Math.round(session.duration_minutes)} MIN` : ''}
                        </Text>
                      </View>
                    </Card>
                  </Pressable>
                )) : (
                  <Card><Text style={styles.bodyText}>Aucune séance terminée sur cette période.</Text></Card>
                )}
              </>
            ) : null}

            {section === 'athletic' ? (
              <>
                <Card style={styles.heroCard}>
                  <Text style={styles.cardEyebrow}>PAS DE NOTE ARBITRAIRE /100</Text>
                  <Text style={styles.heroTitle}>NIVEAU + TENDANCE + FIABILITÉ.</Text>
                  <Text style={styles.bodyText}>
                    Les scores internes restent réservés au moteur. Ici, UGEROD affiche seulement un niveau fonctionnel lorsqu’il existe assez de références pour le défendre.
                  </Text>
                </Card>

                <SectionTitle title="TES DIMENSIONS" meta="FORCE · ENGINE · CONTRÔLE" />
                {athleteDimensions.map((dimension) => {
                  const evidence = evidenceByDimension.get(dimension.dimension);
                  const confidence = percent01(evidence?.confidence);
                  return (
                    <Card key={dimension.dimension}>
                      <View style={styles.rowBetween}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemTitle}>{dimension.label}</Text>
                          <Text style={styles.dimensionLevel}>{dimension.level}</Text>
                        </View>
                        <Text style={styles.trendText}>{dimension.trend_symbol} {dimension.trend_label}</Text>
                      </View>
                      <Text style={styles.itemMeta}>
                        {dimension.calibrated
                          ? `${evidence?.sample_count ?? 0} référence(s) valide(s) · confiance ${confidence ?? '—'}`
                          : 'UGEROD ne dispose pas encore d’assez de références fiables pour conclure.'}
                      </Text>
                    </Card>
                  );
                })}
              </>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  background: { flex: 1 },
  darkOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,6,9,0.62)' },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, paddingTop: 8, paddingBottom: 50, gap: 12 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  loadingText: { fontFamily: 'Oswald_600SemiBold', fontSize: 11, letterSpacing: 0.9, color: colors.textMuted },
  header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(17,21,26,0.84)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  eyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 10, letterSpacing: 1.1, color: colors.brandRed },
  title: { marginTop: 2, fontFamily: 'BebasNeue_400Regular', fontSize: 31, lineHeight: 33, letterSpacing: 1.2, color: colors.textPrimary },
  blueDot: { color: colors.primaryLight },
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  periodButton: { flex: 1, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(17,21,26,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  periodButtonActive: { backgroundColor: 'rgba(8,104,255,0.16)', borderColor: 'rgba(29,140,255,0.42)' },
  periodText: { fontFamily: 'Oswald_600SemiBold', fontSize: 10, color: colors.textMuted },
  periodTextActive: { color: colors.primaryLight },
  card: { padding: 16, borderRadius: 18, backgroundColor: 'rgba(17,21,26,0.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  heroCard: { paddingVertical: 20 },
  cardEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 9, letterSpacing: 1.1, color: colors.brandRed },
  heroTitle: { marginTop: 5, fontFamily: 'BebasNeue_400Regular', fontSize: 27, lineHeight: 30, letterSpacing: 1.1, color: colors.textPrimary },
  bodyText: { marginTop: 7, fontFamily: 'Oswald_400Regular', fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  errorText: { flex: 1, fontFamily: 'Oswald_400Regular', fontSize: 12, color: colors.textSecondary },
  metricRow: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, minHeight: 80, padding: 12, justifyContent: 'center', borderRadius: 16, backgroundColor: 'rgba(17,21,26,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  metricValue: { fontFamily: 'BebasNeue_400Regular', fontSize: 24, color: colors.textPrimary },
  metricLabel: { marginTop: 2, fontFamily: 'Oswald_600SemiBold', fontSize: 8, letterSpacing: 0.8, color: colors.textMuted },
  sectionHeader: { marginTop: 12, marginBottom: -2, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { fontFamily: 'BebasNeue_400Regular', fontSize: 24, letterSpacing: 1, color: colors.textPrimary },
  sectionMeta: { marginBottom: 3, fontFamily: 'Oswald_600SemiBold', fontSize: 8, letterSpacing: 0.7, color: colors.textMuted },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  itemTitle: { fontFamily: 'Oswald_700Bold', fontSize: 13, lineHeight: 18, color: colors.textPrimary },
  signalText: { marginTop: 3, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.7, color: colors.primaryLight },
  confidenceText: { fontFamily: 'BebasNeue_400Regular', fontSize: 22, color: colors.textPrimary },
  itemMeta: { marginTop: 8, fontFamily: 'Oswald_400Regular', fontSize: 10, lineHeight: 15, color: colors.textMuted },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 11 },
  progressLabel: { width: 54, fontFamily: 'Oswald_600SemiBold', fontSize: 9, color: colors.textSecondary },
  progressTrack: { flex: 1, height: 7, overflow: 'hidden', borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)' },
  currentWeekTrack: { marginTop: 14, flex: 0, width: '100%' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.primary },
  progressValue: { width: 32, textAlign: 'right', fontFamily: 'Oswald_600SemiBold', fontSize: 9, color: colors.textPrimary },
  loadRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  loadValue: { fontFamily: 'Oswald_700Bold', fontSize: 11, color: colors.textPrimary },
  footnote: { marginTop: 12, fontFamily: 'Oswald_400Regular', fontSize: 9, lineHeight: 14, color: colors.textMuted },
  dimensionLevel: { marginTop: 3, fontFamily: 'BebasNeue_400Regular', fontSize: 22, color: colors.textPrimary },
  trendText: { maxWidth: 125, textAlign: 'right', fontFamily: 'Oswald_600SemiBold', fontSize: 9, lineHeight: 14, color: colors.primaryLight },
});
