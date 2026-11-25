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
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../src/constants';
import { getProgressionDashboard } from '../../src/services/progressionService';
import { getPerformanceRecordBook } from '../../src/services/performanceRecordService';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

const PERIODS = [
  { id: '4w', label: '4 SEM.' },
  { id: '3m', label: '3 MOIS' },
  { id: '1y', label: '1 AN' },
];

const DIMENSION_ICONS = {
  strength: 'barbell-outline',
  conditioning: 'pulse-outline',
  power: 'flash-outline',
  stability: 'git-branch-outline',
  mobility: 'body-outline',
};

function confidenceLabel(value) {
  const confidence = Number(value ?? 0);
  if (confidence >= 70) return 'ÉLEVÉE';
  if (confidence >= 40) return 'MOYENNE';
  return 'FAIBLE';
}

function trendState(item) {
  const confidence = Number(item?.confidence ?? 0);
  const trend = Number(item?.trend ?? 0);

  if (confidence < 25) {
    return {
      key: 'LEARNING',
      label: 'EN APPRENTISSAGE',
      icon: 'ellipsis-horizontal-circle-outline',
    };
  }

  if (trend > 0.015) {
    return {
      key: 'UP',
      label: 'EN PROGRESSION',
      icon: 'trending-up-outline',
    };
  }

  if (trend < -0.015) {
    return {
      key: 'DOWN',
      label: 'À RECALIBRER',
      icon: 'trending-down-outline',
    };
  }

  return {
    key: 'STABLE',
    label: 'STABLE',
    icon: 'remove-outline',
  };
}

function explanationText(item) {
  const explanation = item?.explanation_json ?? {};
  return (
    explanation?.text ??
    explanation?.summary ??
    explanation?.reason ??
    null
  );
}

export default function ProgressionScreen() {
  const [period, setPeriod] = useState('4w');
  const [dashboard, setDashboard] = useState(null);
  const [prBook, setPrBook] = useState(null);
  const [expandedDimension, setExpandedDimension] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      const [progression, records] = await Promise.all([
        getProgressionDashboard(period),
        getPerformanceRecordBook().catch(() => null),
      ]);

      setDashboard(progression);
      setPrBook(records);
    } catch (loadError) {
      setError(loadError?.message ?? 'Impossible de charger ta progression.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const prCount = Number(
    prBook?.summary?.confirmed_entries ??
    prBook?.summary?.confirmedEntries ??
    0
  );

  const movementPreview = useMemo(
    () => (dashboard?.movements ?? []).slice(0, 4),
    [dashboard?.movements]
  );

  if (loading && !dashboard) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <Image source={brandIcon} style={styles.loadingLogo} resizeMode="contain" />
        <ActivityIndicator color={colors.primaryLight} />
        <Text style={styles.loadingText}>LECTURE DE TA PROGRESSION...</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <ImageBackground source={backgroundImage} resizeMode="cover" style={styles.background}>
        <View style={styles.darkOverlay} />
        <LinearGradient
          colors={['rgba(7,9,12,0.34)', 'rgba(7,9,12,0.72)', 'rgba(7,9,12,0.99)']}
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
                <Text style={styles.headerEyebrow}>CE QUI CHANGE CHEZ TOI</Text>
                <Text style={styles.headerTitle}>
                  PROGRESSION<Text style={styles.blueDot}>.</Text>
                </Text>
              </View>
              <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
            </View>

            <View style={styles.periodRow}>
              {PERIODS.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => setPeriod(item.id)}
                  style={[styles.periodButton, item.id === period && styles.periodButtonSelected]}
                >
                  <Text style={[styles.periodText, item.id === period && styles.periodTextSelected]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>

            {error ? (
              <View style={styles.errorCard}>
                <Ionicons name="alert-circle-outline" size={19} color={colors.brandRed} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.kpiGrid}>
              <KpiCard
                icon="checkmark-circle-outline"
                value={dashboard?.summary?.completedSessions ?? 0}
                label="SÉANCES"
              />
              <KpiCard
                icon="calendar-outline"
                value={`${dashboard?.summary?.regularityPercent ?? 0}%`}
                label="RÉGULARITÉ"
              />
              <KpiCard
                icon="time-outline"
                value={dashboard?.summary?.totalTimeLabel ?? '0 min'}
                label="TEMPS"
                compact
              />
            </View>

            <SectionHeader title="LECTURE DU COACH" meta="SYNTHÈSE" />

            <View style={styles.coachCard}>
              {(dashboard?.coachObservations ?? []).map((observation, index) => (
                <View
                  key={`${observation.title}-${index}`}
                  style={[styles.observationRow, index < (dashboard?.coachObservations?.length ?? 0) - 1 && styles.rowBorder]}
                >
                  <View style={styles.observationIcon}>
                    <Ionicons name={observation.icon ?? 'analytics-outline'} size={17} color={colors.primaryLight} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.observationTitle}>{observation.title}</Text>
                    <Text style={styles.observationText}>{observation.text}</Text>
                  </View>
                </View>
              ))}
            </View>

            <SectionHeader title="TON PROFIL SPORTIF" meta="TENDANCE + FIABILITÉ" />

            <View style={styles.dimensionList}>
              {(dashboard?.athleticProfile ?? []).length > 0 ? (
                dashboard.athleticProfile.map((item) => {
                  const state = trendState(item);
                  const expanded = expandedDimension === item.dimension;

                  return (
                    <Pressable
                      key={item.dimension}
                      onPress={() => setExpandedDimension((current) => current === item.dimension ? null : item.dimension)}
                      style={styles.dimensionCard}
                    >
                      <View style={styles.dimensionTop}>
                        <View style={styles.dimensionIdentity}>
                          <View style={styles.dimensionIcon}>
                            <Ionicons
                              name={DIMENSION_ICONS[item.dimension] ?? 'analytics-outline'}
                              size={18}
                              color={colors.primaryLight}
                            />
                          </View>
                          <View>
                            <Text style={styles.dimensionName}>{item.label}</Text>
                            <Text style={styles.dimensionConfidence}>FIABILITÉ {confidenceLabel(item.confidence)}</Text>
                          </View>
                        </View>

                        <View style={styles.dimensionStateWrap}>
                          <Ionicons name={state.icon} size={16} color={state.key === 'DOWN' ? colors.brandRed : colors.primaryLight} />
                          <Text style={[styles.dimensionState, state.key === 'DOWN' && styles.dimensionStateDown]}>{state.label}</Text>
                          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textMuted} />
                        </View>
                      </View>

                      {expanded ? (
                        <View style={styles.dimensionDetails}>
                          <DetailLine label="CONCLUSION" value={state.label} />
                          <DetailLine label="FIABILITÉ" value={confidenceLabel(item.confidence)} />
                          <DetailLine label="REPÈRES ANALYSÉS" value={String(item.sample_count ?? 0)} />
                          {explanationText(item) ? (
                            <Text style={styles.dimensionExplanation}>{explanationText(item)}</Text>
                          ) : (
                            <Text style={styles.dimensionExplanation}>
                              UGEROD croise les performances, la régularité et la répétition des observations. Aucun score arbitraire sur 100 n’est utilisé ici.
                            </Text>
                          )}
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })
              ) : (
                <EmptyCard text="UGEROD a besoin de quelques séances pour commencer à établir des tendances fiables." />
              )}
            </View>

            <SectionHeader title="CARNET DE RECORDS" meta="PAGE DÉDIÉE" />

            <Pressable
              onPress={() => router.push('/progression/records')}
              style={({ pressed }) => [styles.prBookCard, pressed && styles.pressed]}
            >
              <View style={styles.prBookIcon}>
                <Ionicons name="book-outline" size={25} color={colors.primaryLight} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.prBookEyebrow}>TON LIVRE DE RÉFÉRENCES</Text>
                <Text style={styles.prBookTitle}>CARNET DE PR</Text>
                <Text style={styles.prBookText}>
                  {prCount > 0
                    ? `${prCount} record${prCount > 1 ? 's' : ''} confirmé${prCount > 1 ? 's' : ''} · ouvre le carnet pour voir les estimations et l’historique.`
                    : 'Ajoute tes premiers PR pour aider UGEROD à mieux calibrer ton niveau de départ.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
            </Pressable>

            <SectionHeader title="MOUVEMENTS SUIVIS" meta="APERÇU" />

            {movementPreview.length > 0 ? (
              <View style={styles.movementList}>
                {movementPreview.map((movement) => (
                  <Pressable
                    key={movement.id}
                    onPress={() => router.push(`/exercise/${movement.id}`)}
                    style={({ pressed }) => [styles.movementCard, pressed && styles.pressed]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.movementName}>{movement.name}</Text>
                      <Text style={styles.movementMeta}>
                        {movement.stateLabel ?? 'EN APPRENTISSAGE'} · {movement.exposureCount ?? 0} EXPOSITION{(movement.exposureCount ?? 0) > 1 ? 'S' : ''}
                      </Text>
                    </View>
                    {movement.currentValue ? <Text style={styles.movementValue}>{movement.currentValue}</Text> : null}
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <EmptyCard text="Les mouvements suivis apparaîtront lorsque le moteur aura des observations exploitables." />
            )}

            <SectionHeader title="HISTORIQUE" meta="DERNIÈRES SÉANCES" />

            {(dashboard?.recentSessions ?? []).length > 0 ? (
              <View style={styles.historyList}>
                {dashboard.recentSessions.map((session) => (
                  <Pressable
                    key={session.id}
                    onPress={() => router.push(`/workout/${session.id}`)}
                    style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}
                  >
                    <View style={styles.historyCheck}>
                      <Ionicons name="checkmark" size={13} color={colors.brandWhite} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyDate}>{session.date}</Text>
                      <Text style={styles.historyTitle}>{session.title}</Text>
                    </View>
                    <Text style={styles.historyDuration}>{session.duration}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <EmptyCard text="Aucune séance terminée sur cette période." />
            )}

            <View style={styles.methodCard}>
              <Ionicons name="information-circle-outline" size={20} color={colors.primaryLight} />
              <View style={{ flex: 1 }}>
                <Text style={styles.methodTitle}>PAS DE NOTE MAGIQUE.</Text>
                <Text style={styles.methodText}>
                  UGEROD sépare ce que tu sais faire, la tendance de progression et la confiance dans cette conclusion. Un niveau chiffré ne sera affiché que lorsqu’il pourra être justifié par un référentiel clair.
                </Text>
              </View>
            </View>

            <View style={styles.bottomSpace} />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function KpiCard({ icon, value, label, compact }) {
  return (
    <View style={styles.kpiCard}>
      <Ionicons name={icon} size={17} color={colors.primaryLight} />
      <Text style={[styles.kpiValue, compact && styles.kpiValueCompact]} numberOfLines={1}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title, meta }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionMeta}>{meta}</Text>
    </View>
  );
}

function DetailLine({ label, value }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function EmptyCard({ text }) {
  return (
    <View style={styles.emptyCard}>
      <Ionicons name="analytics-outline" size={20} color={colors.textMuted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  background: { flex: 1 },
  darkOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,6,9,0.52)' },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 100 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  loadingLogo: { width: 46, height: 46 },
  loadingText: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 11, letterSpacing: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 15 },
  profileButton: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  headerText: { flex: 1 },
  headerEyebrow: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 1.3 },
  headerTitle: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 36 },
  blueDot: { color: colors.primaryLight },
  brandIcon: { width: 38, height: 38 },
  periodRow: { flexDirection: 'row', gap: 7, marginBottom: 15 },
  periodButton: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  periodButtonSelected: { backgroundColor: 'rgba(73,157,255,0.13)', borderColor: 'rgba(73,157,255,0.24)' },
  periodText: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 9 },
  periodTextSelected: { color: colors.primaryLight },
  errorCard: { flexDirection: 'row', gap: 10, padding: 13, borderRadius: 14, backgroundColor: 'rgba(180,35,45,0.12)', borderWidth: 1, borderColor: 'rgba(255,90,100,0.18)', marginBottom: 12 },
  errorText: { flex: 1, color: colors.textSecondary, fontFamily: 'Oswald_400Regular', fontSize: 12 },
  kpiGrid: { flexDirection: 'row', gap: 8 },
  kpiCard: { flex: 1, minHeight: 99, padding: 12, justifyContent: 'center', borderRadius: 16, backgroundColor: 'rgba(11,15,20,0.90)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  kpiValue: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 28, marginTop: 5 },
  kpiValueCompact: { fontSize: 20 },
  kpiLabel: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 8, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 25, marginBottom: 9 },
  sectionTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 14, letterSpacing: 0.7 },
  sectionMeta: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 8, letterSpacing: 0.4 },
  coachCard: { paddingHorizontal: 15, borderRadius: 18, backgroundColor: 'rgba(11,15,20,0.90)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  observationRow: { flexDirection: 'row', gap: 11, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  observationIcon: { width: 33, height: 33, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(73,157,255,0.09)' },
  observationTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 11 },
  observationText: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 10, lineHeight: 15, marginTop: 3 },
  dimensionList: { gap: 8 },
  dimensionCard: { padding: 15, borderRadius: 17, backgroundColor: 'rgba(11,15,20,0.90)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  dimensionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dimensionIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  dimensionIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(73,157,255,0.09)' },
  dimensionName: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 12 },
  dimensionConfidence: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 8, marginTop: 2 },
  dimensionStateWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dimensionState: { color: colors.primaryLight, fontFamily: 'Oswald_600SemiBold', fontSize: 8 },
  dimensionStateDown: { color: colors.brandRed },
  dimensionDetails: { marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 8 },
  detailValue: { color: colors.textSecondary, fontFamily: 'Oswald_600SemiBold', fontSize: 9 },
  dimensionExplanation: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 10, lineHeight: 16, marginTop: 9 },
  prBookCard: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 17, borderRadius: 18, backgroundColor: 'rgba(29,66,108,0.15)', borderWidth: 1, borderColor: 'rgba(73,157,255,0.18)' },
  prBookIcon: { width: 47, height: 47, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(73,157,255,0.10)' },
  prBookEyebrow: { color: colors.primaryLight, fontFamily: 'Oswald_600SemiBold', fontSize: 8, letterSpacing: 0.6 },
  prBookTitle: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 24, marginTop: 1 },
  prBookText: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 10, lineHeight: 15, marginTop: 2 },
  movementList: { gap: 7 },
  movementCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 13, borderRadius: 15, backgroundColor: 'rgba(11,15,20,0.84)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  movementName: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 11 },
  movementMeta: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 8, marginTop: 2 },
  movementValue: { color: colors.textSecondary, fontFamily: 'Oswald_600SemiBold', fontSize: 10 },
  historyList: { borderRadius: 17, paddingHorizontal: 14, backgroundColor: 'rgba(11,15,20,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  historyCheck: { width: 27, height: 27, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  historyDate: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 8 },
  historyTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 10, marginTop: 2 },
  historyDuration: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 9 },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 16, borderRadius: 16, backgroundColor: 'rgba(11,15,20,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  emptyText: { flex: 1, color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 11, lineHeight: 17 },
  methodCard: { flexDirection: 'row', gap: 11, padding: 15, borderRadius: 16, backgroundColor: 'rgba(73,157,255,0.07)', borderWidth: 1, borderColor: 'rgba(73,157,255,0.12)', marginTop: 25 },
  methodTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 10 },
  methodText: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 10, lineHeight: 15, marginTop: 3 },
  pressed: { opacity: 0.78 },
  bottomSpace: { height: 25 },
});
