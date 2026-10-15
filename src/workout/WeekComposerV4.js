import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
  { code: 'OUTDOOR', label: 'Extérieur', icon: 'sunny-outline' },
];

const FALLBACK_INTENTS = [
  { key: 'STRENGTH', label: 'Force', subtitle: 'Construire autour d’un travail de force.', focus: 'Strength' },
  { key: 'CONDITIONING', label: 'Conditioning', subtitle: 'Faire monter le moteur et la densité.', focus: 'Conditioning' },
  { key: 'TECHNIQUE', label: 'Technique', subtitle: 'Travailler proprement un mouvement ou une qualité.', focus: 'General Fitness' },
  { key: 'FULL_BODY', label: 'Full body', subtitle: 'Une séance équilibrée et complète.', focus: 'General Fitness' },
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

function humanize(value) {
  if (!value) return null;
  return String(value).replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function coachIntentFromItem(item) {
  if (!item) return null;
  const title = item?.coachProjection?.presentation?.title
    ?? humanize(item?.plannedContext?.focus)
    ?? 'Séance UGEROD';
  const raw = String(item?.plannedContext?.focus ?? item?.coachProjection?.priority?.key ?? title).toUpperCase();
  const focus = raw.includes('STRENGTH') || raw.includes('FORCE')
    ? 'Strength'
    : raw.includes('CONDITION') || raw.includes('CARDIO')
      ? 'Conditioning'
      : 'General Fitness';
  return {
    key: `COACH_${raw.replace(/\s+/g, '_')}`,
    label: title,
    subtitle: item?.coachProjection?.presentation?.description ?? 'La direction déjà prévue dans ta semaine.',
    focus,
    targetRegion: item?.plannedContext?.targetRegion ?? null,
    recommended: true,
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

function DurationControl({ value, onChange, colors, styles }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const currentIndex = Math.max(0, DURATIONS.indexOf(value));
  const step = trackWidth > 0 ? trackWidth / (DURATIONS.length - 1) : 0;
  const dragOriginXRef = useRef(0);
  const currentIndexRef = useRef(currentIndex);
  const stepRef = useRef(step);
  const trackWidthRef = useRef(trackWidth);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  currentIndexRef.current = currentIndex;
  stepRef.current = step;
  trackWidthRef.current = trackWidth;
  valueRef.current = value;
  onChangeRef.current = onChange;

  const updateFromXRef = useRef(null);
  updateFromXRef.current = (x) => {
    const liveTrackWidth = trackWidthRef.current;
    const liveStep = stepRef.current;
    if (!liveTrackWidth || !liveStep) return;
    const clampedX = Math.max(0, Math.min(liveTrackWidth, x));
    const nextIndex = Math.max(0, Math.min(DURATIONS.length - 1, Math.round(clampedX / liveStep)));
    const nextValue = DURATIONS[nextIndex];
    if (nextValue !== valueRef.current) {
      valueRef.current = nextValue;
      onChangeRef.current(nextValue);
    }
  };

  const knobPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragOriginXRef.current = currentIndexRef.current * stepRef.current; },
    onPanResponderMove: (_event, gestureState) => updateFromXRef.current?.(dragOriginXRef.current + gestureState.dx),
    onPanResponderRelease: (_event, gestureState) => updateFromXRef.current?.(dragOriginXRef.current + gestureState.dx),
    onPanResponderTerminationRequest: () => false,
  }), []);

  const knobLeft = currentIndex * step;
  const durationColor = value <= 30 ? colors.accent : value >= 75 ? colors.secondaryAccent : colors.text;

  return (
    <View style={styles.durationShell}>
      <View style={styles.durationReadout}>
        <Text style={[styles.durationValue, { color: durationColor }]}>{value}</Text>
        <Text style={[styles.durationUnit, { color: durationColor }]}>MIN</Text>
      </View>
      <View style={styles.durationSliderColumn}>
        <View
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            trackWidthRef.current = width;
            setTrackWidth(width);
          }}
          style={styles.durationTrackTouch}
        >
          <View style={styles.durationTrack}>
            <View style={[styles.durationProgress, { width: knobLeft, backgroundColor: durationColor }]} />
            <View style={styles.durationHitRow}>
              {DURATIONS.map((item) => (
                <Pressable key={item} onPress={() => onChange(item)} style={styles.durationHit} />
              ))}
            </View>
            <View {...knobPanResponder.panHandlers} style={[styles.durationKnob, { left: knobLeft, borderColor: durationColor }]}>
              <Ionicons name="stopwatch-outline" size={18} color={colors.text} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function SummaryCard({ title, value, icon, accent, onPress, styles, colors }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.summaryCard, pressed && styles.pressed]}>
      <LinearGradient colors={[colors.surfaceElevated ?? colors.surface, colors.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.summaryInner}>
        <View style={[styles.summaryAccentBar, { backgroundColor: accent }]} />
        <Ionicons name={icon} size={58} color={accent} style={styles.summaryWatermark} />
        <View style={styles.summaryTopRow}>
          <View style={[styles.summaryIcon, { borderColor: accent, backgroundColor: colors.surface }]}>
            <Ionicons name={icon} size={19} color={accent} />
          </View>
          <Ionicons name="chevron-forward" size={19} color={colors.textSecondary} />
        </View>
        <View style={styles.summaryCopy}>
          <Text style={[styles.summaryTitle, { color: accent }]}>{title}</Text>
          <Text numberOfLines={2} style={styles.summaryValue}>{value}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

function ChoiceChip({ label, selected, onPress, styles, colors, icon = null }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.choiceChip, selected && styles.choiceChipSelected, pressed && styles.pressed]}>
      {icon ? <Ionicons name={icon} size={17} color={selected ? colors.textOnAccent : colors.textSecondary} /> : null}
      <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function EquipmentChoice({ item, selected, onPress, colors, styles }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.equipmentChoice, selected && styles.equipmentChoiceSelected, pressed && styles.pressed]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.equipmentChoiceTitle}>{item.name}</Text>
        {item.detail ? <Text numberOfLines={1} style={styles.equipmentChoiceDetail}>{item.detail}</Text> : null}
      </View>
      <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={selected ? colors.accent : colors.textMuted} />
    </Pressable>
  );
}

function SheetShell({ visible, title, onClose, children, styles, colors, footer = null }) {
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable onPress={onClose} style={styles.modalBackdrop} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.sheetClose}>
              <Ionicons name="close" size={23} color={colors.text} />
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

function PrimaryButton({ label, onPress, disabled = false, loading = false, styles, colors }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primaryButton, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      {loading ? <ActivityIndicator size="small" color={colors.textOnAccent} /> : null}
      <Text style={styles.primaryButtonText}>{label}</Text>
      {!loading ? <Ionicons name="arrow-forward" size={18} color={colors.textOnAccent} /> : null}
    </Pressable>
  );
}

export default function WeekComposerV4() {
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
  const [mechanic, setMechanic] = useState(null);

  async function loadEquipmentForEnvironment(code, catalog = equipmentCatalog) {
    try {
      setEquipmentLoading(true);
      const presetRows = await getUserEnvironmentEquipmentPreset(code);
      const reference = buildReferenceEquipment(catalog, presetRows ?? []);
      setReferenceEquipment(reference);
      setEquipmentIds(reference.map((item) => item.id));
    } catch (loadError) {
      console.warn('[WeekComposerV4] equipment preset failed', loadError);
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
        const [contract, catalog] = await Promise.all([
          getWeekReadContract({ anchorDate: new Date() }),
          getEquipmentCatalog(),
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
        setDuration(DURATIONS.includes(initialDuration) ? initialDuration : 60);
        setEnvironmentCode(initialEnvironment);

        const presetRows = await getUserEnvironmentEquipmentPreset(initialEnvironment);
        if (!active) return;
        const reference = buildReferenceEquipment(catalog ?? [], presetRows ?? []);
        setReferenceEquipment(reference);
        setEquipmentIds(reference.map((entry) => entry.id));

        const coachIntent = coachIntentFromItem(item);
        if (coachIntent) setIntent(coachIntent);
      } catch (loadError) {
        console.warn('[WeekComposerV4] load failed', loadError);
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
    return referenceEquipment.filter((item) => selected.has(String(item.id))).map((item) => item.name).filter(Boolean);
  }

  async function goToArchitecture() {
    if (!intent) return;
    try {
      setBusy(true);
      const targets = await getComposerArchitectureTargets(duration);
      const next = buildComposerArchitectures({ durationMinutes: duration, intentKey: intent.key, targets });
      setArchitectures(next);
      setArchitecture(next[0] ?? null);
      setStep(2);
    } catch (loadError) {
      console.warn('[WeekComposerV4] architecture failed', loadError);
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
      const blocks = architecture.blocks ?? [];
      const results = await Promise.all(blocks.map(async (block) => {
        const candidates = await getComposerExerciseCandidates({
          blockType: block.type,
          focus: intent?.focus ?? 'General Fitness',
          targetRegion: intent?.targetRegion ?? selectedItem?.plannedContext?.targetRegion ?? null,
          environmentCode,
          equipmentIds,
          limit: 8,
        });
        return [block.type, candidates];
      }));
      const nextMap = Object.fromEntries(results);
      const defaults = {};
      results.forEach(([type, candidates]) => {
        defaults[type] = candidates.slice(0, maxForBlock(type)).map((candidate) => candidate.id);
      });
      setCandidateMap(nextMap);
      setSelectionMap(defaults);
      setExerciseBlockIndex(0);
      setStep(3);
    } catch (loadError) {
      console.warn('[WeekComposerV4] candidate load failed', loadError);
      setError('Impossible de charger les mouvements proposés.');
    } finally {
      setBusy(false);
    }
  }

  function toggleExercise(type, id) {
    const max = maxForBlock(type);
    setSelectionMap((current) => {
      const selected = current[type] ?? [];
      if (selected.includes(id)) return { ...current, [type]: selected.filter((value) => value !== id) };
      if (selected.length >= max) return current;
      return { ...current, [type]: [...selected, id] };
    });
  }

  function advanceExerciseBlock() {
    const blocks = architecture?.blocks ?? [];
    if (exerciseBlockIndex < blocks.length - 1) {
      setExerciseBlockIndex((value) => value + 1);
      return;
    }
    const wodBlock = blocks.find((block) => block.type === 'WOD');
    const options = getComposerMechanicOptions({ wodMinutes: wodBlock?.minutes ?? 12, exerciseCount: (selectionMap.WOD ?? []).length });
    setMechanic(options[0] ?? null);
    setStep(4);
  }

  function selectedExercises(type) {
    const ids = new Set(selectionMap[type] ?? []);
    return (candidateMap[type] ?? []).filter((candidate) => ids.has(candidate.id));
  }

  async function addToWeek() {
    try {
      setBusy(true);
      setError('');
      const context = {
        duration_minutes: duration,
        environment_code: environmentCode,
        equipment: equipmentNames(),
        target_region: selectedItem?.plannedContext?.targetRegion ?? null,
      };
      let planItemId = selectedItem?.planItemId ?? null;
      if (planItemId) await updateWeekPlanItemContext({ planItemId, context });
      else {
        const created = await createAssistedWeekPlanItem({ recommendedDate: dateKey, context });
        planItemId = created?.planItemId ?? null;
      }

      const draft = {
        target_date: dateKey,
        duration_minutes: duration,
        environment_code: environmentCode,
        equipment_ids: equipmentIds,
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
        estimated_minutes: (architecture?.blocks ?? []).reduce((sum, block) => sum + Number(block.minutes ?? 0), 0),
      };

      if (!planItemId) throw new Error('Impossible de créer le créneau de semaine.');
      await saveComposerDraft({ planItemId, draft });
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/planning');
    } catch (saveError) {
      console.warn('[WeekComposerV4] save failed', saveError);
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

  const intentChoices = [
    ...(coachIntentFromItem(selectedItem) ? [coachIntentFromItem(selectedItem)] : []),
    ...FALLBACK_INTENTS,
  ].filter((choice, index, array) => array.findIndex((item) => item.label === choice.label) === index);
  const exerciseBlocks = architecture?.blocks ?? [];
  const activeBlock = exerciseBlocks[exerciseBlockIndex] ?? null;
  const activeCandidates = activeBlock ? candidateMap[activeBlock.type] ?? [] : [];
  const activeSelected = activeBlock ? selectionMap[activeBlock.type] ?? [] : [];
  const wodBlock = architecture?.blocks?.find((block) => block.type === 'WOD') ?? null;
  const mechanicOptions = getComposerMechanicOptions({ wodMinutes: wodBlock?.minutes ?? 12, exerciseCount: (selectionMap.WOD ?? []).length });
  const estimatedMinutes = (architecture?.blocks ?? []).reduce((sum, block) => sum + Number(block.minutes ?? 0), 0);
  const equipmentSummary = equipmentLoading ? 'Chargement…' : summarizeEquipment(referenceEquipment, equipmentIds);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable
            onPress={() => step > 0 ? setStep((value) => value - 1) : (router.canGoBack() ? router.back() : router.replace('/(tabs)/planning'))}
            style={styles.backButton}
            hitSlop={10}
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
            <Text style={styles.contextTrailText}>{duration} MIN · {environmentLabel(environmentCode).toUpperCase()}</Text>
            {intent ? <Text style={styles.contextTrailText}>{intent.label.toUpperCase()}</Text> : null}
            {architecture ? <Text style={styles.contextTrailMuted}>{architecture.blocks.map((block) => block.label).join(' + ')}</Text> : null}
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {step === 0 ? (
          <View style={styles.frameStep}>
            <Text style={styles.frameIntro}>Cadre de la séance</Text>
            <DurationControl value={duration} onChange={setDuration} colors={colors} styles={styles} />
            <View style={styles.summaryGrid}>
              <SummaryCard
                title="Lieu"
                value={environmentLabel(environmentCode)}
                icon="location-outline"
                accent={colors.accent}
                onPress={() => setSheet('location')}
                styles={styles}
                colors={colors}
              />
              <SummaryCard
                title="Matériel"
                value={equipmentSummary}
                icon="barbell-outline"
                accent={colors.accent}
                onPress={() => setSheet('equipment')}
                styles={styles}
                colors={colors}
              />
            </View>
            <PrimaryButton label="CONTINUER" onPress={() => setStep(1)} disabled={equipmentLoading} styles={styles} colors={colors} />
          </View>
        ) : null}

        {step === 1 ? (
          <View style={styles.stepWrap}>
            <Text style={styles.kicker}>QU’EST-CE QU’ON VEUT TRAVAILLER ?</Text>
            <Text style={styles.question}>Choisis l’envie de la séance.</Text>
            <Text style={styles.helper}>UGEROD garde la direction déjà prévue quand elle existe, mais tu peux reprendre la main.</Text>
            <View style={styles.optionList}>
              {intentChoices.map((choice) => {
                const selected = intent?.key === choice.key;
                return (
                  <Pressable key={choice.key} onPress={() => setIntent(choice)} style={[styles.optionCard, selected && styles.optionCardSelected]}>
                    <View style={styles.optionTopRow}>
                      <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>{choice.label}</Text>
                      {choice.recommended ? <Text style={styles.recommendedTag}>PRÉVU PAR UGEROD</Text> : null}
                    </View>
                    <Text style={[styles.optionSubtitle, selected && styles.optionSubtitleSelected]}>{choice.subtitle}</Text>
                  </Pressable>
                );
              })}
            </View>
            <PrimaryButton label={busy ? 'PRÉPARATION…' : 'VOIR LES STRUCTURES'} onPress={goToArchitecture} disabled={!intent || busy} loading={busy} styles={styles} colors={colors} />
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.stepWrap}>
            <Text style={styles.kicker}>VOILÀ COMMENT ON PEUT LA CONSTRUIRE.</Text>
            <Text style={styles.question}>Choisis une forme de séance.</Text>
            <Text style={styles.helper}>Les budgets viennent du moteur de durée UGEROD. Tu choisis l’architecture, pas les minutes bloc par bloc.</Text>
            <View style={styles.optionList}>
              {architectures.map((option) => {
                const selected = architecture?.key === option.key;
                return (
                  <Pressable key={option.key} onPress={() => setArchitecture(option)} style={[styles.architectureCard, selected && styles.optionCardSelected]}>
                    <View style={styles.optionTopRow}>
                      <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>{option.title}</Text>
                      {option.recommended ? <Text style={styles.recommendedTag}>MON CHOIX</Text> : null}
                    </View>
                    <View style={styles.architectureBlocks}>
                      {option.blocks.map((block) => (
                        <View key={`${option.key}-${block.type}`} style={styles.blockLine}>
                          <Text style={[styles.blockName, selected && styles.optionTitleSelected]}>{block.label}</Text>
                          <Text style={[styles.blockMinutes, selected && styles.optionSubtitleSelected]}>{block.minutes} min</Text>
                        </View>
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <PrimaryButton label={busy ? 'CHARGEMENT…' : 'CHOISIR LES MOUVEMENTS'} onPress={goToExercises} disabled={!architecture || busy} loading={busy} styles={styles} colors={colors} />
          </View>
        ) : null}

        {step === 3 && activeBlock ? (
          <View style={styles.stepWrap}>
            <Text style={styles.kicker}>{blockTitle(activeBlock.type)}</Text>
            <Text style={styles.question}>UGEROD te propose plusieurs mouvements cohérents.</Text>
            <Text style={styles.helper}>J’en ai déjà sélectionné {Math.min(maxForBlock(activeBlock.type), activeCandidates.length)}. Tu peux garder, retirer ou remplacer dans cette shortlist.</Text>
            <View style={styles.blockPositionRow}>
              {exerciseBlocks.map((block, index) => (
                <Pressable key={`${block.type}-${index}`} onPress={() => setExerciseBlockIndex(index)} style={[styles.blockPill, index === exerciseBlockIndex && styles.blockPillSelected]}>
                  <Text style={[styles.blockPillText, index === exerciseBlockIndex && styles.blockPillTextSelected]}>{block.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.exerciseList}>
              {activeCandidates.map((exercise) => {
                const selected = activeSelected.includes(exercise.id);
                return (
                  <Pressable key={exercise.id} onPress={() => toggleExercise(activeBlock.type, exercise.id)} style={[styles.exerciseCard, selected && styles.exerciseCardSelected]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.exerciseName}>{exercise.name}</Text>
                      <Text style={styles.exerciseMeta}>{[exercise.bodyRegion, exercise.movementPattern].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={selected ? colors.accent : colors.textMuted} />
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.selectionHint}>{activeSelected.length} / {maxForBlock(activeBlock.type)} mouvement{maxForBlock(activeBlock.type) > 1 ? 's' : ''}</Text>
            <PrimaryButton label={exerciseBlockIndex === exerciseBlocks.length - 1 ? 'CHOISIR LA MÉCANIQUE' : 'BLOC SUIVANT'} onPress={advanceExerciseBlock} disabled={activeSelected.length === 0} styles={styles} colors={colors} />
          </View>
        ) : null}

        {step === 4 ? (
          <View style={styles.stepWrap}>
            <Text style={styles.kicker}>MÉCANIQUE DU WOD.</Text>
            <Text style={styles.question}>Voilà les formats qui collent à tes mouvements et au temps prévu.</Text>
            <Text style={styles.helper}>Tu ne vois que quelques options. Le choix final servira ensuite à calculer la prescription.</Text>
            <View style={styles.optionList}>
              {mechanicOptions.map((option) => {
                const selected = mechanic?.key === option.key;
                return (
                  <Pressable key={option.key} onPress={() => setMechanic(option)} style={[styles.optionCard, selected && styles.optionCardSelected]}>
                    <View style={styles.optionTopRow}>
                      <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>{option.title}</Text>
                      {option.recommended ? <Text style={styles.recommendedTag}>RECOMMANDÉ</Text> : null}
                    </View>
                    <Text style={[styles.optionSubtitle, selected && styles.optionSubtitleSelected]}>{option.description}</Text>
                  </Pressable>
                );
              })}
            </View>
            <PrimaryButton label="FINALISER LA SÉANCE" onPress={() => setStep(5)} disabled={!mechanic} styles={styles} colors={colors} />
          </View>
        ) : null}

        {step === 5 ? (
          <View style={styles.stepWrap}>
            <Text style={styles.kicker}>TA SÉANCE EST CONSTRUITE.</Text>
            <Text style={styles.question}>{intent?.label}</Text>
            <Text style={styles.helper}>{duration} min · {environmentLabel(environmentCode)} · estimation actuelle {estimatedMinutes} min.</Text>
            <View style={styles.recapCard}>
              {(architecture?.blocks ?? []).map((block) => (
                <View key={`recap-${block.type}`} style={styles.recapBlock}>
                  <View style={styles.recapHeaderRow}>
                    <Text style={styles.recapBlockTitle}>{block.label.toUpperCase()}</Text>
                    <Text style={styles.recapMinutes}>{block.minutes} min</Text>
                  </View>
                  {selectedExercises(block.type).map((exercise) => <Text key={exercise.id} style={styles.recapExercise}>• {exercise.name}</Text>)}
                  {block.type === 'WOD' && mechanic ? <Text style={styles.recapMechanic}>{mechanic.title}</Text> : null}
                </View>
              ))}
            </View>
            <View style={styles.coachGuard}>
              <View style={styles.coachRule} />
              <Text style={styles.coachGuardText}>Les blocs, mouvements et la mécanique seront conservés. UGEROD pourra ensuite finaliser la dose — reps, charge, volume et repos — sans réécrire tes choix.</Text>
            </View>
            <PrimaryButton label={busy ? 'ENREGISTREMENT…' : 'AJOUTER À MA SEMAINE'} onPress={addToWeek} disabled={busy} loading={busy} styles={styles} colors={colors} />
          </View>
        ) : null}
      </ScrollView>

      <SheetShell visible={sheet === 'location'} title="Où tu t’entraînes ?" onClose={() => setSheet(null)} styles={styles} colors={colors}>
        <View style={styles.choiceGrid}>
          {ENVIRONMENTS.map((item) => (
            <ChoiceChip
              key={item.code}
              label={item.label}
              icon={item.icon}
              selected={environmentCode === item.code}
              onPress={async () => {
                await chooseEnvironment(item.code);
                setSheet(null);
              }}
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
        footer={
          <Pressable onPress={() => setSheet(null)} style={styles.sheetDoneButton}>
            <Text style={styles.sheetDoneButtonText}>Terminé</Text>
          </Pressable>
        }
      >
        <Text style={styles.sheetHelp}>Ajuste uniquement le matériel réellement disponible pour cette séance.</Text>
        {equipmentLoading ? (
          <View style={styles.sheetLoading}><ActivityIndicator size="small" color={colors.accent} /></View>
        ) : referenceEquipment.length === 0 ? (
          <View style={styles.infoRow}>
            <Ionicons name="body-outline" size={20} color={colors.accent} />
            <Text style={styles.infoText}>Aucun matériel enregistré ici. UGEROD composera au poids du corps.</Text>
          </View>
        ) : (
          <>
            <View style={styles.quickActions}>
              <Pressable onPress={() => setEquipmentIds(referenceEquipment.map((item) => item.id))} style={styles.quickButton}>
                <Text style={styles.quickButtonText}>Tout mon matériel</Text>
              </Pressable>
              <Pressable onPress={() => setEquipmentIds([])} style={styles.quickButton}>
                <Text style={styles.quickButtonText}>Poids du corps</Text>
              </Pressable>
            </View>
            <View style={styles.equipmentGrid}>
              {referenceEquipment.map((item) => (
                <EquipmentChoice
                  key={item.id}
                  item={item}
                  selected={equipmentIds.includes(item.id)}
                  onPress={() => toggleEquipment(item.id)}
                  colors={colors}
                  styles={styles}
                />
              ))}
            </View>
          </>
        )}
      </SheetShell>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.xl, paddingTop: 8, paddingBottom: 60 },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    muted: { fontFamily: fontFamilies.medium, fontSize: 13, color: colors.textSecondary },
    pressed: { opacity: 0.76 },
    disabled: { opacity: 0.45 },
    header: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 13 },
    backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    eyebrow: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.2, color: colors.accent },
    title: { marginTop: 2, fontFamily: fontFamilies.display, fontSize: 33, lineHeight: 37, color: colors.text },
    dot: { color: colors.secondaryAccent },
    brandIcon: { width: 38, height: 38 },
    contextTrail: { marginTop: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 3 },
    contextTrailText: { fontFamily: fontFamilies.bold, fontSize: 11, letterSpacing: 0.8, color: colors.text },
    contextTrailMuted: { fontFamily: fontFamilies.medium, fontSize: 11, color: colors.textSecondary },
    errorText: { marginTop: 12, fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 18, color: colors.error },
    frameStep: { marginTop: 18 },
    frameIntro: { marginTop: 6, fontFamily: fontFamilies.display, fontSize: 24, lineHeight: 29, color: colors.text },
    durationShell: { marginTop: 22, minHeight: 110, flexDirection: 'row', alignItems: 'center', gap: 20 },
    durationReadout: { minWidth: 82, alignItems: 'flex-start' },
    durationValue: { fontFamily: fontFamilies.display, fontSize: 52, lineHeight: 56 },
    durationUnit: { marginTop: 1, fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.5 },
    durationSliderColumn: { flex: 1, justifyContent: 'center' },
    durationTrackTouch: { height: 54, justifyContent: 'center' },
    durationTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border, position: 'relative' },
    durationProgress: { position: 'absolute', left: 0, top: 0, height: 4, borderRadius: 2 },
    durationHitRow: { position: 'absolute', left: -8, right: -8, top: -18, bottom: -18, flexDirection: 'row' },
    durationHit: { flex: 1 },
    durationKnob: { position: 'absolute', top: -18, marginLeft: -20, width: 40, height: 40, borderRadius: 20, borderWidth: 2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    summaryGrid: { marginTop: 18, flexDirection: 'row', gap: 12 },
    summaryCard: { flex: 1, minHeight: 154, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
    summaryInner: { flex: 1, padding: 15, overflow: 'hidden' },
    summaryAccentBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
    summaryWatermark: { position: 'absolute', right: -5, bottom: -8, opacity: 0.08 },
    summaryTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    summaryIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    summaryCopy: { marginTop: 17 },
    summaryTitle: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.1, textTransform: 'uppercase' },
    summaryValue: { marginTop: 7, fontFamily: fontFamilies.semiBold, fontSize: 15, lineHeight: 20, color: colors.text },
    stepWrap: { marginTop: 34 },
    kicker: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.45, color: colors.accent },
    question: { marginTop: 9, fontFamily: fontFamilies.display, fontSize: 31, lineHeight: 36, color: colors.text },
    helper: { marginTop: 10, fontFamily: fontFamilies.regular, fontSize: 14, lineHeight: 21, color: colors.textSecondary },
    optionList: { marginTop: 24, gap: 12 },
    optionCard: { padding: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    optionCardSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    optionTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    optionTitle: { flex: 1, fontFamily: fontFamilies.display, fontSize: 21, lineHeight: 25, color: colors.text },
    optionTitleSelected: { color: colors.textOnAccent },
    optionSubtitle: { marginTop: 7, fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    optionSubtitleSelected: { color: colors.textOnAccent, opacity: 0.82 },
    recommendedTag: { fontFamily: fontFamilies.bold, fontSize: 8, letterSpacing: 0.8, color: colors.secondaryAccent },
    architectureCard: { padding: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    architectureBlocks: { marginTop: 14, gap: 8 },
    blockLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    blockName: { fontFamily: fontFamilies.semiBold, fontSize: 13, color: colors.text },
    blockMinutes: { fontFamily: fontFamilies.medium, fontSize: 12, color: colors.textSecondary },
    blockPositionRow: { marginTop: 24, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    blockPill: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    blockPillSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    blockPillText: { fontFamily: fontFamilies.semiBold, fontSize: 11, color: colors.textSecondary },
    blockPillTextSelected: { color: colors.textOnAccent },
    exerciseList: { marginTop: 18, gap: 9 },
    exerciseCard: { minHeight: 66, paddingHorizontal: 15, paddingVertical: 13, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
    exerciseCardSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated ?? colors.surface },
    exerciseName: { fontFamily: fontFamilies.semiBold, fontSize: 14, color: colors.text },
    exerciseMeta: { marginTop: 4, fontFamily: fontFamilies.regular, fontSize: 11, color: colors.textSecondary },
    selectionHint: { marginTop: 12, textAlign: 'right', fontFamily: fontFamilies.medium, fontSize: 11, color: colors.textMuted },
    recapCard: { marginTop: 24, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
    recapBlock: { padding: 17, borderBottomWidth: 1, borderBottomColor: colors.border },
    recapHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    recapBlockTitle: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1, color: colors.accent },
    recapMinutes: { fontFamily: fontFamilies.medium, fontSize: 11, color: colors.textSecondary },
    recapExercise: { marginTop: 7, fontFamily: fontFamilies.medium, fontSize: 13, color: colors.text },
    recapMechanic: { marginTop: 10, fontFamily: fontFamilies.bold, fontSize: 12, color: colors.secondaryAccent },
    coachGuard: { marginTop: 20, flexDirection: 'row', gap: 12 },
    coachRule: { width: 3, borderRadius: 2, backgroundColor: colors.accent },
    coachGuardText: { flex: 1, fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20, color: colors.textSecondary },
    primaryButton: { marginTop: 30, minHeight: 54, borderRadius: 15, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18 },
    primaryButtonText: { fontFamily: fontFamilies.bold, fontSize: 12, letterSpacing: 0.9, color: colors.textOnAccent },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheetCard: { maxHeight: '76%', borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.surface, paddingBottom: 12 },
    sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 9, marginBottom: 10 },
    sheetHeader: { paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sheetTitle: { flex: 1, fontFamily: fontFamilies.display, fontSize: 25, lineHeight: 30, color: colors.text },
    sheetClose: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    sheetScrollContent: { paddingHorizontal: 20, paddingBottom: 22 },
    sheetHelp: { fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20, color: colors.textSecondary, marginBottom: 16 },
    choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
    choiceChip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 7 },
    choiceChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    choiceChipText: { fontFamily: fontFamilies.semiBold, fontSize: 13, color: colors.textSecondary },
    choiceChipTextSelected: { color: colors.textOnAccent },
    quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 13 },
    quickButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
    quickButtonText: { fontFamily: fontFamilies.semiBold, fontSize: 11, color: colors.accent },
    equipmentGrid: { gap: 8 },
    equipmentChoice: { minHeight: 58, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
    equipmentChoiceSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated ?? colors.surface },
    equipmentChoiceTitle: { fontFamily: fontFamilies.semiBold, fontSize: 13, color: colors.text },
    equipmentChoiceDetail: { marginTop: 3, fontFamily: fontFamilies.regular, fontSize: 11, color: colors.textSecondary },
    sheetDoneButton: { marginHorizontal: 20, minHeight: 50, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    sheetDoneButtonText: { fontFamily: fontFamilies.bold, fontSize: 12, letterSpacing: 0.8, color: colors.textOnAccent },
    sheetLoading: { minHeight: 90, alignItems: 'center', justifyContent: 'center' },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.background },
    infoText: { flex: 1, fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  });
}
