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
import {
  getCoachOpportunitySnapshot,
  getProgressionDataContract,
  getW4ProgressionIntelligence,
} from '../../src/services/progressionDataService';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

function experienceLabel(value) {
  const raw = String(value ?? '').toLowerCase();
  if (raw.includes('begin') || raw.includes('début')) return 'DÉBUTANT';
  if (raw.includes('advance') || raw.includes('avanc')) return 'AVANCÉ';
  return 'INTERMÉDIAIRE';
}

function formatMinutes(value) {
  const total = Math.max(0, Math.round(Number(value ?? 0)));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;

  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours} h`;
  return `${hours} h ${minutes}`;
}

function formatSeconds(value) {
  const seconds = Math.max(0, Math.round(Number(value ?? 0)));
  if (!seconds) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest} s`;
  return `${minutes} min ${String(rest).padStart(2, '0')} s`;
}

function confidenceBand(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'non déterminée';
  if (number >= 0.7) return 'forte';
  if (number >= 0.45) return 'moyenne';
  return 'faible';
}

function freshnessBand(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'date inconnue';
  if (number >= 0.75) return 'récente';
  if (number >= 0.4) return 'encore exploitable';
  return 'ancienne';
}

function humanizeMechanic(value) {
  return String(value ?? 'WOD')
    .replaceAll('_', ' ')
    .trim()
    .toUpperCase();
}

function movementMetric(item) {
  const load = Number(
    item?.load_envelope?.repeatable?.repeatable_load_kg
      ?? item?.load_envelope?.fresh?.fresh_load_kg
  );
  if (Number.isFinite(load) && load > 0) return `${load} kg`;

  const reps = Number(
    item?.reps_envelope?.repeatable?.repeatable_reps
      ?? item?.reps_envelope?.fresh?.fresh_reps
  );
  if (Number.isFinite(reps) && reps > 0) return `${Math.round(reps)} reps`;

  const seconds = Number(
    item?.time_envelope?.repeatable?.repeatable_seconds
      ?? item?.time_envelope?.fresh?.fresh_seconds
      ?? item?.time_envelope?.repeatable?.repeatable_time_seconds
      ?? item?.time_envelope?.fresh?.fresh_time_seconds
  );
  if (Number.isFinite(seconds) && seconds > 0) return formatSeconds(seconds);

  const distance = Number(
    item?.distance_envelope?.repeatable?.repeatable_distance_meters
      ?? item?.distance_envelope?.fresh?.fresh_distance_meters
  );
  if (Number.isFinite(distance) && distance > 0) return `${Math.round(distance)} m`;

  return null;
}

function movementStatus(item) {
  switch (item?.signal) {
    case 'PROGRESSING':
      return { eyebrow: 'SIGNAL DE PROGRESSION', title: 'À CONFIRMER', accent: 'blue' };
    case 'RECALIBRATING':
      return { eyebrow: 'RÉFÉRENCE À REVÉRIFIER', title: 'RECALIBRATION', accent: 'red' };
    case 'STABLE':
      return { eyebrow: 'RÉFÉRENCE ÉTABLIE', title: 'STABLE', accent: 'muted' };
    default:
      return { eyebrow: 'NOUVELLE RÉFÉRENCE', title: 'EN CONSTRUCTION', accent: 'blue' };
  }
}

function movementEvidence(item) {
  const status = movementStatus(item);
  const metric = movementMetric(item);
  const validEvidence = Number(item?.valid_evidence_count ?? item?.evidence_count ?? 0);

  return {
    id: `movement-${item?.exercise_id ?? item?.name}`,
    icon: 'barbell-outline',
    eyebrow: status.eyebrow,
    title: item?.name ?? 'Mouvement observé',
    value: metric ?? status.title,
    text: item?.signal === 'PROGRESSING'
      ? 'La référence récente monte, mais UGEROD attend encore une confirmation comparable.'
      : item?.signal === 'RECALIBRATING'
        ? 'Une observation récente diffère de la référence précédente. Le niveau acquis n’est pas effacé.'
        : item?.signal === 'STABLE'
          ? 'Les observations récentes restent cohérentes entre elles.'
          : 'UGEROD possède une première mesure exploitable mais pas encore assez de recul pour conclure.',
    detail: `${validEvidence} preuve${validEvidence > 1 ? 's' : ''} valide${validEvidence > 1 ? 's' : ''} · confiance ${confidenceBand(item?.confidence)} · référence ${freshnessBand(item?.freshness)}`,
    accent: status.accent,
  };
}

function protocolEvidence(item) {
  const outcome = item?.latest_outcome ?? item?.best_outcome ?? {};
  const completed = outcome?.protocol_completed === true;
  if (!completed) return null;

  const rounds = Number(outcome?.rounds_completed ?? 0);
  const stages = Number(outcome?.last_completed_stage ?? 0);
  const elapsed = formatSeconds(outcome?.elapsed_seconds);
  const primary = rounds > 0
    ? `${rounds} TOUR${rounds > 1 ? 'S' : ''}`
    : stages > 0
      ? `PALIER ${stages}`
      : 'FORMAT TERMINÉ';

  return {
    id: `protocol-${item?.protocol_signature ?? item?.mechanic_key}`,
    icon: 'timer-outline',
    eyebrow: 'RÉFÉRENCE DE FORMAT',
    title: humanizeMechanic(item?.mechanic_key),
    value: primary,
    text: elapsed
      ? `Séance terminée en ${elapsed}. Cette référence reste liée à ce format et à cette structure.`
      : 'Cette exécution devient une référence comparable pour ce format.',
    detail: `${Number(item?.valid_evidence_count ?? 0)} preuve valide · confiance ${confidenceBand(item?.confidence)} · référence ${freshnessBand(item?.freshness)}`,
    accent: 'muted',
  };
}

function buildEvidence(progression) {
  const movements = Array.isArray(progression?.movement_capabilities)
    ? progression.movement_capabilities
    : [];
  const protocols = Array.isArray(progression?.protocol_capabilities)
    ? progression.protocol_capabilities
    : [];

  const priority = { PROGRESSING: 0, RECALIBRATING: 1, LEARNING: 2, STABLE: 3 };

  const movementItems = [...movements]
    .sort((a, b) => {
      const stateDelta = (priority[a?.signal] ?? 9) - (priority[b?.signal] ?? 9);
      if (stateDelta !== 0) return stateDelta;
      const evidenceDelta = Number(b?.valid_evidence_count ?? 0) - Number(a?.valid_evidence_count ?? 0);
      if (evidenceDelta !== 0) return evidenceDelta;
      return Number(b?.confidence ?? 0) - Number(a?.confidence ?? 0);
    })
    .filter((item) => Number(item?.valid_evidence_count ?? item?.evidence_count ?? 0) > 0)
    .slice(0, 3)
    .map(movementEvidence);

  const protocolItem = protocols.map(protocolEvidence).find(Boolean);

  return [...movementItems, ...(protocolItem ? [protocolItem] : [])].slice(0, 4);
}

function summaryCopy(progression) {
  const state = progression?.overall?.state;
  const maturity = progression?.maturity?.stage;

  if (state === 'PROGRESSING') {
    return {
      eyebrow: 'EST-CE QUE JE PROGRESSE ?',
      title: 'OUI, DES SIGNAUX SE CONFIRMENT.',
      text: progression?.overall?.text ?? 'Plusieurs observations récentes commencent à raconter la même histoire.',
      badge: 'PROGRESSION EN COURS',
    };
  }

  if (state === 'RECALIBRATING') {
    return {
      eyebrow: 'EST-CE QUE JE PROGRESSE ?',
      title: 'CERTAINES RÉFÉRENCES BOUGENT.',
      text: progression?.overall?.text ?? 'UGEROD vérifie d’abord les changements avant d’augmenter ou de réduire une référence.',
      badge: 'RECALIBRATION',
    };
  }

  if (maturity === 'ESTABLISHED') {
    return {
      eyebrow: 'EST-CE QUE JE PROGRESSE ?',
      title: 'TES RÉFÉRENCES SONT STABLES.',
      text: progression?.overall?.text ?? 'Aucun changement net n’est confirmé sur la période. Stable ne veut pas dire bloqué.',
      badge: 'PROFIL ÉTABLI',
    };
  }

  return {
    eyebrow: 'EST-CE QUE JE PROGRESSE ?',
    title: 'TROP TÔT POUR LE DIRE.',
    text: progression?.overall?.text ?? 'UGEROD accumule encore des références avant de tirer une conclusion sur ta progression.',
    badge: 'CALIBRATION EN COURS',
  };
}

function coachActionCopy(progression) {
  const state = progression?.overall?.state;
  const maturity = progression?.maturity?.stage;

  if (state === 'PROGRESSING') {
    return {
      title: 'CONFIRMER AVANT D’AUGMENTER',
      text: 'Le Coach cherchera une nouvelle exposition comparable avant de transformer un signal positif en référence plus haute.',
    };
  }

  if (state === 'RECALIBRATING') {
    return {
      title: 'REVÉRIFIER SANS RÉGRESSER AUTOMATIQUEMENT',
      text: 'UGEROD peut représenter une référence dans une séance cohérente pour vérifier le changement, sans effacer ton niveau acquis sur une seule observation.',
    };
  }

  if (maturity === 'ESTABLISHED') {
    return {
      title: 'CONSOLIDER ET CHERCHER LE PROCHAIN SIGNAL',
      text: 'Le Coach conserve les références établies et profite des séances cohérentes pour détecter un nouveau signal utile.',
    };
  }

  return {
    title: 'CONSOLIDER TES PREMIÈRES RÉFÉRENCES',
    text: 'Quand deux options de séance se valent, UGEROD peut privilégier ponctuellement un mouvement déjà observé afin d’obtenir une deuxième preuve comparable, sans le forcer.',
  };
}

function equipmentRequirementLabel(item) {
  const name = String(item?.name ?? '').trim();
  if (!name) return null;

  const quantity = Math.max(1, Math.round(Number(item?.required_quantity ?? 1)));
  return quantity > 1 ? `${quantity} × ${name}` : name;
}

function joinEquipmentLabels(items) {
  const labels = (Array.isArray(items) ? items : [])
    .map(equipmentRequirementLabel)
    .filter(Boolean);

  if (!labels.length) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} + ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} + ${labels[labels.length - 1]}`;
}

function equipmentOpportunityCopy(snapshot) {
  const topOpportunities = Array.isArray(snapshot?.top_opportunities)
    ? snapshot.top_opportunities
    : [];
  const opportunity = topOpportunities.find((item) => item?.type === 'EQUIPMENT_ACCESS');

  if (!opportunity) return null;

  const equipment = joinEquipmentLabels(opportunity?.equipment_gap?.missing_equipment);
  if (!equipment) return null;

  const target = opportunity?.target_exercise_name ?? 'ton objectif';
  const supportType = opportunity?.supports_opportunity_type;
  const benefit = supportType === 'CALIBRATION'
    ? `mieux calibrer ${target}`
    : supportType === 'RETEST'
      ? `retester ${target}`
      : supportType === 'SKILL_PROGRESSION'
        ? `faire progresser ${target}`
        : supportType === 'SKILL_DEVELOPMENT'
          ? `développer ${target}`
          : supportType === 'MOVEMENT_PROGRESSION'
            ? `faire progresser ${target}`
            : `travailler ${target}`;

  return {
    equipment,
    title: 'UNE SÉANCE MIEUX ÉQUIPÉE PEUT ÊTRE UTILE',
    text: `Si tu as accès à ${equipment} en salle ou ailleurs, UGEROD pourra ${benefit}. Ce n’est pas une obligation : ton programme continue avec ton matériel actuel.`,
    detail: `Opportunité détectée pour ${target}. UGEROD recommande un accès ponctuel au matériel, pas un achat.`,
  };
}

function referenceProgressCopy(snapshot) {
  if (snapshot?.status !== 'REFERENCE_PROGRESS_AVAILABLE') return null;

  const presentation = snapshot?.presentation ?? {};
  return {
    headline: presentation?.headline ?? 'Comparaison disponible sur une séance repère.',
    metricLabel: presentation?.metric_label ?? 'RÉSULTAT',
    current: presentation?.current_display ?? '—',
    reference: presentation?.reference_display ?? '—',
    currentRpe: presentation?.current_rpe,
    referenceRpe: presentation?.reference_rpe,
    contextNote: presentation?.context_note ?? 'Comparaison avec une séance strictement comparable.',
  };
}

function goalGapCopy(goalGap) {
  const target = String(goalGap?.target?.exercise_name ?? '').trim();
  const requirements = Array.isArray(goalGap?.requirements) ? goalGap.requirements : [];

  if (!target) {
    return {
      title: 'CAP EN COURS DE CONSTRUCTION',
      text: 'UGEROD n’a pas encore de cap Skill suffisamment défini pour afficher un écart fiable.',
      requirements: [],
    };
  }

  switch (goalGap?.status) {
    case 'TARGET_CALIBRATION_NEEDED':
      return {
        title: target.toUpperCase(),
        text: `UGEROD doit d’abord obtenir une mesure fiable sur ${target} avant de conclure sur le prochain cap. Une donnée manquante n’est pas une faiblesse.`,
        requirements: [],
      };
    case 'CALIBRATION_NEEDED':
      return {
        title: target.toUpperCase(),
        text: 'Le cap est identifié, mais certaines capacités nécessaires doivent encore être mesurées avant de conclure.',
        requirements,
      };
    case 'LIMITING_FACTORS_IDENTIFIED':
      return {
        title: target.toUpperCase(),
        text: 'UGEROD a identifié les capacités qui limitent probablement ce cap à partir de prérequis documentés.',
        requirements,
      };
    case 'REQUIREMENTS_SUPPORTED':
      return {
        title: target.toUpperCase(),
        text: 'Les prérequis documentés connus sont soutenus par les observations disponibles. UGEROD peut poursuivre la progression sans inventer de seuil supplémentaire.',
        requirements,
      };
    default:
      return {
        title: target.toUpperCase(),
        text: 'Ce cap reste actif. Aucun facteur limitant causal fiable n’est identifié pour le moment.',
        requirements,
      };
  }
}

function requirementStatusLabel(status) {
  if (status === 'LIMITING') return 'À DÉVELOPPER';
  if (status === 'TO_CALIBRATE') return 'À CALIBRER';
  return 'OBSERVÉ';
}

function EvidenceCard({ item, showDetails }) {
  const red = item.accent === 'red';
  const muted = item.accent === 'muted';

  return (
    <View style={styles.evidenceCard}>
      <View style={[styles.evidenceIcon, red && styles.evidenceIconRed, muted && styles.evidenceIconMuted]}>
        <Ionicons
          name={item.icon}
          size={20}
          color={red ? colors.brandRed : muted ? colors.textSecondary : colors.primaryLight}
        />
      </View>

      <View style={styles.evidenceMain}>
        <Text style={styles.evidenceEyebrow}>{item.eyebrow}</Text>
        <Text style={styles.evidenceTitle}>{item.title}</Text>
        <Text style={styles.evidenceValue}>{item.value}</Text>
        <Text style={styles.evidenceText}>{item.text}</Text>
        {showDetails ? <Text style={styles.evidenceDetail}>{item.detail}</Text> : null}
      </View>
    </View>
  );
}

function LinkCard({ icon, eyebrow, title, text, onPress, accent = 'blue' }) {
  const red = accent === 'red';

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}>
      <View style={[styles.linkIcon, red && styles.linkIconRed]}>
        <Ionicons name={icon} size={20} color={red ? colors.brandRed : colors.primaryLight} />
      </View>
      <View style={styles.linkMain}>
        <Text style={styles.linkEyebrow}>{eyebrow}</Text>
        <Text style={styles.linkTitle}>{title}</Text>
        <Text style={styles.linkText}>{text}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export default function ProgressionScreen() {
  const [progression, setProgression] = useState(null);
  const [coachOpportunitySnapshot, setCoachOpportunitySnapshot] = useState(null);
  const [w4Intelligence, setW4Intelligence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      const [data, opportunitySnapshot, w4Snapshot] = await Promise.all([
        getProgressionDataContract('4w'),
        getCoachOpportunitySnapshot(),
        getW4ProgressionIntelligence(),
      ]);

      setProgression(data);
      setCoachOpportunitySnapshot(opportunitySnapshot);
      setW4Intelligence(w4Snapshot);
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

  const evidence = useMemo(() => buildEvidence(progression), [progression]);
  const summary = useMemo(() => summaryCopy(progression), [progression]);
  const coachAction = useMemo(() => coachActionCopy(progression), [progression]);
  const equipmentOpportunity = useMemo(
    () => equipmentOpportunityCopy(coachOpportunitySnapshot),
    [coachOpportunitySnapshot]
  );
  const referenceProgress = useMemo(
    () => referenceProgressCopy(w4Intelligence?.personal_reference_progress),
    [w4Intelligence]
  );
  const goalGap = useMemo(
    () => goalGapCopy(w4Intelligence?.goal_gap),
    [w4Intelligence]
  );

  const profile = progression?.profile ?? {};
  const activitySummary = progression?.activity?.summary ?? {};
  const currentWeek = progression?.activity?.current_week ?? {};
  const records = progression?.records?.current_records ?? [];
  const recordSuggestions = progression?.records?.suggestions_to_confirm ?? [];
  const athleteDimensions = progression?.athlete_profile?.dimensions ?? [];
  const calibratedDimensions = athleteDimensions.filter((item) => item?.calibrated);

  const weeklyTarget = Number(currentWeek?.target_sessions ?? profile?.weekly_session_target ?? 0);
  const currentWeekSessions = Number(currentWeek?.realized_sessions ?? 0);
  const ratio = Number(currentWeek?.completion_ratio ?? 0);
  const weekPercent = Number.isFinite(ratio)
    ? Math.round(Math.max(0, Math.min(1, ratio)) * 100)
    : 0;

  if (loading && !progression) {
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
          colors={['rgba(7,9,12,0.34)', 'rgba(7,9,12,0.70)', 'rgba(7,9,12,0.97)', 'rgba(7,9,12,1)']}
          locations={[0, 0.22, 0.56, 1]}
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
                <Text style={styles.headerEyebrow}>PROGRESSION</Text>
                <Text style={styles.headerTitle}>
                  {(profile?.firstname || 'TON PROFIL').toUpperCase()}
                  <Text style={styles.blueDot}>.</Text>
                </Text>
                <Text style={styles.headerMeta}>
                  {experienceLabel(profile?.experience)} · {activitySummary?.completed_sessions ?? 0} SÉANCE(S) ANALYSÉE(S)
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
              <View style={styles.heroTopRow}>
                <Text style={styles.heroEyebrow}>{summary.eyebrow}</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>{summary.badge}</Text>
                </View>
              </View>
              <Text style={styles.heroTitle}>{summary.title}</Text>
              <Text style={styles.heroText}>{summary.text}</Text>

              <View style={styles.heroStats}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>{activitySummary?.completed_sessions ?? 0}</Text>
                  <Text style={styles.heroStatLabel}>SÉANCES · 4 SEM.</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>{formatMinutes(activitySummary?.total_minutes)}</Text>
                  <Text style={styles.heroStatLabel}>ENTRAÎNEMENT</Text>
                </View>
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>SUR QUOI ?</Text>
                <Text style={styles.sectionTitle}>CE QUI ÉVOLUE</Text>
              </View>
              <Pressable
                onPress={() => setShowDetails((value) => !value)}
                style={({ pressed }) => [styles.whyButton, pressed && styles.pressed]}
              >
                <Ionicons
                  name={showDetails ? 'chevron-up' : 'information-circle-outline'}
                  size={16}
                  color={colors.primaryLight}
                />
                <Text style={styles.whyButtonText}>{showDetails ? 'MASQUER' : 'POURQUOI ?'}</Text>
              </Pressable>
            </View>

            {evidence.length > 0 ? (
              evidence.map((item) => <EvidenceCard key={item.id} item={item} showDetails={showDetails} />)
            ) : (
              <View style={styles.emptyEvidenceCard}>
                <Ionicons name="scan-outline" size={23} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.emptyEvidenceTitle}>PAS ENCORE DE PREUVE COMPARABLE</Text>
                  <Text style={styles.emptyEvidenceText}>
                    UGEROD attend des observations mesurables avant d’afficher une évolution. Une absence de donnée n’est pas une faiblesse.
                  </Text>
                </View>
              </View>
            )}

            <Pressable
              onPress={() => router.push('/progression/detail?section=evolution')}
              style={({ pressed }) => [styles.inlineLink, pressed && styles.pressed]}
            >
              <Text style={styles.inlineLinkText}>VOIR TOUTES LES RÉFÉRENCES</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.primaryLight} />
            </Pressable>

            {referenceProgress ? (
              <View style={styles.referenceProgressCard}>
                <View style={styles.referenceProgressTop}>
                  <View style={styles.referenceProgressIcon}>
                    <Ionicons name="git-compare-outline" size={20} color={colors.primaryLight} />
                  </View>
                  <View style={styles.referenceProgressHeading}>
                    <Text style={styles.referenceProgressEyebrow}>MOI VS MOI · SÉANCE REPÈRE</Text>
                    <Text style={styles.referenceProgressHeadline}>{referenceProgress.headline}</Text>
                  </View>
                </View>
                <View style={styles.referenceProgressValues}>
                  <View style={styles.referenceProgressValueBlock}>
                    <Text style={styles.referenceProgressValue}>{referenceProgress.reference}</Text>
                    <Text style={styles.referenceProgressLabel}>AVANT</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={17} color={colors.textMuted} />
                  <View style={styles.referenceProgressValueBlock}>
                    <Text style={[styles.referenceProgressValue, styles.referenceProgressValueCurrent]}>{referenceProgress.current}</Text>
                    <Text style={styles.referenceProgressLabel}>MAINTENANT</Text>
                  </View>
                </View>
                <Text style={styles.referenceProgressMetric}>{referenceProgress.metricLabel}</Text>
                {(referenceProgress.currentRpe != null || referenceProgress.referenceRpe != null) ? (
                  <Text style={styles.referenceProgressRpe}>
                    RPE {referenceProgress.referenceRpe ?? '—'} → {referenceProgress.currentRpe ?? '—'}
                  </Text>
                ) : null}
                <Text style={styles.referenceProgressContext}>{referenceProgress.contextNote}</Text>
              </View>
            ) : null}

            <Text style={styles.sectionEyebrowStandalone}>CE QUE LE COACH FAIT MAINTENANT</Text>
            <View style={styles.coachCard}>
              <View style={styles.coachIcon}>
                <Ionicons name="navigate-outline" size={22} color={colors.brandRed} />
              </View>
              <View style={styles.coachMain}>
                <Text style={styles.coachTitle}>{coachAction.title}</Text>
                <Text style={styles.coachText}>{coachAction.text}</Text>
              </View>
            </View>

            {equipmentOpportunity ? (
              <View style={styles.equipmentOpportunityCard}>
                <View style={styles.equipmentOpportunityTop}>
                  <View style={styles.equipmentOpportunityIcon}>
                    <Ionicons name="barbell-outline" size={20} color={colors.primaryLight} />
                  </View>
                  <View style={styles.equipmentOpportunityHeading}>
                    <Text style={styles.equipmentOpportunityEyebrow}>OPPORTUNITÉ MATÉRIEL</Text>
                    <Text style={styles.equipmentOpportunityEquipment}>{equipmentOpportunity.equipment}</Text>
                  </View>
                </View>
                <Text style={styles.equipmentOpportunityTitle}>{equipmentOpportunity.title}</Text>
                <Text style={styles.equipmentOpportunityText}>{equipmentOpportunity.text}</Text>
                <View style={styles.equipmentOpportunityReason}>
                  <Ionicons name="information-circle-outline" size={15} color={colors.textMuted} />
                  <Text style={styles.equipmentOpportunityReasonText}>{equipmentOpportunity.detail}</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.capCard}>
              <View style={styles.capTopRow}>
                <View style={styles.capIcon}>
                  <Ionicons name="flag-outline" size={20} color={colors.primaryLight} />
                </View>
                <Text style={styles.capEyebrow}>TON PROCHAIN CAP</Text>
              </View>
              <Text style={styles.capTitle}>{goalGap.title}</Text>
              <Text style={styles.capText}>{goalGap.text}</Text>
              {goalGap.requirements.length > 0 ? (
                <View style={styles.capRequirements}>
                  {goalGap.requirements.map((item) => (
                    <View key={`${item?.exercise_id}-${item?.status}`} style={styles.capRequirementRow}>
                      <View style={styles.capRequirementMain}>
                        <Text style={styles.capRequirementName}>{item?.exercise_name ?? 'Capacité'}</Text>
                        {item?.source?.source_title ? (
                          <Text style={styles.capRequirementSource}>{item.source.source_title}</Text>
                        ) : null}
                      </View>
                      <View style={[
                        styles.capRequirementBadge,
                        item?.status === 'LIMITING' && styles.capRequirementBadgeRed,
                      ]}>
                        <Text style={[
                          styles.capRequirementBadgeText,
                          item?.status === 'LIMITING' && styles.capRequirementBadgeTextRed,
                        ]}>
                          {requirementStatusLabel(item?.status)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            <Text style={styles.sectionEyebrowStandalone}>TON RYTHME</Text>
            <Pressable
              onPress={() => router.push('/progression/detail?section=activity')}
              style={({ pressed }) => [styles.rhythmCard, pressed && styles.pressed]}
            >
              <View style={styles.rhythmTop}>
                <View>
                  <Text style={styles.rhythmValue}>{currentWeekSessions} / {weeklyTarget}</Text>
                  <Text style={styles.rhythmLabel}>SÉANCES CETTE SEMAINE</Text>
                </View>
                <Text style={styles.rhythmPercent}>{weekPercent}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${weekPercent}%` }]} />
              </View>
              <Text style={styles.rhythmText}>
                La semaine repart proprement : aucune séance manquée n’est transformée en dette à rattraper.
              </Text>
            </Pressable>

            <Text style={styles.sectionEyebrowStandalone}>PLUS DE DÉTAILS</Text>

            <LinkCard
              icon="trophy-outline"
              eyebrow="RÉFÉRENCES / PR"
              title={`${records.length} RECORD${records.length > 1 ? 'S' : ''} CONFIRMÉ${records.length > 1 ? 'S' : ''}`}
              text={recordSuggestions.length > 0
                ? `${recordSuggestions.length} suggestion${recordSuggestions.length > 1 ? 's' : ''} à confirmer. Les estimations restent séparées des vrais PR.`
                : 'Les PR sont une preuve parmi d’autres : ils ne résument pas toute ta progression.'}
              onPress={() => router.push('/progression/records')}
            />

            <LinkCard
              icon="analytics-outline"
              eyebrow="PROFIL ATHLÉTIQUE"
              title={`${calibratedDimensions.length}/5 DIMENSIONS CALIBRÉES`}
              text={calibratedDimensions.length > 0
                ? 'Force fonctionnelle, conditioning, puissance, stabilité et mobilité sont expliqués avec leurs preuves.'
                : 'Le profil reste volontairement en calibration tant que les preuves sont trop rares.'}
              onPress={() => router.push('/progression/detail?section=athletic')}
            />

            <LinkCard
              icon="navigate-circle-outline"
              eyebrow="LECTURE COACH"
              title="VOIR LE RAISONNEMENT DÉTAILLÉ"
              text="Signaux de progression, recalibration et maturité des références sans score arbitraire unique."
              onPress={() => router.push('/progression/detail?section=coach')}
              accent="red"
            />

            <Text style={styles.footerNote}>
              UGEROD sépare ce qu’il observe, la fiabilité de la preuve et le contexte dans lequel la performance a été réalisée. Une qualité peu observée n’est pas automatiquement une faiblesse.
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
  content: { paddingHorizontal: spacing.xl, paddingTop: 8, paddingBottom: 48 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  loadingLogo: { width: 42, height: 42 },
  loadingText: { fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 1, color: colors.textMuted },
  header: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(17,21,26,0.84)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  headerText: { flex: 1 },
  headerEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 9, letterSpacing: 1.1, color: colors.brandRed },
  headerTitle: { marginTop: 1, fontFamily: 'BebasNeue_400Regular', fontSize: 31, lineHeight: 33, letterSpacing: 1.3, color: colors.textPrimary },
  blueDot: { color: colors.primaryLight },
  headerMeta: { marginTop: 1, fontFamily: 'Oswald_600SemiBold', fontSize: 8, letterSpacing: 0.55, color: colors.textMuted },
  brandIcon: { width: 34, height: 34, opacity: 0.94 },
  errorCard: { marginTop: 8, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, backgroundColor: 'rgba(17,21,26,0.92)', borderWidth: 1, borderColor: 'rgba(255,82,82,0.20)' },
  errorText: { flex: 1, fontFamily: 'Oswald_400Regular', fontSize: 11, color: colors.textSecondary },
  heroCard: { marginTop: 14, padding: 20, borderRadius: 22, backgroundColor: 'rgba(13,18,25,0.96)', borderWidth: 1, borderColor: 'rgba(29,140,255,0.26)' },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  heroEyebrow: { flex: 1, fontFamily: 'Oswald_700Bold', fontSize: 9, letterSpacing: 1.1, color: colors.primaryLight },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(29,140,255,0.11)', borderWidth: 1, borderColor: 'rgba(29,140,255,0.22)' },
  statusBadgeText: { fontFamily: 'Oswald_700Bold', fontSize: 7, letterSpacing: 0.7, color: colors.primaryLight },
  heroTitle: { marginTop: 9, fontFamily: 'BebasNeue_400Regular', fontSize: 32, lineHeight: 34, letterSpacing: 1.1, color: colors.textPrimary },
  heroText: { marginTop: 8, fontFamily: 'Oswald_400Regular', fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  heroStats: { marginTop: 18, paddingTop: 15, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  heroStat: { flex: 1 },
  heroStatValue: { fontFamily: 'BebasNeue_400Regular', fontSize: 25, lineHeight: 28, color: colors.textPrimary },
  heroStatLabel: { marginTop: 1, fontFamily: 'Oswald_600SemiBold', fontSize: 7, letterSpacing: 0.65, color: colors.textMuted },
  heroDivider: { width: 1, height: 30, marginHorizontal: 18, backgroundColor: 'rgba(255,255,255,0.09)' },
  sectionHeader: { marginTop: 28, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  sectionEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 8, letterSpacing: 0.9, color: colors.brandRed },
  sectionTitle: { marginTop: 2, fontFamily: 'BebasNeue_400Regular', fontSize: 27, lineHeight: 29, letterSpacing: 1, color: colors.textPrimary },
  sectionEyebrowStandalone: { marginTop: 27, marginBottom: 9, fontFamily: 'Oswald_700Bold', fontSize: 9, letterSpacing: 1, color: colors.textMuted },
  whyButton: { minHeight: 34, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, backgroundColor: 'rgba(17,21,26,0.88)', borderWidth: 1, borderColor: 'rgba(29,140,255,0.18)' },
  whyButtonText: { fontFamily: 'Oswald_700Bold', fontSize: 8, letterSpacing: 0.75, color: colors.primaryLight },
  evidenceCard: { marginBottom: 9, padding: 15, flexDirection: 'row', gap: 12, borderRadius: 17, backgroundColor: 'rgba(17,21,26,0.93)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  evidenceIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(29,140,255,0.12)', borderWidth: 1, borderColor: 'rgba(29,140,255,0.20)' },
  evidenceIconRed: { backgroundColor: 'rgba(255,70,70,0.10)', borderColor: 'rgba(255,70,70,0.20)' },
  evidenceIconMuted: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.08)' },
  evidenceMain: { flex: 1 },
  evidenceEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 8, letterSpacing: 0.8, color: colors.textMuted },
  evidenceTitle: { marginTop: 2, fontFamily: 'BebasNeue_400Regular', fontSize: 22, lineHeight: 25, letterSpacing: 0.7, color: colors.textPrimary },
  evidenceValue: { marginTop: 3, fontFamily: 'Oswald_700Bold', fontSize: 12, color: colors.primaryLight },
  evidenceText: { marginTop: 5, fontFamily: 'Oswald_400Regular', fontSize: 10.5, lineHeight: 16, color: colors.textSecondary },
  evidenceDetail: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', fontFamily: 'Oswald_400Regular', fontSize: 9, lineHeight: 14, color: colors.textMuted },
  emptyEvidenceCard: { padding: 16, flexDirection: 'row', gap: 12, borderRadius: 17, backgroundColor: 'rgba(17,21,26,0.91)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  emptyEvidenceTitle: { fontFamily: 'Oswald_700Bold', fontSize: 10, letterSpacing: 0.8, color: colors.textPrimary },
  emptyEvidenceText: { marginTop: 4, fontFamily: 'Oswald_400Regular', fontSize: 10, lineHeight: 15, color: colors.textSecondary },
  inlineLink: { alignSelf: 'flex-start', marginTop: 3, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 7 },
  inlineLinkText: { fontFamily: 'Oswald_700Bold', fontSize: 8.5, letterSpacing: 0.8, color: colors.primaryLight },
  referenceProgressCard: { marginTop: 10, padding: 16, borderRadius: 18, backgroundColor: 'rgba(13,20,27,0.94)', borderWidth: 1, borderColor: 'rgba(29,140,255,0.24)' },
  referenceProgressTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  referenceProgressIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(29,140,255,0.10)', borderWidth: 1, borderColor: 'rgba(29,140,255,0.18)' },
  referenceProgressHeading: { flex: 1 },
  referenceProgressEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 8, letterSpacing: 0.85, color: colors.primaryLight },
  referenceProgressHeadline: { marginTop: 2, fontFamily: 'Oswald_600SemiBold', fontSize: 11, lineHeight: 16, color: colors.textPrimary },
  referenceProgressValues: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 14 },
  referenceProgressValueBlock: { flex: 1 },
  referenceProgressValue: { fontFamily: 'BebasNeue_400Regular', fontSize: 27, lineHeight: 30, color: colors.textSecondary },
  referenceProgressValueCurrent: { color: colors.primaryLight },
  referenceProgressLabel: { fontFamily: 'Oswald_700Bold', fontSize: 7.5, letterSpacing: 0.8, color: colors.textMuted },
  referenceProgressMetric: { marginTop: 8, fontFamily: 'Oswald_700Bold', fontSize: 8, letterSpacing: 0.8, color: colors.textMuted },
  referenceProgressRpe: { marginTop: 4, fontFamily: 'Oswald_400Regular', fontSize: 9.5, color: colors.textSecondary },
  referenceProgressContext: { marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', fontFamily: 'Oswald_400Regular', fontSize: 9, lineHeight: 14, color: colors.textMuted },
  coachCard: { padding: 16, flexDirection: 'row', gap: 12, borderRadius: 18, backgroundColor: 'rgba(24,16,18,0.92)', borderWidth: 1, borderColor: 'rgba(255,70,70,0.18)' },
  coachIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,70,70,0.09)' },
  coachMain: { flex: 1 },
  coachTitle: { fontFamily: 'BebasNeue_400Regular', fontSize: 23, lineHeight: 26, letterSpacing: 0.8, color: colors.textPrimary },
  coachText: { marginTop: 5, fontFamily: 'Oswald_400Regular', fontSize: 10.5, lineHeight: 16, color: colors.textSecondary },
  equipmentOpportunityCard: { marginTop: 10, padding: 16, borderRadius: 18, backgroundColor: 'rgba(13,20,27,0.94)', borderWidth: 1, borderColor: 'rgba(29,140,255,0.24)' },
  equipmentOpportunityTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  equipmentOpportunityIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(29,140,255,0.10)', borderWidth: 1, borderColor: 'rgba(29,140,255,0.18)' },
  equipmentOpportunityHeading: { flex: 1 },
  equipmentOpportunityEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 8, letterSpacing: 0.85, color: colors.primaryLight },
  equipmentOpportunityEquipment: { marginTop: 2, fontFamily: 'Oswald_600SemiBold', fontSize: 10, lineHeight: 15, color: colors.textPrimary },
  equipmentOpportunityTitle: { marginTop: 12, fontFamily: 'BebasNeue_400Regular', fontSize: 23, lineHeight: 26, letterSpacing: 0.7, color: colors.textPrimary },
  equipmentOpportunityText: { marginTop: 5, fontFamily: 'Oswald_400Regular', fontSize: 10.5, lineHeight: 16, color: colors.textSecondary },
  equipmentOpportunityReason: { marginTop: 11, paddingTop: 9, flexDirection: 'row', alignItems: 'flex-start', gap: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  equipmentOpportunityReasonText: { flex: 1, fontFamily: 'Oswald_400Regular', fontSize: 9, lineHeight: 14, color: colors.textMuted },
  capCard: { marginTop: 10, padding: 16, borderRadius: 18, backgroundColor: 'rgba(17,21,26,0.91)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  capTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  capIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(29,140,255,0.09)' },
  capEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 8.5, letterSpacing: 0.9, color: colors.primaryLight },
  capTitle: { marginTop: 10, fontFamily: 'BebasNeue_400Regular', fontSize: 23, lineHeight: 26, color: colors.textPrimary },
  capText: { marginTop: 4, fontFamily: 'Oswald_400Regular', fontSize: 10.5, lineHeight: 16, color: colors.textSecondary },
  capRequirements: { marginTop: 12, gap: 8 },
  capRequirementRow: { paddingTop: 9, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  capRequirementMain: { flex: 1 },
  capRequirementName: { fontFamily: 'Oswald_600SemiBold', fontSize: 10, lineHeight: 15, color: colors.textPrimary },
  capRequirementSource: { marginTop: 2, fontFamily: 'Oswald_400Regular', fontSize: 8.5, lineHeight: 13, color: colors.textMuted },
  capRequirementBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(29,140,255,0.10)', borderWidth: 1, borderColor: 'rgba(29,140,255,0.18)' },
  capRequirementBadgeRed: { backgroundColor: 'rgba(255,70,70,0.09)', borderColor: 'rgba(255,70,70,0.18)' },
  capRequirementBadgeText: { fontFamily: 'Oswald_700Bold', fontSize: 7, letterSpacing: 0.6, color: colors.primaryLight },
  capRequirementBadgeTextRed: { color: colors.brandRed },
  rhythmCard: { padding: 16, borderRadius: 18, backgroundColor: 'rgba(17,21,26,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  rhythmTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rhythmValue: { fontFamily: 'BebasNeue_400Regular', fontSize: 28, lineHeight: 30, color: colors.textPrimary },
  rhythmLabel: { fontFamily: 'Oswald_600SemiBold', fontSize: 8, letterSpacing: 0.7, color: colors.textMuted },
  rhythmPercent: { fontFamily: 'BebasNeue_400Regular', fontSize: 25, color: colors.primaryLight },
  progressTrack: { marginTop: 12, height: 5, overflow: 'hidden', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: colors.primaryLight },
  rhythmText: { marginTop: 10, fontFamily: 'Oswald_400Regular', fontSize: 10, lineHeight: 15, color: colors.textSecondary },
  linkCard: { marginBottom: 9, minHeight: 92, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 17, backgroundColor: 'rgba(17,21,26,0.91)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  linkIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(29,140,255,0.10)' },
  linkIconRed: { backgroundColor: 'rgba(255,70,70,0.08)' },
  linkMain: { flex: 1 },
  linkEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 7.5, letterSpacing: 0.8, color: colors.textMuted },
  linkTitle: { marginTop: 2, fontFamily: 'BebasNeue_400Regular', fontSize: 21, lineHeight: 23, color: colors.textPrimary },
  linkText: { marginTop: 3, fontFamily: 'Oswald_400Regular', fontSize: 9.5, lineHeight: 14, color: colors.textSecondary },
  pressed: { opacity: 0.72 },
  footerNote: { marginTop: 20, paddingHorizontal: 8, textAlign: 'center', fontFamily: 'Oswald_400Regular', fontSize: 9, lineHeight: 14, color: colors.textMuted },
});