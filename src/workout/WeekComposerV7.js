import ComposerOutdoorCardioPreview from '../components/workout/ComposerOutdoorCardioPreview';
import ComposerMovementOverview, { ComposerMovementTabs } from '../components/workout/ComposerMovementOverview';
import { OUTDOOR_PLACES, selectableOutdoorPlaces, terrainOptionsForPlace } from '../constants/outdoorContext';
import { COMPOSER_OUTDOOR_VERSION, composerOutdoorContext } from '../utils/composerOutdoor';
import ComposerExercisePickerPage from './ComposerExercisePickerPage';
import { pickerEquipmentMatches, pickerAddSessionEquipment } from '../utils/composerPickerPresentation';
import ExerciseDetail from '../components/exercises/ExerciseDetail';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { spacing } from '../constants';
import { fontFamilies } from '../constants/typography';
import ComposerMuscleSelector from './ComposerMuscleSelector';
import ComposerSkillTargetSelector from './ComposerSkillTargetSelector';
import { composerInitialSkillEngineVersion, composerGuidedPreferencesEnabled } from '../utils/composerReleasePolicy';
import {
  readComposerPreferences, legacyComposerTargetRegion, composerRegionsLabel,
  withComposerPreferences,
} from '../utils/composerPreferences';
import { composerWodSelectionLimit, chooseComposerExercise } from '../utils/composerWodSelection';
import { composerManualKey,restoreComposerManualEdits,attachComposerManualEdits,composerManualExerciseFields,composerManualParameterFields,validComposerManualValues,composerManualTimeSummary,composerManualError } from '../utils/composerManualDose';
import {
  composerDurationSummary,
  composerMechanicIdentity,
  composerWodTimeSummary,
  composerPreviewIssue,
  composerMovementAction,
  composerMechanicDescription,
  composerMechanicAdjustmentReason, composerWodRegionAdvisory, composerWodDurationAdvisory,
  composerWodProtocol,
  currentComposerAssessment,
  formatComposerDose as formatPreviewDose,
} from '../utils/composerPresentation';
import {
  editComposerArchitecture,
  composerMainBlocks,
  composerAddableBlocks,
  composerArchitectureForTarget, composerStrengthOnlyOption, composerSkillWodOption,
} from '../utils/composerArchitectureEditor';
import { useUgerodTheme } from '../contexts/UgerodThemeContext';
import {
  getEquipmentCatalog,
  getUserEnvironmentEquipmentPreset,
} from '../services/equipmentService';
import {
  buildComposerArchitectures,
  composerBlockDisplayLabel,
  composerArchitectureDisplayTitle,
  composerArchitecturePurpose,
  composerArchitectureMatchesIntent,
  composerExerciseSlotLimit,
  getComposerArchitectureTargets,
  getComposerArchitectureProposal,
  getComposerCardioProposal,
  getComposerExerciseCandidates,
  getComposerExerciseCompatibility,
  getComposerMechanicOptions,
  getComposerWodSelectionContracts,
  getComposerPrescriptionPreview,
  getComposerStrengthAutoPick,
  getComposerStrengthAssessment,
  getComposerCandidateEvidence,
  rankComposerCandidates,
  selectComposerDefaultExercises,
  getComposerForLocalDate,
  getComposerSkillTargets,
  getComposerSkillProposal,
  getComposerAutomaticSkillProposal,
  saveComposerDraft,
} from '../services/composerService';
import {
  createAssistedWeekPlanItem,
  getWeekReadContract,
} from '../services/weeklyPlanService';

const darkBrandIcon = require('../../assets/branding/ugerod-icon.png');
const lightBrandIcon = require('../../assets/branding/LOGO VERSION NOIR.png');

const DURATIONS = [20, 30, 45, 60, 75, 90];
const ENVIRONMENTS = [
  { code: 'HOME', label: 'Maison', icon: 'home-outline' },
  { code: 'BOX', label: 'Box', icon: 'fitness-outline' },
  { code: 'GYM', label: 'Salle', icon: 'barbell-outline' },
  { code: 'OUTDOOR', label: 'Extérieur', icon: 'leaf-outline' },
];
const FALLBACK_INTENTS = [
  { key: 'STRENGTH', label: 'Développer ma force', subtitle: 'Force et progression musculaire.', focus: 'Strength' },
  { key: 'CONDITIONING', label: 'Améliorer mon endurance', subtitle: 'Cardio, conditioning et capacité à soutenir l’effort.', focus: 'Conditioning' },
  { key: 'TECHNIQUE', label: 'Progresser sur un mouvement', subtitle: 'Apprentissage et maîtrise technique.', focus: 'General Fitness' },
];
const LOAD_CAPABLE_EQUIPMENT_IDS = new Set(['E03', 'E04', 'E09', 'E14']);

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateLabel(value) {
  const date = parseDateKey(value);
  if (!date) return 'CETTE SÉANCE';
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date).toUpperCase();
}

function environmentLabel(code) {
  return ENVIRONMENTS.find((item) => item.code === code)?.label ?? 'Maison';
}

function regionLabel(value) {
  if (value === 'Upper') return 'Haut du corps';
  if (value === 'Back') return 'Dos';
  if (value === 'Lower') return 'Jambes';
  if (value === 'Core') return 'Abdos / gainage';
  if (value === 'Full Body') return 'Full body';
  return value ?? null;
}

function movementLabel(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ');
  const labels = {
    squat: 'Squat',
    lunge: 'Fente',
    hinge: 'Charnière',
    push: 'Poussée',
    pull: 'Tirage',
    carry: 'Porté',
    core: 'Gainage',
    rotation: 'Rotation',
    'anti rotation': 'Anti-rotation',
    'push horizontal': 'Poussée horizontale',
    'pull horizontal': 'Tirage horizontal',
    'push vertical': 'Poussée verticale',
    'pull vertical': 'Tirage vertical',
    jump: 'Saut',
  };
  return labels[key] ?? raw.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function humanize(value) {
  if (!value) return null;
  return String(value).replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

// Resolve the visible Coach direction from one coherent source, not a mix of
// the current projection's copy and the older weekly slot's focus.
function classifyTrainingDirection(value) {
  const text = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (/\b(CONDITIONING|CONDITIONNEMENT|CARDIO|ENDURANCE|METCON|AEROBIE)\b/.test(text)) return 'Conditioning';
  if (/\b(FORCE|STRENGTH)\b/.test(text)) return 'Strength';
  if (/\b(TECHNIQUE|TECHNICAL|SKILL|GYMNASTIQUE)\b/.test(text)) return 'General Fitness';
  return null;
}

function coachIntentFromItem(item) {
  if (!item) return null;
  const presentation = item?.coachProjection?.presentation ?? {};
  const title = String(presentation.title ?? '').trim();
  const description = String(presentation.description ?? '').trim();
  const titleDirection = classifyTrainingDirection(title);
  const descriptionDirection = classifyTrainingDirection(description);
  // The Coach's technical direction is distinct from an unknown/general
  // direction, even though both use General Fitness as the C2 focus.
  const technicalDirection = [title, description, item?.coachProjection?.priority?.key]
    .some((part) => /\b(TECHNIQUE|TECHNICAL|SKILL|GYMNASTIQUE)\b/i.test(String(part ?? '')));

  // The Coach projection is fresher than plannedContext.focus, which can still
  // describe the legacy slot (e.g. Strength for a Conditioning opportunity).
  const focus = titleDirection
    ?? classifyTrainingDirection(item?.coachProjection?.priority?.key)
    ?? descriptionDirection
    ?? classifyTrainingDirection(item?.plannedContext?.focus)
    ?? 'General Fitness';

  const legacyTitle = humanize(item?.plannedContext?.focus);
  const fallbackTitle = focus === 'Strength'
    ? 'Force'
    : focus === 'Conditioning'
      ? 'Conditioning'
      : legacyTitle ?? 'Séance UGEROD';
  const label = title || (classifyTrainingDirection(legacyTitle) === focus ? legacyTitle : fallbackTitle);

  // Hide an obsolete explanation rather than claim that Force is Conditioning.
  const subtitle = description && (!descriptionDirection || descriptionDirection === focus)
    ? description
    : null;

  return {
    key: focus === 'General Fitness' && technicalDirection
      ? 'COACH_TECHNIQUE'
      : `COACH_${focus.toUpperCase().replace(/\s+/g, '_')}`,
    label,
    subtitle,
    focus,
    targetRegion: item?.plannedContext?.targetRegion ?? null,
    recommended: true,
  };
}

function directionBaseLabel(choice) {
  if (choice?.key === 'TECHNIQUE' || choice?.key === 'COACH_TECHNIQUE') return 'Progresser sur un mouvement';
  if (choice?.focus === 'Strength') return 'Développer ma force';
  if (choice?.focus === 'Conditioning') return 'Améliorer mon endurance';
  return String(choice?.label ?? 'Séance').split('·')[0].trim();
}

function directionChoiceForRegion(choice, targetRegion, plannedRegion = null) {
  if (!choice || !targetRegion) return choice;
  const adapted = plannedRegion && plannedRegion !== targetRegion;
  return {
    ...choice,
    label: `${directionBaseLabel(choice)} · ${regionLabel(targetRegion)}`,
    targetRegion,
    subtitle: choice.recommended && adapted
      ? `J’adapte la direction prévue à ta préférence ${regionLabel(targetRegion).toLowerCase()}.`
      : choice.subtitle,
  };
}

function blockTitle(type, environmentCode = 'BOX') {
  return composerBlockDisplayLabel(type, environmentCode).toUpperCase();
}

function buildReferenceEquipment(catalog, inventory) {
  const rowsByEquipment = new Map();
  for (const row of inventory ?? []) {
    const equipmentId = String(row.equipment_id ?? '');
    if (!equipmentId || equipmentId === 'E00') continue;
    if (!rowsByEquipment.has(equipmentId)) rowsByEquipment.set(equipmentId, []);
    rowsByEquipment.get(equipmentId).push(row);
  }
  return (catalog ?? [])
    .filter((item) => item.id !== 'E00' && rowsByEquipment.has(String(item.id)))
    .map((item) => {
      const rows = rowsByEquipment.get(String(item.id)) ?? [];
      const supportsLoad = LOAD_CAPABLE_EQUIPMENT_IDS.has(String(item.id));
      const hasConfirmedLoad = rows.some((row) => ['fixed_load', 'adjustable_load'].includes(row.inventory_mode));
      const hasUnknownLoad = supportsLoad && !hasConfirmedLoad && rows.some((row) => row.inventory_mode === 'load_unknown');
      const quantity = rows.reduce((total, row) => total + Math.max(1, Number(row.quantity ?? 1)), 0);
      const fixedLoads = rows
        .filter((row) => row.inventory_mode === 'fixed_load' && row.load_kg != null)
        .map((row) => ({ quantity: Math.max(1, Number(row.quantity ?? 1)), load: Number(row.load_kg) }));
      const adjustable = rows.find((row) => row.inventory_mode === 'adjustable_load');
      let detail = null;
      if (fixedLoads.length > 0) detail = fixedLoads.map((row) => `${row.quantity}×${row.load} kg`).join(' · ');
      else if (adjustable) detail = `${adjustable.min_load_kg}–${adjustable.max_load_kg} kg`;
      else if (hasUnknownLoad) detail = 'Charge non renseignée';
      else if (quantity > 1) detail = `×${quantity}`;
      return { id: String(item.id), name: item.name, detail };
    });
}

function summarizeEquipment(referenceEquipment, equipmentIds) {
  const selected = new Set((equipmentIds ?? []).map(String));
  const names = (referenceEquipment ?? [])
    .filter((item) => selected.has(String(item.id)))
    .map((item) => item.name)
    .filter(Boolean);
  if (names.length === 0) return 'Poids du corps';
  if (names.length <= 2) return names.join(' · ');
  return `${names.slice(0, 2).join(' · ')} · +${names.length - 2}`;
}

function DurationControl({ value, onChange, styles, colors }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(0, DURATIONS.indexOf(value));
  const step = trackWidth > 0 ? trackWidth / (DURATIONS.length - 1) : 0;
  const dragOriginXRef = useRef(0);
  const indexRef = useRef(index);
  const stepRef = useRef(step);
  const widthRef = useRef(trackWidth);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  indexRef.current = index;
  stepRef.current = step;
  widthRef.current = trackWidth;
  valueRef.current = value;
  onChangeRef.current = onChange;

  const updateRef = useRef(null);
  updateRef.current = (x) => {
    if (!widthRef.current || !stepRef.current) return;
    const clamped = Math.max(0, Math.min(widthRef.current, x));
    const nextIndex = Math.max(0, Math.min(DURATIONS.length - 1, Math.round(clamped / stepRef.current)));
    const nextValue = DURATIONS[nextIndex];
    if (nextValue !== valueRef.current) {
      valueRef.current = nextValue;
      onChangeRef.current(nextValue);
    }
  };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragOriginXRef.current = indexRef.current * stepRef.current; },
    onPanResponderMove: (_event, gesture) => updateRef.current?.(dragOriginXRef.current + gesture.dx),
    onPanResponderRelease: (_event, gesture) => updateRef.current?.(dragOriginXRef.current + gesture.dx),
  }), []);

  const left = index * step;
  // Same duration thresholds and colors as PreparationCheckinV4.
  const durationColor = value <= 30
    ? colors.accent
    : value >= 75 ? colors.secondaryAccent : colors.text;
  return (
    <View style={styles.durationShell}>
      <View style={styles.durationReadout}>
        <Text style={[styles.durationValue, { color: durationColor }]}>{value}</Text>
        <Text style={[styles.durationUnit, { color: durationColor }]}>MIN</Text>
      </View>
      <View style={styles.durationSliderColumn}>
        <View
          style={styles.durationTrackTouch}
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            widthRef.current = width;
            setTrackWidth(width);
          }}
        >
          <View style={styles.durationTrack}>
            <View style={[styles.durationProgress, { width: left, backgroundColor: durationColor }]} />
            <View style={styles.durationHitRow}>
              {DURATIONS.map((item) => <Pressable key={item} onPress={() => onChange(item)} style={styles.durationHit} />)}
            </View>
            <View {...pan.panHandlers} style={[styles.durationKnob, { left, borderColor: durationColor }]}>
              <Ionicons name="stopwatch-outline" size={18} color={colors.text} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function ChoiceChip({ label, selected, onPress, styles, colors, icon = null }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} style={({ pressed }) => [styles.choiceChip, selected && styles.choiceChipSelected, pressed && styles.pressed]}>
      {icon ? <Ionicons name={icon} size={16} color={selected ? colors.textOnAccent : colors.textSecondary} /> : null}
      <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function PrimaryButton({ label, onPress, disabled = false, loading = false, styles, colors }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primaryButton, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      {loading ? <ActivityIndicator size="small" color={colors.textOnAccent} /> : null}
      <Text style={styles.primaryButtonText}>{label}</Text>
      {!loading ? <Ionicons name="arrow-forward" size={18} color={colors.textOnAccent} /> : null}
    </Pressable>
  );
}

function SheetShell({ visible, title, onClose, children, footer, styles, colors }) {
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable onPress={onClose} style={styles.modalBackdrop} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} style={styles.sheetClose}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScrollContent}>
            {children}
          </ScrollView>
          {footer}
        </View>
      </View>
    </Modal>
  );
}

function StageHeader({ kicker, title, helper, styles }) {
  return (
    <View style={styles.stageHeader}>
      {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
      <Text style={styles.question}>{title}</Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

function ComposerWodPreview({ block, loading, issue, environmentCode, styles, colors }) {
  const [showDetails, setShowDetails] = useState(false);
  if (!block) return <Text style={styles.sectionSmallHint}>
    {loading ? 'Calcul du protocole…' : issue ? composerPreviewIssue(issue, environmentCode) : 'Le protocole sera disponible après validation des blocs.'}
  </Text>;
  const p = block.parameters ?? {};
  const rounds = p.rounds ?? block.rounds;
  const headline = block.mechanic === 'AMRAP' ? 'Un maximum de tours'
    : ['FOR_TIME', 'CIRCUIT'].includes(block.mechanic) && rounds != null ? `${rounds} tours à réaliser`
      : composerWodProtocol(block);
  const capSeconds = p.cap_seconds ?? p.time_limit_seconds;
  const timeLabel = capSeconds != null ? `${Number(capSeconds) / 60} min maximum`
    : `${block.minutes} min prévues`;
  const estimate = block.time?.prescribed_seconds;
  const perRound = ['AMRAP', 'FOR_TIME', 'CIRCUIT'].includes(block.mechanic);
  return <View style={styles.protocolCard}>
    <View style={styles.previewHeadingRow}>
      <Text style={styles.sectionSmallTitle}>TON WOD</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Détails de la durée du WOD"
        accessibilityState={{ expanded: showDetails }} aria-expanded={showDetails} hitSlop={8}
        onPress={() => setShowDetails((value) => !value)} style={styles.previewInfoButton}>
        <Ionicons name="information-circle-outline" size={21} color={colors.textSecondary} />
      </Pressable>
    </View>
    {headline ? <Text style={styles.previewHeadline}>{headline}</Text> : null}
    <View style={styles.previewTimeRow}>
      <Ionicons name="time-outline" size={16} color={colors.accent} />
      <Text style={styles.previewTimePrimary}>{timeLabel}</Text>
      {estimate != null ? <Text style={styles.previewEstimate}>≈ {Math.round(Number(estimate) / 60)} min estimées</Text> : null}
    </View>
    {showDetails ? <Text style={styles.previewDetails}>{composerWodTimeSummary(block) || 'Durée prévisionnelle, ajustable le jour J.'}</Text> : null}
    <Text style={styles.previewListLabel}>{perRound ? 'À chaque tour' : 'Tes mouvements'}</Text>
    <View>
      {(block.exercises ?? []).map((dose, index) => <View key={dose.id}
        style={[styles.previewExerciseRow, index > 0 && styles.previewExerciseDivider]}>
        <Text style={styles.previewExerciseName}>{dose.name}</Text>
        <Text style={styles.previewExerciseDose}>{formatPreviewDose(dose, 'WOD', block)}</Text>
      </View>)}
    </View>
    {composerWodRegionAdvisory(block)?<Text style={styles.previewDetails}>{composerWodRegionAdvisory(block)}</Text>:null}
    {composerWodDurationAdvisory(block)?<Text style={styles.previewDetails}>{composerWodDurationAdvisory(block)}</Text>:null}
    <Text style={styles.previewFootnote}>Prévision ajustable le jour J.</Text>
  </View>;
}

function ArchitectureCard({ option, selected, onPress, styles, colors, environmentCode, intentKey, summary = false }) {
  const Container = summary ? View : Pressable;
  // Use the backend-owned durations: two complements, main blocks, transitions.
  const segments = [
    ...(option.blocks ?? []),
    ...(Number(option.transitionReserveMinutes ?? 0) > 0
      ? [{ type: 'TRANSITION', minutes: Number(option.transitionReserveMinutes) }]
      : []),
  ].filter((block) => Number(block.minutes) > 0);
  const totalMinutes = Number(option.estimatedMinutes)
    || segments.reduce((sum, block) => sum + Number(block.minutes || 0), 0);

  function segmentColor(type) {
    if (type === 'WARMUP') return '#B6C3B3';
    if (type === 'TABATA') return '#F0AC80';
    if (type === 'TRANSITION') return '#C6CDC4';
    if (type === 'WOD') return colors.secondaryAccent;
    return colors.accent;
  }

  return (
    <Container
      {...(summary ? {} : { onPress, accessibilityRole: 'radio', accessibilityState: { selected } })}
      accessibilityLabel={composerArchitectureDisplayTitle(option, environmentCode) + ', ' + totalMinutes + ' minutes'}
      style={summary ? [styles.architectureCard, styles.architectureSummary] : ({ pressed }) => [
        styles.architectureCard, selected && styles.cardSelected, pressed && styles.pressed,
      ]}
    >
      {!summary && selected ? <View style={styles.selectedRail} /> : null}
      <View style={styles.cardTopRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardEyebrow}>{summary ? 'APERÇU' : !composerArchitectureMatchesIntent(option, intentKey) ? 'STRUCTURE LIBRE' : option.recommended ? 'CHOIX UGEROD' : option.distribution_label ?? 'MÊME OBJECTIF'}</Text>
          <Text style={styles.cardTitle}>{composerArchitectureDisplayTitle(option, environmentCode)}</Text>
          {!summary ? <Text style={styles.architecturePurpose}>{composerArchitecturePurpose(option, intentKey, environmentCode)}</Text> : null}
        </View>
        {!summary ? <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={30}
          color={selected ? colors.accent : colors.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        /> : null}
      </View>
      <View style={styles.architectureBlocks}>
        <View style={styles.architectureTimeline}>
          {segments.map((block, index) => (
            <View
              key={option.key + '-' + block.type + '-' + index}
              style={[
                styles.architectureTimelineSlice,
                {
                  flex: Math.max(1, Number(block.minutes)),
                  backgroundColor: segmentColor(block.type),
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.architectureLegend}>
          {segments.map((block, index) => (
            <View key={option.key + '-legend-' + block.type + '-' + index} style={styles.architectureLegendItem}>
              <View style={[styles.architectureLegendDot, { backgroundColor: segmentColor(block.type) }]} />
              <Text style={styles.architectureLegendLabel}>
                {composerBlockDisplayLabel(block.type, environmentCode, option)}
                <Text style={styles.architectureLegendMinutes}>{' · ' + block.minutes + ' min'}</Text>
              </Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.architectureDurationFooter}>
        <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
        <Text style={styles.cardFooterText}>{'Durée prévue : ' + totalMinutes + ' min'}</Text>
      </View>
    </Container>
  );
}

function ExerciseCard({ exercise, doseLabel, selected, onOpenDetail, styles, colors }) {
  const imageUri = /^https?:\/\//i.test(String(exercise.imagePath ?? '')) ? exercise.imagePath : null;
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [imageUri]);
  return <View style={styles.exerciseCard} testID={`movement-card-${exercise.id}`}>
    <Pressable onPress={onOpenDetail} accessibilityRole="button" accessibilityLabel={'Détails de ' + exercise.name}
      style={({ pressed }) => [styles.exerciseInfoButton, pressed && styles.pressed]}>
      <View style={styles.exerciseThumbnail} testID={`movement-thumbnail-${exercise.id}`}>
        {imageUri && !imageFailed ? <Image source={{uri:imageUri}} resizeMode="contain" style={styles.exerciseThumbnailImage}
          onError={() => setImageFailed(true)} accessible={false} /> : <Ionicons name="image-outline" size={19} color={colors.textMuted} accessible={false}/>}
      </View>
      <View style={styles.exerciseCopy}><Text style={styles.exerciseName}>{exercise.name}</Text>
        {doseLabel ? <Text style={styles.exerciseDose}>{doseLabel}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.textMuted}/>
    </Pressable>
    {exercise.warning && selected ? <View style={styles.exerciseGuidance}>
      <Ionicons name="alert-circle-outline" size={15} color={colors.secondaryAccent}/>
      <Text style={styles.exerciseGuidanceText}>{exercise.recommendationReason || 'Mouvement similaire déjà sélectionné'}</Text>
    </View> : null}
  </View>;
}

export default function WeekComposerV7() {
  const params = useLocalSearchParams();
  const dateKey = firstParam(params?.date);
  const requestedPlanItemId = firstParam(params?.planItemId) ?? null;
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const [sheet, setSheet] = useState(null);
  const [savedStructure, setSavedStructure] = useState(null);
  const [replacementId, setReplacementId] = useState(null);
  const [pickerCatalogue, setPickerCatalogue] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState(false);
  const pickerRequest = useRef(0);
  const [selectedItem, setSelectedItem] = useState(null);
  const [duration, setDuration] = useState(60);
  const [environmentCode, setEnvironmentCode] = useState('HOME');
  const [outdoorEngineVersion, setOutdoorEngineVersion] = useState(COMPOSER_OUTDOOR_VERSION);
  const [outdoorContext, setOutdoorContext] = useState(() => composerOutdoorContext());
  const selectedOutdoorPlace = OUTDOOR_PLACES.find((item) => item.code === outdoorContext.place_code);
  const outdoorEngine = environmentCode === 'OUTDOOR' && outdoorEngineVersion === COMPOSER_OUTDOOR_VERSION;
  const outdoorTransport = outdoorEngine ? { outdoor_engine_version: outdoorEngineVersion, outdoor_context: outdoorContext } : {};
  const [preferredRegions, setPreferredRegions] = useState([]);
  const [skillTargetPath, setSkillTargetPath] = useState(null);
  const [skillEngineVersion, setSkillEngineVersion] = useState(composerInitialSkillEngineVersion);
  const [showSkillTarget, setShowSkillTarget] = useState(false);
  const [skillTargets, setSkillTargets] = useState([]);
  const [skillTargetsLoading, setSkillTargetsLoading] = useState(false);
  const [skillTargetsError, setSkillTargetsError] = useState(false);
  const [skillTargetsRetry, setSkillTargetsRetry] = useState(0);
  const [equipmentCatalog, setEquipmentCatalog] = useState([]);
  const [referenceEquipment, setReferenceEquipment] = useState([]);
  const [equipmentIds, setEquipmentIds] = useState([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [intent, setIntent] = useState(null);
  const composerPreferences = readComposerPreferences({
    preferred_regions: preferredRegions, skill_target_path_key: skillTargetPath,
  });
  const targetRegion = legacyComposerTargetRegion(composerPreferences);
  const preferencesSignature = JSON.stringify(composerPreferences);
  const guidedComposer = composerGuidedPreferencesEnabled({ skillEngineVersion, preferredRegions, skillTargetPath });
  const skillTargetVisible = guidedComposer && Boolean(showSkillTarget || skillTargetPath);
  const [architectures, setArchitectures] = useState([]);
  const [architecture, setArchitecture] = useState(null);
  const [architectureEditError, setArchitectureEditError] = useState('');
  const previousSkillWodChoices = useRef(null);
  const [candidateMap, setCandidateMap] = useState({});
  const [candidateEvidence, setCandidateEvidence] = useState({});
  const [selectionMap, setSelectionMap] = useState({});
  const [manualEdits,setManualEdits]=useState({});
  const [doseEditor,setDoseEditor]=useState(null);
  const beforeManualEdit=useRef(null);
  const [exerciseBlockIndex, setExerciseBlockIndex] = useState(0);
  const [recapEditingBlock, setRecapEditingBlock] = useState(null);
  const [expandedExerciseId, setExpandedExerciseId] = useState(null);
  const [mechanic, setMechanic] = useState(null);
  const [wodEngineVersion, setWodEngineVersion] = useState('C4_COMPOSER_V2');
  const [mechanicOptions, setMechanicOptions] = useState([]);
  const [mechanicIssue, setMechanicIssue] = useState(null);
  const [requestedMechanic,setRequestedMechanic]=useState(null);
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewIssue, setPreviewIssue] = useState(null);
  const [previewSignature, setPreviewSignature] = useState(null);
  const [strengthAssessment, setStrengthAssessment] = useState(null);
  const [strengthAssessmentSignature, setStrengthAssessmentSignature] = useState(null);
  const [strengthAssessmentLoading, setStrengthAssessmentLoading] = useState(false);
  const [strengthAssessmentError, setStrengthAssessmentError] = useState(false);
  const [showAllMechanics, setShowAllMechanics] = useState(false);
  const [wodSelectionContracts, setWodSelectionContracts] = useState(null);
  const [wodContractsLoading, setWodContractsLoading] = useState(false);
  const [wodContractsError, setWodContractsError] = useState(false);
  const [wodContractsRetry, setWodContractsRetry] = useState(0);
  const latestComposition = useRef(null);
  latestComposition.current = JSON.stringify({ preferencesSignature, duration, environmentCode,
    equipmentIds, intent, architecture, selectionMap, skillEngineVersion, outdoorContext, outdoorEngineVersion });

  useEffect(() => {
    if (loading || !skillTargetVisible || skillTargets.length > 0) return undefined;
    let active = true;
    setSkillTargetsLoading(true);
    setSkillTargetsError(false);
    getComposerSkillTargets().then((options) => {
      if (active) setSkillTargets(options);
    }).catch((reason) => {
      if (active) {
        console.warn('[Composer] skill target catalogue unavailable', reason);
        setSkillTargetsError(true);
      }
    }).finally(() => { if (active) setSkillTargetsLoading(false); });
    return () => { active = false; };
  }, [loading, skillTargetVisible, skillTargetsRetry]);

  function maxForBlock(type, minutes = 0) {
    if (type === 'SKILL' && !skillEngineVersion) return 2;
    return type === 'WOD' ? composerWodSelectionLimit(wodSelectionContracts)
      : composerExerciseSlotLimit(type, minutes);
  }

  const wodContractMinutes = architecture?.blocks?.find((b) => b.type === 'WOD')?.minutes;
  const wodContractProbeId = candidateMap.WOD?.[0]?.id;
  useEffect(() => {
    if (loading || !wodContractMinutes || !wodContractProbeId) return undefined;
    let active = true;
    setWodSelectionContracts(null);
    setWodContractsLoading(true);
    setWodContractsError(false);
    getComposerWodSelectionContracts({
      engineVersion: wodEngineVersion,
      wodMinutes: wodContractMinutes, exerciseIds: [wodContractProbeId],
      environmentCode, focus: intent?.focus,
    }).then((contracts) => {
      if (active) setWodSelectionContracts(contracts);
    }).catch((reason) => {
      if (active) {
        console.warn('[Composer] WOD composition contracts unavailable', reason);
        setWodContractsError(true);
      }
    }).finally(() => { if (active) setWodContractsLoading(false); });
    return () => { active = false; };
  }, [loading, wodContractMinutes, wodContractProbeId, environmentCode, intent?.focus, wodContractsRetry, wodEngineVersion]);

  async function loadEquipmentForEnvironment(code, catalog = equipmentCatalog) {
    try {
      setEquipmentLoading(true);
      const rows = await getUserEnvironmentEquipmentPreset(code);
      const reference = buildReferenceEquipment(catalog, rows ?? []);
      setReferenceEquipment(reference);
      setEquipmentIds(reference.map((item) => item.id));
    } catch (loadError) {
      console.warn('[WeekComposerV7] equipment preset failed', loadError);
      setReferenceEquipment([]);
      setEquipmentIds([]);
    } finally {
      setEquipmentLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        setError('');
        const [contract, catalog, saved] = await Promise.all([
          getWeekReadContract({ anchorDate: new Date() }),
          getEquipmentCatalog(),
          getComposerForLocalDate(dateKey),
        ]);
        if (!active) return;
        const candidates = (contract?.visibleItems ?? []).filter((item) => item?.recommendedDate === dateKey && (!item?.sessionId || item.planItemId === requestedPlanItemId));
        const item = requestedPlanItemId
          ? candidates.find((candidate) => candidate.planItemId === requestedPlanItemId) ?? candidates[0] ?? null
          : candidates[0] ?? null;
        setSelectedItem(item);
        setEquipmentCatalog(catalog ?? []);
        const future = item?.plannedContext?.futureContext ?? {};
        const initialDuration = Number(future.durationMinutes ?? item?.plannedContext?.durationMinutes ?? 60);
        const initialEnvironment = String(future.environmentCode ?? item?.plannedContext?.environmentCode ?? 'HOME').toUpperCase();
        const initialTargetRegion = future.targetRegion ?? item?.plannedContext?.targetRegion ?? null;
        setDuration(DURATIONS.includes(initialDuration) ? initialDuration : 60);
        setEnvironmentCode(initialEnvironment);
        setOutdoorContext(composerOutdoorContext({ outdoorPlaceCode: future.outdoorPlaceCode, surfaceCode: future.surfaceCode }));
        setPreferredRegions(readComposerPreferences({ target_region: initialTargetRegion }).preferred_regions);
        const rows = await getUserEnvironmentEquipmentPreset(initialEnvironment);
        if (!active) return;
        const reference = buildReferenceEquipment(catalog ?? [], rows ?? []);
        setReferenceEquipment(reference);
        setEquipmentIds(reference.map((entry) => entry.id));
        const coachIntent = coachIntentFromItem(item);
        if (coachIntent) setIntent(coachIntent);

        // A composition already saved must reopen as the same user-owned
        // composition, not silently start a new coach generation from scratch.
        if (saved?.planItemId && saved.planItemId === item?.planItemId &&
            Array.isArray(saved.draft?.architecture?.blocks)) {
          const draft = saved.draft;
          const draftInventory = draft.environment_code === initialEnvironment ? rows
            : await getUserEnvironmentEquipmentPreset(draft.environment_code);
          if (!active) return;
          const draftReference = buildReferenceEquipment(catalog ?? [], draftInventory ?? []);
          setReferenceEquipment(draftReference);
          const blocks = draft.architecture.blocks;
          setSavedStructure(draft.architecture);
          const requested = {};
          const exerciseMap = {};
          for (const block of blocks) {
            requested[block.type] = (block.exercises ?? []).map((ex) => ex.id);
            exerciseMap[block.type] = (block.exercises ?? []).map((ex) => ({
              id: ex.id, name: ex.name,
            }));
          }
          // Fetch alternative candidates only for editing. Preserve selected
          // exercises even if their current compatibility has changed.
          const alternatives = await Promise.all(blocks.map(async (block) => {
            try {
              if (block.type === 'CARDIO') {
                const choices = await getComposerCardioProposal({
                  outdoor_engine_version: draft.outdoor_engine_version, outdoor_context: draft.outdoor_context,
                  session_minutes: draft.duration_minutes, block_minutes: block.minutes,
                  environment_code: draft.environment_code, focus: draft.intent?.focus,
                  progression_intent: draft.progression_intent,
                  equipment_names: draftReference.filter((e) => (draft.equipment_ids ?? []).includes(String(e.id))).map((e) => e.name),
                });
                return [block.type, choices];
              }
              const choices = await getComposerExerciseCandidates({
                blockType: block.type,
                focus: draft.intent?.focus ?? 'General Fitness',
                targetRegion: draft.target_region,
                preferences: readComposerPreferences(draft),
                environmentCode: draft.environment_code,
                outdoorGym: draft.outdoor_engine_version === COMPOSER_OUTDOOR_VERSION && block.type === 'SKILL' && !readComposerPreferences(draft).skill_target_path_key,
                equipmentIds: draft.equipment_ids ?? [],
                limit: 30,
              });
              return [block.type, choices];
            } catch {
              return [block.type, []];
            }
          }));
          if (!active) return;
          for (const [type, list] of alternatives) {
            const resolvedById = new Map(list.map((exercise) => [exercise.id, exercise]));
            const seen = new Set(exerciseMap[type].map((ex) => ex.id));
            exerciseMap[type] = [
              ...exerciseMap[type].map((ex) => resolvedById.get(ex.id) ?? ex),
              ...list.filter((ex) => !seen.has(ex.id)),
            ];
          }
          setDuration(Number(draft.duration_minutes));
          setEnvironmentCode(draft.environment_code);
          setOutdoorEngineVersion(draft.outdoor_engine_version ?? null);
          setOutdoorContext(composerOutdoorContext({}, draft.outdoor_context));
          const savedPreferences = readComposerPreferences(draft);
          setPreferredRegions(savedPreferences.preferred_regions);
          setSkillTargetPath(savedPreferences.skill_target_path_key);
          setSkillEngineVersion(draft.skill_engine_version ?? null);
          setEquipmentIds(Array.isArray(draft.equipment_ids) ? draft.equipment_ids : []);
          setIntent(draft.intent ?? coachIntent);
          setArchitecture(draft.architecture);
          setArchitectures([draft.architecture]);
          setCandidateMap(exerciseMap);
          setSelectionMap(requested);
          setManualEdits(restoreComposerManualEdits(draft));
          try {
            const observations = await getComposerCandidateEvidence({
              exerciseIds: Object.values(exerciseMap).flatMap((list) => list.map((exercise) => exercise.id)),
              anchorDate: dateKey, planItemId: item?.planItemId ?? null,
            });
            if (!active) return;
            setCandidateEvidence(observations);
          } catch {
            setCandidateEvidence({});
          }
          setMechanic(draft.mechanic ?? null);
          setWodEngineVersion(draft.wod_engine_version ?? null);
          if (draft.mechanic?.key) {
            const wod = blocks.find((b) => b.type === 'WOD');
            try {
              const options = await getComposerMechanicOptions({
                wodMinutes: wod?.minutes,
                sessionMinutes: draft.duration_minutes, targetRegion: draft.target_region,
                progressionIntent: draft.progression_intent,
                equipmentNames: draftReference.filter((e) => (draft.equipment_ids ?? []).includes(String(e.id))).map((e) => e.name),
                engineVersion: draft.wod_engine_version ?? null,
                exerciseIds: requested.WOD ?? [],
                environmentCode: draft.environment_code,
                focus: draft.intent?.focus,
              });
              if (!active) return;
              setMechanicOptions(options);
            } catch {
              setMechanicOptions([draft.mechanic]);
            }
          }
          const repairBlock = firstParam(params?.repairBlock);
          if (firstParam(params?.repair) === 'confirmed') {
            setError('Tes choix sont conservés. Ajuste le bloc concerné puis vérifie l’aperçu avant de confirmer à nouveau.');
            if (blocks.some((b) => b.type === repairBlock && !['WARMUP','TABATA'].includes(b.type))) {
              setRecapEditingBlock(repairBlock); setExerciseBlockIndex(0); setStep(3);
            } else setStep(5);
          } else setStep(5);
        }
      } catch (loadError) {
        console.warn('[WeekComposerV7] load failed', loadError);
        if (active) setError('Impossible de charger le Composer pour le moment.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [dateKey, requestedPlanItemId, params?.repair, params?.repairBlock]);

  async function chooseEnvironment(code) {
    setEnvironmentCode(code);
    if (code !== environmentCode) setOutdoorEngineVersion(COMPOSER_OUTDOOR_VERSION);
    await loadEquipmentForEnvironment(code);
  }

  function toggleEquipment(id) {
    setEquipmentIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  }

  function equipmentNames() {
    const selected = new Set(equipmentIds);
    return referenceEquipment
      .filter((item) => selected.has(String(item.id)))
      .map((item) => item.name)
      .filter(Boolean);
  }

  function openProfileEquipment() {
    setSheet(null);
    const returnTo = `/workout/preparation?entry=week_assisted&date=${encodeURIComponent(String(dateKey ?? ''))}${requestedPlanItemId ? `&planItemId=${encodeURIComponent(String(requestedPlanItemId))}` : ''}`;
    router.push({
      pathname: '/profile/equipment',
      params: { returnTo, environment: environmentCode, view: 'categories' },
    });
  }

  async function goToArchitecture() {
    if (!intent) return;
    if (environmentCode === 'OUTDOOR' && (!outdoorContext.place_code || !outdoorContext.surface_code)) {
      setError('Précise le lieu et le terrain de ta séance extérieure.'); return;
    }
    try {
      setBusy(true);
      setError('');
      const targets = await getComposerArchitectureTargets(duration);
      // Coach source keys (COACH_STRENGTH, COACH_CONDITIONING...) are not
      // product intent types. Follow the Coach's actual focus instead of
      // treating a generic Coach direction as an endurance request.
      const planningIntentKey = (intent.key === 'TECHNIQUE' || intent.key === 'COACH_TECHNIQUE') ? 'TECHNIQUE'
        : intent.focus === 'Strength' ? 'STRENGTH'
          : intent.focus === 'Conditioning' ? 'CONDITIONING'
            : 'GENERAL_FITNESS';
      const proposal = guidedComposer ? await getComposerArchitectureProposal({ durationMinutes: duration, environmentCode, outdoorContext, skillTargetPath }) : null;
      const proposed = proposal?.options ?? buildComposerArchitectures({
        durationMinutes: duration, intentKey: planningIntentKey, environmentCode, targets,
      });
      const next = proposed.map((option) => composerArchitectureForTarget(option, skillTargetPath));
      if (['HOME', 'BOX'].includes(environmentCode) && !next.some((option) => composerMainBlocks(option).length === 1 && composerMainBlocks(option)[0].type === 'STRENGTH')) {
        const solo = composerStrengthOnlyOption(next.find((option) => composerMainBlocks(option).length === 1) ?? next[0]);
        if (solo) next.push(solo);
      }
      if (environmentCode === 'OUTDOOR') { setOutdoorEngineVersion(COMPOSER_OUTDOOR_VERSION); setSkillEngineVersion('C4_COMPOSER_SKILL_V1'); }
      if (proposal?.status === 'DEFAULT_UNAVAILABLE') setArchitectureEditError(proposal.reason);
      previousSkillWodChoices.current = null;
      setRequestedMechanic(null);
      setArchitectures(next);
      setArchitecture(proposal?.status === 'DEFAULT_UNAVAILABLE' ? null : next[0] ?? null);
      if (proposal?.status !== 'DEFAULT_UNAVAILABLE') setArchitectureEditError('');
      setStep(2);
    } catch (loadError) {
      console.warn('[WeekComposerV7] architecture failed', loadError);
      setError('Impossible de préparer les structures proposées.');
    } finally {
      setBusy(false);
    }
  }

  function changeArchitecture(action) {
    if (action.blockType === 'CARDIO' && !['GYM', 'OUTDOOR'].includes(environmentCode)) return;
    const result = editComposerArchitecture(architecture, action);
    if (!result.ok) {
      setArchitectureEditError(result.error);
      return;
    }
    setArchitecture(result.architecture);
    setArchitectureEditError('');
    setError('');
    // Each type has a single identity in the current Day-J compiler; never
    // retain exercise choices from a block the athlete explicitly removed.
    if (result.removedType) {
      setSelectionMap((previous) => {
        const next = { ...previous };
        delete next[result.removedType];
        return next;
      });
      setCandidateMap((previous) => {
        const next = { ...previous };
        delete next[result.removedType];
        return next;
      });
      if (result.removedType === 'WOD') {
        setMechanic(null);
        setMechanicOptions([]);
      }
    }
    setPreviewSignature(null);
    setPrescriptionPreview(null);
    setPreviewIssue(null);
    setStrengthAssessment(null);
  }

  async function goToExercises() {
    if (!architecture) return;
    const requestedComposition = latestComposition.current;
    try {
      setBusy(true);
      setError('');
      const results = await Promise.all((architecture.blocks ?? []).map(async (block) => {
        if (block.type === 'CARDIO') {
          const candidates = await getComposerCardioProposal({ session_minutes: duration, block_minutes: block.minutes,
            ...outdoorTransport, focus: intent?.focus, environment_code: environmentCode, equipment_names: equipmentNames(),
            progression_intent: selectedItem?.plannedContext?.progressionIntent ?? 'MAINTAIN', target_region: targetRegion });
          return [block.type, candidates];
        }
        const candidates = await getComposerExerciseCandidates({
          blockType: block.type,
          focus: intent?.focus ?? 'General Fitness',
          targetRegion,
          preferences: guidedComposer ? composerPreferences : null,
          environmentCode,
          outdoorGym: outdoorEngine && block.type === 'SKILL' && !skillTargetPath,
          equipmentIds,
          limit: 30,
        });
        return [block.type, candidates];
      }));
      const candidatesByBlock = Object.fromEntries(results);
      // Keep user-authored choices even if the ranked shortlist changes.
      // A mismatch must be diagnosed in the preview, not silently substituted.
      for (const block of architecture.blocks ?? []) {
        const preservedIds = new Set(selectionMap[block.type] ?? []);
        if (!preservedIds.size) continue;
        const existing = candidatesByBlock[block.type] ?? [];
        const seen = new Set(existing.map((item) => item.id));
        const preserved = (candidateMap[block.type] ?? [])
          .filter((item) => preservedIds.has(item.id) && !seen.has(item.id));
        candidatesByBlock[block.type] = [...preserved, ...existing];
      }
      let observations = {};
      try {
        const ids = results.flatMap(([, candidates]) => candidates.map((candidate) => candidate.id));
        observations = await getComposerCandidateEvidence({
          exerciseIds: ids, anchorDate: dateKey,
          planItemId: selectedItem?.planItemId ?? null,
        });
      } catch (evidenceError) {
        console.warn('[Composer] recommendations proceed without recent-history evidence', evidenceError);
      }
      const defaults = selectComposerDefaultExercises({
        targetRegion,
        candidateMap: candidatesByBlock,
        evidence: observations,
        equipmentIds,
        maxPerBlock: Object.fromEntries((architecture.blocks ?? []).map(
          // Keep current automatic defaults. Raising the manual ceiling must
          // never silently add exercises to an athlete's initial proposal.
          (block) => [block.type, block.type === 'SKILL' ? 2 : composerExerciseSlotLimit(block.type, block.minutes)]
        )),
      });
      if (candidatesByBlock.CARDIO) defaults.CARDIO = candidatesByBlock.CARDIO.map((e) => e.id);
      // A new or edited structure never erases exercises the athlete picked.
      for (const block of architecture.blocks ?? []) {
        const previousChoice = selectionMap[block.type];
        if (Array.isArray(previousChoice) && previousChoice.length) {
          defaults[block.type] = [...previousChoice];
        }
      }
      const strength = (architecture.blocks ?? []).find((block) => block.type === 'STRENGTH');
      if (strength && !(selectionMap.STRENGTH ?? []).length) {
        const ordered = (defaults.STRENGTH ?? []).map((id) => candidatesByBlock.STRENGTH.find((x) => x.id === id))
          .filter(Boolean).map((exercise) => ({ id: exercise.id, name: exercise.name }));
        // A missing initial proposal is not a reason to lock the catalogue.
        // The existing preview still validates every manual composition.
        const proposal = ordered.length ? await getComposerStrengthAutoPick({
          candidates: ordered, sessionMinutes: duration, blockMinutes: strength.minutes,
          progressionIntent: selectedItem?.plannedContext?.progressionIntent ?? 'MAINTAIN',
          equipmentNames: equipmentNames(), focus: intent?.focus ?? 'Strength',
          targetRegion,
          environmentCode,
        }) : null;
        defaults.STRENGTH = (proposal?.selected_exercises ?? []).map((item) => item.id);
        setStrengthAssessment(proposal);
        setStrengthAssessmentError(false);
      } else {
        setStrengthAssessment(null);
        setStrengthAssessmentError(false);
      }
      const skill = (architecture.blocks ?? []).find((block) => block.type === 'SKILL');
      if (skill && skillEngineVersion && !(selectionMap.SKILL ?? []).length) {
        const proposal = await getComposerAutomaticSkillProposal({
          context: {
            ...outdoorTransport, automatic_selection: outdoorEngine && !skillTargetPath,
            preferences: composerPreferences, session_minutes: duration, block_minutes: skill.minutes,
            environment_code: environmentCode, focus: intent?.focus ?? 'General Fitness',
            progression_intent: selectedItem?.plannedContext?.progressionIntent ?? 'MAINTAIN',
            equipment_names: equipmentNames(), readiness: 'normal',
            exercises: (defaults.SKILL ?? []).map((id) => ({ id })),
            wod_exercises: (defaults.WOD ?? []).map((id) => ({ exercise_id: id })),
          },
          candidateMap: candidatesByBlock, defaultSelections: defaults,
          evidence: observations, equipmentIds, targetRegion,
        });
        if (proposal?.status !== 'READY') {
          // No valid recommendation: open an empty editable block instead.
          // Never manufacture a lesson or present a rejected dose as valid.
          defaults.SKILL = [];
        } else {
        const byId = new Map((candidatesByBlock.SKILL ?? []).map((exercise) => [exercise.id, exercise]));
        for (const exercise of proposal.exercises ?? []) {
          if (!byId.has(exercise.id)) byId.set(exercise.id, {
            ...exercise, description: exercise.instructions, imagePath: exercise.image_path,
            bodyRegion: exercise.region, movementPattern: exercise.pattern,
            exerciseFamily: exercise.family,
          });
        }
        candidatesByBlock.SKILL = [...byId.values()];
        defaults.SKILL = proposal.exercises.map((exercise) => exercise.id);
        // Reuse the existing complement selection after the actual lesson is
        // known. Preserve every explicit choice; never duplicate an engine
        // Skill exercise in a newly proposed Warm-up/Tabata by accident.
        const fixedSelections = Object.fromEntries(Object.entries(defaults).filter(([type]) =>
          !['WARMUP', 'TABATA'].includes(type) || (selectionMap[type] ?? []).length));
        const refreshed = selectComposerDefaultExercises({
          candidateMap: candidatesByBlock, fixedSelections, evidence: observations,
          equipmentIds, targetRegion,
          maxPerBlock: Object.fromEntries((architecture.blocks ?? []).map((block) =>
            [block.type, composerExerciseSlotLimit(block.type, block.minutes)])),
        });
        for (const type of ['WARMUP', 'TABATA']) {
          if (!(selectionMap[type] ?? []).length && refreshed[type]) defaults[type] = refreshed[type];
        }
        }
      }
      if (requestedComposition !== latestComposition.current) return;
      setCandidateMap(candidatesByBlock);
      setCandidateEvidence(observations);
      setSelectionMap(defaults);
      setRecapEditingBlock(null);
      setExerciseBlockIndex(0);
      setExpandedExerciseId(null);
      setStep(3);
    } catch (loadError) {
      console.warn('[WeekComposerV7] candidate load failed', loadError);
      if (requestedComposition !== latestComposition.current) return;
      setError(loadError.userMessage ?? 'Impossible de charger les mouvements proposés.');
    } finally {
      setBusy(false);
    }
  }

  async function openExercisePicker(id = null, nextEquipmentIds = equipmentIds) {
    if (!activeBlock || activeBlock.type === 'CARDIO') return;
    const request = ++pickerRequest.current;
    setReplacementId(id);
    setPickerCatalogue([]); setPickerError(false); setPickerLoading(true);
    setSheet('exercise-picker');
    try {
      const rows = await getComposerExerciseCandidates({
        blockType: activeBlock.type, focus: intent?.focus ?? 'General Fitness',
        environmentCode, equipmentIds: nextEquipmentIds, manualCatalogue: true,
      });
      if (request !== pickerRequest.current) return;
      // Only the real inventory/environment authority can approve catalogue rows.
      setPickerCatalogue(rows);
      // Evidence is optional; never restrict exploration if history is unavailable.
      setPickerLoading(false);
      const chunks = [];
      for (let offset = 0; offset < rows.length; offset += 160) chunks.push(rows.slice(offset, offset + 160));
      const evidence = await Promise.all(chunks.map((chunk) => getComposerCandidateEvidence({
        exerciseIds: chunk.map((row) => row.id), anchorDate: dateKey,
        planItemId: selectedItem?.planItemId ?? null,
      }).catch(() => ({}))));
      if (request === pickerRequest.current) setCandidateEvidence((old) => Object.assign({}, old, ...evidence));
    } catch (err) {
      if (request === pickerRequest.current) setPickerError(true);
    } finally {
      if (request === pickerRequest.current) setPickerLoading(false);
    }
  }

  function closeExercisePicker() {
    ++pickerRequest.current;
    setPickerLoading(false);
    setReplacementId(null);
    setSheet(null);
  }

  function addPickerEquipment(ids) {
    const nextEquipmentIds=pickerAddSessionEquipment(equipmentIds,ids,referenceEquipment);
    setEquipmentIds(nextEquipmentIds);
    openExercisePicker(replacementId,nextEquipmentIds);
    setPreviewSignature(null); setPrescriptionPreview(null); setPreviewIssue(null);
    setStrengthAssessmentSignature(null);
  }

  function selectPickerExercise(exercise) {
    if (!activeBlock || !pickerEquipmentMatches(exercise, equipmentIds)) return;
    const type = activeBlock.type;
    setCandidateMap((old) => ({
      ...old, [type]: (old[type] ?? []).some((row) => row.id === exercise.id)
        ? old[type] : [...(old[type] ?? []), exercise],
    }));
    chooseExercise(type, exercise.id);
  }

  function chooseStrengthOnly(option) {
    if (busy || !option) return;
    if (architecture?.blocks?.some(block => block.type === 'SKILL')) {
      previousSkillWodChoices.current = { environmentCode, duration, selectionMap, candidateMap };
    }
    // Explicit format change: retain the preparation and current Strength
    // choices, or reuse Skill choices as the starting point for recalculation.
    setSkillTargetPath(null); setShowSkillTarget(false);
    setArchitecture(option);
    setSelectionMap((old) => ({ WARMUP: old.WARMUP ?? [], TABATA: old.TABATA ?? [],
      STRENGTH: old.STRENGTH?.length ? old.STRENGTH : old.SKILL ?? [] }));
    setCandidateMap((old) => ({ WARMUP: old.WARMUP ?? [], TABATA: old.TABATA ?? [],
      STRENGTH: old.STRENGTH?.length ? old.STRENGTH : old.SKILL ?? [] }));
    setMechanic(null); setMechanicOptions([]);
    setPreviewSignature(null); setPrescriptionPreview(null); setPreviewIssue(null);
    setStrengthAssessment(null); setArchitectureEditError(''); setError('');
  }

  function chooseSkillWod(option) {
    if (busy || !option) return;
    const previous = previousSkillWodChoices.current;
    const restore = previous?.environmentCode === environmentCode && previous?.duration === duration ? previous : null;
    setArchitecture(option);
    // Do not copy a Musculation prescription or its eight movements into a Skill.
    // Preserve common blocks and restore previous Skill/WOD choices when available.
    setSelectionMap(old => ({ WARMUP: old.WARMUP ?? [], TABATA: old.TABATA ?? [],
      SKILL: old.SKILL?.length ? old.SKILL : restore?.selectionMap.SKILL ?? [],
      WOD: old.WOD?.length ? old.WOD : restore?.selectionMap.WOD ?? [] }));
    setCandidateMap(old => ({ WARMUP: old.WARMUP ?? [], TABATA: old.TABATA ?? [],
      SKILL: old.SKILL?.length ? old.SKILL : restore?.candidateMap.SKILL ?? [],
      WOD: old.WOD?.length ? old.WOD : restore?.candidateMap.WOD ?? [] }));
    setSkillTargetPath(null); setShowSkillTarget(false);
    setMechanic(null); setMechanicOptions([]); setMechanicIssue(null);
    setPreviewSignature(null); setPrescriptionPreview(null); setPreviewIssue(null);
    setStrengthAssessment(null); setStrengthAssessmentSignature(null);
    setArchitectureEditError(''); setError('');
  }

  async function refreshCardioProtocol() {
    const block = architecture?.blocks?.find((b) => b.type === 'CARDIO');
    if (!block || busy) return;
    const signature = latestComposition.current;
    try {
      setBusy(true); setError('');
      const rows = await getComposerCardioProposal({ session_minutes: duration, block_minutes: block.minutes,
        ...outdoorTransport, focus: intent?.focus, environment_code: environmentCode, equipment_names: equipmentNames(), target_region: targetRegion,
        progression_intent: selectedItem?.plannedContext?.progressionIntent ?? 'MAINTAIN' });
      if (latestComposition.current !== signature) return;
      setCandidateMap((current) => ({ ...current, CARDIO: rows }));
      setSelectionMap((current) => ({ ...current, CARDIO: rows.map((e) => e.id) }));
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }

  function chooseExercise(type, id) {
    if (type === 'CARDIO') { setError(outdoorEngine ? 'Le moteur adapte la course à la durée et au contexte extérieur. Reviens au contexte pour les modifier.' : 'Le protocole cardio dépend du matériel. Modifie le matériel puis recalcule les mouvements pour le changer.'); return; }
    const minutes = architecture?.blocks?.find((block) => block.type === type)?.minutes ?? 0;
    const max = maxForBlock(type, minutes);
    const before = selectionMap[type] ?? [];
    if (type === 'SKILL' && skillTargetPath &&
        chooseComposerExercise(before, id, max, replacementId) !== before) {
      setSkillTargetPath(null); setShowSkillTarget(false);
    }
    setSelectionMap((current) => {
      const selected = current[type] ?? [];
      return { ...current, [type]: chooseComposerExercise(selected, id, max, replacementId) };
    });
    if (replacementId) closeExercisePicker();
  }

  async function refreshSkillLesson() {
    const skill = architecture?.blocks?.find((block) => block.type === 'SKILL');
    if (!skill || !skillEngineVersion || busy) return;
    const requestedComposition = latestComposition.current;
    try {
      setBusy(true);
      setError('');
      const proposal = await getComposerSkillProposal({
        ...outdoorTransport,
        preferences: composerPreferences, session_minutes: duration, block_minutes: skill.minutes,
        environment_code: environmentCode, focus: intent?.focus ?? 'General Fitness',
        progression_intent: selectedItem?.plannedContext?.progressionIntent ?? 'MAINTAIN',
        equipment_names: equipmentNames(), readiness: 'normal',
        exercises: (selectionMap.SKILL ?? []).map((id) => ({ id })),
        wod_exercises: (selectionMap.WOD ?? []).map((id) => ({ exercise_id: id })),
      });
      if (requestedComposition !== latestComposition.current) return;
      if (proposal?.status !== 'READY') {
        setError(composerPreviewIssue(proposal));
        return;
      }
      setCandidateMap((previous) => {
        const byId = new Map((previous.SKILL ?? []).map((exercise) => [exercise.id, exercise]));
        for (const exercise of proposal.exercises ?? []) byId.set(exercise.id, {
          ...byId.get(exercise.id), ...exercise, description: exercise.instructions,
          imagePath: exercise.image_path, bodyRegion: exercise.region,
          movementPattern: exercise.pattern, exerciseFamily: exercise.family,
        });
        return { ...previous, SKILL: [...byId.values()] };
      });
      setSelectionMap((previous) => ({ ...previous, SKILL: proposal.exercises.map((exercise) => exercise.id) }));
      setPreviewSignature(null);
      setPrescriptionPreview(null);
    } catch {
      if (requestedComposition === latestComposition.current) setError('Impossible d’actualiser la leçon technique. Réessaie.');
    } finally {
      setBusy(false);
    }
  }

  function editWodForMechanic(option=null){
    setRequestedMechanic(option);
    setRecapEditingBlock('WOD');setExerciseBlockIndex(0);setExpandedExerciseId(null);
    setMechanicIssue(null);setError('');setStep(3);
  }

  async function advanceExerciseBlock() {
    const blocks = recapEditingBlock
      ? (architecture?.blocks ?? []).filter((item) => item.type === recapEditingBlock)
      : (architecture?.blocks ?? []).filter((item) => !['WARMUP', 'TABATA'].includes(item.type));
    setExpandedExerciseId(null);
    if (exerciseBlockIndex < blocks.length - 1) {
      setExerciseBlockIndex((value) => value + 1);
      return;
    }
    if (recapEditingBlock && recapEditingBlock !== 'WOD') {
      setRecapEditingBlock(null);
      setStep(5);
      return;
    }
    const wodBlock = blocks.find((block) => block.type === 'WOD');
    if (!wodBlock) {
      setMechanic(null);
      setRecapEditingBlock(null);
      setStep(5);
      return;
    }
    try {
      setBusy(true);
      setError('');
      const compatibility=await getComposerExerciseCompatibility({exerciseIds:selectionMap.WOD??[],equipmentIds,environmentCode});
      const bad=(selectionMap.WOD??[]).filter(id=>!compatibility[id]?.equipment_ok||!compatibility[id]?.environment_ok||compatibility[id]?.wod_role==='prep_only');
      if(bad.length){
        const names=bad.map(id=>{const exercise=candidateMap.WOD?.find(row=>row.id===id);const status=compatibility[id];return (exercise?.name??id)+' ('+(!status?'référence manquante':!status.equipment_ok?'matériel ou quantité requis':!status.environment_ok?'lieu incompatible':'réservé à la préparation')+')';});
        setError('À ajuster : '+names.join(' · ')+'. Remplace ces mouvements ou ajoute le matériel nécessaire. Les mouvements de préparation restent disponibles dans les autres blocs adaptés.');
        setRecapEditingBlock('WOD');setExerciseBlockIndex(0);setStep(3);return;
      }
      if(!(selectionMap.WOD??[]).some(id=>compatibility[id]?.wod_role==='wod')){
        setError('Ajoute au moins un mouvement d’entraînement au WOD. Les variantes adaptées peuvent compléter le bloc.');
        setRecapEditingBlock('WOD');setExerciseBlockIndex(0);setStep(3);return;
      }
      const options = await getComposerMechanicOptions({
        sessionMinutes: duration, targetRegion,
        equipmentNames: referenceEquipment.filter((e) => equipmentIds.includes(String(e.id))).map((e) => e.name),
        progressionIntent: selectedItem?.plannedContext?.progressionIntent ?? 'MAINTAIN',
        engineVersion: 'C4_COMPOSER_V2',
        wodMinutes: wodBlock.minutes,
        exerciseIds: selectionMap.WOD ?? [],
        environmentCode,
        focus: intent?.focus,
      });
      setWodEngineVersion('C4_COMPOSER_V2');
      setMechanicOptions(options);
      setMechanicIssue(null);
      const requested=requestedMechanic?options.find(option=>composerMechanicIdentity(option)===composerMechanicIdentity(requestedMechanic)):null;
      setMechanic((current) => requested ? (requested.available?requested:null) : options.find((option) => option.available !== false && composerMechanicIdentity(option) === composerMechanicIdentity(current))
        ?? options.find((option) => option.available !== false));
      if(requested&&!requested.available)setMechanicIssue(requested.title+' : '+composerMechanicAdjustmentReason(requested));
      if(requested?.available)setRequestedMechanic(null);
      setShowAllMechanics(Boolean(requested&&!requested.available)||!options.some((option) => option.available !== false));
      setStep(4);
    } catch (reason) {
      console.warn('[Composer] mechanic recommendation failed', reason);
      setError('Impossible de valider les mécaniques compatibles avec tes mouvements.');
    } finally {
      setBusy(false);
    }
  }

  function selectedExercises(type) {
    const candidates = candidateMap[type] ?? [];
    return (selectionMap[type] ?? [])
      .map((id) => candidates.find((exercise) => exercise.id === id))
      .filter(Boolean);
  }

  function editRecapBlock(type) {
    setRecapEditingBlock(type);
    setExerciseBlockIndex(0);
    setExpandedExerciseId(null);
    setStep(3);
  }

  function openManualEditor(type,exerciseId,title,fields){
    if(!fields.length)return;
    setDoseEditor({type,exerciseId,title,fields,values:Object.fromEntries(fields.map(f=>[f.key,String(f.value)]))});
  }
  function applyManualEditor(reset=false){
    if(!doseEditor)return;
    const {type,exerciseId,fields,values}=doseEditor;
    if(!reset&&!validComposerManualValues(fields,values))return;
    const key=composerManualKey(type,mechanic);
    const changes=Object.fromEntries(fields.filter(f=>Number(values[f.key])!==f.value).map(f=>[f.key,Number(values[f.key])]));
    if(!reset&&!Object.keys(changes).length){setDoseEditor(null);return;}
    beforeManualEdit.current=manualEdits;
    setManualEdits(old=>{
      const entry=old[key]??{exercises:{},parameters:{}};
      const next={...entry,exercises:{...entry.exercises},parameters:{...entry.parameters}};
      if(exerciseId){if(reset)delete next.exercises[exerciseId];else next.exercises[exerciseId]={...next.exercises[exerciseId],...changes};}
      else next.parameters=reset?{}:{...next.parameters,...changes};
      if(!Object.keys(next.exercises).length&&!Object.keys(next.parameters).length){const copy={...old};delete copy[key];return copy;}
      return {...old,[key]:next};
    });
    setDoseEditor(null);
  }
  function resetManualEdits(){beforeManualEdit.current=manualEdits;setManualEdits({});}
  function undoManualEdit(){if(beforeManualEdit.current){setManualEdits(beforeManualEdit.current);beforeManualEdit.current=null;}}
  function buildCurrentDraft() {
    const estimatedMinutes = architecture?.estimatedMinutes
      ?? (architecture?.blocks ?? []).reduce((sum, item) => sum + Number(item.minutes ?? 0), 0);
    return withComposerPreferences({
      ...outdoorTransport,
      target_date: dateKey,
      wod_engine_version: wodEngineVersion,
      ...(skillEngineVersion ? { skill_engine_version: skillEngineVersion } : {}),
      duration_minutes: duration,
      environment_code: environmentCode,
      equipment_ids: equipmentIds,
      progression_intent: selectedItem?.plannedContext?.progressionIntent ?? 'MAINTAIN',
      intent: { key: intent?.key ?? null, label: intent?.label ?? null, focus: intent?.focus ?? null },
      architecture: {
        key: architecture?.key ?? null,
        title: architecture?.title ?? null,
        blocks: (architecture?.blocks ?? []).map((block) => attachComposerManualEdits({
          type: block.type,
          label: outdoorEngine ? composerBlockDisplayLabel(block.type, environmentCode) : block.label,
          minutes: block.minutes,
          exercises: selectedExercises(block.type).map((exercise) => ({ id: exercise.id, name: exercise.name })),
        },mechanic,manualEdits,{skillTarget:skillTargetPath,wodEngineVersion})),
      },
      mechanic: mechanic ? { key: mechanic.key, variant_key: mechanic.variant_key ?? null, title: mechanic.title } : null,
      estimated_minutes: estimatedMinutes,
    }, composerPreferences);
  }

  useEffect(() => {
    if (loading || ![4, 5].includes(step) || !architecture || !Object.keys(selectionMap).length
        || (architecture.blocks?.some((b) => b.type === 'WOD') && !mechanic)) return undefined;
    let active = true;
    const draft = buildCurrentDraft();
    const draftSignature = JSON.stringify(draft);
    const selectedNames = referenceEquipment
      .filter((item) => equipmentIds.includes(String(item.id)))
      .map((item) => item.name).filter(Boolean);
    setPreviewLoading(true);
    setPreviewError(false);
    setPreviewIssue(null);
    setPreviewSignature(null);
    setPrescriptionPreview(null);
    getComposerPrescriptionPreview({ draft, equipmentNames: selectedNames })
      .then((result) => {
        if (!active) return;
        if(result?.status==='PREVIEW')beforeManualEdit.current=null;
        setPrescriptionPreview(result?.status === 'PREVIEW' ? result : null);
        setPreviewSignature(result?.status === 'PREVIEW' ? draftSignature : null);
        setPreviewIssue(['NEEDS_RECOMPOSITION','RECOMPOSITION_REQUIRED','UNAVAILABLE'].includes(result?.status) ? result : null);
        if (!['PREVIEW', 'NEEDS_RECOMPOSITION','RECOMPOSITION_REQUIRED','UNAVAILABLE'].includes(result?.status)) setPreviewError(true);
      })
      .catch((reason) => {
        if (active) {
          console.warn('[Composer] C2 preview unavailable', reason);
          const manualMessage=composerManualError(reason);
          if(manualMessage)setPreviewIssue({reason:'COMPOSER_MANUAL_ERROR',manualMessage});else setPreviewError(true);
        }
      })
      .finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [loading, step, architecture, selectionMap, candidateMap, mechanic,
      referenceEquipment, equipmentIds, duration, environmentCode, targetRegion, intent, dateKey, wodEngineVersion, preferencesSignature, skillEngineVersion, outdoorContext, outdoorEngineVersion,manualEdits]);

  const strengthRequest = {
    exercises: (selectionMap.STRENGTH ?? []).map((id) => {
      const row = (candidateMap.STRENGTH ?? []).find((x) => x.id === id);
      return { id, name: row?.name ?? id };
    }),
    sessionMinutes: duration,
    blockMinutes: architecture?.blocks?.find((b) => b.type === 'STRENGTH')?.minutes,
    progressionIntent: selectedItem?.plannedContext?.progressionIntent ?? 'MAINTAIN',
    equipmentNames: equipmentNames(), focus: intent?.focus ?? 'Strength',
    targetRegion,
    environmentCode,
  };
  const strengthRequestSignature = JSON.stringify(strengthRequest);
  const currentStrengthAssessment = currentComposerAssessment(
    strengthAssessment, strengthAssessmentSignature, strengthRequestSignature,
    strengthAssessmentLoading, strengthAssessmentError,
  );

  // Every manual replacement triggers the same server-side C2/C4/time budget
  // check as automatic selection and recap. Never silently fill unused time.
  useEffect(() => {
    if (loading || !architecture || ![3, 4, 5].includes(step)) return undefined;
    if (!strengthRequest.blockMinutes || !strengthRequest.exercises.length) {
      setStrengthAssessment(null);
      setStrengthAssessmentSignature(null);
      setStrengthAssessmentLoading(false);
      setStrengthAssessmentError(false);
      return undefined;
    }
    let active = true;
    setStrengthAssessmentLoading(true);
    setStrengthAssessmentError(false);
    setStrengthAssessmentSignature(null);
    getComposerStrengthAssessment(strengthRequest).then((result) => {
      if (active) {
        setStrengthAssessment(result);
        setStrengthAssessmentSignature(strengthRequestSignature);
      }
    })
      .catch((err) => {
        if (active) {
          console.warn('[Composer] shared strength authority failed', err);
          setStrengthAssessmentError(true);
          setStrengthAssessment(null);
        }
      }).finally(() => { if (active) setStrengthAssessmentLoading(false); });
    return () => { active = false; };
  }, [loading, step, strengthRequestSignature]);

  async function addToWeek({ confirmReplacement = false } = {}) {
    try {
      setBusy(true);
      setError('');
      if (!prescriptionPreview || JSON.stringify(buildCurrentDraft()) !== previewSignature || previewLoading || previewIssue || strengthAssessmentError
          || (architecture?.blocks ?? []).some((b) => b.type === 'STRENGTH')
             && (strengthAssessmentLoading || currentStrengthAssessment?.status !== 'READY')) {
        throw new Error('La composition doit être validée par le moteur sportif avant enregistrement.');
      }
      const context = {
        duration_minutes: duration,
        environment_code: environmentCode,
        equipment: equipmentNames(),
        ...(outdoorEngine ? { surface_code: outdoorContext.surface_code, outdoor_place_code: outdoorContext.place_code } : {}),
        target_region: targetRegion,
      };
      let planItemId = selectedItem?.planItemId ?? null;
      if (!planItemId) {
        const created = await createAssistedWeekPlanItem({ recommendedDate: dateKey, context });
        planItemId = created?.planItemId ?? null;
        if (planItemId) setSelectedItem((item) => ({ ...(item ?? {}), planItemId }));
      }
      if (!planItemId) throw new Error('Impossible de créer le créneau de semaine.');

      const draft = { ...buildCurrentDraft(), prescription_preview: prescriptionPreview };
      const saved = await saveComposerDraft({ planItemId, draft, context, confirmReplacement });
      if (saved?.status === 'CONFIRM_REPLACEMENT_REQUIRED') { setSheet('confirm-revision'); return; }
      if (saved?.status !== 'SAVED') throw new Error('La séance n’a pas pu être enregistrée.');
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/planning');
    } catch (saveError) {
      console.warn('[WeekComposerV7] save failed', saveError);
      setError(saveError?.message ?? 'Impossible d’ajouter cette séance à Ma semaine.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>UGEROD prépare le Composer…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const rawCoachChoice = coachIntentFromItem(selectedItem);
  const coachChoice = rawCoachChoice;
  const fallbackChoices = FALLBACK_INTENTS
    .filter((choice) => !(coachChoice && directionBaseLabel(choice) === directionBaseLabel(coachChoice)));
  const intentChoices = [
    ...(coachChoice ? [coachChoice] : []),
    ...fallbackChoices,
  ];
  const effectiveIntent = intentChoices.find((choice) => choice.key === intent?.key) ?? intent;

  // Construct the main session first; keep Warm-up/Tabata for recap edits.
  const exerciseBlocks = recapEditingBlock
    ? (architecture?.blocks ?? []).filter((item) => item.type === recapEditingBlock)
    : (architecture?.blocks ?? []).filter((item) => !['WARMUP', 'TABATA'].includes(item.type));
  const intentKey = String(effectiveIntent?.key ?? '').toUpperCase();
  const activeBlock = exerciseBlocks[exerciseBlockIndex] ?? null;
  const activeCandidates = activeBlock ? rankComposerCandidates({
    candidates: candidateMap[activeBlock.type] ?? [],
    blockType: activeBlock.type,
    selectionMap, candidateMap, evidence: candidateEvidence, equipmentIds,
  }) : [];
  const activeSelected = activeBlock ? selectionMap[activeBlock.type] ?? [] : [];
  const selectedCandidateObjects = activeSelected.map((id) => activeCandidates.find((exercise) => exercise.id === id)).filter(Boolean);
  const rankedById = new Map(activeCandidates.map((exercise) => [exercise.id, exercise]));
  const pickerRows = pickerCatalogue.map((exercise) => ({
    ...rankedById.get(exercise.id), ...exercise,
    missingEquipment: exercise.missingEquipment ?? [],
    recommended: pickerEquipmentMatches(exercise, equipmentIds) && Boolean(rankedById.get(exercise.id)?.recommended),
  })).sort((a, b) => Number(b.recommended) - Number(a.recommended));
  const favoriteIds = Object.entries(candidateEvidence).filter(([,e]) => e.explicit_preference_state === 'FAVORI').map(([id]) => id);
  const mainBlocks = composerMainBlocks(architecture);
  const strengthOnlyOption = ['HOME','BOX','GYM'].includes(environmentCode) && mainBlocks.length &&
    !(mainBlocks.length === 1 && mainBlocks[0].type === 'STRENGTH')
    ? composerStrengthOnlyOption(architecture) : null;
  const skillWodOption = ['HOME','BOX'].includes(environmentCode)
    ? composerSkillWodOption(architecture, architectures, duration) : null;

  const wodBlock = architecture?.blocks?.find((block) => block.type === 'WOD') ?? null;
  const estimatedMinutes = architecture?.estimatedMinutes
    ?? (architecture?.blocks ?? []).reduce((sum, item) => sum + Number(item.minutes ?? 0), 0);
  const equipmentSummary = equipmentLoading ? 'Chargement…' : summarizeEquipment(referenceEquipment, equipmentIds);
  const allEquipmentSelected = referenceEquipment.length > 0
    && referenceEquipment.every((item) => equipmentIds.includes(item.id));
  const bodyweightOnly = equipmentIds.length === 0;
  const currentPreview = !previewLoading && previewSignature === JSON.stringify(buildCurrentDraft())
    ? prescriptionPreview : null;
  const currentWodPreview = currentPreview?.blocks?.find((b) => b.type === 'WOD');
  const recapTime=composerManualTimeSummary(currentPreview,duration);
  const hasManualEdits=(buildCurrentDraft().architecture?.blocks??[]).some(b=>Object.keys(b.manual_parameters??{}).length>0||b.exercises.some(x=>Object.keys(x.manual_dose??{}).length>0));
  const activePreviewBlock = currentPreview?.blocks?.find((b) => b.type === activeBlock?.type);
  function movementDose(exercise) {
    return activeBlock?.type === 'STRENGTH' ? currentStrengthAssessment?.exercises?.find((item) => item.id === exercise.id)
      : activePreviewBlock?.exercises?.find((item) => item.id === exercise.id);
  }
  function movementDoseLabel(exercise) {
    const dose = movementDose(exercise);
    if (dose) return formatPreviewDose(dose, activeBlock.type, activePreviewBlock, { compactCard: true });
    if (activeBlock?.type === 'STRENGTH') return strengthAssessmentError ? 'Dosage indisponible' : 'Dosage en attente de calcul';
    return activeBlock?.type === 'WOD' ? 'Dosage selon la mécanique' : null;
  }
  const detailIndex = selectedCandidateObjects.findIndex((exercise) => exercise.id === expandedExerciseId);
  const detailExercise = step === 3 && detailIndex >= 0 ? selectedCandidateObjects[detailIndex] : null;

  if (sheet === 'exercise-picker' && activeBlock) return <ComposerExercisePickerPage
    colors={colors} isDark={isDark} brandIcon={brandIcon} blockLabel={composerBlockDisplayLabel(activeBlock.type, environmentCode)}
    rows={pickerRows} equipmentIds={equipmentIds} referenceEquipment={referenceEquipment} equipmentSummary={equipmentSummary} selectedRows={selectedCandidateObjects} selectedIds={activeSelected} favoriteIds={favoriteIds}
    capacity={maxForBlock(activeBlock.type, activeBlock.minutes)} replacementId={replacementId} onReplacement={setReplacementId}
    loading={pickerLoading} error={pickerError} onRetry={() => openExercisePicker(replacementId)}
    onSelect={selectPickerExercise} onClose={closeExercisePicker} onAddEquipment={addPickerEquipment} />;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pageScroll}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Pressable
              onPress={() => {
                if (recapEditingBlock && step === 3) {
                  setRecapEditingBlock(null);
                  setStep(5);
                } else if (step > 0) {
                  setStep((value) => value - 1);
                } else if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/(tabs)/planning');
                }
              }}
              style={styles.backButton}
            >
              <Ionicons name="arrow-back" size={20} color={colors.text} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>{dateLabel(dateKey)}</Text>
              <Text style={[styles.title, step === 3 && styles.movementHeaderTitle]}>Composer<Text style={styles.dot}>.</Text></Text>
            </View>
            <Image source={brandIcon} style={[styles.brandIcon, step === 3 && styles.movementBrandIcon]} resizeMode="contain" />
          </View>

          {step === 3 ? <ComposerMovementOverview
            minutes={duration}
            environment={environmentLabel(environmentCode)}
            intent={effectiveIntent}
            regions={preferredRegions.map((region) => composerRegionsLabel({ preferred_regions: [region] }))}
            technicalTarget={skillTargetPath ? skillTargets.find((option) => option.key === skillTargetPath)?.name ?? skillTargetPath : null}
            colors={colors}
          /> : step > 0 ? (
            <View style={styles.contextTrail}>
              <View style={styles.contextLine}>
                <Text style={styles.contextPrimary}>{duration} MIN · {environmentLabel(environmentCode).toUpperCase()}</Text>
                {preferredRegions.length ? <Text style={styles.contextPill}>{composerRegionsLabel(composerPreferences)}</Text> : null}
              </View>
              {effectiveIntent ? <Text style={styles.contextPrimary}>DOMINANTE · {directionBaseLabel(effectiveIntent).toUpperCase()}</Text> : null}
              {skillTargetPath ? <Text style={styles.contextMuted}>OBJECTIF · {skillTargets.find((option) => option.key === skillTargetPath)?.name ?? skillTargetPath}</Text> : null}
              {architecture ? <Text style={styles.contextMuted}>STRUCTURE · {composerArchitectureDisplayTitle(architecture, environmentCode)}</Text> : null}
            </View>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {step === 0 ? (
            <View style={styles.stepWrap}>
              <StageHeader kicker="CADRE" title="Ton cadre d’entraînement." styles={styles} />
              <DurationControl value={duration} onChange={setDuration} styles={styles} colors={colors} />
              <View style={styles.contextSection}>
                <Text style={styles.contextSectionTitle}>LIEU D’ENTRAÎNEMENT</Text>
                <View style={styles.environmentGrid}>
                  {ENVIRONMENTS.map((item) => {
                    const selected = environmentCode === item.code;
                    return (
                      <Pressable
                        key={item.code}
                        onPress={() => chooseEnvironment(item.code)}
                        disabled={equipmentLoading}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, disabled: equipmentLoading }}
                        accessibilityLabel={item.label}
                        style={({ pressed }) => [
                          styles.environmentChoice,
                          selected && styles.environmentChoiceSelected,
                          pressed && !equipmentLoading && styles.pressed,
                        ]}
                      >
                        <Ionicons
                          name={item.icon}
                          size={22}
                          color={selected ? colors.textOnAccent : colors.accent}
                        />
                        <Text style={[styles.environmentChoiceLabel, selected && styles.environmentChoiceLabelSelected]}>
                          {item.label}
                        </Text>
                        {selected ? (
                          <Ionicons name="checkmark-circle" size={17} color={colors.textOnAccent} style={styles.environmentCheck} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {environmentCode === 'OUTDOOR' ? <View style={styles.contextSection}>
                <Text style={styles.contextSectionTitle}>TON TERRAIN</Text>
                <View style={styles.focusWrap}>
                  {selectableOutdoorPlaces().map((place) => <ChoiceChip key={place.code} label={place.label}
                    selected={outdoorContext.place_code === place.code}
                    onPress={() => setOutdoorContext((current) => ({ ...current, place_code: place.code, surface_code: place.surface ?? null }))}
                    styles={styles} colors={colors} />)}
                </View>
                {terrainOptionsForPlace(selectedOutdoorPlace).length ? <>
                  <Text style={styles.sectionSmallHint}>Sur quel sol vas-tu t’entraîner ?</Text>
                  <View style={styles.focusWrap}>{terrainOptionsForPlace(selectedOutdoorPlace).map((terrain) => <ChoiceChip
                    key={terrain.code} label={terrain.label} selected={outdoorContext.surface_code === terrain.code}
                    onPress={() => setOutdoorContext((current) => ({ ...current, surface_code: terrain.code }))}
                    styles={styles} colors={colors} />)}</View>
                </> : null}
                <Text style={styles.sectionSmallHint}>La course est-elle possible pour cette séance ?</Text>
                <View style={styles.focusWrap}>
                  {[true, false].map((value) => <ChoiceChip key={String(value)} label={value ? 'Course possible' : 'Sans course'}
                    selected={outdoorContext.running_allowed === value}
                    onPress={() => setOutdoorContext((current) => ({ ...current, running_allowed: value }))}
                    styles={styles} colors={colors} />)}
                </View>
                <Text style={styles.sectionSmallHint}>Le lieu ne déclare aucun matériel à ta place.</Text>
              </View> : null}

              <View style={styles.contextSection}>
                <Text style={styles.contextSectionTitle}>MATÉRIEL DISPONIBLE</Text>
                <Pressable
                  onPress={() => setSheet('equipment')}
                  accessibilityRole="button"
                  accessibilityLabel="Choisir le matériel disponible pour cette séance"
                  style={({ pressed }) => [styles.equipmentSummaryCard, pressed && styles.pressed]}
                >
                  <View style={styles.summaryIcon}>
                    <Ionicons name="barbell-outline" size={21} color={colors.accent} />
                  </View>
                  <View style={styles.equipmentSummaryText}>
                    <Text style={styles.equipmentSummaryValue}>
                      {equipmentLoading ? 'Chargement…'
                        : equipmentIds.length === 0 ? 'Poids du corps'
                          : `${equipmentIds.length} équipement${equipmentIds.length > 1 ? 's' : ''} sélectionné${equipmentIds.length > 1 ? 's' : ''}`}
                    </Text>
                    {equipmentIds.length > 0 && !equipmentLoading ? (
                      <Text style={styles.equipmentSummaryDetail} numberOfLines={1}>{equipmentSummary}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </Pressable>
              </View>

              <PrimaryButton label="CONTINUER" onPress={() => setStep(1)} disabled={equipmentLoading} styles={styles} colors={colors} />
            </View>
          ) : null}

          {step === 1 ? (
            <View style={styles.stepWrap}>
              <StageHeader kicker="DIRECTION" title="Quel travail aujourd’hui ?" helper="UGEROD propose une dominante, tu peux la changer." styles={styles} />

              {coachChoice ? (
                <View style={styles.directionSection}>
                  <Text style={styles.directionEyebrow}>LA PROPOSITION DU COACH</Text>
                  <Pressable
                    onPress={() => setIntent(coachChoice)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: intent?.key === coachChoice.key }}
                    style={[styles.coachDirectionCard, intent?.key === coachChoice.key && styles.cardSelected]}
                  >
                    {intent?.key === coachChoice.key ? <View style={styles.selectedRail} /> : null}
                    <View style={styles.cardTopRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.coachDirectionTitle}>{directionBaseLabel(coachChoice)}</Text>
                        {coachChoice.subtitle ? <Text style={styles.cardSubtitle}>{coachChoice.subtitle}</Text> : null}
                      </View>
                      <Ionicons name={intent?.key === coachChoice.key ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={colors.accent} />
                    </View>
                  </Pressable>
                </View>
              ) : null}

              <Text style={styles.directionEyebrow}>{coachChoice ? 'AUTRES DOMINANTES' : 'CHOISIS TA DOMINANTE'}</Text>
              <View style={styles.intentTiles}>
                {fallbackChoices.map((choice) => {
                  const selected = intent?.key === choice.key;
                  return (
                    <Pressable
                      key={choice.key}
                      onPress={() => setIntent(choice)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      style={[styles.intentTile, selected && styles.cardSelected]}
                    >
                      <View style={styles.intentTileHead}>
                        <Text style={styles.intentTileTitle}>{directionBaseLabel(choice)}</Text>
                        <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={colors.accent} />
                      </View>
                      <Text style={styles.intentTileHelp}>{choice.subtitle}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.focusSection}>
                <Text style={styles.focusTitle}>{guidedComposer ? 'Zones à privilégier' : 'Zone à travailler'}</Text>
                <Text style={styles.focusHelp}>{guidedComposer ? 'Choisis une ou plusieurs zones, ou laisse UGEROD équilibrer la séance.' : 'Choisis une zone sur la silhouette, ou laisse UGEROD équilibrer la séance.'}</Text>
                <ComposerMuscleSelector
                  value={targetRegion}
                  values={guidedComposer ? preferredRegions : undefined}
                  onChange={guidedComposer ? setPreferredRegions : (region) => setPreferredRegions(region ? [region] : [])}
                  colors={colors}
                  fontFamilies={fontFamilies}
                />
              </View>
              {skillTargetPath ? <Pressable onPress={() => { setSkillTargetPath(null); setShowSkillTarget(false); }} style={styles.structureLink}>
                <Text style={styles.structureLinkText}>Retirer le parcours technique enregistré</Text>
              </Pressable> : null}
              <PrimaryButton label={busy ? 'PRÉPARATION…' : 'CHOISIR LA STRUCTURE'} onPress={goToArchitecture} disabled={!intent || busy} loading={busy} styles={styles} colors={colors} />
            </View>
          ) : null}

          {step === 2 ? (
            <View style={styles.stepWrap}>
              <StageHeader kicker="STRUCTURE" title="Ta séance." styles={styles} />
              {architecture ? (
                <ArchitectureCard option={architecture} summary styles={styles} colors={colors}
                  environmentCode={environmentCode} intentKey={intentKey} />
              ) : (
                <View style={styles.optionList}>
                  <Text style={styles.structureEditorHelp}>Choisis explicitement un format adapté à ce créneau, ou augmente la durée.</Text>
                  {architectures.map((option) => (
                    <Pressable key={option.key} accessibilityRole="button" style={styles.structureAddButton}
                      onPress={() => { if (composerMainBlocks(option).length === 1 && composerMainBlocks(option)[0].type === 'STRENGTH') chooseStrengthOnly(option); else { setArchitecture(option); setArchitectureEditError(''); } }}>
                      <Text style={styles.structureAddLabel}>{composerArchitectureDisplayTitle(option, environmentCode)}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {strengthOnlyOption || skillWodOption ? (
                <View style={styles.structureAddRow}>
                  <Text style={styles.structureEditorHeading}>Autre format</Text>
                  {strengthOnlyOption ? <ArchitectureCard option={strengthOnlyOption} selected={false} onPress={() => chooseStrengthOnly(strengthOnlyOption)}
                    styles={styles} colors={colors} environmentCode={environmentCode} intentKey={intentKey} /> : null}
                  {skillWodOption ? <ArchitectureCard option={skillWodOption} selected={false} onPress={() => chooseSkillWod(skillWodOption)}
                    styles={styles} colors={colors} environmentCode={environmentCode} intentKey={intentKey} /> : null}
                </View>
              ) : null}
              {architecture ? (
                <View style={styles.structureEditor}>
                  <Text accessibilityRole="header" style={styles.structureEditorHeading}>Personnaliser la structure</Text>
                  <Text style={styles.structureEditorHelp}>Ajuste les durées, l’ordre et les blocs de ta séance.</Text>
                  {architecture.blocks.some((b) => b.type === 'WARMUP') ? (
                    <View accessibilityState={{ disabled: true }} style={styles.structureProtected}>
                      <Ionicons name="lock-closed-outline" size={16} color={colors.textSecondary} />
                      <Text style={styles.structureEditorHelp}>Échauffement · {architecture.blocks.find((b) => b.type === 'WARMUP')?.minutes} min</Text>
                    </View>
                  ) : null}
                  {architecture.blocks.some((b) => b.type === 'TABATA') ? (
                    <View accessibilityState={{ disabled: true }} style={styles.structureProtected}>
                      <Ionicons name="lock-closed-outline" size={16} color={colors.textSecondary} />
                      <Text style={styles.structureEditorHelp}>Tabata abdos · 4 min</Text>
                    </View>
                  ) : null}
                  {composerMainBlocks(architecture).map((block, index, mainBlocks) => (
                    <View key={'edit-' + block.type} style={styles.structureEditBlock}>
                      <View style={styles.structureEditBlockTitle}>
                        <Text style={styles.structureEditTitle}>
                          {composerBlockDisplayLabel(block.type, environmentCode, architecture)}
                        </Text>
                      </View>
                      <View style={styles.structureEditActions}>
                        <View style={styles.structureEditActionGroup}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={'Monter le bloc ' + block.type}
                            disabled={index === 0}
                            onPress={() => changeArchitecture({ kind: 'move', blockType: block.type, direction: -1 })}
                            style={[styles.structureIconButton, index === 0 && styles.disabled]}
                          >
                            <Ionicons name="arrow-up" size={19} color={colors.accent} />
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={'Descendre le bloc ' + block.type}
                            disabled={index === mainBlocks.length - 1}
                            onPress={() => changeArchitecture({ kind: 'move', blockType: block.type, direction: 1 })}
                            style={[styles.structureIconButton, index === mainBlocks.length - 1 && styles.disabled]}
                          >
                            <Ionicons name="arrow-down" size={19} color={colors.accent} />
                          </Pressable>
                        </View>
                        <View style={styles.structureDurationControl}>
                          <Text style={styles.structureEditMinutes}>Durée · {block.minutes} min</Text>
                          <View style={styles.structureEditActionGroup}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={'Réduire la durée du bloc ' + block.type}
                              disabled={mainBlocks.length < 2}
                              onPress={() => changeArchitecture({ kind: 'minutes', blockType: block.type, delta: -2 })}
                              style={[styles.structureIconButton, mainBlocks.length < 2 && styles.disabled]}
                            >
                              <Ionicons name="remove" size={20} color={colors.accent} />
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={'Augmenter la durée du bloc ' + block.type}
                              disabled={mainBlocks.length < 2}
                              onPress={() => changeArchitecture({ kind: 'minutes', blockType: block.type, delta: 2 })}
                              style={[styles.structureIconButton, mainBlocks.length < 2 && styles.disabled]}
                            >
                              <Ionicons name="add" size={20} color={colors.accent} />
                            </Pressable>
                          </View>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={'Retirer le bloc ' + block.type}
                          disabled={mainBlocks.length === 1}
                          onPress={() => changeArchitecture({ kind: 'remove', blockType: block.type })}
                          style={[styles.structureIconButton, mainBlocks.length === 1 && styles.disabled]}
                        >
                          <Ionicons name="trash-outline" size={19} color={colors.textSecondary} />
                        </Pressable>
                      </View>
                    </View>
                  ))}
                  {skillTargetPath ? <Pressable onPress={() => { setSkillTargetPath(null); setShowSkillTarget(false); setError(''); setPreviewSignature(null); }} style={styles.structureLink}>
                    <Text style={styles.structureLinkText}>Continuer sans parcours technique</Text>
                  </Pressable> : null}
                  {composerAddableBlocks(architecture, environmentCode, skillTargetPath, outdoorEngine && outdoorContext.running_allowed).length ? (
                    <View style={styles.structureAddRow}>
                      <Text style={styles.structureEditorHelp}>Ajouter un bloc</Text>
                      <View style={styles.structureAddActions}>
                        {composerAddableBlocks(architecture, environmentCode, skillTargetPath, outdoorEngine && outdoorContext.running_allowed).map((type) => (
                          <Pressable
                            key={'add-' + type}
                            accessibilityRole="button"
                            onPress={() => changeArchitecture({ kind: 'add', blockType: type })}
                            style={styles.structureAddButton}
                          >
                            <Ionicons name="add-circle-outline" size={17} color={colors.accent} />
                            <Text style={styles.structureAddLabel}>{composerBlockDisplayLabel(type, environmentCode)}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}
              {architectureEditError ? <Text accessibilityRole="alert" style={styles.errorText}>{architectureEditError}</Text> : null}
              <PrimaryButton label={busy ? 'CHARGEMENT…' : 'CHOISIR LES MOUVEMENTS'} onPress={goToExercises} disabled={!architecture || busy} loading={busy} styles={styles} colors={colors} />
            </View>
          ) : null}

          {step === 3 && activeBlock ? (
            <View style={styles.movementStepWrap}>
              <Text accessibilityRole="header" style={styles.movementTitle}>{recapEditingBlock ? 'Ajuste tes mouvements.' : 'Tes mouvements.'}</Text>
              <ComposerMovementTabs
                blocks={exerciseBlocks.map((item) => ({ ...item, label: composerBlockDisplayLabel(item.type, environmentCode) }))}
                selectedIndex={exerciseBlockIndex}
                onSelect={(index) => { setExerciseBlockIndex(index); setExpandedExerciseId(null); }}
                colors={colors}
              />

              <Text style={styles.selectionCount}>
                {activeBlock.type === 'STRENGTH'
                  ? activeSelected.length + ' mouvements retenus'
                  : activeSelected.length + ' / ' + maxForBlock(activeBlock.type, activeBlock.minutes) + ' sélectionnés'}
              </Text>
              {activeBlock.type === 'SKILL' && guidedComposer ? <ComposerSkillTargetSelector
                visible={skillTargetVisible} optional={true}
                selectedPath={skillTargetPath} options={skillTargets}
                loading={skillTargetsLoading} error={skillTargetsError}
                onRetry={() => setSkillTargetsRetry((value) => value + 1)}
                onOpen={() => setShowSkillTarget(true)} onChange={(path) => { setSkillTargetPath(path); setSkillEngineVersion('C4_COMPOSER_SKILL_V1'); }}
                onRemove={() => { setSkillTargetPath(null); setShowSkillTarget(false); }}
                colors={colors} fontFamilies={fontFamilies}
              /> : null}
              {activeBlock.type === 'SKILL' && skillTargetPath && skillEngineVersion ? (
                <View>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={refreshSkillLesson} style={styles.structureLink}>
                    <Text style={styles.structureLinkText}>{busy ? 'Calcul de la leçon…' : 'Actualiser la leçon pour cet objectif'}</Text>
                  </Pressable>
                  <Text style={styles.sectionSmallHint}>Cette action propose une leçon guidée. Si tu modifies ensuite ses exercices, tu repasses en composition libre.</Text>
                </View>
              ) : null}
              {activeBlock.type === 'WOD' && requestedMechanic ? <View style={styles.structureExplanation}><Ionicons name="options-outline" size={18} color={colors.accent}/><Text style={styles.structureExplanationText}>{requestedMechanic.title} : {composerMechanicAdjustmentReason(requestedMechanic)}{requestedMechanic?.reason_code==='EXERCISE_COUNT'?' Aucun exercice ne sera ajouté ou retiré automatiquement.':''}</Text></View>:null}
              {activeBlock.type === 'WOD' ? <Text style={styles.sectionSmallHint}>
                {wodContractsLoading ? 'Vérification des limites par mécanique…'
                  : wodContractsError ? 'Limites indisponibles : trois mouvements maximum pour les nouveaux ajouts.'
                    : activeSelected.length >= maxForBlock(activeBlock.type, activeBlock.minutes)
                      ? 'Limite de sélection atteinte. Tu peux remplacer un mouvement.'
                      : 'Tu peux ajouter des mouvements. Les mécaniques proposées dépendront de leur nombre.'}
                {' Le dosage sera précisé avec la mécanique.'}
              </Text> : null}
              {activeBlock.type === 'WOD' && wodContractsError ? (
                <Pressable accessibilityRole="button" onPress={() => setWodContractsRetry((value) => value + 1)} style={styles.structureLink}>
                  <Text style={styles.structureLinkText}>Réessayer le chargement des limites</Text>
                </Pressable>
              ) : null}
              {activeBlock.type === 'STRENGTH' && currentStrengthAssessment?.status !== 'READY' ? (
                <View style={styles.structureExplanation}>
                  <Ionicons name="time-outline" size={18} color={colors.accent} />
                  <Text style={styles.structureExplanationText}>
                    {strengthAssessmentError ? 'Calcul sportif indisponible. Vérifie ta connexion.'
                      : currentStrengthAssessment?.time ? composerDurationSummary(currentStrengthAssessment, activeBlock.minutes)
                        : activeSelected.length ? 'Calcul du dosage et du temps, récupérations comprises…'
                          : 'Choisis des mouvements pour estimer la durée du bloc.'}
                  </Text>
                </View>
              ) : null}
              {!activeSelected.length && activeBlock.type !== 'CARDIO' ? <Text style={styles.sectionSmallHint}>Pas de proposition prête pour ce bloc. Choisis tes mouvements dans le catalogue pour que UGEROD calcule la séance.</Text> : null}
              <View style={styles.exerciseList}>
                {selectedCandidateObjects.map((exercise) => <ExerciseCard
                  key={exercise.id} exercise={exercise} doseLabel={movementDoseLabel(exercise)}
                  selected={activeSelected.includes(exercise.id)} onOpenDetail={() => setExpandedExerciseId(exercise.id)}
                  styles={styles} colors={colors}/>)}
              </View>

              {activeBlock.type === 'CARDIO' ? <Pressable disabled={busy} onPress={refreshCardioProtocol} style={styles.structureLink}><Text style={styles.structureLinkText}>{outdoorEngine ? 'Actualiser le protocole de course' : 'Actualiser le protocole cardio avec mon matériel'}</Text></Pressable> : null}
              {activeBlock.type === 'CARDIO' && outdoorEngine ? <ComposerOutdoorCardioPreview
                block={currentPreview?.blocks?.find((block) => block.type === 'CARDIO') ?? activeCandidates[0]?.cardioProtocol}
                minutes={activeBlock.minutes} styles={styles} /> : null}
              {activeBlock.type !== 'CARDIO' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Explorer le catalogue complet"
                  onPress={() => openExercisePicker()}
                  style={styles.exerciseChangeAction}
                >
                  <Ionicons name={activeSelected.length < maxForBlock(activeBlock.type, activeBlock.minutes) ? 'add-outline' : 'swap-horizontal-outline'} size={19} color={colors.accent} />
                  <Text style={styles.exerciseChangeLabel}>
                    {composerMovementAction(activeSelected.length, maxForBlock(activeBlock.type, activeBlock.minutes))}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.accent} />
                </Pressable>
              ) : null}
              <PrimaryButton
                label={exerciseBlockIndex !== exerciseBlocks.length - 1 ? 'BLOC SUIVANT'
                  : recapEditingBlock && recapEditingBlock !== 'WOD' ? 'REVENIR AU RÉCAPITULATIF'
                    : architecture?.blocks?.some((item) => item.type === 'WOD') ? 'CHOISIR LA MÉCANIQUE' : 'VOIR LE RÉCAPITULATIF'}
                onPress={advanceExerciseBlock}
                disabled={activeSelected.length === 0 || busy}
                styles={styles}
                colors={colors}
              />
            </View>
          ) : null}

          {step === 4 ? (
            <View style={styles.mechanicStepWrap}>
              <StageHeader
                  kicker="MÉCANIQUE DU WOD"
                  title="La mécanique de ton WOD."
                  helper={`${wodBlock?.minutes ?? 0} min prévues · ${selectionMap.WOD?.length ?? 0} mouvements. Une seule mécanique à la fois.`}
                  styles={{...styles,stageHeader:styles.mechanicStageHeader,question:styles.mechanicQuestion,helper:styles.mechanicHelper}}
                />
              {!mechanicOptions.some((o) => o.available !== false) ? <View style={styles.structureExplanation}><Ionicons name="options-outline" size={18} color={colors.accent}/><View style={{flex:1,gap:8}}><Text style={styles.structureExplanationText}>Ajuste les mouvements ou la durée pour construire une mécanique exécutable.</Text><Pressable accessibilityRole="button" onPress={()=>editWodForMechanic()}><Text style={styles.structureLinkText}>Modifier les mouvements du WOD</Text></Pressable><Pressable accessibilityRole="button" onPress={()=>setStep(2)}><Text style={styles.structureLinkText}>Ajuster la durée du WOD</Text></Pressable></View></View> : null}
              <View style={styles.mechanicList}>
                {mechanicOptions.filter((option) =>
                    showAllMechanics || composerMechanicIdentity(option) === composerMechanicIdentity(mechanic) || option.recommended
                  ).sort((a, b) => Number(composerMechanicIdentity(b) === composerMechanicIdentity(mechanic))
                    - Number(composerMechanicIdentity(a) === composerMechanicIdentity(mechanic))).map((option) => {
                  const selected = composerMechanicIdentity(mechanic) === composerMechanicIdentity(option);
                  const premium=option.available===false&&option.reason_code==='PREMIUM_REQUIRED';
                  const adjustable=option.available===false&&!premium;
                  return (
                    <View key={composerMechanicIdentity(option)} style={styles.previewOptionGroup}>
                    <Pressable
                      accessibilityRole={adjustable?'button':'radio'}
                      accessibilityState={{ checked: selected, disabled: premium }}
                      accessibilityLabel={option.title+(adjustable?', ajuster la composition':premium?', Premium':'')}
                      onPress={() => adjustable ? editWodForMechanic(option) : premium ? setMechanicIssue(option.reason) : (setMechanic(option),setRequestedMechanic(null),setMechanicIssue(null))}
                      style={[styles.simpleCard, styles.mechanicCard, selected && styles.cardSelected, premium && styles.mechanicDisabled]}>
                      {selected ? <View style={styles.mechanicSelectedRail} /> : null}
                      <View style={styles.mechanicTopRow}>
                        <View style={{ flex: 1 }}>
                          {option.available === false || option.recommended || selected ? (
                            <Text style={styles.cardEyebrow}>{option.available === false ? option.reason_code === 'PREMIUM_REQUIRED' ? 'PREMIUM' : 'À AJUSTER' : option.recommended ? 'CHOIX UGEROD' : 'MÉCANIQUE CHOISIE'}</Text>
                          ) : null}
                          <Text style={styles.mechanicTitle}>{option.title}</Text>
                          <Text style={styles.mechanicDescription}>{composerMechanicDescription(option)}</Text>
                          {adjustable?<><Text style={styles.mechanicDescription}>{composerMechanicAdjustmentReason(option)}</Text><Text style={styles.structureLinkText}>{option.reason_code==='EXERCISE_COUNT'?'Ajuster les mouvements':'Adapter la composition'} <Text>›</Text></Text></>:null}
                        </View>
                        <View style={[styles.mechanicSelectCircle, selected && styles.selectCircleSelected]}>
                          {option.available === false || selected ? <Ionicons name={premium ? 'lock-closed-outline' : adjustable ? 'options-outline' : 'checkmark'} size={16} color={premium ? colors.textMuted : adjustable ? colors.accent : colors.textOnAccent} /> : null}
                        </View>
                      </View>
                    </Pressable>
                    {selected ? <ComposerWodPreview key={composerMechanicIdentity(option)} block={currentWodPreview}
                      loading={previewLoading} issue={previewIssue} environmentCode={environmentCode}
                      styles={styles} colors={colors} /> : null}
                    </View>
                  );
                })}
              </View>
              {mechanicIssue ? <Text style={styles.mechanicIssue}>{mechanicIssue}</Text> : null}
              {mechanicOptions.length > 1 ? (
                <Pressable onPress={() => setShowAllMechanics((value) => !value)} style={styles.mechanicMore}>
                  <Text style={styles.mechanicMoreText}>
                    {showAllMechanics ? 'Masquer les mécaniques complémentaires' : 'Voir d’autres mécaniques'}
                  </Text>
                  <Ionicons name={showAllMechanics ? 'chevron-up' : 'chevron-down'} size={16} color={colors.accent}/>
                </Pressable>
              ) : null}
              <PrimaryButton label="VOIR LE RÉCAPITULATIF" onPress={() => { setRecapEditingBlock(null); setStep(5); }} disabled={!mechanic} styles={styles} colors={colors} />
            </View>
          ) : null}

          {step === 5 ? (
            <View style={styles.stepWrap}>
              <StageHeader kicker="RÉCAPITULATIF" title="Ta séance." helper={`${environmentLabel(environmentCode)} · ${composerArchitectureDisplayTitle(architecture,environmentCode)}`} styles={{...styles,stageHeader:styles.mechanicStageHeader,question:styles.mechanicQuestion,helper:styles.mechanicHelper}} />
              <View style={styles.recapOverview}>
                <View style={styles.recapHeaderRow}>
                  <View><Text style={styles.recapExerciseMeta}>Durée prévue</Text><Text style={styles.recapTimeValue}>{duration} min</Text></View>
                  <View><Text style={styles.recapExerciseMeta}>Durée estimée</Text><Text style={[styles.recapTimeValue,recapTime?.overMinutes>0&&{color:colors.secondaryAccent}]}>{recapTime?recapTime.minutes+' min':'—'}</Text></View>
                </View>
                <View style={styles.recapSegments}>{(architecture?.blocks??[]).map((b,i)=><View key={b.type} style={{flex:b.minutes,backgroundColor:[colors.accent,colors.secondaryAccent,colors.textSecondary,colors.accent,colors.textMuted][i%5],opacity:i===0?.45:i===1?.65:1,borderRadius:3}}/>)}</View>
                {recapTime?.overMinutes>0?<View style={styles.recapAdvisory}><Ionicons name="time-outline" size={18} color={colors.secondaryAccent}/><Text style={styles.recapAdvisoryText}>{hasManualEdits?'Tes modifications dépassent':'La séance dépasse'} la durée prévue d’environ {recapTime.overMinutes} min. Tu peux conserver cette séance.</Text></View>:null}
                {hasManualEdits?<Text style={styles.recapHelp}>Prescription personnalisée · UGEROD conserve tes choix et vérifie le contexte du jour.</Text>:null}
              </View>
              <Text style={styles.recapHelp}>
                {(architecture?.blocks ?? []).some((b) => b.type === 'TABATA')
                  ? 'Échauffement et Tabata inclus. Modifie les prescriptions des blocs d’entraînement si tu le souhaites.'
                  : 'Échauffement inclus. Modifie les prescriptions des blocs d’entraînement si tu le souhaites.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setArchitectureEditError('');
                  setStep(2);
                }}
                style={styles.structureEditorToggle}
              >
                <Ionicons name="options-outline" size={20} color={colors.accent} />
                <Text style={styles.structureLinkText}>Ajouter, retirer ou réorganiser les blocs</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.accent} />
              </Pressable>
              {previewLoading ? (
                <View style={styles.previewState}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.previewNote}>Calcul des séries, répétitions et récupérations…</Text>
                </View>
              ) : prescriptionPreview ? (
                <Text style={styles.previewNote}>{hasManualEdits?'Tes valeurs personnalisées seront conservées. Les contrôles de sécurité du jour J restent actifs.':'Dosage prévisionnel · le jour J, la forme et les gênes pourront entraîner des ajustements.'}</Text>
              ) : previewIssue ? (
                <View style={styles.structureExplanation}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.secondaryAccent} />
                  <Text style={styles.structureExplanationText}>
                    {previewIssue.manualMessage??composerPreviewIssue(previewIssue, environmentCode)}
                  </Text>
                </View>
              ) : previewError ? (
                <Text style={styles.previewWarning}>Prévision indisponible : vérifie la connexion avant de valider.</Text>
              ) : null}
              {previewIssue&&beforeManualEdit.current?<Pressable onPress={undoManualEdit} style={styles.recapEdit}><Ionicons name="arrow-undo-outline" size={17} color={colors.accent}/><Text style={styles.recapEditText}>Annuler la dernière modification</Text></Pressable>:null}
              {hasManualEdits?<Pressable onPress={resetManualEdits} style={styles.recapEdit}><Ionicons name="refresh-outline" size={17} color={colors.accent}/><Text style={styles.recapEditText}>Rétablir les recommandations UGEROD</Text></Pressable>:null}
              {previewIssue&&!previewIssue.manualMessage ? (
                <PrimaryButton
                  label="ADAPTER LA STRUCTURE"
                  onPress={() => setStep(2)}
                  styles={styles}
                  colors={colors}
                />
              ) : null}
              <View style={styles.recapCard}>
                {(architecture?.blocks??[]).map((item,index)=>{
                  const block=currentPreview?.blocks?.find(b=>b.type===item.type);
                  const blockFields=composerManualParameterFields(block,wodEngineVersion);
                  const blockTime=block?.time?.prescribed_seconds;
                  const over=blockTime!=null&&Number(blockTime)>Number(item.minutes)*60;
                  const icon={WARMUP:'flame-outline',TABATA:'timer-outline',SKILL:'body-outline',STRENGTH:'barbell-outline',WOD:'flash-outline',CARDIO:'heart-outline'}[item.type];
                  const entry=manualEdits[composerManualKey(item.type,mechanic)];
                  return <View key={'recap-'+item.type} style={styles.recapBlock}>
                    <View style={styles.recapHeaderRow}>
                      <View style={styles.recapBlockHeading}><Ionicons name={icon??'fitness-outline'} size={20} color={colors.accent}/><View style={{flex:1}}><Text style={styles.recapBlockTitle}>{String(index+1).padStart(2,'0')} · {composerBlockDisplayLabel(item.type,environmentCode)}</Text>{item.type==='WOD'&&mechanic?<Text style={styles.recapExerciseMeta}>{mechanic.title}</Text>:null}</View></View>
                      <View style={{alignItems:'flex-end'}}><Text style={styles.recapMinutes}>{item.minutes} min prévues</Text>{blockTime!=null?<Text style={[styles.recapMinutes,over&&{color:colors.secondaryAccent}]}>≈ {Math.ceil(Number(blockTime)/60)} min</Text>:null}</View>
                    </View>
                    {item.type==='TABATA'?<Text style={styles.recapDose}>8 intervalles · 20 s effort / 10 s repos</Text>:null}
                    {item.type==='WOD'&&block?<Text style={styles.recapDose}>{composerWodProtocol(block)}</Text>:null}
                    {composerWodRegionAdvisory(block)?<Text style={styles.previewDetails}>{composerWodRegionAdvisory(block)}</Text>:null}
                    {composerWodDurationAdvisory(block)?<Text style={styles.previewDetails}>{composerWodDurationAdvisory(block)}</Text>:null}
                    {over?<Text style={styles.recapAdvisoryText}>Ce bloc dépasse le temps réservé. Ce n’est pas bloquant.</Text>:null}
                    {blockFields.length?<Pressable accessibilityRole="button" onPress={()=>openManualEditor(item.type,null,'Paramètres du WOD',blockFields)} style={styles.recapParameterButton}><Ionicons name="options-outline" size={16} color={colors.accent}/><Text style={styles.recapEditText}>{Object.keys(entry?.parameters??{}).length?'Paramètres personnalisés':'Modifier les paramètres'}</Text><Ionicons name="chevron-forward" size={15} color={colors.accent}/></Pressable>:null}
                    {selectedExercises(item.type).map(exercise=>{
                      const dose=block?.exercises?.find(x=>x.id===exercise.id);
                      const fields=composerManualExerciseFields(item.type,dose,mechanic,{skillTarget:skillTargetPath,wodEngineVersion});
                      const edited=Boolean(Object.keys(entry?.exercises?.[exercise.id]??{}).length);
                      return <View key={exercise.id} style={styles.recapExerciseRow}>
                        <View style={styles.recapThumb}>{exercise.imagePath?<Image source={{uri:exercise.imagePath}} style={{width:'100%',height:'100%'}} resizeMode="cover"/>:<Ionicons name="image-outline" size={20} color={colors.textMuted}/>}</View>
                        <View style={{flex:1,minWidth:0}}>
                          <Text style={styles.recapExercise}>{exercise.name}</Text>
                          {dose?<Text style={styles.recapDose}>{formatPreviewDose(dose,item.type,block,{compactCard:true})}</Text>:null}
                          {edited?<Text style={styles.recapExerciseMeta}>Personnalisé</Text>:null}
                        </View>
                        {fields.length?<Pressable accessibilityRole="button" accessibilityLabel={'Modifier le dosage de '+exercise.name} onPress={()=>openManualEditor(item.type,exercise.id,exercise.name,fields)} style={styles.recapDoseEdit}><Ionicons name="create-outline" size={19} color={colors.accent}/></Pressable>:null}
                      </View>;
                    })}
                    <Pressable onPress={()=>editRecapBlock(item.type)} style={styles.recapEdit}><Ionicons name="swap-horizontal-outline" size={16} color={colors.accent}/><Text style={styles.recapEditText}>Modifier {item.type==='WOD'?'les mouvements ou la mécanique':'les mouvements'}</Text></Pressable>
                  </View>;
                })}
              </View>
              <PrimaryButton
                label={busy ? 'ENREGISTREMENT…' : 'VALIDER MA SÉANCE'}
                onPress={addToWeek}
                disabled={busy || previewLoading || !prescriptionPreview || previewSignature !== JSON.stringify(buildCurrentDraft()) || !!previewIssue || strengthAssessmentLoading || strengthAssessmentError || ((architecture?.blocks ?? []).some((b) => b.type === 'STRENGTH') && currentStrengthAssessment?.status !== 'READY')}
                loading={busy}
                styles={styles}
                colors={colors}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {detailExercise ? <ExerciseDetail key={detailExercise.id} visible exercise={detailExercise}
        dose={movementDose(detailExercise)} doseLabel={movementDoseLabel(detailExercise)}
        index={detailIndex} count={selectedCandidateObjects.length} colors={colors} isDark={isDark}
        brandIcon={brandIcon} editable={activeBlock.type !== 'CARDIO'} onClose={() => setExpandedExerciseId(null)}
        onReplace={() => { setExpandedExerciseId(null); openExercisePicker(detailExercise.id); }}
        onRemove={() => { setExpandedExerciseId(null); chooseExercise(activeBlock.type, detailExercise.id); }}
        onPrevious={detailIndex > 0 ? () => setExpandedExerciseId(selectedCandidateObjects[detailIndex - 1].id) : null}
        onNext={detailIndex < selectedCandidateObjects.length - 1 ? () => setExpandedExerciseId(selectedCandidateObjects[detailIndex + 1].id) : null}
      /> : null}
      {doseEditor?<SheetShell visible title={doseEditor.title} onClose={()=>setDoseEditor(null)} styles={styles} colors={colors}
        footer={<PrimaryButton label="APPLIQUER" onPress={()=>applyManualEditor()} disabled={!validComposerManualValues(doseEditor.fields,doseEditor.values)} styles={styles} colors={colors}/>}>
        <Text style={styles.sheetHelp}>Personnalise la prescription. UGEROD estime la durée, sans bloquer un simple dépassement de temps.</Text>
        {doseEditor.fields.map(f=><View key={f.key} style={styles.manualDoseField}>
          <Text style={styles.recapExercise}>{f.label}</Text>
          <View style={styles.manualDoseControls}>
            <Pressable accessibilityLabel={'Diminuer '+f.label} onPress={()=>setDoseEditor(old=>({...old,values:{...old.values,[f.key]:String(Math.max(f.min,(Number(old.values[f.key])||f.min)-f.step))}}))} style={styles.manualDoseButton}><Ionicons name="remove" size={20} color={colors.accent}/></Pressable>
            <TextInput accessibilityLabel={f.label} value={doseEditor.values[f.key]} onChangeText={value=>setDoseEditor(old=>({...old,values:{...old.values,[f.key]:value.replace(/[^0-9]/g,'').slice(0,5)}}))} keyboardType="number-pad" selectTextOnFocus style={styles.manualDoseInput}/>
            <Pressable accessibilityLabel={'Augmenter '+f.label} onPress={()=>setDoseEditor(old=>({...old,values:{...old.values,[f.key]:String(Math.min(f.max,(Number(old.values[f.key])||f.min)+f.step))}}))} style={styles.manualDoseButton}><Ionicons name="add" size={20} color={colors.accent}/></Pressable>
          </View>
        </View>)}
        <Pressable onPress={()=>applyManualEditor(true)} style={styles.recapEdit}><Ionicons name="refresh-outline" size={17} color={colors.accent}/><Text style={styles.recapEditText}>Rétablir le dosage recommandé</Text></Pressable>
      </SheetShell>:null}
      <SheetShell visible={sheet === 'confirm-revision'} title="Mettre à jour cette séance ?" onClose={() => setSheet(null)} styles={styles} colors={colors}>
        <Text style={styles.sheetHelp}>La version déjà générée n’a pas commencé. Elle sera conservée comme remplacée et le nouveau contenu sera généré au prochain lancement.</Text>
        <Text style={styles.sheetHelp}>Actuellement : {composerArchitectureDisplayTitle(savedStructure, environmentCode)}</Text>
        <Text style={styles.sheetHelp}>Nouveau : {composerArchitectureDisplayTitle(architecture, environmentCode)} · {duration} min</Text>
        <PrimaryButton label="CONFIRMER LA MISE À JOUR" disabled={busy} onPress={() => addToWeek({ confirmReplacement: true })} styles={styles} colors={colors}/>
      </SheetShell>
      <SheetShell visible={sheet === 'location'} title="Où tu t’entraînes ?" onClose={() => setSheet(null)} styles={styles} colors={colors}>
        <View style={styles.choiceGrid}>
          {ENVIRONMENTS.map((item) => (
            <ChoiceChip
              key={item.code}
              label={item.label}
              icon={item.icon}
              selected={environmentCode === item.code}
              onPress={async () => { await chooseEnvironment(item.code); setSheet(null); }}
              styles={styles}
              colors={colors}
            />
          ))}
        </View>
      </SheetShell>

      <SheetShell
        visible={sheet === 'equipment'}
        title="Matériel disponible"
        onClose={() => setSheet(null)}
        styles={styles}
        colors={colors}
        footer={<Pressable onPress={() => setSheet(null)} style={styles.sheetDoneButton}><Text style={styles.sheetDoneButtonText}>Terminé</Text></Pressable>}
      >
        <Text style={styles.sheetHelp}>Pour cette séance, tu peux désactiver temporairement ce qui n’est pas disponible.</Text>
        {equipmentLoading ? (
          <View style={styles.sheetLoading}><ActivityIndicator size="small" color={colors.accent} /></View>
        ) : referenceEquipment.length === 0 ? (
          <View style={styles.infoRow}><Ionicons name="body-outline" size={20} color={colors.accent} /><Text style={styles.infoText}>Aucun matériel enregistré ici. UGEROD composera au poids du corps.</Text></View>
        ) : (
          <>
            <View style={styles.equipmentQuickRow}>
              <Pressable
                onPress={() => setEquipmentIds(referenceEquipment.map((item) => item.id))}
                style={[styles.equipmentQuickButton, allEquipmentSelected && styles.equipmentQuickButtonSelected]}
              >
                <Ionicons name="checkmark-done-outline" size={18} color={allEquipmentSelected ? colors.textOnAccent : colors.accent} />
                <Text style={[styles.equipmentQuickText, allEquipmentSelected && styles.equipmentQuickTextSelected]}>Tout mon matériel</Text>
              </Pressable>
              <Pressable
                onPress={() => setEquipmentIds([])}
                style={[styles.equipmentQuickButton, bodyweightOnly && styles.equipmentQuickButtonSelected]}
              >
                <Ionicons name="body-outline" size={18} color={bodyweightOnly ? colors.textOnAccent : colors.accent} />
                <Text style={[styles.equipmentQuickText, bodyweightOnly && styles.equipmentQuickTextSelected]}>Poids du corps</Text>
              </Pressable>
            </View>
            <View style={styles.equipmentGrid}>
              {referenceEquipment.map((item) => (
                <Pressable key={item.id} onPress={() => toggleEquipment(item.id)} style={[styles.equipmentChoice, equipmentIds.includes(item.id) && styles.equipmentChoiceSelected]}>
                  <View style={{ flex: 1 }}><Text style={styles.equipmentChoiceTitle}>{item.name}</Text>{item.detail ? <Text style={styles.equipmentChoiceDetail}>{item.detail}</Text> : null}</View>
                  <Ionicons name={equipmentIds.includes(item.id) ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={equipmentIds.includes(item.id) ? colors.accent : colors.textMuted} />
                </Pressable>
              ))}
            </View>
          </>
        )}
        <Pressable onPress={openProfileEquipment} style={styles.inlineLink}><Text style={styles.inlineLinkText}>Modifier mon matériel</Text><Ionicons name="chevron-forward" size={18} color={colors.accent} /></Pressable>
      </SheetShell>


    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    pageScroll: { flexGrow: 1, paddingBottom: 64 },
    content: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: spacing.xl, paddingTop: 8 },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    muted: { fontFamily: fontFamilies.medium, fontSize: 13, color: colors.textSecondary },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.42 },
    header: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 13 },
    backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    eyebrow: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.2, color: colors.accent },
    title: { marginTop: 2, fontFamily: fontFamilies.display, fontSize: 33, lineHeight: 37, color: colors.text },
    dot: { color: colors.secondaryAccent },
    brandIcon: { width: 38, height: 38 },
    contextTrail: { marginTop: 14, paddingVertical: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, gap: 5 },
    contextLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    contextPrimary: { fontFamily: fontFamilies.bold, fontSize: 11, letterSpacing: 0.7, color: colors.text },
    contextMuted: { fontFamily: fontFamilies.medium, fontSize: 11, color: colors.textSecondary },
    contextPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden', fontFamily: fontFamilies.semiBold, fontSize: 10, color: colors.accent, backgroundColor: colors.surfaceElevated ?? colors.surface },
    errorText: { marginTop: 12, fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 18, color: colors.error },
    stepWrap: { marginTop: 32 },
    movementStepWrap: { marginTop: 18 },
    movementTitle: { fontFamily: fontFamilies.display, fontSize: 26, lineHeight: 30, color: colors.text, marginBottom: 10 },
    movementHeaderTitle: { fontSize: 25, lineHeight: 29 },
    movementBrandIcon: { width: 30, height: 30 },
    stageHeader: { marginBottom: 16 },
    kicker: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.35, color: colors.accent },
    question: { marginTop: 8, fontFamily: fontFamilies.display, fontSize: 29, lineHeight: 34, color: colors.text },
    helper: { marginTop: 10, fontFamily: fontFamilies.regular, fontSize: 14, lineHeight: 21, color: colors.textSecondary, maxWidth: 680 },
    durationShell: { minHeight: 105, flexDirection: 'row', alignItems: 'center', gap: 20 },
    durationReadout: { minWidth: 82 },
    durationValue: { fontFamily: fontFamilies.display, fontSize: 52, lineHeight: 56, color: colors.text },
    durationUnit: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.4, color: colors.accent },
    durationSliderColumn: { flex: 1 },
    durationTrackTouch: { height: 54, justifyContent: 'center' },
    durationTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border, position: 'relative' },
    durationProgress: { position: 'absolute', left: 0, top: 0, height: 4, borderRadius: 2, backgroundColor: colors.accent },
    durationHitRow: { position: 'absolute', left: -8, right: -8, top: -18, bottom: -18, flexDirection: 'row' },
    durationHit: { flex: 1 },
    durationKnob: { position: 'absolute', top: -18, marginLeft: -20, width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    summaryGrid: { marginTop: 14, flexDirection: 'row', gap: 12 },
    summaryCard: { flex: 1, minHeight: 82, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 11 },
    summaryIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    summaryLabel: { fontFamily: fontFamilies.bold, fontSize: 9, letterSpacing: 1.1, color: colors.accent },
    summaryValue: { marginTop: 4, fontFamily: fontFamilies.semiBold, fontSize: 13, lineHeight: 18, color: colors.text },
    contextSection: { marginTop: 18 },
    contextSectionTitle: { marginBottom: 10, fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.15, color: colors.accent },
    environmentGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 10 },
    environmentChoice: { width: '48%', minHeight: 89, borderRadius: 17, padding: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'space-between' },
    environmentChoiceSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    environmentChoiceLabel: { marginTop: 7, fontFamily: fontFamilies.semiBold, fontSize: 16, color: colors.text },
    environmentChoiceLabelSelected: { color: colors.textOnAccent },
    environmentCheck: { position: 'absolute', top: 13, right: 13 },
    equipmentSummaryCard: { minHeight: 78, paddingHorizontal: 15, paddingVertical: 14, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
    equipmentSummaryText: { flex: 1 },
    equipmentSummaryValue: { fontFamily: fontFamilies.semiBold, fontSize: 15, lineHeight: 20, color: colors.text },
    equipmentSummaryDetail: { marginTop: 4, fontFamily: fontFamilies.medium, fontSize: 11, lineHeight: 16, color: colors.textSecondary },
    directionSection: { marginBottom: 20 },
    directionEyebrow: { marginBottom: 10, fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.1, color: colors.accent },
    coachDirectionCard: { position: 'relative', overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 17, backgroundColor: colors.surface },
    coachDirectionTitle: { fontFamily: fontFamilies.display, fontSize: 24, lineHeight: 29, color: colors.text },
    // One full-width row per dominant: prevent the orphan Skill tile on mobile.
    intentTiles: { gap: 9, marginBottom: 8 },
    intentTile: { width: '100%', minHeight: 76, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 15, paddingVertical: 11, backgroundColor: colors.surface },
    intentTileHead: { flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'space-between' },
    intentTileTitle: { flexShrink: 1, fontFamily: fontFamilies.display, fontSize: 19, lineHeight: 22, color: colors.text },
    intentTileHelp: { marginTop: 4, fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    focusWrap: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    focusSection: { marginTop: 25 },
    focusTitle: { fontFamily: fontFamilies.semiBold, fontSize: 14, color: colors.text },
    focusHelp: { marginTop: 3, fontFamily: fontFamilies.regular, fontSize: 12, color: colors.textSecondary },
    focusRow: { marginTop: 12, gap: 8, paddingRight: 10 },
    choiceChip: { minHeight: 39, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6 },
    choiceChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    choiceChipText: { fontFamily: fontFamilies.semiBold, fontSize: 11, color: colors.textSecondary },
    choiceChipTextSelected: { color: colors.textOnAccent },
    optionList: { gap: 12 },
    structureLink: { marginVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, minHeight: 38 },
    structureLinkText: { flex: 1, fontFamily: fontFamilies.semiBold, fontSize: 13, color: colors.accent },
    structureEditorToggle: { marginTop: 13, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, padding: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14 },
    structureEditor: { marginTop: 22, marginBottom: 18, gap: 10 },
    structureEditorHeading: { fontFamily: fontFamilies.semiBold, fontSize: 16, color: colors.text, marginBottom: 2 },
    architectureSummary: { backgroundColor: colors.background },
    structureEditorHelp: { flex: 1, fontFamily: fontFamilies.regular, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
    structureProtected: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, opacity: 0.7 },
    structureEditBlock: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 10, backgroundColor: colors.background },
    structureEditBlockTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    structureEditTitle: { fontFamily: fontFamilies.bold, fontSize: 14, color: colors.text },
    structureEditMinutes: { fontFamily: fontFamilies.semiBold, fontSize: 12, lineHeight: 18, textAlign: 'center', color: colors.accent },
    structureEditActions: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' },
    structureEditActionGroup: { flexDirection: 'row', gap: 6 },
    structureDurationControl: { alignItems: 'center', gap: 7 },
    structureIconButton: { minWidth: 39, minHeight: 38, padding: 7, borderRadius: 9, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    structureAddRow: { gap: 8, paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.border },
    structureAddActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    structureAddButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10 },
    structureAddLabel: { fontFamily: fontFamilies.medium, fontSize: 12, color: colors.text },
    mechanicStepWrap: { marginTop: 18 },
    mechanicStageHeader: { marginBottom: 12 },
    mechanicQuestion: { marginTop: 4, fontFamily: fontFamilies.display, fontSize: 26, lineHeight: 30, color: colors.text },
    mechanicHelper: { marginTop: 6, fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    mechanicList: { gap: 10 },
    mechanicCard: { padding: 12, paddingLeft: 14, borderRadius: 12 },
    mechanicSelectedRail: { position:'absolute', left:0, top:0, bottom:0, width:3, backgroundColor:colors.accent },
    mechanicTopRow: { flexDirection:'row', alignItems:'center', gap:10 },
    mechanicTitle: { marginTop:3, fontFamily:fontFamilies.display, fontSize:20, lineHeight:23, color:colors.text },
    mechanicDescription: { marginTop:4, fontFamily:fontFamilies.regular, fontSize:12, lineHeight:18, color:colors.textSecondary },
    mechanicSelectCircle: { width:28, height:28, borderRadius:14, borderWidth:1, borderColor:colors.accent, alignItems:'center', justifyContent:'center', backgroundColor:colors.surface, flexShrink:0 },
    mechanicMore: { minHeight:44, paddingVertical:10, flexDirection:'row', justifyContent:'center', alignItems:'center', gap:6 },
    mechanicMoreText: { color:colors.accent, fontFamily:fontFamilies.semiBold, fontSize:13 },
    previewOptionGroup: { gap: 6 },
    protocolCard: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    previewHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    previewInfoButton: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
    previewHeadline: { fontFamily: fontFamilies.semiBold, fontSize: 16, lineHeight: 22, color: colors.text },
    previewTimeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 7, marginBottom: 12 },
    previewTimePrimary: { fontFamily: fontFamilies.bold, fontSize: 13, lineHeight: 19, color: colors.accent },
    previewEstimate: { fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
    previewDetails: { fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginBottom: 14 },
    previewListLabel: { fontFamily: fontFamilies.medium, fontSize: 11, lineHeight: 17, color: colors.textSecondary, marginBottom: 5 },
    previewExerciseRow: { gap: 3, paddingVertical: 7 },
    previewExerciseDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    previewExerciseName: { fontFamily: fontFamilies.semiBold, fontSize: 14, lineHeight: 19, color: colors.text },
    previewExerciseDose: { fontFamily: fontFamilies.medium, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
    previewFootnote: { fontFamily: fontFamilies.regular, fontSize: 11, lineHeight: 17, color: colors.textSecondary, marginTop: 7 },
    protocolDose: { fontFamily: fontFamilies.medium, fontSize: 13, lineHeight: 19, color: colors.text },
    mechanicDisabled: { opacity: 0.46 },
    mechanicIssue: { marginTop: 12, fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
    simpleCard: { position: 'relative', overflow: 'hidden', padding: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    architectureCard: { position: 'relative', overflow: 'hidden', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    cardSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated ?? colors.surface },
    selectedRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.accent },
    cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
    cardEyebrow: { fontFamily: fontFamilies.bold, fontSize: 8, letterSpacing: 1, color: colors.secondaryAccent },
    cardTitle: { marginTop: 4, fontFamily: fontFamilies.display, fontSize: 21, lineHeight: 25, color: colors.text },
    cardSubtitle: { marginTop: 7, fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    selectCircle: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    selectCircleSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    architecturePurpose: { marginTop: 5, fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    architectureBlocks: { marginTop: 12, gap: 10 },
    architectureTimeline: { flexDirection: 'row', gap: 3, height: 10, borderRadius: 6, overflow: 'hidden' },
    architectureTimelineSlice: { borderRadius: 4 },
    architectureLegend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 7, columnGap: 14 },
    architectureLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    architectureLegendDot: { width: 8, height: 8, borderRadius: 2 },
    architectureLegendLabel: { fontFamily: fontFamilies.medium, fontSize: 11, lineHeight: 15, color: colors.text },
    architectureLegendMinutes: { color: colors.textSecondary },
    architectureDurationFooter: { marginTop: 11, paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 7 },
    cardFooter: { marginTop: 15, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 7 },
    cardFooterText: { fontFamily: fontFamilies.medium, fontSize: 11, color: colors.textSecondary },
    structureExplanation: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 11, marginBottom: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    structureExplanationText: { flex: 1, fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
    exerciseList: { gap: 0, borderTopWidth: 1, borderTopColor: colors.border },
    sectionSmallTitle: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.1, color: colors.accent, marginBottom: 7 },
    sectionSmallHint: { marginBottom: 12, fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    exerciseSuggestionsSection: { marginTop: 22 },
    exerciseCard: { position: 'relative', borderBottomWidth: 1, borderBottomColor: colors.border },
    exerciseCardExpanded: { borderColor: colors.accent },
    exerciseMainRow: { minHeight: 92, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
    exerciseInfoButton: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
    exerciseThumbnail: { width: 86, height: 60, flexShrink: 0, overflow: 'hidden', borderRadius: 8, backgroundColor: colors.surfaceElevated ?? colors.surface, alignItems: 'center', justifyContent: 'center' },
    exerciseThumbnailImage: { width: '100%', height: '100%' },
    exerciseCopy: { flex: 1, minWidth: 0 },
    exerciseName: { fontFamily: fontFamilies.semiBold, fontSize: 15, lineHeight: 20, color: colors.text },
    exerciseDose: { marginTop: 3, fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    exerciseDetailMeta: { marginTop: 12, fontFamily: fontFamilies.medium, fontSize: 12, color: colors.textSecondary },
    exerciseDetailReason: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    exerciseDetailActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 15 },
    exerciseDetailAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
    exerciseDetailActionText: { fontFamily: fontFamilies.semiBold, fontSize: 12, color: colors.text },
    selectionCount: { marginBottom: 10, fontFamily: fontFamilies.semiBold, fontSize: 12, color: colors.textSecondary },
    exerciseChangeAction: { marginTop: 12, minHeight: 48, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 },
    exerciseChangeLabel: { flex: 1, fontFamily: fontFamilies.semiBold, fontSize: 13, color: colors.accent },
    exerciseRecommendedLabel: { fontFamily: fontFamilies.bold, fontSize: 10, color: colors.accent, letterSpacing: 0.5, marginBottom: 5 },
    exerciseWarningLabel: { fontFamily: fontFamilies.bold, fontSize: 10, color: colors.secondaryAccent, letterSpacing: 0.5, marginBottom: 5 },
    exerciseGuidance: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
    exerciseGuidanceText: { flex: 1, fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
    exerciseSuggestion: { marginHorizontal: 14, marginBottom: 12, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, gap: 8, backgroundColor: colors.background },
    exerciseSuggestionText: { fontFamily: fontFamilies.medium, fontSize: 12, color: colors.text },
    exerciseSuggestionLink: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
    exerciseSuggestionLinkText: { fontFamily: fontFamilies.semiBold, fontSize: 12, color: colors.accent },
    exerciseReason: { marginTop: 5, fontFamily: fontFamilies.semiBold, fontSize: 11, lineHeight: 16, color: colors.accent },
    exerciseDetails: { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: colors.border },
    detailBlock: { marginTop: 15 },
    detailLabel: { fontFamily: fontFamilies.bold, fontSize: 9, letterSpacing: 1, color: colors.accent },
    detailText: { marginTop: 6, fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20, color: colors.textSecondary },
    tipBlock: { marginTop: 16, flexDirection: 'row', gap: 11 },
    tipRule: { width: 3, borderRadius: 2, backgroundColor: colors.accent },
    secondaryAction: { marginTop: 14, minHeight: 68, paddingHorizontal: 15, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 11 },
    secondaryActionTitle: { fontFamily: fontFamilies.semiBold, fontSize: 13, color: colors.text },
    secondaryActionText: { marginTop: 3, fontFamily: fontFamilies.regular, fontSize: 11, lineHeight: 16, color: colors.textSecondary },
    selectionFooter: { marginTop: 13, gap: 3 },
    selectionFooterText: { fontFamily: fontFamilies.bold, fontSize: 11, color: colors.accent },
    selectionFooterHint: { fontFamily: fontFamilies.regular, fontSize: 11, color: colors.textSecondary },
    primaryButton: { marginTop: 28, minHeight: 54, borderRadius: 15, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18 },
    primaryButtonText: { fontFamily: fontFamilies.bold, fontSize: 12, letterSpacing: 0.8, color: colors.textOnAccent },
    recapCard: { gap:10, marginTop:12 },
    recapOverview:{borderRadius:12,borderWidth:1,borderColor:colors.border,padding:12,gap:10,backgroundColor:colors.surface,marginBottom:12},
    recapTimeValue:{fontFamily:fontFamilies.bold,fontSize:22,color:colors.text},
    recapSegments:{height:7,flexDirection:'row',gap:3},
    recapAdvisory:{flexDirection:'row',gap:8,alignItems:'center'},
    recapAdvisoryText:{fontFamily:fontFamilies.medium,fontSize:12,lineHeight:18,color:colors.secondaryAccent,flexShrink:1},
    recapBlockHeading:{flex:1,flexDirection:'row',alignItems:'center',gap:8},
    recapParameterButton:{flexDirection:'row',alignItems:'center',gap:7,paddingVertical:9},
    recapThumb:{width:45,height:45,borderRadius:8,overflow:'hidden',backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,alignItems:'center',justifyContent:'center'},
    recapDoseEdit:{width:44,height:44,justifyContent:'center',alignItems:'center'},
    manualDoseField:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,marginVertical:6},
    manualDoseControls:{flexDirection:'row',alignItems:'center',gap:4},
    manualDoseButton:{width:40,height:44,borderRadius:8,borderWidth:1,borderColor:colors.border,alignItems:'center',justifyContent:'center'},
    manualDoseInput:{width:58,height:44,borderWidth:1,borderColor:colors.border,borderRadius:8,textAlign:'center',fontFamily:fontFamilies.semiBold,fontSize:16,color:colors.text},
    recapHelp: { fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20, color: colors.textSecondary, marginBottom: 16 },
    previewState: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 12 },
    previewNote: { fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginBottom: 12 },
    previewWarning: { fontFamily: fontFamilies.semiBold, fontSize: 12, lineHeight: 18, color: colors.error, marginBottom: 12 },
    recapDose: { marginTop: 5, fontFamily: fontFamilies.semiBold, fontSize: 12, lineHeight: 18, color: colors.accent },
    recapEdit: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', minHeight: 34 },
    recapEditText: { fontFamily: fontFamilies.semiBold, fontSize: 12, color: colors.accent },
    recapExerciseRow: { flexDirection:'row',alignItems:'center',gap:10,paddingVertical:9,borderTopWidth:1,borderTopColor:colors.border },
    recapExerciseMeta: { marginTop: 3, fontFamily: fontFamilies.medium, fontSize: 11, color: colors.textSecondary },
    recapBlock: { padding:12,borderWidth:1,borderColor:colors.border,borderRadius:12,backgroundColor:colors.surface,gap:4 },
    recapHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    recapBlockTitle: { fontFamily:fontFamilies.semiBold,fontSize:15,color:colors.text },
    recapMinutes: { fontFamily: fontFamilies.medium, fontSize: 11, color: colors.textSecondary },
    recapExercise: { fontFamily: fontFamilies.medium, fontSize: 13, color: colors.text },
    recapMechanic: { marginTop: 9, fontFamily: fontFamilies.bold, fontSize: 12, color: colors.secondaryAccent },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheetCard: { maxHeight: '82%', borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.surface, paddingBottom: 12 },
    sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 9, marginBottom: 10 },
    sheetHeader: { paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    sheetTitle: { flex: 1, fontFamily: fontFamilies.display, fontSize: 24, lineHeight: 29, color: colors.text },
    sheetClose: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    sheetScrollContent: { paddingHorizontal: 20, paddingBottom: 22 },
    sheetHelp: { fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20, color: colors.textSecondary, marginBottom: 14 },
    sheetNotice: { marginBottom: 14, padding: 12, borderRadius: 12, backgroundColor: colors.background, fontFamily: fontFamilies.medium, fontSize: 11, lineHeight: 17, color: colors.textSecondary },
    choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
    equipmentQuickRow: { flexDirection: 'row', gap: 9, marginBottom: 14 },
    equipmentQuickButton: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10 },
    equipmentQuickButtonSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    equipmentQuickText: { fontFamily: fontFamilies.semiBold, fontSize: 11, color: colors.accent },
    equipmentQuickTextSelected: { color: colors.textOnAccent },
    equipmentGrid: { gap: 8 },
    equipmentChoice: { minHeight: 58, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
    equipmentChoiceSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated ?? colors.surface },
    equipmentChoiceTitle: { fontFamily: fontFamilies.semiBold, fontSize: 13, color: colors.text },
    equipmentChoiceDetail: { marginTop: 3, fontFamily: fontFamilies.regular, fontSize: 11, color: colors.textSecondary },
    inlineLink: { marginTop: 16, minHeight: 50, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    inlineLinkText: { fontFamily: fontFamilies.semiBold, fontSize: 12, color: colors.accent },
    sheetDoneButton: { marginHorizontal: 20, minHeight: 50, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    sheetDoneButtonText: { fontFamily: fontFamilies.bold, fontSize: 12, letterSpacing: 0.8, color: colors.textOnAccent },
    sheetLoading: { minHeight: 90, alignItems: 'center', justifyContent: 'center' },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.background },
    infoText: { flex: 1, fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
    exerciseSearch: { minHeight: 48, marginBottom: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.background, fontFamily: fontFamilies.medium, fontSize: 14, color: colors.text },
    extraExerciseList: { gap: 8 },
    extraExerciseRow: { minHeight: 62, paddingHorizontal: 14, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
    extraExerciseRowSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated ?? colors.surface },
    extraExerciseName: { fontFamily: fontFamilies.semiBold, fontSize: 13, color: colors.text },
    extraExerciseMeta: { marginTop: 4, fontFamily: fontFamilies.medium, fontSize: 10, color: colors.textSecondary },
  });
}
