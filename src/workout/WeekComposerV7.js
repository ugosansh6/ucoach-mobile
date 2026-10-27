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
import { useUgerodTheme } from '../contexts/UgerodThemeContext';
import {
  getEquipmentCatalog,
  getUserEnvironmentEquipmentPreset,
} from '../services/equipmentService';
import {
  buildComposerArchitectures,
  composerBlockDisplayLabel,
  composerArchitectureDisplayTitle,
  getComposerArchitectureTargets,
  getComposerExerciseCandidates,
  getComposerMechanicOptions,
  getComposerPrescriptionPreview,
  getComposerCandidateEvidence,
  rankComposerCandidates,
  selectComposerDefaultExercises,
  getComposerForLocalDate,
  saveComposerDraft,
} from '../services/composerService';
import {
  createAssistedWeekPlanItem,
  getWeekReadContract,
  updateWeekPlanItemContext,
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
  { key: 'STRENGTH', label: 'Force', subtitle: 'Construire autour d’un travail de force.', focus: 'Strength' },
  { key: 'CONDITIONING', label: 'Conditioning', subtitle: 'Faire monter le moteur et la densité.', focus: 'Conditioning' },
  { key: 'TECHNIQUE', label: 'Skill', subtitle: 'Maîtriser un mouvement ou développer une compétence.', focus: 'General Fitness' },
];
const LOAD_CAPABLE_EQUIPMENT_IDS = new Set(['E03', 'E04', 'E09', 'E14']);
const MAIN_SHORTLIST_SIZE = 2;

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
    jump: 'Saut',
  };
  return labels[key] ?? raw.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function formatPreviewDose(dose, blockType) {
  if (!dose) return '';
  if (blockType === 'TABATA') return dose.intervals_per_exercise
    ? `${dose.intervals_per_exercise} passages · 20 s effort / 10 s repos`
    : '20 s effort / 10 s repos';
  const parts = [];
  if (dose.reps != null && Number.isFinite(Number(dose.reps))) {
    const reps = `${dose.reps} reps${dose.reps_semantics === 'per_side' ? ' / côté' : ''}`;
    parts.push(dose.sets ? `${dose.sets} × ${reps}` : reps);
  } else if (dose.duration_seconds != null) {
    parts.push(`${dose.duration_seconds} s`);
  } else if (dose.distance_meters != null) {
    parts.push(`${dose.distance_meters} m`);
  }
  if (dose.load_kg != null) parts.push(`${dose.load_kg} kg`);
  else if (dose.band_resistance_label) parts.push(`Élastique ${dose.band_resistance_label}`);
  if (dose.rest_seconds && ['STRENGTH', 'SKILL'].includes(blockType)) parts.push(`${dose.rest_seconds} s repos`);
  return parts.join(' · ') || 'Dosage à calibrer';
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
    key: `COACH_${focus.toUpperCase().replace(/\s+/g, '_')}`,
    label,
    subtitle,
    focus,
    targetRegion: item?.plannedContext?.targetRegion ?? null,
    recommended: true,
  };
}

function directionBaseLabel(choice) {
  if (choice?.focus === 'Strength') return 'Force';
  if (choice?.focus === 'Conditioning') return 'Conditioning';
  if (choice?.key === 'TECHNIQUE') return 'Skill';
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

function maxForBlock(type) {
  if (type === 'WARMUP') return 3;
  if (type === 'TABATA') return 2;
  if (type === 'STRENGTH' || type === 'SKILL') return 2;
  if (type === 'WOD') return 3;
  return 2;
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
    <Pressable onPress={onPress} style={({ pressed }) => [styles.choiceChip, selected && styles.choiceChipSelected, pressed && styles.pressed]}>
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
      <Text style={styles.kicker}>{kicker}</Text>
      <Text style={styles.question}>{title}</Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

function ArchitectureCard({ option, selected, onPress, styles, colors, environmentCode }) {
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
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={composerArchitectureDisplayTitle(option, environmentCode) + ', ' + totalMinutes + ' minutes'}
      style={({ pressed }) => [
        styles.architectureCard, selected && styles.cardSelected, pressed && styles.pressed,
      ]}
    >
      {selected ? <View style={styles.selectedRail} /> : null}
      <View style={styles.cardTopRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardEyebrow}>{option.recommended ? 'CHOIX UGEROD' : 'ALTERNATIVE'}</Text>
          <Text style={styles.cardTitle}>{composerArchitectureDisplayTitle(option, environmentCode)}</Text>
        </View>
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={30}
          color={selected ? colors.accent : colors.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
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
                {composerBlockDisplayLabel(block.type, environmentCode)}
                <Text style={styles.architectureLegendMinutes}>{' · ' + block.minutes + ' min'}</Text>
              </Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.architectureDurationFooter}>
        <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
        <Text style={styles.cardFooterText}>{'Durée totale : ' + totalMinutes + ' min'}</Text>
      </View>
    </Pressable>
  );
}

function ExerciseCard({ exercise, selected, expanded, onToggleSelect, onToggleExpand, onOpenAlternatives, suggestedAlternative, styles, colors }) {
  const imageUri = /^https?:\/\//i.test(String(exercise.imagePath ?? '')) ? exercise.imagePath : null;
  const material = (exercise.equipmentNames ?? []).join(' · ') || 'Poids du corps';
  const compactMeta = [movementLabel(exercise.movementPattern), material].filter(Boolean).join(' · ');
  const detailMeta = [regionLabel(exercise.bodyRegion), humanize(exercise.difficulty)].filter(Boolean).join(' · ');
  return (
    <View style={[styles.exerciseCard, selected && styles.cardSelected, expanded && styles.exerciseCardExpanded]}>
      {selected ? <View style={styles.selectedRail} /> : null}
      <View style={styles.exerciseMainRow}>
        <Pressable
          onPress={onToggleExpand}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={'Détails de ' + exercise.name}
          style={({ pressed }) => [styles.exerciseInfoButton, pressed && styles.pressed]}
        >
          <View style={[styles.exerciseGlyph, selected && styles.exerciseGlyphSelected]}>
            <Ionicons name="barbell-outline" size={18} color={selected ? colors.textOnAccent : colors.accent} />
          </View>
          <View style={styles.exerciseCopy}>
            <Text numberOfLines={1} style={styles.exerciseName}>{exercise.name}</Text>
            {compactMeta ? <Text numberOfLines={1} style={styles.exerciseMeta}>{compactMeta}</Text> : null}
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        </Pressable>
        <Pressable
          onPress={onToggleSelect}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={(selected ? 'Retirer ' : 'Choisir ') + exercise.name}
          style={[styles.selectCircle, selected && styles.selectCircleSelected]}
          hitSlop={8}
        >
          <Ionicons name={selected ? 'checkmark' : 'add'} size={18} color={selected ? colors.textOnAccent : colors.accent} />
        </Pressable>
      </View>

      {/* Never hide relevant movement conflicts behind collapsed details. */}
      {exercise.warning && selected ? (
        <View style={styles.exerciseGuidance}>
          <Ionicons name="alert-circle-outline" size={15} color={colors.secondaryAccent} />
          <Text style={styles.exerciseGuidanceText} numberOfLines={2}>
            {exercise.recommendationReason || 'Mouvement similaire déjà sélectionné'}
          </Text>
        </View>
      ) : null}

      {expanded ? (
        <View style={styles.exerciseDetails}>
          {detailMeta ? <Text style={styles.exerciseDetailMeta}>{detailMeta}</Text> : null}
          {!exercise.warning && exercise.recommendationReason ? (
            <View style={styles.exerciseDetailReason}>
              <Ionicons name="bulb-outline" size={15} color={colors.accent} />
              <Text style={styles.exerciseGuidanceText}>{exercise.recommendationReason}</Text>
            </View>
          ) : null}
          {exercise.warning && selected && suggestedAlternative ? (
            <Pressable onPress={onOpenAlternatives} style={styles.exerciseDetailReason}>
              <Text style={styles.exerciseSuggestionLinkText}>
                {'Essayer plutôt : ' + suggestedAlternative.name}
              </Text>
              <Ionicons name="chevron-forward" size={15} color={colors.accent} />
            </Pressable>
          ) : null}
          {imageUri ? <Image source={{ uri: imageUri }} resizeMode="cover" style={styles.exerciseImage} /> : null}
          {exercise.description ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>DESCRIPTION</Text>
              <Text style={styles.detailText}>{exercise.description}</Text>
            </View>
          ) : null}
          {exercise.instructions ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>COMMENT FAIRE</Text>
              <Text style={styles.detailText}>{exercise.instructions}</Text>
            </View>
          ) : null}
          {exercise.tips ? (
            <View style={styles.tipBlock}>
              <View style={styles.tipRule} />
              <View style={{ flex: 1 }}>
                <Text style={styles.detailLabel}>POINT D’ATTENTION</Text>
                <Text style={styles.detailText}>{exercise.tips}</Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
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
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [duration, setDuration] = useState(60);
  const [environmentCode, setEnvironmentCode] = useState('HOME');
  const [targetRegion, setTargetRegion] = useState(null);
  const [equipmentCatalog, setEquipmentCatalog] = useState([]);
  const [referenceEquipment, setReferenceEquipment] = useState([]);
  const [equipmentIds, setEquipmentIds] = useState([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [intent, setIntent] = useState(null);
  const [architectures, setArchitectures] = useState([]);
  const [architecture, setArchitecture] = useState(null);
  const [candidateMap, setCandidateMap] = useState({});
  const [candidateEvidence, setCandidateEvidence] = useState({});
  const [selectionMap, setSelectionMap] = useState({});
  const [exerciseBlockIndex, setExerciseBlockIndex] = useState(0);
  const [recapEditingBlock, setRecapEditingBlock] = useState(null);
  const [expandedExerciseId, setExpandedExerciseId] = useState(null);
  const [mechanic, setMechanic] = useState(null);
  const [mechanicOptions, setMechanicOptions] = useState([]);
  const [mechanicIssue, setMechanicIssue] = useState(null);
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [showAllMechanics, setShowAllMechanics] = useState(false);

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
        const candidates = (contract?.visibleItems ?? []).filter((item) => item?.recommendedDate === dateKey && !item?.sessionId);
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
        setTargetRegion(initialTargetRegion);
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
          const blocks = draft.architecture.blocks;
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
              const choices = await getComposerExerciseCandidates({
                blockType: block.type,
                focus: draft.intent?.focus ?? 'General Fitness',
                targetRegion: draft.target_region,
                environmentCode: draft.environment_code,
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
          setTargetRegion(draft.target_region ?? null);
          setEquipmentIds(Array.isArray(draft.equipment_ids) ? draft.equipment_ids : []);
          setIntent(draft.intent ?? coachIntent);
          setArchitecture(draft.architecture);
          setArchitectures([draft.architecture]);
          setCandidateMap(exerciseMap);
          setSelectionMap(requested);
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
          if (draft.mechanic?.key) {
            const wod = blocks.find((b) => b.type === 'WOD');
            try {
              const options = await getComposerMechanicOptions({
                wodMinutes: wod?.minutes,
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
          setStep(5);
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
  }, [dateKey, requestedPlanItemId]);

  async function chooseEnvironment(code) {
    setEnvironmentCode(code);
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
    try {
      setBusy(true);
      setError('');
      const targets = await getComposerArchitectureTargets(duration);
      const next = buildComposerArchitectures({ durationMinutes: duration, intentKey: intent.key, environmentCode, targets });
      setArchitectures(next);
      setArchitecture(next[0] ?? null);
      setStep(2);
    } catch (loadError) {
      console.warn('[WeekComposerV7] architecture failed', loadError);
      setError('Impossible de préparer les structures proposées.');
    } finally {
      setBusy(false);
    }
  }

  async function goToExercises() {
    if (!architecture) return;
    try {
      setBusy(true);
      setError('');
      const results = await Promise.all((architecture.blocks ?? []).map(async (block) => {
        const candidates = await getComposerExerciseCandidates({
          blockType: block.type,
          focus: intent?.focus ?? 'General Fitness',
          targetRegion: targetRegion ?? intent?.targetRegion ?? selectedItem?.plannedContext?.targetRegion ?? null,
          environmentCode,
          equipmentIds,
          limit: 30,
        });
        return [block.type, candidates];
      }));
      const candidatesByBlock = Object.fromEntries(results);
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
        candidateMap: candidatesByBlock,
        evidence: observations,
        equipmentIds,
        maxPerBlock: Object.fromEntries(results.map(([type]) => [type, maxForBlock(type)])),
      });
      setCandidateMap(candidatesByBlock);
      setCandidateEvidence(observations);
      setSelectionMap(defaults);
      setRecapEditingBlock(null);
      setExerciseBlockIndex(0);
      setExpandedExerciseId(null);
      setStep(3);
    } catch (loadError) {
      console.warn('[WeekComposerV7] candidate load failed', loadError);
      setError('Impossible de charger les mouvements proposés.');
    } finally {
      setBusy(false);
    }
  }

  function chooseExercise(type, id) {
    const max = maxForBlock(type);
    setSelectionMap((current) => {
      const selected = current[type] ?? [];
      if (selected.includes(id)) {
        return { ...current, [type]: selected.filter((value) => value !== id) };
      }
      if (selected.length < max) {
        return { ...current, [type]: [...selected, id] };
      }
      return { ...current, [type]: [...selected.slice(0, max - 1), id] };
    });
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
      const options = await getComposerMechanicOptions({
        wodMinutes: wodBlock.minutes,
        exerciseIds: selectionMap.WOD ?? [],
        environmentCode,
        focus: intent?.focus,
      });
      if (!options.some((option) => option.available !== false)) throw new Error('Aucune mécanique compatible avec ce WOD.');
      setMechanicOptions(options);
      setMechanicIssue(null);
      setMechanic((current) => options.find((option) => option.available !== false && option.key === current?.key)
        ?? options.find((option) => option.available !== false));
      setShowAllMechanics(false);
      setStep(4);
    } catch (reason) {
      console.warn('[Composer] mechanic recommendation failed', reason);
      setError('Impossible de valider les formats compatibles avec tes mouvements.');
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

  function buildCurrentDraft() {
    const estimatedMinutes = architecture?.estimatedMinutes
      ?? (architecture?.blocks ?? []).reduce((sum, item) => sum + Number(item.minutes ?? 0), 0);
    return {
      target_date: dateKey,
      duration_minutes: duration,
      environment_code: environmentCode,
      equipment_ids: equipmentIds,
      target_region: targetRegion,
      progression_intent: selectedItem?.plannedContext?.progressionIntent ?? 'MAINTAIN',
      intent: { key: intent?.key ?? null, label: intent?.label ?? null, focus: intent?.focus ?? null },
      architecture: {
        key: architecture?.key ?? null,
        title: architecture?.title ?? null,
        blocks: (architecture?.blocks ?? []).map((block) => ({
          type: block.type,
          label: block.label,
          minutes: block.minutes,
          exercises: selectedExercises(block.type).map((exercise) => ({ id: exercise.id, name: exercise.name })),
        })),
      },
      mechanic: mechanic ? { key: mechanic.key, title: mechanic.title } : null,
      estimated_minutes: estimatedMinutes,
    };
  }

  useEffect(() => {
    if (loading || step !== 5 || !architecture || !Object.keys(selectionMap).length) return undefined;
    let active = true;
    const draft = buildCurrentDraft();
    const selectedNames = referenceEquipment
      .filter((item) => equipmentIds.includes(String(item.id)))
      .map((item) => item.name).filter(Boolean);
    setPreviewLoading(true);
    setPreviewError(false);
    setPrescriptionPreview(null);
    getComposerPrescriptionPreview({ draft, equipmentNames: selectedNames })
      .then((result) => { if (active) setPrescriptionPreview(result?.status === 'PREVIEW' ? result : null); })
      .catch((reason) => {
        if (active) {
          console.warn('[Composer] C2 preview unavailable', reason);
          setPreviewError(true);
        }
      })
      .finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [loading, step, architecture, selectionMap, candidateMap, mechanic,
      referenceEquipment, equipmentIds, duration, environmentCode, targetRegion, intent, dateKey]);

  async function addToWeek() {
    try {
      setBusy(true);
      setError('');
      const context = {
        duration_minutes: duration,
        environment_code: environmentCode,
        equipment: equipmentNames(),
        target_region: targetRegion ?? selectedItem?.plannedContext?.targetRegion ?? null,
      };
      let planItemId = selectedItem?.planItemId ?? null;
      if (planItemId) await updateWeekPlanItemContext({ planItemId, context });
      else {
        const created = await createAssistedWeekPlanItem({ recommendedDate: dateKey, context });
        planItemId = created?.planItemId ?? null;
      }
      if (!planItemId) throw new Error('Impossible de créer le créneau de semaine.');

      if (!prescriptionPreview || previewLoading) {
        throw new Error('Le calcul de la séance est encore indisponible. Attends la prescription avant de valider.');
      }
      const draft = { ...buildCurrentDraft(), prescription_preview: prescriptionPreview };
      await saveComposerDraft({ planItemId, draft });
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
  const mainTypes = (architecture?.blocks ?? [])
    .filter((item) => !['WARMUP', 'TABATA'].includes(item.type))
    .map((item) => item.type);
  const intentKey = String(effectiveIntent?.key ?? '').toUpperCase();
  const intentFocus = String(effectiveIntent?.focus ?? '').toUpperCase();
  const dominantType = intentFocus === 'CONDITIONING' ? 'WOD'
    : intentKey === 'TECHNIQUE' || intentKey.includes('SKILL') ? 'SKILL'
      : intentFocus === 'STRENGTH' ? 'STRENGTH' : null;
  const structureDiffersFromDominant = dominantType && architecture
    && !mainTypes.includes(dominantType);
  const activeBlock = exerciseBlocks[exerciseBlockIndex] ?? null;
  const activeCandidates = activeBlock ? rankComposerCandidates({
    candidates: candidateMap[activeBlock.type] ?? [],
    blockType: activeBlock.type,
    selectionMap, candidateMap, evidence: candidateEvidence, equipmentIds,
  }) : [];
  const activeSelected = activeBlock ? selectionMap[activeBlock.type] ?? [] : [];
  const selectedCandidateObjects = activeCandidates.filter((exercise) => activeSelected.includes(exercise.id));
  const suggestedCandidates = activeCandidates
    .filter((exercise) => !activeSelected.includes(exercise.id))
    .slice(0, MAIN_SHORTLIST_SIZE);
  const mainCandidates = [...selectedCandidateObjects, ...suggestedCandidates];
  const extraCandidates = activeCandidates.filter((exercise) => !mainCandidates.some((item) => item.id === exercise.id));
  const replacementCandidates = activeCandidates.filter((exercise) => !activeSelected.includes(exercise.id));
  const filteredExtraCandidates = replacementCandidates.filter((exercise) => {
    const search = exerciseQuery.trim().toLowerCase();
    return !search || [exercise.name, exercise.movementPattern, exercise.bodyRegion, ...(exercise.equipmentNames ?? [])]
      .some((value) => String(value ?? '').toLowerCase().includes(search));
  });
  const wodBlock = architecture?.blocks?.find((block) => block.type === 'WOD') ?? null;
  const estimatedMinutes = architecture?.estimatedMinutes
    ?? (architecture?.blocks ?? []).reduce((sum, item) => sum + Number(item.minutes ?? 0), 0);
  const equipmentSummary = equipmentLoading ? 'Chargement…' : summarizeEquipment(referenceEquipment, equipmentIds);
  const allEquipmentSelected = referenceEquipment.length > 0
    && referenceEquipment.every((item) => equipmentIds.includes(item.id));
  const bodyweightOnly = equipmentIds.length === 0;

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
              <Text style={styles.title}>Composer<Text style={styles.dot}>.</Text></Text>
            </View>
            <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
          </View>

          {step > 0 ? (
            <View style={styles.contextTrail}>
              <View style={styles.contextLine}>
                <Text style={styles.contextPrimary}>{duration} MIN · {environmentLabel(environmentCode).toUpperCase()}</Text>
                {targetRegion ? <Text style={styles.contextPill}>{regionLabel(targetRegion)}</Text> : null}
              </View>
              {effectiveIntent ? <Text style={styles.contextPrimary}>DOMINANTE · {directionBaseLabel(effectiveIntent).toUpperCase()}</Text> : null}
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
                <Text style={styles.focusTitle}>Zone à travailler</Text>
                <Text style={styles.focusHelp}>Choisis une zone sur la silhouette, ou laisse UGEROD équilibrer la séance.</Text>
                <ComposerMuscleSelector
                  value={targetRegion}
                  onChange={setTargetRegion}
                  colors={colors}
                  fontFamilies={fontFamilies}
                />
              </View>
              <PrimaryButton label={busy ? 'PRÉPARATION…' : 'CHOISIR LA STRUCTURE'} onPress={goToArchitecture} disabled={!intent || busy} loading={busy} styles={styles} colors={colors} />
            </View>
          ) : null}

          {step === 2 ? (
            <View style={styles.stepWrap}>
              <StageHeader kicker="STRUCTURE" title="Le cœur de ta séance." helper="Warm-up, Tabata et transitions sont compris dans la durée de ta séance." styles={styles} />
              <View style={styles.optionList}>
                {architectures.map((option) => (
                  <ArchitectureCard key={option.key} option={option} selected={architecture?.key === option.key} onPress={() => setArchitecture(option)} styles={styles} colors={colors} environmentCode={environmentCode} />
                ))}
              </View>
              <PrimaryButton label={busy ? 'CHARGEMENT…' : 'CHOISIR LES MOUVEMENTS'} onPress={goToExercises} disabled={!architecture || busy} loading={busy} styles={styles} colors={colors} />
            </View>
          ) : null}

          {step === 3 && activeBlock ? (
            <View style={styles.stepWrap}>
              <StageHeader
                kicker={`${blockTitle(activeBlock.type, environmentCode)} · ${activeBlock.minutes} MIN`}
                title={recapEditingBlock ? 'Ajuste ce bloc.' : 'Construisons le cœur de ta séance.'}
                helper={recapEditingBlock
                   ? 'UGEROD a déjà proposé ces mouvements. Tu peux les conserver ou les remplacer.'
                   : `UGEROD en a retenu ${activeSelected.length}. Tu peux les remplacer ou consulter leur description.`}
                styles={styles}
              />
              {structureDiffersFromDominant ? (
                <View style={styles.structureExplanation}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.accent} />
                  <Text style={styles.structureExplanationText}>
                    Tu as choisi {directionBaseLabel(effectiveIntent)} comme dominante, mais cette structure privilégie {composerArchitectureDisplayTitle(architecture, environmentCode).toLowerCase()}. Tu peux revenir à Structure pour la modifier.
                  </Text>
                </View>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blockPositionRow}>
                {exerciseBlocks.map((item, index) => (
                  <Pressable
                    key={`${item.type}-${index}`}
                    onPress={() => { setExerciseBlockIndex(index); setExpandedExerciseId(null); }}
                    style={[styles.blockPill, index === exerciseBlockIndex && styles.blockPillSelected]}
                  >
                    <Text style={[styles.blockPillText, index === exerciseBlockIndex && styles.blockPillTextSelected]}>{composerBlockDisplayLabel(item.type, environmentCode)}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={styles.sectionSmallTitle}>TES MOUVEMENTS · {activeSelected.length}</Text>
              <Text style={styles.sectionSmallHint}>UGEROD privilégie des mouvements complémentaires. Tu peux modifier cette sélection, même pour choisir deux variantes similaires.</Text>
              <View style={styles.exerciseList}>
                {mainCandidates.filter((exercise) => activeSelected.includes(exercise.id)).map((exercise) => (
                  <ExerciseCard
                    key={exercise.id}
                    exercise={exercise}
                    selected={activeSelected.includes(exercise.id)}
                    expanded={expandedExerciseId === exercise.id}
                    onToggleSelect={() => chooseExercise(activeBlock.type, exercise.id)}
                    onToggleExpand={() => setExpandedExerciseId((current) => current === exercise.id ? null : exercise.id)}
                    suggestedAlternative={exercise.warning
                      ? activeCandidates.find((candidate) => !activeSelected.includes(candidate.id)
                        && candidate.movementPattern !== exercise.movementPattern) : null}
                    onOpenAlternatives={() => { setExerciseQuery(''); setSheet('exercise-picker'); }}
                    styles={styles}
                    colors={colors}
                  />
                ))}
              </View>

              {suggestedCandidates.length > 0 ? (
                <View style={styles.exerciseSuggestionsSection}>
                  <Text style={styles.sectionSmallTitle}>ALTERNATIVES CONSEILLÉES</Text>
                  <Text style={styles.sectionSmallHint}>Elles évoluent selon les mouvements que tu sélectionnes.</Text>
                  <View style={styles.exerciseList}>
                    {suggestedCandidates.map((exercise) => (
                      <ExerciseCard
                        key={exercise.id}
                        exercise={exercise}
                        selected={false}
                        expanded={expandedExerciseId === exercise.id}
                        onToggleSelect={() => chooseExercise(activeBlock.type, exercise.id)}
                        onToggleExpand={() => setExpandedExerciseId((current) => current === exercise.id ? null : exercise.id)}
                        onOpenAlternatives={() => { setExerciseQuery(''); setSheet('exercise-picker'); }}
                        styles={styles}
                        colors={colors}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              {extraCandidates.length > 0 ? (
                <Pressable onPress={() => { setExerciseQuery(''); setSheet('exercise-picker'); }} style={styles.secondaryAction}>
                  <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.secondaryActionTitle}>Voir d’autres exercices</Text>
                    <Text style={styles.secondaryActionText}>{extraCandidates.length} autres mouvements compatibles avec ce bloc.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}

              <View style={styles.selectionFooter}>
                <Text style={styles.selectionFooterText}>{activeSelected.length} / {maxForBlock(activeBlock.type)} retenu{activeSelected.length > 1 ? 's' : ''}</Text>
                <Text style={styles.selectionFooterHint}>Si le bloc est complet, choisir un autre mouvement remplace le dernier.</Text>
              </View>
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
            <View style={styles.stepWrap}>
              <StageHeader kicker="MÉCANIQUE DU WOD" title="Quel format donne le meilleur rythme ?" helper="Les formats incompatibles sont grisés. Touche-les pour comprendre pourquoi." styles={styles} />
              <View style={styles.optionList}>
                {mechanicOptions.filter((option, index) => showAllMechanics || index < 3).map((option) => {
                  const selected = mechanic?.key === option.key;
                  return (
                    <Pressable key={option.key}
                      onPress={() => option.available === false ? setMechanicIssue(option.reason) : (setMechanic(option), setMechanicIssue(null))}
                      style={[styles.simpleCard, selected && styles.cardSelected, option.available === false && styles.mechanicDisabled]}>
                      {selected ? <View style={styles.selectedRail} /> : null}
                      <View style={styles.cardTopRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cardEyebrow}>{option.available === false ? 'INDISPONIBLE' : option.recommended ? 'CHOIX UGEROD' : 'ALTERNATIVE'}</Text>
                          <Text style={styles.cardTitle}>{option.title}</Text>
                          <Text style={styles.cardSubtitle}>{option.available === false ? option.reason : option.description}</Text>
                        </View>
                        <View style={[styles.selectCircle, selected && styles.selectCircleSelected]}>
                          <Ionicons name={option.available === false ? 'lock-closed-outline' : selected ? 'checkmark' : 'add'} size={18} color={option.available === false ? colors.textMuted : selected ? colors.textOnAccent : colors.accent} />
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {mechanicIssue ? <Text style={styles.mechanicIssue}>{mechanicIssue}</Text> : null}
              {mechanicOptions.length > 3 ? (
                <Pressable onPress={() => setShowAllMechanics((value) => !value)} style={{ paddingVertical: 14, alignItems: 'center' }}>
                  <Text style={{ color: colors.accent, fontFamily: fontFamilies.bold, textDecorationLine: 'underline' }}>
                    {showAllMechanics ? 'Masquer les formats complémentaires' : 'Voir d’autres formats'}
                  </Text>
                </Pressable>
              ) : null}
              <PrimaryButton label="VOIR LE RÉCAPITULATIF" onPress={() => { setRecapEditingBlock(null); setStep(5); }} disabled={!mechanic} styles={styles} colors={colors} />
            </View>
          ) : null}

          {step === 5 ? (
            <View style={styles.stepWrap}>
              <StageHeader kicker="RÉCAPITULATIF" title="Ta séance est construite." helper={`${duration} min · ${environmentLabel(environmentCode)} · ≈ ${estimatedMinutes} min avec transitions.`} styles={styles} />
              <Text style={styles.recapHelp}>Warm-up et Tabata sont inclus dans la durée. Tu peux modifier chaque bloc.</Text>
              {previewLoading ? (
                <View style={styles.previewState}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.previewNote}>Calcul des prescriptions C2…</Text>
                </View>
              ) : prescriptionPreview ? (
                <Text style={styles.previewNote}>Prescription C2 prévisionnelle · le jour J, la forme et les gênes pourront entraîner des ajustements.</Text>
              ) : previewError ? (
                <Text style={styles.previewWarning}>Prévision indisponible : vérifie la connexion avant de valider.</Text>
              ) : null}
              <View style={styles.recapCard}>
                {(architecture?.blocks ?? []).map((item) => (
                  <View key={`recap-${item.type}`} style={styles.recapBlock}>
                    <View style={styles.recapHeaderRow}>
                      <Text style={styles.recapBlockTitle}>{item.label.toUpperCase()}</Text>
                      <Text style={styles.recapMinutes}>{item.minutes} min</Text>
                    </View>
                    {(() => {
                      const prescription = prescriptionPreview?.blocks?.find((block) => block.type === item.type);
                      if (!prescription) return null;
                      if (item.type === 'TABATA') {
                        return <Text style={styles.recapDose}>8 intervalles · 20 s effort / 10 s repos</Text>;
                      }
                      if (item.type === 'WOD' && prescription.rounds != null) {
                        const units = prescription.mechanic === 'EMOM' ? 'cycles' : 'tours';
                        return <Text style={styles.recapDose}>{prescription.rounds} {units}</Text>;
                      }
                      return null;
                    })()}
                    {selectedExercises(item.type).map((exercise) => {
                      const dose = prescriptionPreview?.blocks
                        ?.find((block) => block.type === item.type)?.exercises
                        ?.find((value) => value.id === exercise.id);
                      return (
                        <View key={exercise.id} style={styles.recapExerciseRow}>
                          <Text style={styles.recapExercise}>{exercise.name}</Text>
                          {dose ? <Text style={styles.recapDose}>{formatPreviewDose(dose, item.type)}</Text> : null}
                          <Text style={styles.recapExerciseMeta}>{(exercise.equipmentNames ?? []).join(' · ') || 'Poids du corps'}</Text>
                        </View>
                      );
                    })}
                    {item.type === 'WOD' && mechanic ? <Text style={styles.recapMechanic}>{mechanic.title}</Text> : null}
                    <Pressable onPress={() => editRecapBlock(item.type)} style={styles.recapEdit}>
                      <Ionicons name="create-outline" size={16} color={colors.accent} />
                      <Text style={styles.recapEditText}>Modifier {item.type === 'WOD' ? 'ce bloc ou sa mécanique' : 'les exercices'}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
              <PrimaryButton
                label={busy ? 'ENREGISTREMENT…' : 'VALIDER MA SÉANCE'}
                onPress={addToWeek}
                disabled={busy || previewLoading || !prescriptionPreview}
                loading={busy}
                styles={styles}
                colors={colors}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>

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

      <SheetShell
        visible={sheet === 'exercise-picker'}
        title={`Autres exercices · ${activeBlock ? blockTitle(activeBlock.type, environmentCode) : ''}`}
        onClose={() => setSheet(null)}
        styles={styles}
        colors={colors}
        footer={<Pressable onPress={() => setSheet(null)} style={styles.sheetDoneButton}><Text style={styles.sheetDoneButtonText}>Terminé</Text></Pressable>}
      >
        <Text style={styles.sheetHelp}>Tous restent filtrés par ton environnement, ton matériel et l’objectif de la séance.</Text>
        {activeSelected.length >= maxForBlock(activeBlock?.type) ? <Text style={styles.sheetNotice}>Le bloc est complet : choisir un autre mouvement remplacera le dernier sélectionné.</Text> : null}
        <TextInput
          value={exerciseQuery}
          onChangeText={setExerciseQuery}
          placeholder="Rechercher un mouvement ou du matériel…"
          placeholderTextColor={colors.textMuted}
          style={styles.exerciseSearch}
          autoCorrect={false}
          accessibilityLabel="Rechercher un exercice compatible"
        />
        {filteredExtraCandidates.length === 0 ? <Text style={styles.sheetHelp}>Aucun mouvement compatible ne correspond à cette recherche.</Text> : null}
        <View style={styles.extraExerciseList}>
          {filteredExtraCandidates.map((exercise) => {
            const selected = activeSelected.includes(exercise.id);
            return (
              <Pressable key={exercise.id} onPress={() => chooseExercise(activeBlock.type, exercise.id)} style={[styles.extraExerciseRow, selected && styles.extraExerciseRowSelected]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.extraExerciseName}>{exercise.name}</Text>
                  <Text style={styles.extraExerciseMeta}>{[regionLabel(exercise.bodyRegion), movementLabel(exercise.movementPattern), humanize(exercise.difficulty)].filter(Boolean).join(' · ')}</Text>
                  <Text style={styles.extraExerciseMeta}>Matériel : {(exercise.equipmentNames ?? []).join(' · ') || 'Poids du corps'}</Text>
                  {exercise.recommended ? <Text style={styles.exerciseReason}>Recommandé · {exercise.recommendationReason}</Text> : null}
                </View>
                <View style={[styles.selectCircle, selected && styles.selectCircleSelected]}>
                  <Ionicons name={selected ? 'checkmark' : 'add'} size={18} color={selected ? colors.textOnAccent : colors.accent} />
                </View>
              </Pressable>
            );
          })}
        </View>
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
    stageHeader: { marginBottom: 22 },
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
    blockPositionRow: { gap: 8, paddingRight: 10, marginBottom: 16 },
    blockPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    blockPillSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    blockPillText: { fontFamily: fontFamilies.semiBold, fontSize: 11, color: colors.textSecondary },
    blockPillTextSelected: { color: colors.textOnAccent },
    exerciseList: { gap: 10 },
    sectionSmallTitle: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.1, color: colors.accent, marginBottom: 7 },
    sectionSmallHint: { marginBottom: 12, fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    exerciseSuggestionsSection: { marginTop: 22 },
    exerciseCard: { position: 'relative', overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    exerciseCardExpanded: { borderColor: colors.accent },
    exerciseMainRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
    exerciseInfoButton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    exerciseGlyph: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
    exerciseGlyphSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    exerciseCopy: { flex: 1 },
    exerciseName: { fontFamily: fontFamilies.semiBold, fontSize: 15, lineHeight: 19, color: colors.text },
    exerciseMeta: { marginTop: 5, fontFamily: fontFamilies.medium, fontSize: 11, color: colors.textSecondary },
    exerciseEquipment: { marginTop: 5, fontFamily: fontFamilies.semiBold, fontSize: 11, color: colors.accent },
    exerciseRecommendedLabel: { fontFamily: fontFamilies.bold, fontSize: 10, color: colors.accent, letterSpacing: 0.5, marginBottom: 5 },
    exerciseWarningLabel: { fontFamily: fontFamilies.bold, fontSize: 10, color: colors.secondaryAccent, letterSpacing: 0.5, marginBottom: 5 },
    exerciseGuidance: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 12 },
    exerciseGuidanceText: { flex: 1, fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
    exerciseSuggestion: { marginHorizontal: 14, marginBottom: 12, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, gap: 8, backgroundColor: colors.background },
    exerciseSuggestionText: { fontFamily: fontFamilies.medium, fontSize: 12, color: colors.text },
    exerciseSuggestionLink: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
    exerciseSuggestionLinkText: { fontFamily: fontFamilies.semiBold, fontSize: 12, color: colors.accent },
    exerciseReason: { marginTop: 5, fontFamily: fontFamilies.semiBold, fontSize: 11, lineHeight: 16, color: colors.accent },
    exerciseDetails: { paddingHorizontal: 16, paddingBottom: 17, borderTopWidth: 1, borderTopColor: colors.border },
    exerciseImage: { marginTop: 15, width: '100%', height: 190, borderRadius: 14, backgroundColor: colors.background },
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
    recapCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
    recapHelp: { fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20, color: colors.textSecondary, marginBottom: 16 },
    previewState: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 12 },
    previewNote: { fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginBottom: 12 },
    previewWarning: { fontFamily: fontFamilies.semiBold, fontSize: 12, lineHeight: 18, color: colors.error, marginBottom: 12 },
    recapDose: { marginTop: 5, fontFamily: fontFamilies.semiBold, fontSize: 12, lineHeight: 18, color: colors.accent },
    recapEdit: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', minHeight: 34 },
    recapEditText: { fontFamily: fontFamilies.semiBold, fontSize: 12, color: colors.accent },
    recapExerciseRow: { marginTop: 9 },
    recapExerciseMeta: { marginTop: 3, fontFamily: fontFamilies.medium, fontSize: 11, color: colors.textSecondary },
    recapBlock: { padding: 17, borderBottomWidth: 1, borderBottomColor: colors.border },
    recapHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    recapBlockTitle: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1, color: colors.accent },
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
