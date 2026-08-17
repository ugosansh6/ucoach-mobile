import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

import { colors, spacing } from '../../src/constants';
import { getProgressionDashboard } from '../../src/services/progressionService';
import { getProgressionInsights } from '../../src/services/progressionInsightsService';
import { getPerformanceRecordBook } from '../../src/services/performanceRecordService';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

function experienceLabel(value) {
  const raw = String(value ?? '').toLowerCase();
  if (raw.includes('begin') || raw.includes('début')) return 'DÉBUTANT';
  if (raw.includes('advance') || raw.includes('avanc')) return 'AVANCÉ';
  return 'INTERMÉDIAIRE';
}

function signalLabel(value) {
  switch (value) {
    case 'PROGRESSING': return 'PROGRESSION À CONFIRMER';
    case 'RECALIBRATING': return 'RÉFÉRENCE À RECALIBRER';
    case 'STABLE': return 'RÉFÉRENCE STABLE';
    default: return 'EN APPRENTISSAGE';
  }
}

function confidenceLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const percent = Math.round(Math.max(0, Math.min(1, number)) * 100);
  if (percent >= 70) return `confiance forte · ${percent}%`;
  if (percent >= 45) return `confiance moyenne · ${percent}%`;
  return `confiance faible · ${percent}%`;
}

function HubCard({ icon, eyebrow, title, value, text, meta, onPress, accent = 'blue' }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.hubCard, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, accent === 'red' && styles.iconBoxRed]}>
        <Ionicons
          name={icon}
          size={21}
          color={accent === 'red' ? colors.brandRed : colors.primaryLight}
        />
      </View>

      <View style={styles.cardMain}>
        <Text style={styles.cardEyebrow}>{eyebrow}</Text>
        <Text style={styles.cardTitle}>{title}</Text>
        {value ? <Text style={styles.cardValue}>{value}</Text> : null}
        {text ? <Text style={styles.cardText}>{text}</Text> : null}
        {meta ? <Text style={styles.cardMeta}>{meta}</Text> : null}
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export default function ProgressionScreen() {
  const [dashboard, setDashboard] = useState(null);
  const [insights, setInsights] = useState(null);
  const [recordBook, setRecordBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      const [dashboardData, insightsData, recordsData] = await Promise.all([
        getProgressionDashboard('4w'),
        getProgressionInsights('4w'),
        getPerformanceRecordBook(),
      ]);

      setDashboard(dashboardData);
      setInsights(insightsData);
      setRecordBook(recordsData);
    } catch (loadError) {
      setError(loadError?.message ?? 'Impossible de charger ta progression.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const movementCapabilities = insights?.intelligence?.movement_capabilities ?? [];
  const nextMovement = useMemo(
    () => movementCapabilities.find((item) => item.signal === 'PROGRESSING')
      ?? movementCapabilities.find((item) => item.signal === 'RECALIBRATING')
      ?? null,
    [movementCapabilities]
  );

  const athleteDimensions = insights?.athleteSummary?.dimensions ?? [];
  const calibratedDimensions = athleteDimensions.filter((item) => item.calibrated);
  const trendingDimension = calibratedDimensions.find((item) => item.trend_symbol === '↗')
    ?? calibratedDimensions[0]
    ?? null;

  const records = recordBook?.current_records ?? recordBook?.currentRecords ?? [];
  const suggestions = recordBook?.suggestions_to_confirm ?? recordBook?.suggestionsToConfirm ?? [];

  const overallState = insights?.intelligence?.overall?.state;
  const heroTitle = overallState === 'PROGRESSING'
    ? 'TA PROGRESSION COMMENCE À SE CONFIRMER.'
    : overallState === 'RECALIBRATING'
      ? 'UGEROD RECALIBRE CERTAINES RÉFÉRENCES.'
      : insights?.intelligence?.data_maturity?.stage === 'ESTABLISHED'
        ? 'TON PROFIL SE CONSOLIDE.'
        : 'UGEROD APPREND TON PROFIL.';

  const heroText = insights?.intelligence?.overall?.text
    ?? 'Chaque séance enrichit ton profil et rend les prochaines décisions du Coach plus fiables.';

  if (loading && !dashboard) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <Image source={brandIcon} style={styles.loadingLogo} resizeMode="contain" />
        <ActivityIndicator size="small" color={colors.primaryLight} />
        <Text style={styles.loadingText}>ANALYSE DE TA PROGRESSION...</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <ImageBackground source={backgroundImage} resizeMode="cover" style={styles.background}>
        <View style={styles.darkOverlay} />
        <LinearGradient
          colors={['rgba(7,9,12,0.34)', 'rgba(7,9,12,0.68)', 'rgba(7,9,12,0.96)', 'rgba(7,9,12,1)']}
          locations={[0, 0.22, 0.55, 1]}
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
                <Ionicons name="person-outline" size={21} color={colors.textPrimary} />
              </Pressable>

              <View style={styles.headerText}>
                <Text style={styles.headerEyebrow}>TON PROFIL ATHLÈTE</Text>
                <Text style={styles.headerTitle}>
                  {(insights?.profile?.firstname || 'TOI').toUpperCase()}
                  <Text style={styles.blueDot}>.</Text>
                </Text>
                <Text style={styles.headerMeta}>
                  {experienceLabel(insights?.profile?.experience)} · OBJECTIF {dashboard?.summary?.weeklyTarget ?? insights?.profile?.weekly_session_target ?? 0} SÉANCES / SEM.
                </Text>
              </View>

              <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
            </View>

            {error ? (
              <View style={styles.errorCard}>
                <Ionicons name="alert-circle-outline" size={19} color={colors.brandRed} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>BILAN · 4 DERNIÈRES SEMAINES</Text>
              <Text style={styles.heroTitle}>{heroTitle}</Text>
              <Text style={styles.heroText}>{heroText}</Text>

              <View style={styles.heroStats}>
                <View>
                  <Text style={styles.heroStatValue}>{dashboard?.summary?.completedSessions ?? 0}</Text>
                  <Text style={styles.heroStatLabel}>SÉANCES</Text>
                </View>
                <View style={styles.heroDivider} />
                <View>
                  <Text style={styles.heroStatValue}>{dashboard?.summary?.regularityPercent ?? 0}%</Text>
                  <Text style={styles.heroStatLabel}>RÉGULARITÉ</Text>
                </View>
                <View style={styles.heroDivider} />
                <View>
                  <Text style={styles.heroStatValue}>{records.length}</Text>
                  <Text style={styles.heroStatLabel}>PR</Text>
                </View>
              </View>
            </View>

            <Text style={styles.sectionLabel}>TON TABLEAU DE BORD</Text>

            <HubCard
              icon="trending-up-outline"
              eyebrow="ÉVOLUTION"
              title="VOIR CE QUI CHANGE"
              value={insights?.intelligence?.overall?.state === 'PROGRESSING' ? 'SIGNAUX POSITIFS' : 'SUIVI EN COURS'}
              text="Performances réelles, mouvements qui progressent et niveau de fiabilité des conclusions."
              onPress={() => router.push('/progression/detail?section=evolution')}
            />

            <HubCard
              icon="navigate-circle-outline"
              eyebrow="COACH"
              title="TES PROCHAINES ÉTAPES"
              value={nextMovement ? `${nextMovement.name}` : 'UGEROD AFFINE TON PROFIL'}
              text={nextMovement
                ? `${signalLabel(nextMovement.signal)} · ${nextMovement.valid_evidence_count ?? 0} référence(s) valide(s)`
                : 'Pas de recommandation forte sans données suffisamment fiables.'}
              meta={nextMovement ? confidenceLabel(nextMovement.confidence) : null}
              onPress={() => router.push('/progression/detail?section=coach')}
              accent="red"
            />

            <HubCard
              icon="trophy-outline"
              eyebrow="TES RÉFÉRENCES"
              title="CARNET DE PR"
              value={`${records.length} RECORD${records.length > 1 ? 'S' : ''}`}
              text={suggestions.length
                ? `${suggestions.length} nouveau${suggestions.length > 1 ? 'x' : ''} record${suggestions.length > 1 ? 's' : ''} potentiel${suggestions.length > 1 ? 's' : ''} à confirmer.`
                : 'Tes records confirmés restent distincts des estimations du Coach.'}
              onPress={() => router.push('/progression/records')}
            />

            <HubCard
              icon="calendar-outline"
              eyebrow="RÉGULARITÉ & ACTIVITÉ"
              title="TON RYTHME D’ENTRAÎNEMENT"
              value={`${dashboard?.summary?.regularityPercent ?? 0}% DE TON OBJECTIF`}
              text={`${dashboard?.summary?.completedSessions ?? 0} séance(s) · ${dashboard?.summary?.totalTimeLabel ?? '0 min'} sur les 4 dernières semaines.`}
              onPress={() => router.push('/progression/detail?section=activity')}
            />

            <HubCard
              icon="analytics-outline"
              eyebrow="PROFIL ATHLÉTIQUE"
              title="TES QUALITÉS PHYSIQUES"
              value={trendingDimension
                ? `${trendingDimension.label} · ${trendingDimension.level}`
                : `${calibratedDimensions.length}/5 DIMENSIONS CALIBRÉES`}
              text={trendingDimension
                ? `${trendingDimension.trend_symbol} ${trendingDimension.trend_label}. Aucun score arbitraire /100 n’est affiché.`
                : 'Force fonctionnelle, conditioning, puissance, stabilité et mobilité se calibrent avec tes références réelles.'}
              onPress={() => router.push('/progression/detail?section=athletic')}
            />

            <Text style={styles.footerNote}>
              UGEROD privilégie les preuves observées. Une qualité peu travaillée ou limitée par le matériel n’est pas automatiquement considérée comme une faiblesse.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  background: { flex: 1 },
  darkOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,6,9,0.60)' },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, paddingTop: 8, paddingBottom: 46 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  loadingLogo: { width: 42, height: 42 },
  loadingText: { fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 1, color: colors.textMuted },
  header: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(17,21,26,0.84)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  headerText: { flex: 1 },
  headerEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 9, letterSpacing: 1.1, color: colors.brandRed },
  headerTitle: { marginTop: 1, fontFamily: 'BebasNeue_400Regular', fontSize: 31, lineHeight: 33, letterSpacing: 1.3, color: colors.textPrimary },
  blueDot: { color: colors.primaryLight },
  headerMeta: { marginTop: 1, fontFamily: 'Oswald_600SemiBold', fontSize: 8, letterSpacing: 0.55, color: colors.textMuted },
  brandIcon: { width: 34, height: 34, opacity: 0.94 },
  errorCard: { marginTop: 8, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, backgroundColor: 'rgba(17,21,26,0.92)', borderWidth: 1, borderColor: 'rgba(255,82,82,0.20)' },
  errorText: { flex: 1, fontFamily: 'Oswald_400Regular', fontSize: 11, color: colors.textSecondary },
  heroCard: { marginTop: 14, padding: 20, borderRadius: 22, backgroundColor: 'rgba(13,18,25,0.95)', borderWidth: 1, borderColor: 'rgba(29,140,255,0.24)' },
  heroEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 9, letterSpacing: 1.1, color: colors.primaryLight },
  heroTitle: { marginTop: 7, fontFamily: 'BebasNeue_400Regular', fontSize: 31, lineHeight: 33, letterSpacing: 1.1, color: colors.textPrimary },
  heroText: { marginTop: 8, fontFamily: 'Oswald_400Regular', fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  heroStats: { marginTop: 18, paddingTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  heroStatValue: { textAlign: 'center', fontFamily: 'BebasNeue_400Regular', fontSize: 24, color: colors.textPrimary },
  heroStatLabel: { marginTop: 1, textAlign: 'center', fontFamily: 'Oswald_600SemiBold', fontSize: 8, letterSpacing: 0.75, color: colors.textMuted },
  heroDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.08)' },
  sectionLabel: { marginTop: 25, marginBottom: 9, fontFamily: 'Oswald_700Bold', fontSize: 9, letterSpacing: 1.15, color: colors.textMuted },
  hubCard: { minHeight: 122, marginBottom: 11, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 19, backgroundColor: 'rgba(17,21,26,0.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  pressed: { opacity: 0.72 },
  iconBox: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(8,104,255,0.13)' },
  iconBoxRed: { backgroundColor: 'rgba(255,59,59,0.11)' },
  cardMain: { flex: 1 },
  cardEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 8, letterSpacing: 1, color: colors.textMuted },
  cardTitle: { marginTop: 2, fontFamily: 'BebasNeue_400Regular', fontSize: 22, lineHeight: 24, letterSpacing: 0.9, color: colors.textPrimary },
  cardValue: { marginTop: 5, fontFamily: 'Oswald_700Bold', fontSize: 11, lineHeight: 16, color: colors.primaryLight },
  cardText: { marginTop: 4, fontFamily: 'Oswald_400Regular', fontSize: 10, lineHeight: 15, color: colors.textSecondary },
  cardMeta: { marginTop: 5, fontFamily: 'Oswald_600SemiBold', fontSize: 8, letterSpacing: 0.5, color: colors.textMuted },
  footerNote: { marginTop: 12, paddingHorizontal: 8, fontFamily: 'Oswald_400Regular', fontSize: 9, lineHeight: 14, textAlign: 'center', color: colors.textMuted },
});
