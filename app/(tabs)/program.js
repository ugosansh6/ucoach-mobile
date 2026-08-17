import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';

import { colors } from '../../src/constants';
import { getProgramCoachSnapshot } from '../../src/services/programCoachService';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

const ROLE_LABELS = {
  PRIORITY: 'PRIORITÉ',
  DEVELOP: 'DÉVELOPPEMENT',
  MAINTAIN: 'ENTRETIEN',
  SUPPORT: 'SUPPORT',
};

const PHASE_LABELS = {
  CALIBRATE: 'CALIBRATION',
  BUILD: 'CONSTRUCTION',
  PROGRESS: 'PROGRESSION',
  CONSOLIDATE: 'CONSOLIDATION',
  RECALIBRATE: 'RECALIBRATION',
  DELOAD: 'ALLÈGEMENT',
};

function humanize(value) {
  if (!value) return '—';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function roleStrength(role) {
  switch (role) {
    case 'PRIORITY':
      return 1;
    case 'DEVELOP':
      return 0.76;
    case 'MAINTAIN':
      return 0.5;
    default:
      return 0.32;
  }
}

export default function ProgramScreen() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      setSnapshot(await getProgramCoachSnapshot());
    } catch (loadError) {
      setError(loadError?.message ?? 'Impossible de charger ton programme.');
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

  if (loading && !snapshot) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <Image source={brandIcon} style={styles.loadingLogo} resizeMode="contain" />
        <ActivityIndicator size="small" color={colors.primaryLight} />
        <Text style={styles.loadingText}>CONSTRUCTION DE TA TRAJECTOIRE...</Text>
      </SafeAreaView>
    );
  }

  const block = snapshot?.block;
  const weekIndex = Math.max(1, block?.currentWeekIndex ?? 1);
  const weeks = Math.max(1, block?.nominalWeeks ?? 4);
  const progress = Math.min(1, weekIndex / weeks);
  const isCalibration = !snapshot?.isActive;

  return (
    <View style={styles.screen}>
      <ImageBackground source={backgroundImage} style={styles.background} resizeMode="cover">
        <View style={styles.darkOverlay} />
        <LinearGradient
          colors={['rgba(7,9,12,0.32)', 'rgba(7,9,12,0.72)', 'rgba(7,9,12,0.98)']}
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
              <View>
                <Text style={styles.eyebrow}>TA TRAJECTOIRE</Text>
                <Text style={styles.title}>
                  PROGRAMME<Text style={styles.blueDot}>.</Text>
                </Text>
              </View>
              <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
            </View>

            {error ? (
              <View style={styles.errorCard}>
                <Ionicons name="alert-circle-outline" size={20} color={colors.brandRed} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.heroCard}>
              <View style={styles.heroTop}>
                <View style={styles.phaseBadge}>
                  <Text style={styles.phaseBadgeText}>
                    {PHASE_LABELS[block?.phase] ?? humanize(block?.phase ?? 'CALIBRATE')}
                  </Text>
                </View>
                <Text style={styles.weekLabel}>SEMAINE {weekIndex} / {weeks}</Text>
              </View>

              <Text style={styles.heroEyebrow}>
                {isCalibration ? 'UGEROD PRÉPARE TON PREMIER BLOC' : 'BLOC ACTUEL'}
              </Text>
              <Text style={styles.heroTitle}>{humanize(block?.primaryGoal ?? 'PROGRAMME ADAPTATIF')}</Text>
              <Text style={styles.heroText}>
                {isCalibration
                  ? 'Les premières références servent à calibrer ton niveau réel avant de donner plus d’autorité au programme multi-semaines.'
                  : 'UGEROD ajuste chaque semaine la trajectoire selon ce que tu réalises vraiment, sans créer de dette si ton rythme change.'}
              </Text>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
            </View>

            <SectionTitle title="PRIORITÉS DU BLOC" meta="PAS TOUT À LA FOIS" />

            <View style={styles.card}>
              {block?.priorities?.length ? (
                block.priorities.map((item, index) => (
                  <View
                    key={`${item.key}-${item.role}`}
                    style={[styles.priorityRow, index < block.priorities.length - 1 && styles.rowBorder]}
                  >
                    <View style={styles.priorityHeader}>
                      <Text style={styles.priorityName}>{humanize(item.key)}</Text>
                      <Text style={styles.priorityRole}>{ROLE_LABELS[item.role] ?? humanize(item.role)}</Text>
                    </View>
                    <View style={styles.priorityTrack}>
                      <View
                        style={[
                          styles.priorityFill,
                          { width: `${Math.round(roleStrength(item.role) * 100)}%` },
                        ]}
                      />
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.mutedText}>Les priorités apparaîtront après la première calibration.</Text>
              )}
            </View>

            <SectionTitle title="POURQUOI CE PROGRAMME ?" meta="COACH" />

            <View style={styles.coachCard}>
              <Ionicons name="sparkles-outline" size={21} color={colors.primaryLight} />
              <View style={styles.coachTextWrap}>
                <Text style={styles.coachTitle}>UNE DIRECTION, PAS UN CALENDRIER RIGIDE.</Text>
                <Text style={styles.coachText}>
                  L’objectif principal guide le bloc. Les autres qualités sont développées, entretenues ou utilisées en support. La séance du jour reste adaptée à ta forme, tes douleurs, ton matériel et ta charge récente.
                </Text>
              </View>
            </View>

            <SectionTitle title="CHARGE RÉCENTE" meta="7 / 14 / 28 JOURS" />

            <View style={styles.loadGrid}>
              <MetricCard label="7 JOURS" value={snapshot?.recentLoad?.sessions7d ?? 0} suffix="SÉANCES" />
              <MetricCard label="14 JOURS" value={snapshot?.recentLoad?.sessions14d ?? 0} suffix="SÉANCES" />
              <MetricCard label="PRESSION" value={humanize(snapshot?.recentLoad?.pressure)} compact />
            </View>

            <SectionTitle title="PROGRAMMES SPÉCIALISÉS" meta="À VENIR" />

            <View style={styles.bootcampGrid}>
              <BootcampCard icon="hand-left-outline" title="HANDSTAND" subtitle="SKILL BOOTCAMP" />
              <BootcampCard icon="barbell-outline" title="FULL KETTLEBELL" subtitle="MATÉRIEL" />
              <BootcampCard icon="speedometer-outline" title="HYROX" subtitle="SPORT SPÉCIFIQUE" />
              <BootcampCard icon="fitness-outline" title="MUSCLE-UP" subtitle="SKILL BOOTCAMP" />
            </View>

            <Text style={styles.futureHint}>
              Les futurs Bootcamps utiliseront le même Coach Engine : ils changeront la priorité du programme, jamais les règles de sécurité ou de récupération.
            </Text>

            <View style={styles.bottomSpace} />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function SectionTitle({ title, meta }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionMeta}>{meta}</Text>
    </View>
  );
}

function MetricCard({ label, value, suffix, compact }) {
  return (
    <View style={styles.metricCard}>
      <Text style={[styles.metricValue, compact && styles.metricValueCompact]} numberOfLines={1}>
        {value}
      </Text>
      {suffix ? <Text style={styles.metricSuffix}>{suffix}</Text> : null}
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function BootcampCard({ icon, title, subtitle }) {
  return (
    <View style={styles.bootcampCard}>
      <View style={styles.bootcampIcon}>
        <Ionicons name={icon} size={19} color={colors.textSecondary} />
      </View>
      <Text style={styles.bootcampTitle}>{title}</Text>
      <Text style={styles.bootcampSubtitle}>{subtitle}</Text>
      <View style={styles.soonBadge}>
        <Text style={styles.soonText}>BIENTÔT</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  background: { flex: 1 },
  darkOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,6,9,0.55)' },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 96 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: colors.background },
  loadingLogo: { width: 48, height: 48 },
  loadingText: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 11, letterSpacing: 1.1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  eyebrow: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 11, letterSpacing: 1.5 },
  title: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 39, letterSpacing: 0.8 },
  blueDot: { color: colors.primaryLight },
  brandIcon: { width: 40, height: 40 },
  errorCard: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 14, backgroundColor: 'rgba(180,35,45,0.12)', borderWidth: 1, borderColor: 'rgba(255,90,100,0.18)', marginBottom: 16 },
  errorText: { flex: 1, color: colors.textSecondary, fontFamily: 'Oswald_400Regular', fontSize: 13 },
  heroCard: { padding: 20, borderRadius: 20, backgroundColor: 'rgba(11,15,20,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  phaseBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(73,157,255,0.13)', borderWidth: 1, borderColor: 'rgba(73,157,255,0.24)' },
  phaseBadgeText: { color: colors.primaryLight, fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 0.8 },
  weekLabel: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 11 },
  heroEyebrow: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 1.2 },
  heroTitle: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 31, marginTop: 3 },
  heroText: { color: colors.textSecondary, fontFamily: 'Oswald_400Regular', fontSize: 14, lineHeight: 21, marginTop: 5 },
  progressTrack: { height: 4, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 18 },
  progressFill: { height: '100%', backgroundColor: colors.primaryLight, borderRadius: 999 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 26, marginBottom: 10 },
  sectionTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 14, letterSpacing: 0.8 },
  sectionMeta: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 9, letterSpacing: 0.8 },
  card: { borderRadius: 18, paddingHorizontal: 16, backgroundColor: 'rgba(11,15,20,0.90)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  priorityRow: { paddingVertical: 15 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  priorityHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priorityName: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 13 },
  priorityRole: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 9, letterSpacing: 0.6 },
  priorityTrack: { height: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 9, overflow: 'hidden' },
  priorityFill: { height: '100%', borderRadius: 999, backgroundColor: colors.primaryLight },
  mutedText: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 13, paddingVertical: 18 },
  coachCard: { flexDirection: 'row', gap: 13, padding: 17, borderRadius: 18, backgroundColor: 'rgba(30,76,125,0.12)', borderWidth: 1, borderColor: 'rgba(73,157,255,0.16)' },
  coachTextWrap: { flex: 1 },
  coachTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 12, letterSpacing: 0.4 },
  coachText: { color: colors.textSecondary, fontFamily: 'Oswald_400Regular', fontSize: 13, lineHeight: 19, marginTop: 4 },
  loadGrid: { flexDirection: 'row', gap: 9 },
  metricCard: { flex: 1, minHeight: 96, justifyContent: 'center', padding: 13, borderRadius: 16, backgroundColor: 'rgba(11,15,20,0.90)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  metricValue: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 29 },
  metricValueCompact: { fontSize: 19 },
  metricSuffix: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 8, marginTop: -2 },
  metricLabel: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 9, letterSpacing: 0.5, marginTop: 7 },
  bootcampGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bootcampCard: { width: '48%', minHeight: 142, padding: 15, borderRadius: 18, backgroundColor: 'rgba(11,15,20,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  bootcampIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  bootcampTitle: { color: colors.textSecondary, fontFamily: 'Oswald_600SemiBold', fontSize: 13, marginTop: 11 },
  bootcampSubtitle: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 9, marginTop: 2 },
  soonBadge: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', marginTop: 12 },
  soonText: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 8, letterSpacing: 0.6 },
  futureHint: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 11, lineHeight: 17, marginTop: 12 },
  bottomSpace: { height: 30 },
});
