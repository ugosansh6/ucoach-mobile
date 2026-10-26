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
  View,
} from 'react-native';

import { spacing } from '../constants';
import { fontFamilies } from '../constants/typography';
import { useUgerodTheme } from '../contexts/UgerodThemeContext';
import {
  getEquipmentCatalog,
  getUserEnvironmentEquipmentPreset,
} from '../services/equipmentService';
import {
  buildComposerArchitectures,
  getComposerArchitectureTargets,
  getComposerExerciseCandidates,
  getComposerMechanicOptions,
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
const FOCUS_OPTIONS = [
  { value: null, label: 'UGEROD choisit' },
  { value: 'Upper', label: 'Haut' },
  { value: 'Lower', label: 'Jambes' },
  { value: 'Core', label: 'Abdos / gainage' },
  { value: 'Full Body', label: 'Full body' },
];
const FALLBACK_INTENTS = [
  { key: 'STRENGTH', label: 'Force', subtitle: 'Construire autour d’un travail de force.', focus: 'Strength' },
  { key: 'CONDITIONING', label: 'Conditioning', subtitle: 'Faire monter le moteur et la densité.', focus: 'Conditioning' },
  { key: 'TECHNIQUE', label: 'Technique', subtitle: 'Travailler proprement un mouvement ou une qualité.', focus: 'General Fitness' },
];
const LOAD_CAPABLE_EQUIPMENT_IDS = new Set(['E03', 'E04', 'E09', 'E14']);
const MAIN_SHORTLIST_SIZE = 6;

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
  if (choice?.key === 'TECHNIQUE') return 'Technique';
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

function blockTitle(type) {
  if (type === 'WARMUP') return 'WARM-UP';
  if (type === 'TABATA') return 'TABATA';
  if (type === 'STRENGTH') return 'STRENGTH';
  if (type === 'SKILL') return 'SKILL';
  if (type === 'WOD') return 'WOD';
  return type;
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
  return (
    <View style={styles.durationShell}>
      <View style={styles.durationReadout}>
        <Text style={styles.durationValue}>{value}</Text>
        <Text style={styles.durationUnit}>MIN</Text>
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
            <View style={[styles.durationProgress, { width: left }]} />
            <View style={styles.durationHitRow}>
              {DURATIONS.map((item) => <Pressable key={item} onPress={() => onChange(item)} style={styles.durationHit} />)}
            </View>
            <View {...pan.panHandlers} style={[styles.durationKnob, { left }]}>
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

function ArchitectureCard({ option, selected, onPress, styles, colors }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.architectureCard, selected && styles.cardSelected, pressed && styles.pressed]}>
      {selected ? <View style={styles.selectedRail} /> : null}
      <View style={styles.cardTopRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardEyebrow}>{option.available === false ? 'INDISPONIBLE' : option.recommended ? 'CHOIX UGEROD' : 'ALTERNATIVE'}</Text>
          <Text style={styles.cardTitle}>{option.title}</Text>
        </View>
        <View style={[styles.selectCircle, selected && styles.selectCircleSelected]}>
          <Ionicons name={selected ? 'checkmark' : 'add'} size={18} color={selected ? colors.textOnAccent : colors.accent} />
        </View>
      </View>
      <View style={styles.architectureBlocks}>
        {option.blocks.map((block) => (
          <View key={`${option.key}-${block.type}`} style={styles.blockLine}>
            <Text style={styles.blockName}>{block.label}</Text>
            <Text style={styles.blockMinutes}>{block.minutes} min</Text>
          </View>
        ))}
      </View>
      <View style={styles.cardFooter}>
        <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
        <Text style={styles.cardFooterText}>≈ {option.estimatedMinutes ?? option.blocks.reduce((sum, item) => sum + Number(item.minutes ?? 0), 0)} min tout compris</Text>
      </View>
    </Pressable>
  );
}

function ExerciseCard({ exercise, selected, expanded, onToggleSelect, onToggleExpand, styles, colors }) {
  const imageUri = /^https?:\/\//i.test(String(exercise.imagePath ?? '')) ? exercise.imagePath : null;
  const conciseMeta = [regionLabel(exercise.bodyRegion), movementLabel(exercise.movementPattern), humanize(exercise.difficulty)].filter(Boolean).join(' · ');
  const material = (exercise.equipmentNames ?? []).join(' · ') || 'Poids du corps';
  return (
    <View style={[styles.exerciseCard, selected && styles.cardSelected, expanded && styles.exerciseCardExpanded]}>
      {selected ? <View style={styles.selectedRail} /> : null}
      <View style={styles.exerciseMainRow}>
        <Pressable onPress={onToggleExpand} style={({ pressed }) => [styles.exerciseInfoButton, pressed && styles.pressed]}>
          <View style={[styles.exerciseGlyph, selected && styles.exerciseGlyphSelected]}>
            <Ionicons name="barbell-outline" size={18} color={selected ? colors.textOnAccent : colors.accent} />
          </View>
          <View style={styles.exerciseCopy}>
            <Text style={styles.exerciseName}>{exercise.name}</Text>
            {conciseMeta ? <Text style={styles.exerciseMeta}>{conciseMeta}</Text> : null}
            <Text style={styles.exerciseEquipment}>Matériel : {material}</Text>
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={19} color={colors.textMuted} />
        </Pressable>
        <Pressable onPress={onToggleSelect} style={[styles.selectCircle, selected && styles.selectCircleSelected]} hitSlop={8}>
          <Ionicons name={selected ? 'checkmark' : 'add'} size={18} color={selected ? colors.textOnAccent : colors.accent} />
        </Pressable>
      </View>

      {expanded ? (
        <View style={styles.exerciseDetails}>
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
  const [selectionMap, setSelectionMap] = useState({});
  const [exerciseBlockIndex, setExerciseBlockIndex] = useState(0);
  const [recapEditingBlock, setRecapEditingBlock] = useState(null);
  const [expandedExerciseId, setExpandedExerciseId] = useState(null);
  const [mechanic, setMechanic] = useState(null);
  const [mechanicOptions, setMechanicOptions] = useState([]);
  const [mechanicIssue, setMechanicIssue] = useState(null);
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
      const next = buildComposerArchitectures({ durationMinutes: duration, intentKey: intent.key, targets });
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
      const defaults = {};
      results.forEach(([type, candidates]) => {
        defaults[type] = candidates.slice(0, maxForBlock(type)).map((candidate) => candidate.id);
      });
      setCandidateMap(Object.fromEntries(results));
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

      const estimatedMinutes = architecture?.estimatedMinutes
        ?? (architecture?.blocks ?? []).reduce((sum, item) => sum + Number(item.minutes ?? 0), 0);
      const draft = {
        target_date: dateKey,
        duration_minutes: duration,
        environment_code: environmentCode,
        equipment_ids: equipmentIds,
        target_region: targetRegion,
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
  const coachChoice = directionChoiceForRegion(rawCoachChoice, targetRegion, rawCoachChoice?.targetRegion ?? null);
  const fallbackChoices = FALLBACK_INTENTS
    .filter((choice) => !(coachChoice && directionBaseLabel(choice) === directionBaseLabel(coachChoice)))
    .map((choice) => directionChoiceForRegion(choice, targetRegion));
  const intentChoices = [
    ...(coachChoice ? [coachChoice] : []),
    ...fallbackChoices,
  ];
  const effectiveIntent = intentChoices.find((choice) => choice.key === intent?.key) ?? intent;

  // Construct the main session first; keep Warm-up/Tabata for recap edits.
  const exerciseBlocks = recapEditingBlock
    ? (architecture?.blocks ?? []).filter((item) => item.type === recapEditingBlock)
    : (architecture?.blocks ?? []).filter((item) => !['WARMUP', 'TABATA'].includes(item.type));
  const activeBlock = exerciseBlocks[exerciseBlockIndex] ?? null;
  const activeCandidates = activeBlock ? candidateMap[activeBlock.type] ?? [] : [];
  const activeSelected = activeBlock ? selectionMap[activeBlock.type] ?? [] : [];
  const selectedCandidateObjects = activeCandidates.filter((exercise) => activeSelected.includes(exercise.id));
  const mainCandidates = [
    ...selectedCandidateObjects,
    ...activeCandidates.slice(0, MAIN_SHORTLIST_SIZE),
  ].filter((exercise, index, array) => array.findIndex((item) => item.id === exercise.id) === index);
  const extraCandidates = activeCandidates.filter((exercise) => !mainCandidates.some((item) => item.id === exercise.id));
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
              }
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
              {effectiveIntent ? <Text style={styles.contextPrimary}>{effectiveIntent.label.toUpperCase()}</Text> : null}
              {architecture ? <Text style={styles.contextMuted}>{architecture.blocks.map((item) => item.label).join(' + ')}</Text> : null}
            </View>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {step === 0 ? (
            <View style={styles.stepWrap}>
              <StageHeader kicker="CADRE" title="On part de quoi ?" helper="Durée, lieu et matériel. Rien de plus pour commencer." styles={styles} />
              <DurationControl value={duration} onChange={setDuration} styles={styles} colors={colors} />
              <View style={styles.summaryGrid}>
                <Pressable onPress={() => setSheet('location')} style={styles.summaryCard}>
                  <View style={styles.summaryIcon}><Ionicons name="location-outline" size={19} color={colors.accent} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>LIEU</Text><Text style={styles.summaryValue}>{environmentLabel(environmentCode)}</Text></View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
                <Pressable onPress={() => setSheet('equipment')} style={styles.summaryCard}>
                  <View style={styles.summaryIcon}><Ionicons name="barbell-outline" size={19} color={colors.accent} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>MATÉRIEL</Text><Text numberOfLines={2} style={styles.summaryValue}>{equipmentSummary}</Text></View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
              <View style={styles.focusSection}>
                <Text style={styles.focusTitle}>Une envie aujourd’hui ?</Text>
                <Text style={styles.focusHelp}>Optionnel · UGEROD en tient compte.</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.focusRow}>
                  {FOCUS_OPTIONS.map((option) => (
                    <ChoiceChip key={option.label} label={option.label} selected={targetRegion === option.value} onPress={() => setTargetRegion(option.value)} styles={styles} colors={colors} />
                  ))}
                </ScrollView>
              </View>
              <PrimaryButton label="CONTINUER" onPress={() => setStep(1)} disabled={equipmentLoading} styles={styles} colors={colors} />
            </View>
          ) : null}

          {step === 1 ? (
            <View style={styles.stepWrap}>
              <StageHeader kicker="DIRECTION" title="Quel type de travail ?" helper={targetRegion ? `Ta préférence ${regionLabel(targetRegion).toLowerCase()} est déjà prise en compte.` : 'UGEROD garde la direction prévue quand elle existe, mais tu peux reprendre la main.'} styles={styles} />
              <View style={styles.optionList}>
                {intentChoices.map((choice) => {
                  const selected = intent?.key === choice.key;
                  return (
                    <Pressable key={choice.key} onPress={() => setIntent(choice)} style={[styles.simpleCard, selected && styles.cardSelected]}>
                      {selected ? <View style={styles.selectedRail} /> : null}
                      <View style={styles.cardTopRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cardEyebrow}>{choice.recommended ? 'PROPOSITION UGEROD' : 'OPTION'}</Text>
                          <Text style={styles.cardTitle}>{choice.label}</Text>
                          {choice.subtitle ? <Text style={styles.cardSubtitle}>{choice.subtitle}</Text> : null}
                        </View>
                        <View style={[styles.selectCircle, selected && styles.selectCircleSelected]}>
                          <Ionicons name={option.available === false ? 'lock-closed-outline' : selected ? 'checkmark' : 'add'} size={18} color={option.available === false ? colors.textMuted : selected ? colors.textOnAccent : colors.accent} />
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <PrimaryButton label={busy ? 'PRÉPARATION…' : 'VOIR LES STRUCTURES'} onPress={goToArchitecture} disabled={!intent || busy} loading={busy} styles={styles} colors={colors} />
            </View>
          ) : null}

          {step === 2 ? (
            <View style={styles.stepWrap}>
              <StageHeader kicker="STRUCTURE" title="Voilà comment on peut la construire." helper="Même langage visuel, même logique : UGEROD propose, tu choisis. Le temps inclut une marge pour les transitions." styles={styles} />
              <View style={styles.optionList}>
                {architectures.map((option) => (
                  <ArchitectureCard key={option.key} option={option} selected={architecture?.key === option.key} onPress={() => setArchitecture(option)} styles={styles} colors={colors} />
                ))}
              </View>
              <PrimaryButton label={busy ? 'CHARGEMENT…' : 'CHOISIR LES MOUVEMENTS'} onPress={goToExercises} disabled={!architecture || busy} loading={busy} styles={styles} colors={colors} />
            </View>
          ) : null}

          {step === 3 && activeBlock ? (
            <View style={styles.stepWrap}>
              <StageHeader
                kicker={`${blockTitle(activeBlock.type)} · ${activeBlock.minutes} MIN`}
                title={recapEditingBlock ? 'Ajuste ce bloc.' : 'Construisons le cœur de ta séance.'}
                helper={recapEditingBlock
                   ? 'UGEROD a déjà proposé ces mouvements. Tu peux les conserver ou les remplacer.'
                   : `UGEROD en a retenu ${activeSelected.length}. Tu peux les remplacer ou consulter leur description.`}
                styles={styles}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blockPositionRow}>
                {exerciseBlocks.map((item, index) => (
                  <Pressable
                    key={`${item.type}-${index}`}
                    onPress={() => { setExerciseBlockIndex(index); setExpandedExerciseId(null); }}
                    style={[styles.blockPill, index === exerciseBlockIndex && styles.blockPillSelected]}
                  >
                    <Text style={[styles.blockPillText, index === exerciseBlockIndex && styles.blockPillTextSelected]}>{item.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={styles.exerciseList}>
                {mainCandidates.map((exercise) => (
                  <ExerciseCard
                    key={exercise.id}
                    exercise={exercise}
                    selected={activeSelected.includes(exercise.id)}
                    expanded={expandedExerciseId === exercise.id}
                    onToggleSelect={() => chooseExercise(activeBlock.type, exercise.id)}
                    onToggleExpand={() => setExpandedExerciseId((current) => current === exercise.id ? null : exercise.id)}
                    styles={styles}
                    colors={colors}
                  />
                ))}
              </View>

              {extraCandidates.length > 0 ? (
                <Pressable onPress={() => setSheet('exercise-picker')} style={styles.secondaryAction}>
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
              <StageHeader kicker="MÉCANIQUE DU WOD" title="Quel format donne le meilleur rythme ?" helper="UGEROD ne montre que les formats cohérents avec les mouvements retenus et le temps disponible." styles={styles} />
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
                          <Text style={styles.cardEyebrow}>{option.recommended ? 'CHOIX UGEROD' : 'ALTERNATIVE'}</Text>
                          <Text style={styles.cardTitle}>{option.title}</Text>
                          <Text style={styles.cardSubtitle}>{option.available === false ? option.reason : option.description}</Text>
                        </View>
                        <View style={[styles.selectCircle, selected && styles.selectCircleSelected]}>
                          <Ionicons name={selected ? 'checkmark' : 'add'} size={18} color={selected ? colors.textOnAccent : colors.accent} />
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {mechanicIssue ? <Text style={styles.mechanicIssue}>{mechanicIssue}</Text> : null}
              {mechanicOptions.length > 3 ? (
                <Pressable onPress={() => setShowAllMechanics((value) => !value)} style={{ paddingVertical: 14, alignItems: 'center' }}>
                  <Text style={{ color: colors.accent, fontFamily: MANROPE.bold, textDecorationLine: 'underline' }}>
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
              <Text style={styles.recapHelp}>Warm-up et Tabata sont déjà proposés et comptés dans ta durée. Tu peux modifier chaque bloc.</Text>
              <View style={styles.recapCard}>
                {(architecture?.blocks ?? []).map((item) => (
                  <View key={`recap-${item.type}`} style={styles.recapBlock}>
                    <View style={styles.recapHeaderRow}>
                      <Text style={styles.recapBlockTitle}>{item.label.toUpperCase()}</Text>
                      <Text style={styles.recapMinutes}>{item.minutes} min</Text>
                    </View>
                    {selectedExercises(item.type).map((exercise) => (
                      <View key={exercise.id} style={styles.recapExerciseRow}>
                        <Text style={styles.recapExercise}>{exercise.name}</Text>
                        <Text style={styles.recapExerciseMeta}>{(exercise.equipmentNames ?? []).join(' · ') || 'Poids du corps'}</Text>
                      </View>
                    ))}
                    {item.type === 'WOD' && mechanic ? <Text style={styles.recapMechanic}>{mechanic.title}</Text> : null}
                    <Pressable onPress={() => editRecapBlock(item.type)} style={styles.recapEdit}>
                      <Ionicons name="create-outline" size={16} color={colors.accent} />
                      <Text style={styles.recapEditText}>Modifier {item.type === 'WOD' ? 'ce bloc ou sa mécanique' : 'les exercices'}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
              <PrimaryButton label={busy ? 'ENREGISTREMENT…' : 'VALIDER MA SÉANCE'} onPress={addToWeek} disabled={busy} loading={busy} styles={styles} colors={colors} />
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
        title={`Autres exercices · ${activeBlock ? blockTitle(activeBlock.type) : ''}`}
        onClose={() => setSheet(null)}
        styles={styles}
        colors={colors}
        footer={<Pressable onPress={() => setSheet(null)} style={styles.sheetDoneButton}><Text style={styles.sheetDoneButtonText}>Terminé</Text></Pressable>}
      >
        <Text style={styles.sheetHelp}>Tous restent filtrés par ton environnement, ton matériel et l’objectif de la séance.</Text>
        {activeSelected.length >= maxForBlock(activeBlock?.type) ? <Text style={styles.sheetNotice}>Le bloc est complet : choisir un autre mouvement remplacera le dernier sélectionné.</Text> : null}
        <View style={styles.extraExerciseList}>
          {extraCandidates.map((exercise) => {
            const selected = activeSelected.includes(exercise.id);
            return (
              <Pressable key={exercise.id} onPress={() => chooseExercise(activeBlock.type, exercise.id)} style={[styles.extraExerciseRow, selected && styles.extraExerciseRowSelected]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.extraExerciseName}>{exercise.name}</Text>
                  <Text style={styles.extraExerciseMeta}>{[regionLabel(exercise.bodyRegion), movementLabel(exercise.movementPattern), humanize(exercise.difficulty)].filter(Boolean).join(' · ')}</Text>
                  <Text style={styles.extraExerciseMeta}>Matériel : {(exercise.equipmentNames ?? []).join(' · ') || 'Poids du corps'}</Text>
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
    architectureCard: { position: 'relative', overflow: 'hidden', padding: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    cardSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated ?? colors.surface },
    selectedRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.accent },
    cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
    cardEyebrow: { fontFamily: fontFamilies.bold, fontSize: 8, letterSpacing: 1, color: colors.secondaryAccent },
    cardTitle: { marginTop: 4, fontFamily: fontFamilies.display, fontSize: 21, lineHeight: 25, color: colors.text },
    cardSubtitle: { marginTop: 7, fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    selectCircle: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    selectCircleSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    architectureBlocks: { marginTop: 16, gap: 9 },
    blockLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    blockName: { fontFamily: fontFamilies.semiBold, fontSize: 13, color: colors.text },
    blockMinutes: { fontFamily: fontFamilies.medium, fontSize: 12, color: colors.textSecondary },
    cardFooter: { marginTop: 15, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 7 },
    cardFooterText: { fontFamily: fontFamilies.medium, fontSize: 11, color: colors.textSecondary },
    blockPositionRow: { gap: 8, paddingRight: 10, marginBottom: 16 },
    blockPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    blockPillSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    blockPillText: { fontFamily: fontFamilies.semiBold, fontSize: 11, color: colors.textSecondary },
    blockPillTextSelected: { color: colors.textOnAccent },
    exerciseList: { gap: 10 },
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
    extraExerciseList: { gap: 8 },
    extraExerciseRow: { minHeight: 62, paddingHorizontal: 14, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
    extraExerciseRowSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated ?? colors.surface },
    extraExerciseName: { fontFamily: fontFamilies.semiBold, fontSize: 13, color: colors.text },
    extraExerciseMeta: { marginTop: 4, fontFamily: fontFamilies.medium, fontSize: 10, color: colors.textSecondary },
  });
}
