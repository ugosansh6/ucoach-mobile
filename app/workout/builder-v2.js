import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, spacing } from '../../src/constants';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import {
  getEquipmentCatalog,
  getUserEquipmentInventory,
} from '../../src/services/equipmentService';
import { reloadWorkoutSession } from '../../src/services/workoutService';
import {
  commitUserSessionDraft,
  createUserSessionDraft,
  getUserSessionBuilderBootstrap,
  getUserSessionBuilderExercises,
  replaceUserSessionDraftStructure,
  updateUserSessionDraftContext,
  validateUserSessionDraft,
} from '../../src/services/userSessionBuilderService';

const DURATIONS = [20, 30, 45, 60, 75, 90];
const AUTO_MODULES = new Set(['UNLOCK', 'WARMUP']);
const LOAD_CAPABLE_EQUIPMENT_IDS = new Set(['E03', 'E04', 'E09', 'E14']);

const ENVIRONMENT_ICONS = {
  HOME: 'home-outline',
  BOX: 'flash-outline',
  GYM: 'barbell-outline',
  OUTDOOR: 'leaf-outline',
};

const SURFACES = {
  GRASS: 'HERBE',
  TRACK: 'PISTE',
  ROAD: 'ROUTE',
  TRAIL: 'CHEMIN / TRAIL',
  SAND: 'SABLE',
  MIXED: 'MIXTE',
};

const MODULE_META = {
  TABATA: ['Tabata', 'Bloc court et rythmé', 'timer-outline'],
  TABATA_ABS: ['Tabata abdos', 'Core court et rythmé', 'timer-outline'],
  CORE: ['Core', 'Travail du tronc', 'ellipse-outline'],
  SKILL: ['Skill / Gym', 'Technique ou compétence', 'navigate-outline'],
  GYM: ['Gym', 'Gymnastique', 'accessibility-outline'],
  STRENGTH: ['Musculation', 'Séries, reps, charge, repos', 'barbell-outline'],
  WOD: ['WOD', 'Bloc principal', 'flash-outline'],
  CARDIO: ['Cardio', 'Machine ou effort continu', 'heart-outline'],
  CONDITIONING: ['Conditioning', 'Effort cardio / métabolique', 'pulse-outline'],
};

const ISSUE_LABELS = {
  EXERCISE_HARD_GATE_FAILED: 'Un exercice n’est pas compatible avec ton contexte.',
  PRESCRIPTION_INCOMPLETE: 'Une prescription est incomplète.',
  SUPERSET_GROUP_REQUIRED: 'Chaque exercice d’un superset doit appartenir à une paire.',
  SUPERSET_GROUP_MUST_BE_PAIRED: 'Un superset doit contenir exactement deux exercices par groupe.',
  DURATION_EXCEEDS_AVAILABLE_TIME: 'La séance dépasse le temps disponible.',
  DURATION_ESTIMATE_PARTIAL: 'La durée ne peut pas être estimée complètement.',
  AUTO_PREPARATION_UNAVAILABLE: 'Ugerod ne trouve pas de préparation sûre avec ce contexte.',
};

function readinessFromScore(score) {
  const value = Number(score ?? 6);
  if (value <= 4) return 'low';
  if (value >= 8) return 'high';
  return 'normal';
}

function readinessLabel(value) {
  if (value === 'low') return 'FAIBLE';
  if (value === 'high') return 'TRÈS EN FORME';
  return 'NORMALE';
}

function toNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const numeric = Number(String(value).replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
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
    .filter((item) => item.id !== 'E00' && rowsByEquipment.has(item.id))
    .map((item) => {
      const rows = rowsByEquipment.get(item.id) ?? [];
      const supportsLoad = LOAD_CAPABLE_EQUIPMENT_IDS.has(item.id);
      const hasConfirmedLoad = rows.some((row) =>
        ['fixed_load', 'adjustable_load'].includes(row.inventory_mode)
      );
      const hasUnknownLoad =
        supportsLoad &&
        !hasConfirmedLoad &&
        rows.some((row) => row.inventory_mode === 'load_unknown');

      const quantity = rows.reduce(
        (total, row) => total + Math.max(1, Number(row.quantity ?? 1)),
        0
      );
      const fixedLoads = rows
        .filter((row) => row.inventory_mode === 'fixed_load' && row.load_kg != null)
        .map((row) => ({
          quantity: Math.max(1, Number(row.quantity ?? 1)),
          load: Number(row.load_kg),
        }));
      const adjustable = rows.find((row) => row.inventory_mode === 'adjustable_load');

      let detail = null;
      if (fixedLoads.length > 0) {
        detail = fixedLoads.map((row) => `${row.quantity}×${row.load} kg`).join(' · ');
      } else if (adjustable) {
        detail = `${adjustable.min_load_kg}–${adjustable.max_load_kg} kg`;
      } else if (hasUnknownLoad) {
        detail = 'CHARGE NON RENSEIGNÉE';
      } else if (quantity > 1) {
        detail = `×${quantity}`;
      }

      return {
        id: item.id,
        name: item.name,
        detail,
        hasUnknownLoad,
      };
    });
}

function createBlock(moduleCode, gymStyles) {
  const defaultStyle =
    moduleCode === 'STRENGTH'
      ? gymStyles.find((item) => item.is_default)?.style_code ?? 'CLASSIC_SETS'
      : null;

  return {
    clientId: `${moduleCode}-${Date.now()}-${Math.random()}`,
    module_code: moduleCode,
    title: MODULE_META[moduleCode]?.[0] ?? moduleCode,
    execution_style: defaultStyle,
    duration_minutes: '',
    settings: {},
    items: [],
  };
}

function buildPrescription(block, item) {
  const source = item.prescription ?? {};
  const prescription = {};
  const sets = toNumber(source.sets);
  const reps = toNumber(source.reps);
  const load = toNumber(source.load_kg);
  const rest = toNumber(source.rest_seconds);
  const duration = toNumber(source.duration_minutes);
  const distance = toNumber(source.distance_meters);
  const customText = String(source.text ?? '').trim();

  if (sets != null) prescription.sets = sets;
  if (reps != null) prescription.reps = reps;
  if (load != null) prescription.load_kg = load;
  if (rest != null) prescription.rest_seconds = rest;
  if (duration != null) prescription.duration_minutes = duration;
  if (distance != null) prescription.distance_meters = distance;

  if (customText) prescription.text = customText;
  else if (block.module_code === 'STRENGTH' && sets != null && reps != null) {
    prescription.text = [
      `${sets} × ${reps}`,
      load != null ? `${load} kg` : null,
      rest != null ? `repos ${rest} s` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  } else if (['CARDIO', 'CONDITIONING'].includes(block.module_code)) {
    prescription.text = [
      duration != null ? `${duration} min` : null,
      distance != null ? `${distance} m` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  } else if (duration != null) prescription.text = `${duration} min`;

  return prescription;
}

function serializeBlocks(blocks) {
  return blocks.map((block) => ({
    module_code: block.module_code,
    title: block.title,
    execution_style: block.module_code === 'STRENGTH' ? block.execution_style : null,
    duration_minutes: toNumber(block.duration_minutes),
    settings: block.settings ?? {},
    items: block.items.map((item, index) => ({
      exercise_id: item.exercise_id,
      group_key:
        block.module_code === 'STRENGTH' && block.execution_style === 'SUPERSETS'
          ? String.fromCharCode(65 + Math.floor(index / 2))
          : block.module_code === 'STRENGTH' && block.execution_style === 'CIRCUIT'
            ? 'CIRCUIT'
            : null,
      prescription: buildPrescription(block, item),
      notes: item.notes?.trim() || null,
    })),
  }));
}

function getIssueText(issue) {
  const code = issue?.code ?? 'UNKNOWN';
  return ISSUE_LABELS[code] ?? code.replaceAll('_', ' ');
}

export default function UserSessionBuilderV2() {
  const { preparation, setGeneratedWorkout } = useWorkout();

  const [step, setStep] = useState('context');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [bootstrap, setBootstrap] = useState(null);
  const [referenceEquipment, setReferenceEquipment] = useState([]);

  const [environmentCode, setEnvironmentCode] = useState('HOME');
  const [surfaceCode, setSurfaceCode] = useState(null);
  const [durationMinutes, setDurationMinutes] = useState(preparation.duration ?? 45);
  const [readiness, setReadiness] = useState(readinessFromScore(preparation.readiness));
  const [formatCode, setFormatCode] = useState(null);
  const [selectedEquipment, setSelectedEquipment] = useState(
    () => (preparation.equipment ?? []).filter((name) => name && name !== 'Poids du corps')
  );
  const [injuredZones, setInjuredZones] = useState(
    () => (preparation.painZones ?? []).filter((zone) => zone && zone !== 'Aucune')
  );

  const [draftId, setDraftId] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [validation, setValidation] = useState(null);
  const [acceptWarnings, setAcceptWarnings] = useState(false);

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerBlockIndex, setPickerBlockIndex] = useState(null);
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [exerciseResults, setExerciseResults] = useState([]);
  const [exerciseLoading, setExerciseLoading] = useState(false);

  const loadBootstrap = useCallback(async (environment) => {
    const data = await getUserSessionBuilderBootstrap(environment);
    setBootstrap(data);
    const formats = data?.formats ?? [];
    setFormatCode((current) =>
      formats.some((item) => item.format_code === current)
        ? current
        : formats.find((item) => item.is_default)?.format_code ?? formats[0]?.format_code ?? null
    );
    return data;
  }, []);

  const loadEquipment = useCallback(async () => {
    const [catalog, inventory] = await Promise.all([
      getEquipmentCatalog(),
      getUserEquipmentInventory(),
    ]);
    const reference = buildReferenceEquipment(catalog, inventory);
    setReferenceEquipment(reference);

    const allowed = new Set(reference.map((item) => item.name));
    setSelectedEquipment((current) => {
      const sanitized = current.filter((name) => allowed.has(name));
      if (sanitized.length > 0) return sanitized;

      const fromPreparation = (preparation.equipment ?? []).filter(
        (name) => name !== 'Poids du corps' && allowed.has(name)
      );
      if (fromPreparation.length > 0) return fromPreparation;
      return reference.map((item) => item.name);
    });
  }, [preparation.equipment]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await Promise.all([loadBootstrap('HOME'), loadEquipment()]);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Impossible de charger le constructeur.');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadBootstrap, loadEquipment]);

  useFocusEffect(
    useCallback(() => {
      setInjuredZones(
        (preparation.painZones ?? []).filter((zone) => zone && zone !== 'Aucune')
      );
      loadEquipment().catch(() => {});
    }, [preparation.painZones, loadEquipment])
  );

  const formats = bootstrap?.formats ?? [];
  const selectedFormat = formats.find((item) => item.format_code === formatCode);
  const fullModuleOrder = selectedFormat?.module_order ?? [];
  const editableModules = fullModuleOrder.filter((moduleCode) => !AUTO_MODULES.has(moduleCode));
  const automaticModules = fullModuleOrder.filter((moduleCode) => AUTO_MODULES.has(moduleCode));
  const gymStyles = bootstrap?.gym_execution_styles ?? [];

  async function handleEnvironment(nextEnvironment) {
    if (nextEnvironment === environmentCode) return;
    try {
      setBusy(true);
      setEnvironmentCode(nextEnvironment);
      setSurfaceCode(null);
      setValidation(null);
      const data = await loadBootstrap(nextEnvironment);
      const nextFormat =
        data?.formats?.find((item) => item.is_default)?.format_code ??
        data?.formats?.[0]?.format_code ??
        null;
      setFormatCode(nextFormat);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Impossible de changer d’environnement.');
    } finally {
      setBusy(false);
    }
  }

  function handleBack() {
    if (step === 'review') return setStep('build');
    if (step === 'build') return setStep('context');
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  function toggleEquipment(name) {
    setSelectedEquipment((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    );
  }

  async function handleContextContinue() {
    if (environmentCode === 'OUTDOOR' && !surfaceCode) {
      Alert.alert('Surface nécessaire', 'Choisis la surface sur laquelle tu vas t’entraîner.');
      return;
    }

    try {
      setBusy(true);
      setError(null);
      let draft;
      if (!draftId) {
        draft = await createUserSessionDraft({
          environmentCode,
          durationMinutes,
          surfaceCode,
          formatCode,
          readiness,
          focus: 'General Fitness',
          targetRegion: null,
          progressionIntent: 'MAINTAIN',
          availableEquipment: selectedEquipment,
          injuredZones,
        });
        setDraftId(draft?.id ?? null);
      } else {
        draft = await updateUserSessionDraftContext({
          draftId,
          environmentCode,
          durationMinutes,
          surfaceCode: surfaceCode ?? '',
          formatCode: formatCode ?? '',
          readiness,
          focus: 'General Fitness',
          targetRegion: '',
          progressionIntent: 'MAINTAIN',
          availableEquipment: selectedEquipment,
          injuredZones,
        });
      }

      const allowed = new Set(editableModules);
      setBlocks((current) => current.filter((block) => allowed.has(block.module_code)));
      setValidation(null);
      setStep('build');
    } catch (contextError) {
      setError(contextError instanceof Error ? contextError.message : 'Impossible de préparer le brouillon.');
    } finally {
      setBusy(false);
    }
  }

  function addBlock(moduleCode) {
    setBlocks((current) => [...current, createBlock(moduleCode, gymStyles)]);
  }

  function patchBlock(index, patch) {
    setBlocks((current) => current.map((block, i) => (i === index ? { ...block, ...patch } : block)));
  }

  function removeBlock(index) {
    setBlocks((current) => current.filter((_, i) => i !== index));
  }

  function moveBlock(index, direction) {
    setBlocks((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function patchItem(blockIndex, itemIndex, patch) {
    setBlocks((current) =>
      current.map((block, b) =>
        b !== blockIndex
          ? block
          : {
              ...block,
              items: block.items.map((item, i) => (i === itemIndex ? { ...item, ...patch } : item)),
            }
      )
    );
  }

  function patchPrescription(blockIndex, itemIndex, key, value) {
    setBlocks((current) =>
      current.map((block, b) =>
        b !== blockIndex
          ? block
          : {
              ...block,
              items: block.items.map((item, i) =>
                i !== itemIndex
                  ? item
                  : {
                      ...item,
                      prescription: { ...(item.prescription ?? {}), [key]: value },
                    }
              ),
            }
      )
    );
  }

  function removeItem(blockIndex, itemIndex) {
    setBlocks((current) =>
      current.map((block, b) =>
        b === blockIndex
          ? { ...block, items: block.items.filter((_, i) => i !== itemIndex) }
          : block
      )
    );
  }

  async function loadExercises(blockIndex, query = '') {
    const block = blocks[blockIndex];
    if (!draftId || !block) return;
    try {
      setExerciseLoading(true);
      const response = await getUserSessionBuilderExercises({
        draftId,
        moduleCode: block.module_code,
        query: query.trim() || null,
        limit: 60,
      });
      setExerciseResults(response?.results ?? []);
    } catch (exerciseError) {
      Alert.alert(
        'Exercices indisponibles',
        exerciseError instanceof Error ? exerciseError.message : 'Impossible de charger les exercices.'
      );
    } finally {
      setExerciseLoading(false);
    }
  }

  function openPicker(blockIndex) {
    setPickerBlockIndex(blockIndex);
    setExerciseQuery('');
    setExerciseResults([]);
    setPickerVisible(true);
    loadExercises(blockIndex, '');
  }

  function selectExercise(exercise) {
    if (pickerBlockIndex == null || !exercise?.selectable) return;
    setBlocks((current) =>
      current.map((block, blockIndex) => {
        if (blockIndex !== pickerBlockIndex) return block;
        if (block.items.some((item) => item.exercise_id === exercise.exercise_id)) return block;
        return {
          ...block,
          items: [
            ...block.items,
            {
              clientId: `${exercise.exercise_id}-${Date.now()}`,
              exercise_id: exercise.exercise_id,
              exercise_name: exercise.name,
              body_region: exercise.body_region,
              movement_pattern: exercise.movement_pattern,
              prescription: {
                text: '',
                sets: '',
                reps: '',
                load_kg: '',
                rest_seconds: '',
                duration_minutes: '',
                distance_meters: '',
              },
              notes: '',
            },
          ],
        };
      })
    );
    setPickerVisible(false);
  }

  async function saveStructure() {
    if (!draftId) throw new Error('Brouillon introuvable.');
    return replaceUserSessionDraftStructure({ draftId, blocks: serializeBlocks(blocks) });
  }

  async function handleValidate() {
    try {
      setBusy(true);
      setError(null);
      await saveStructure();
      const result = await validateUserSessionDraft(draftId);
      setValidation(result);
      setAcceptWarnings(false);
      setStep('review');
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Impossible de contrôler la séance.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit(startNow) {
    try {
      setBusy(true);
      setError(null);
      await saveStructure();
      const freshValidation = await validateUserSessionDraft(draftId);
      setValidation(freshValidation);
      if (!freshValidation?.pass) {
        setStep('review');
        return;
      }
      if (Number(freshValidation?.warning_count ?? 0) > 0 && !acceptWarnings) {
        Alert.alert('Avertissements à confirmer', 'Confirme que tu souhaites conserver tes choix.');
        return;
      }

      const result = await commitUserSessionDraft({ draftId, startNow, acceptWarnings });
      if (startNow && result?.session_id) {
        const workout = await reloadWorkoutSession({ sessionId: result.session_id });
        setGeneratedWorkout(workout);
        router.replace('/workout/session');
        return;
      }
      Alert.alert('Séance enregistrée', 'Elle est prête pour plus tard.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)') },
      ]);
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : 'Impossible d’enregistrer la séance.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primaryLight} />
        <Text style={styles.centerText}>PRÉPARATION DU CONSTRUCTEUR…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Header onBack={handleBack} />
        <StepBar step={step} />
        {error ? <ErrorBanner text={error} /> : null}

        {step === 'context' ? (
          <ContextStep
            bootstrap={bootstrap}
            environmentCode={environmentCode}
            onEnvironment={handleEnvironment}
            durationMinutes={durationMinutes}
            onDuration={setDurationMinutes}
            readiness={readiness}
            onReadiness={setReadiness}
            formatCode={formatCode}
            onFormat={setFormatCode}
            surfaceCode={surfaceCode}
            onSurface={setSurfaceCode}
            referenceEquipment={referenceEquipment}
            selectedEquipment={selectedEquipment}
            onToggleEquipment={toggleEquipment}
            onBodyweight={() => setSelectedEquipment([])}
            onManageEquipment={() =>
              router.push({ pathname: '/profile/equipment', params: { returnTo: '/workout/builder' } })
            }
            injuredZones={injuredZones}
            onManageInjuries={() => router.push('/workout/injuries')}
            onContinue={handleContextContinue}
            busy={busy}
          />
        ) : step === 'build' ? (
          <BuildStep
            blocks={blocks}
            editableModules={editableModules}
            automaticModules={automaticModules}
            gymStyles={gymStyles}
            onAddBlock={addBlock}
            onPatchBlock={patchBlock}
            onRemoveBlock={removeBlock}
            onMoveBlock={moveBlock}
            onAddExercise={openPicker}
            onPatchItem={patchItem}
            onPatchPrescription={patchPrescription}
            onRemoveItem={removeItem}
            onValidate={handleValidate}
            busy={busy}
          />
        ) : (
          <ReviewStep
            validation={validation}
            blocks={blocks}
            acceptWarnings={acceptWarnings}
            onAcceptWarnings={setAcceptWarnings}
            onEdit={() => setStep('build')}
            onSaveLater={() => handleCommit(false)}
            onStart={() => handleCommit(true)}
            busy={busy}
          />
        )}

        <ExercisePicker
          visible={pickerVisible}
          query={exerciseQuery}
          onQuery={setExerciseQuery}
          onSearch={() => loadExercises(pickerBlockIndex, exerciseQuery)}
          results={exerciseResults}
          loading={exerciseLoading}
          onSelect={selectExercise}
          onClose={() => setPickerVisible(false)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header({ onBack }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.iconButton}>
        <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
      </Pressable>
      <View style={styles.flex}>
        <Text style={styles.eyebrow}>CONSTRUCTION MANUELLE</Text>
        <Text style={styles.title}>CRÉER MA SÉANCE<Text style={styles.dot}>.</Text></Text>
      </View>
    </View>
  );
}

function StepBar({ step }) {
  const steps = [['context', '01', 'CONTEXTE'], ['build', '02', 'SÉANCE'], ['review', '03', 'CONTRÔLE']];
  const active = steps.findIndex(([key]) => key === step);
  return (
    <View style={styles.stepBar}>
      {steps.map(([key, number, label], index) => (
        <View key={key} style={styles.stepItem}>
          <View style={[styles.stepCircle, index <= active && styles.stepCircleActive]}>
            <Text style={[styles.stepNumber, index <= active && styles.stepNumberActive]}>
              {index < active ? '✓' : number}
            </Text>
          </View>
          <Text style={[styles.stepLabel, index === active && styles.stepLabelActive]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function ContextStep({
  bootstrap,
  environmentCode,
  onEnvironment,
  durationMinutes,
  onDuration,
  readiness,
  onReadiness,
  formatCode,
  onFormat,
  surfaceCode,
  onSurface,
  referenceEquipment,
  selectedEquipment,
  onToggleEquipment,
  onBodyweight,
  onManageEquipment,
  injuredZones,
  onManageInjuries,
  onContinue,
  busy,
}) {
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <InfoCard
        icon="construct-outline"
        title="TU COMPOSES LE CŒUR DE TA SÉANCE"
        text="Tu choisis les blocs et les exercices. Ugerod ajoutera automatiquement la préparation adaptée et contrôlera la sécurité."
      />

      <SectionTitle title="OÙ TU T’ENTRAÎNES ?" />
      <View style={styles.environmentGrid}>
        {(bootstrap?.environments ?? []).map((item) => {
          const selected = item.environment_code === environmentCode;
          return (
            <Pressable
              key={item.environment_code}
              onPress={() => onEnvironment(item.environment_code)}
              style={[styles.environmentCard, selected && styles.selectedCard]}
            >
              <Ionicons
                name={ENVIRONMENT_ICONS[item.environment_code] ?? 'location-outline'}
                size={23}
                color={selected ? colors.primaryLight : colors.textSecondary}
              />
              <Text style={[styles.environmentText, selected && styles.selectedText]}>
                {item.label_fr.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle title="TEMPS DISPONIBLE" />
      <View style={styles.chips}>
        {DURATIONS.map((value) => (
          <Chip key={value} label={`${value} MIN`} selected={durationMinutes === value} onPress={() => onDuration(value)} />
        ))}
      </View>

      {(bootstrap?.formats ?? []).length > 1 ? (
        <>
          <SectionTitle title="FORMAT DE SÉANCE" />
          {(bootstrap.formats ?? []).map((format) => (
            <Pressable
              key={format.format_code}
              onPress={() => onFormat(format.format_code)}
              style={[styles.formatCard, format.format_code === formatCode && styles.selectedCard]}
            >
              <View style={styles.flex}>
                <Text style={[styles.formatTitle, format.format_code === formatCode && styles.selectedText]}>
                  {format.label_fr.toUpperCase()}
                </Text>
                <Text style={styles.muted}>{format.description_fr}</Text>
              </View>
              <Ionicons
                name={format.format_code === formatCode ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={format.format_code === formatCode ? colors.primaryLight : colors.textMuted}
              />
            </Pressable>
          ))}
        </>
      ) : null}

      {environmentCode === 'OUTDOOR' ? (
        <>
          <SectionTitle title="SURFACE" subtitle="Aujourd’hui elle est utilisée comme garde-fou de contexte en extérieur." />
          <View style={styles.chips}>
            {(bootstrap?.surface_options ?? []).map((surface) => (
              <Chip
                key={surface}
                label={SURFACES[surface] ?? surface}
                selected={surfaceCode === surface}
                onPress={() => onSurface(surface)}
              />
            ))}
          </View>
        </>
      ) : null}

      <SectionTitle title="MATÉRIEL DU JOUR" subtitle="Même sélection que dans Préparation : ton matériel de profil, sans filtre lié au lieu." />
      <View style={styles.equipmentGrid}>
        <EquipmentChip
          item={{ name: 'Poids du corps', detail: null, hasUnknownLoad: false }}
          selected={selectedEquipment.length === 0}
          onPress={onBodyweight}
          fullWidth
        />
        {referenceEquipment.map((item) => (
          <EquipmentChip
            key={item.id}
            item={item}
            selected={selectedEquipment.includes(item.name)}
            onPress={() => onToggleEquipment(item.name)}
          />
        ))}
      </View>
      <Pressable onPress={onManageEquipment} style={styles.inlineAction}>
        <Text style={styles.inlineActionText}>MODIFIER MON MATÉRIEL</Text>
        <Ionicons name="chevron-forward" size={17} color={colors.primaryLight} />
      </Pressable>

      <SectionTitle title="FORME DU JOUR" />
      <View style={styles.chips}>
        {['low', 'normal', 'high'].map((value) => (
          <Chip key={value} label={readinessLabel(value)} selected={readiness === value} onPress={() => onReadiness(value)} />
        ))}
      </View>

      <SectionTitle title="GÊNES / BLESSURES" />
      <Pressable onPress={onManageInjuries} style={styles.injuryCard}>
        <Ionicons
          name={injuredZones.length ? 'medical-outline' : 'shield-checkmark-outline'}
          size={21}
          color={injuredZones.length ? colors.brandRed : colors.primaryLight}
        />
        <View style={styles.flex}>
          <Text style={styles.injuryTitle}>{injuredZones.length ? `${injuredZones.length} ZONE(S) À PROTÉGER` : 'AUCUNE GÊNE'}</Text>
          {injuredZones.length ? <Text style={styles.muted}>{injuredZones.join(' · ')}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
      </Pressable>

      <PrimaryButton label="COMPOSER MA SÉANCE" onPress={onContinue} loading={busy} />
    </ScrollView>
  );
}

function BuildStep({
  blocks,
  editableModules,
  automaticModules,
  gymStyles,
  onAddBlock,
  onPatchBlock,
  onRemoveBlock,
  onMoveBlock,
  onAddExercise,
  onPatchItem,
  onPatchPrescription,
  onRemoveItem,
  onValidate,
  busy,
}) {
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <InfoCard
        icon="sparkles-outline"
        title="LA PRÉPARATION EST GÉRÉE PAR UGEROD"
        text={
          automaticModules.length > 1
            ? 'Unlock et échauffement seront construits automatiquement à partir des exercices que tu choisis, de ton matériel et de tes gênes.'
            : 'L’Unlock sera construit automatiquement à partir des exercices que tu choisis, de ton matériel et de tes gênes.'
        }
      />

      <SectionTitle title="AJOUTER UN BLOC" subtitle="Tu ne construis que le cœur de la séance." />
      <View style={styles.moduleGrid}>
        {editableModules.map((moduleCode) => {
          const meta = MODULE_META[moduleCode] ?? [moduleCode, '', 'add-circle-outline'];
          return (
            <Pressable key={moduleCode} onPress={() => onAddBlock(moduleCode)} style={styles.moduleCard}>
              <Ionicons name={meta[2]} size={22} color={colors.primaryLight} />
              <Text style={styles.moduleTitle}>{meta[0].toUpperCase()}</Text>
              <Text style={styles.moduleSubtitle}>{meta[1]}</Text>
            </Pressable>
          );
        })}
      </View>

      {blocks.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="add-circle-outline" size={25} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>AJOUTE TON PREMIER BLOC</Text>
          <Text style={styles.muted}>Ugerod complètera ensuite la préparation automatiquement.</Text>
        </View>
      ) : null}

      {blocks.map((block, blockIndex) => (
        <View key={block.clientId} style={styles.blockCard}>
          <View style={styles.blockHeader}>
            <View style={styles.flex}>
              <Text style={styles.blockEyebrow}>BLOC {String(blockIndex + 1).padStart(2, '0')}</Text>
              <Text style={styles.blockTitle}>{block.title.toUpperCase()}</Text>
            </View>
            <View style={styles.row}>
              <Pressable onPress={() => onMoveBlock(blockIndex, -1)} style={styles.smallButton}>
                <Ionicons name="arrow-up" size={17} color={colors.textSecondary} />
              </Pressable>
              <Pressable onPress={() => onMoveBlock(blockIndex, 1)} style={styles.smallButton}>
                <Ionicons name="arrow-down" size={17} color={colors.textSecondary} />
              </Pressable>
              <Pressable onPress={() => onRemoveBlock(blockIndex)} style={styles.smallButton}>
                <Ionicons name="trash-outline" size={17} color={colors.brandRed} />
              </Pressable>
            </View>
          </View>

          {block.module_code === 'STRENGTH' && gymStyles.length ? (
            <View style={styles.chips}>
              {gymStyles.map((style) => (
                <Chip
                  key={style.style_code}
                  label={style.label_fr.toUpperCase()}
                  selected={block.execution_style === style.style_code}
                  onPress={() => onPatchBlock(blockIndex, { execution_style: style.style_code })}
                />
              ))}
            </View>
          ) : null}

          <Field
            label="DURÉE DU BLOC (OPTIONNELLE)"
            value={block.duration_minutes}
            onChangeText={(value) => onPatchBlock(blockIndex, { duration_minutes: value })}
            placeholder="ex. 20"
            keyboardType="numeric"
          />

          {block.items.map((item, itemIndex) => (
            <ExerciseEditor
              key={item.clientId}
              block={block}
              item={item}
              onChange={(patch) => onPatchItem(blockIndex, itemIndex, patch)}
              onPrescription={(key, value) => onPatchPrescription(blockIndex, itemIndex, key, value)}
              onRemove={() => onRemoveItem(blockIndex, itemIndex)}
            />
          ))}

          <Pressable onPress={() => onAddExercise(blockIndex)} style={styles.addExerciseButton}>
            <Ionicons name="add" size={19} color={colors.primaryLight} />
            <Text style={styles.addExerciseText}>AJOUTER UN EXERCICE</Text>
          </Pressable>
        </View>
      ))}

      <PrimaryButton label="CONTRÔLER MA SÉANCE" onPress={onValidate} loading={busy} disabled={blocks.length === 0} />
    </ScrollView>
  );
}

function ExerciseEditor({ block, item, onPrescription, onRemove }) {
  const strength = block.module_code === 'STRENGTH';
  const cardio = ['CARDIO', 'CONDITIONING'].includes(block.module_code);
  return (
    <View style={styles.exerciseCard}>
      <View style={styles.exerciseHeader}>
        <View style={styles.flex}>
          <Text style={styles.exerciseName}>{item.exercise_name}</Text>
          <Text style={styles.muted}>{[item.body_region, item.movement_pattern].filter(Boolean).join(' · ')}</Text>
        </View>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      {strength ? (
        <View style={styles.fieldGrid}>
          <Field label="SÉRIES" value={item.prescription.sets} onChangeText={(v) => onPrescription('sets', v)} placeholder="4" keyboardType="numeric" compact />
          <Field label="REPS" value={item.prescription.reps} onChangeText={(v) => onPrescription('reps', v)} placeholder="8" keyboardType="numeric" compact />
          <Field label="CHARGE KG" value={item.prescription.load_kg} onChangeText={(v) => onPrescription('load_kg', v)} placeholder="optionnel" keyboardType="decimal-pad" compact />
          <Field label="REPOS S" value={item.prescription.rest_seconds} onChangeText={(v) => onPrescription('rest_seconds', v)} placeholder="optionnel" keyboardType="numeric" compact />
        </View>
      ) : cardio ? (
        <View style={styles.fieldGrid}>
          <Field label="DURÉE MIN" value={item.prescription.duration_minutes} onChangeText={(v) => onPrescription('duration_minutes', v)} placeholder="10" keyboardType="numeric" compact />
          <Field label="DISTANCE M" value={item.prescription.distance_meters} onChangeText={(v) => onPrescription('distance_meters', v)} placeholder="optionnel" keyboardType="numeric" compact />
        </View>
      ) : (
        <Field
          label="PRESCRIPTION"
          value={item.prescription.text}
          onChangeText={(v) => onPrescription('text', v)}
          placeholder="ex. 3 tours · 10 reps"
        />
      )}
    </View>
  );
}

function ReviewStep({ validation, blocks, acceptWarnings, onAcceptWarnings, onEdit, onSaveLater, onStart, busy }) {
  const auto = validation?.auto_preparation;
  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.reviewHero, validation?.pass ? styles.reviewHeroOk : styles.reviewHeroBad]}>
        <Ionicons
          name={validation?.pass ? 'shield-checkmark-outline' : 'alert-circle-outline'}
          size={28}
          color={validation?.pass ? colors.primaryLight : colors.brandRed}
        />
        <View style={styles.flex}>
          <Text style={styles.reviewTitle}>{validation?.pass ? 'SÉANCE COHÉRENTE' : 'À CORRIGER'}</Text>
          <Text style={styles.muted}>
            {validation?.pass ? 'Ugerod a validé tes choix et préparé l’échauffement.' : 'Certains choix doivent être corrigés avant de démarrer.'}
          </Text>
        </View>
      </View>

      {auto?.blocks?.length ? (
        <View style={styles.autoPreview}>
          <Text style={styles.blockEyebrow}>AJOUTÉ AUTOMATIQUEMENT PAR UGEROD</Text>
          {(auto.blocks ?? []).map((block) => (
            <View key={block.module_code} style={styles.autoRow}>
              <Ionicons name={block.module_code === 'UNLOCK' ? 'body-outline' : 'flame-outline'} size={19} color={colors.primaryLight} />
              <View style={styles.flex}>
                <Text style={styles.autoTitle}>{block.title.toUpperCase()}</Text>
                <Text style={styles.muted}>{block.duration_minutes} min · {(block.exercises ?? []).map((e) => e.name).join(' · ')}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {validation?.duration_estimate ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>
            {validation.duration_estimate.estimated_minutes ?? '—'} / {validation.duration_estimate.available_minutes} MIN
          </Text>
          <Text style={styles.muted}>Estimation incluant la préparation automatique Ugerod.</Text>
        </View>
      ) : null}

      {errors.map((issue, index) => (
        <Issue key={`e-${index}`} issue={issue} tone="error" />
      ))}
      {warnings.map((issue, index) => (
        <Issue key={`w-${index}`} issue={issue} tone="warning" />
      ))}

      {warnings.length > 0 && validation?.pass ? (
        <Pressable onPress={() => onAcceptWarnings(!acceptWarnings)} style={[styles.acceptCard, acceptWarnings && styles.selectedCard]}>
          <Ionicons name={acceptWarnings ? 'checkbox' : 'square-outline'} size={21} color={acceptWarnings ? colors.primaryLight : colors.textMuted} />
          <Text style={styles.acceptText}>JE CONFIRME QUE JE VEUX CONSERVER MES CHOIX</Text>
        </Pressable>
      ) : null}

      <Pressable onPress={onEdit} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>MODIFIER MA SÉANCE</Text>
      </Pressable>
      <PrimaryButton label="COMMENCER MAINTENANT" onPress={onStart} loading={busy} disabled={!validation?.pass || (warnings.length > 0 && !acceptWarnings)} />
      <Pressable onPress={onSaveLater} disabled={busy || !validation?.pass || (warnings.length > 0 && !acceptWarnings)} style={styles.saveLaterButton}>
        <Text style={styles.saveLaterText}>ENREGISTRER POUR PLUS TARD</Text>
      </Pressable>
    </ScrollView>
  );
}

function ExercisePicker({ visible, query, onQuery, onSearch, results, loading, onSelect, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>AJOUTER UN EXERCICE</Text>
            <Pressable onPress={onClose}><Ionicons name="close" size={23} color={colors.textPrimary} /></Pressable>
          </View>
          <View style={styles.searchRow}>
            <TextInput value={query} onChangeText={onQuery} onSubmitEditing={onSearch} placeholder="Rechercher…" placeholderTextColor={colors.textMuted} style={styles.searchInput} />
            <Pressable onPress={onSearch} style={styles.searchButton}>
              <Ionicons name="search" size={20} color={colors.brandWhite} />
            </Pressable>
          </View>
          {loading ? <ActivityIndicator color={colors.primaryLight} style={styles.modalLoader} /> : null}
          <ScrollView contentContainerStyle={styles.results}>
            {results.map((exercise) => (
              <Pressable
                key={exercise.exercise_id}
                disabled={!exercise.selectable}
                onPress={() => onSelect(exercise)}
                style={[styles.resultCard, !exercise.selectable && styles.resultDisabled]}
              >
                <View style={styles.flex}>
                  <Text style={styles.resultTitle}>{exercise.name}</Text>
                  <Text style={styles.muted}>{[exercise.body_region, exercise.movement_pattern, exercise.difficulty].filter(Boolean).join(' · ')}</Text>
                  {(exercise.equipment ?? []).length ? (
                    <Text style={styles.resultEquipment}>{exercise.equipment.map((eq) => eq.name).join(' · ')}</Text>
                  ) : null}
                  {(exercise.warning_codes ?? []).length ? <Text style={styles.warningText}>⚠ À confirmer selon ton niveau</Text> : null}
                </View>
                <Ionicons name={exercise.selectable ? 'add-circle' : 'lock-closed-outline'} size={22} color={exercise.selectable ? colors.primaryLight : colors.textMuted} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function EquipmentChip({ item, selected, onPress, fullWidth = false }) {
  return (
    <Pressable onPress={onPress} style={[styles.equipmentChip, fullWidth && styles.fullWidth, selected && styles.equipmentChipSelected]}>
      <View style={styles.rowBetween}>
        <Text style={[styles.equipmentText, selected && styles.selectedText]}>{item.name.toUpperCase()}</Text>
        {selected ? <Ionicons name="checkmark-circle" size={19} color={colors.primaryLight} /> : null}
      </View>
      {item.detail ? <Text style={[styles.equipmentDetail, item.hasUnknownLoad && styles.warningText]}>{item.detail}</Text> : null}
    </Pressable>
  );
}

function InfoCard({ icon, title, text }) {
  return (
    <View style={styles.infoCard}>
      <View style={styles.infoIcon}><Ionicons name={icon} size={21} color={colors.primaryLight} /></View>
      <View style={styles.flex}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={styles.muted}>{text}</Text>
      </View>
    </View>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <View style={styles.sectionTitleWrap}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function Chip({ label, selected, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', compact = false }) {
  return (
    <View style={[styles.field, compact && styles.fieldCompact]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        style={styles.input}
      />
    </View>
  );
}

function PrimaryButton({ label, onPress, loading, disabled = false }) {
  return (
    <Pressable onPress={onPress} disabled={loading || disabled} style={[styles.primaryButton, disabled && styles.disabled]}>
      {loading ? <ActivityIndicator color={colors.brandWhite} /> : <>
        <Text style={styles.primaryButtonText}>{label}</Text>
        <Ionicons name="arrow-forward" size={20} color={colors.brandWhite} />
      </>}
    </Pressable>
  );
}

function Issue({ issue, tone }) {
  const errorTone = tone === 'error';
  return (
    <View style={[styles.issue, errorTone ? styles.issueError : styles.issueWarning]}>
      <Ionicons name={errorTone ? 'alert-circle-outline' : 'warning-outline'} size={19} color={errorTone ? colors.brandRed : '#F4B94E'} />
      <Text style={styles.issueText}>{getIssueText(issue)}</Text>
    </View>
  );
}

function ErrorBanner({ text }) {
  return (
    <View style={styles.errorBanner}>
      <Ionicons name="alert-circle-outline" size={19} color={colors.brandRed} />
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  centerText: { fontFamily: 'Oswald_600SemiBold', fontSize: 11, letterSpacing: 1, color: colors.textSecondary },
  header: { minHeight: 72, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  eyebrow: { fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 1.1, color: colors.textSecondary },
  title: { marginTop: 2, fontFamily: 'BebasNeue_400Regular', fontSize: 26, lineHeight: 29, letterSpacing: 1.3, color: colors.textPrimary },
  dot: { color: colors.primaryLight },
  stepBar: { paddingHorizontal: spacing.lg, paddingVertical: 13, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border },
  stepItem: { flex: 1, alignItems: 'center', gap: 5 },
  stepCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  stepCircleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepNumber: { fontFamily: 'Oswald_700Bold', fontSize: 9, color: colors.textMuted },
  stepNumberActive: { color: colors.brandWhite },
  stepLabel: { fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.6, color: colors.textMuted },
  stepLabelActive: { color: colors.textPrimary },
  content: { paddingHorizontal: spacing.lg, paddingTop: 18, paddingBottom: 44 },
  infoCard: { flexDirection: 'row', gap: 12, padding: 15, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(8,104,255,0.24)', backgroundColor: 'rgba(8,104,255,0.07)' },
  infoIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(8,104,255,0.12)' },
  infoTitle: { fontFamily: 'Oswald_700Bold', fontSize: 12, lineHeight: 16, letterSpacing: 0.7, color: colors.textPrimary, marginBottom: 4 },
  sectionTitleWrap: { marginTop: 27, marginBottom: 11 },
  sectionTitle: { fontFamily: 'Oswald_700Bold', fontSize: 13, letterSpacing: 0.8, color: colors.textPrimary },
  sectionSubtitle: { marginTop: 4, fontFamily: 'Oswald_400Regular', fontSize: 11, lineHeight: 16, color: colors.textMuted },
  environmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  environmentCard: { width: '48.5%', minHeight: 78, padding: 13, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 8 },
  environmentText: { fontFamily: 'Oswald_600SemiBold', fontSize: 11, color: colors.textSecondary },
  selectedCard: { borderColor: colors.primaryLight, backgroundColor: 'rgba(8,104,255,0.08)' },
  selectedText: { color: colors.primaryLight },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 38, paddingHorizontal: 13, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { borderColor: colors.primaryLight, backgroundColor: 'rgba(8,104,255,0.10)' },
  chipText: { fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 0.5, color: colors.textSecondary },
  formatCard: { marginBottom: 8, minHeight: 72, padding: 13, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
  formatTitle: { fontFamily: 'Oswald_700Bold', fontSize: 11, letterSpacing: 0.7, color: colors.textPrimary, marginBottom: 3 },
  muted: { fontFamily: 'Oswald_400Regular', fontSize: 11, lineHeight: 16, color: colors.textMuted },
  equipmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  equipmentChip: { width: '48.5%', minHeight: 64, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  equipmentChipSelected: { borderColor: colors.primaryLight, backgroundColor: 'rgba(8,104,255,0.08)' },
  fullWidth: { width: '100%' },
  equipmentText: { flex: 1, fontFamily: 'Oswald_600SemiBold', fontSize: 10, lineHeight: 14, color: colors.textSecondary },
  equipmentDetail: { marginTop: 7, fontFamily: 'Oswald_400Regular', fontSize: 10, color: colors.textMuted },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  inlineAction: { marginTop: 10, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  inlineActionText: { fontFamily: 'Oswald_700Bold', fontSize: 10, letterSpacing: 0.7, color: colors.primaryLight },
  injuryCard: { minHeight: 72, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
  injuryTitle: { fontFamily: 'Oswald_700Bold', fontSize: 11, letterSpacing: 0.5, color: colors.textPrimary, marginBottom: 3 },
  primaryButton: { minHeight: 56, marginTop: 28, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryButtonText: { fontFamily: 'BebasNeue_400Regular', fontSize: 20, letterSpacing: 1.1, color: colors.brandWhite },
  disabled: { opacity: 0.45 },
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  moduleCard: { width: '48.5%', minHeight: 104, padding: 13, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  moduleTitle: { marginTop: 9, fontFamily: 'Oswald_700Bold', fontSize: 11, color: colors.textPrimary },
  moduleSubtitle: { marginTop: 3, fontFamily: 'Oswald_400Regular', fontSize: 10, lineHeight: 14, color: colors.textMuted },
  emptyCard: { marginTop: 18, padding: 22, alignItems: 'center', gap: 8, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
  emptyTitle: { fontFamily: 'Oswald_700Bold', fontSize: 11, letterSpacing: 0.7, color: colors.textSecondary },
  blockCard: { marginTop: 18, padding: 15, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  blockHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  blockEyebrow: { fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.8, color: colors.primaryLight },
  blockTitle: { marginTop: 2, fontFamily: 'BebasNeue_400Regular', fontSize: 23, color: colors.textPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallButton: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  field: { marginTop: 13 },
  fieldCompact: { width: '48%' },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  fieldLabel: { marginBottom: 6, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.6, color: colors.textMuted },
  input: { minHeight: 42, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.textPrimary, fontFamily: 'Oswald_400Regular', fontSize: 13 },
  exerciseCard: { marginTop: 13, padding: 13, borderRadius: 14, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  exerciseHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  exerciseName: { fontFamily: 'Oswald_700Bold', fontSize: 12, color: colors.textPrimary },
  addExerciseButton: { marginTop: 13, minHeight: 43, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  addExerciseText: { fontFamily: 'Oswald_700Bold', fontSize: 10, letterSpacing: 0.7, color: colors.primaryLight },
  reviewHero: { padding: 16, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  reviewHeroOk: { borderColor: 'rgba(8,104,255,0.30)', backgroundColor: 'rgba(8,104,255,0.07)' },
  reviewHeroBad: { borderColor: 'rgba(255,59,59,0.30)', backgroundColor: 'rgba(255,59,59,0.06)' },
  reviewTitle: { fontFamily: 'Oswald_700Bold', fontSize: 13, letterSpacing: 0.7, color: colors.textPrimary, marginBottom: 4 },
  autoPreview: { marginTop: 16, padding: 15, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  autoRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  autoTitle: { fontFamily: 'Oswald_700Bold', fontSize: 11, color: colors.textPrimary },
  summaryCard: { marginTop: 16, padding: 15, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  summaryValue: { fontFamily: 'BebasNeue_400Regular', fontSize: 25, color: colors.textPrimary, marginBottom: 4 },
  issue: { marginTop: 10, padding: 13, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1 },
  issueError: { borderColor: 'rgba(255,59,59,0.24)', backgroundColor: 'rgba(255,59,59,0.05)' },
  issueWarning: { borderColor: 'rgba(244,185,78,0.24)', backgroundColor: 'rgba(244,185,78,0.05)' },
  issueText: { flex: 1, fontFamily: 'Oswald_400Regular', fontSize: 11, lineHeight: 16, color: colors.textSecondary },
  acceptCard: { marginTop: 14, minHeight: 56, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 },
  acceptText: { flex: 1, fontFamily: 'Oswald_700Bold', fontSize: 10, letterSpacing: 0.5, color: colors.textSecondary },
  secondaryButton: { minHeight: 48, marginTop: 20, borderRadius: 13, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontFamily: 'Oswald_700Bold', fontSize: 11, letterSpacing: 0.7, color: colors.textSecondary },
  saveLaterButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  saveLaterText: { fontFamily: 'Oswald_700Bold', fontSize: 10, letterSpacing: 0.7, color: colors.textSecondary },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.62)' },
  modalSheet: { maxHeight: '84%', minHeight: '66%', padding: 17, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontFamily: 'BebasNeue_400Regular', fontSize: 24, color: colors.textPrimary },
  searchRow: { marginTop: 15, flexDirection: 'row', gap: 8 },
  searchInput: { flex: 1, minHeight: 44, borderRadius: 12, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.textPrimary },
  searchButton: { width: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  modalLoader: { marginTop: 18 },
  results: { paddingTop: 14, paddingBottom: 36 },
  resultCard: { minHeight: 74, padding: 13, marginBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultDisabled: { opacity: 0.42 },
  resultTitle: { fontFamily: 'Oswald_700Bold', fontSize: 12, color: colors.textPrimary },
  resultEquipment: { marginTop: 3, fontFamily: 'Oswald_400Regular', fontSize: 10, color: colors.primaryLight },
  warningText: { marginTop: 3, fontFamily: 'Oswald_500Medium', fontSize: 10, color: '#F4B94E' },
  errorBanner: { marginHorizontal: spacing.lg, marginTop: 10, padding: 12, borderRadius: 13, backgroundColor: 'rgba(255,59,59,0.06)', borderWidth: 1, borderColor: 'rgba(255,59,59,0.22)', flexDirection: 'row', alignItems: 'center', gap: 9 },
  errorText: { flex: 1, fontFamily: 'Oswald_400Regular', fontSize: 11, lineHeight: 16, color: colors.textSecondary },
});
