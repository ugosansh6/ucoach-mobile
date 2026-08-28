import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
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
  suggestUserSessionBuilderWodDuration,
  updateUserSessionDraftContext,
  validateUserSessionDraft,
} from '../../src/services/userSessionBuilderService';

const DURATIONS = [20, 30, 45, 60, 75, 90];
const AUTO_MODULES = new Set(['UNLOCK', 'WARMUP']);
const LOAD_CAPABLE_EQUIPMENT_IDS = new Set(['E03', 'E04', 'E09', 'E14']);
const PRIMARY_WOD_MECHANICS = new Set(['AMRAP', 'FOR_TIME', 'EMOM', 'CIRCUIT']);

const CONDITIONING_MODES = [
  {
    mechanic_key: 'RUN_CONTINUOUS',
    label_fr: 'Allure modérée',
    description_fr: 'Course continue à un rythme confortable : tu peux encore parler.',
    requires_intervals: false,
  },
  {
    mechanic_key: 'RUN_INTERVALS',
    label_fr: 'Intervalles',
    description_fr: 'Alterne des temps d’effort et de récupération que tu définis.',
    requires_intervals: true,
  },
  {
    mechanic_key: 'RUN_FARTLEK',
    label_fr: 'Fartlek',
    description_fr: 'Alterne des phases plus vives et des phases à allure modérée.',
    requires_intervals: true,
  },
];

const RUNNING_FAMILY_BY_MECHANIC = {
  RUN_CONTINUOUS: 'EASY_CONTINUOUS',
  RUN_INTERVALS: 'MEDIUM_INTERVALS',
  RUN_FARTLEK: 'GUIDED_FARTLEK',
};

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
  TABATA: ['Tabata', '4 min · 20 s / 10 s', 'timer-outline'],
  TABATA_ABS: ['Tabata abdos', 'Core court et rythmé', 'timer-outline'],
  CORE: ['Core', 'Travail du tronc', 'ellipse-outline'],
  SKILL: ['Skill / Gym', 'Technique ou compétence', 'navigate-outline'],
  GYM: ['Gym', 'Gymnastique', 'accessibility-outline'],
  STRENGTH: ['Musculation', 'Séries · reps · charge · repos', 'barbell-outline'],
  WOD: ['WOD', 'AMRAP · For Time · EMOM · Circuit', 'flash-outline'],
  CARDIO: ['Cardio', 'Machine ou effort continu', 'heart-outline'],
  CONDITIONING: ['Conditioning', 'Course · intervalles · fartlek', 'pulse-outline'],
};

const TRAINING_FILTERS = [
  ['ALL', 'TOUS'],
  ['STRENGTH', 'STRENGTH'],
  ['CONDITIONING', 'CONDITIONING'],
  ['SKILL', 'SKILL'],
];

const REGION_FILTERS = [
  ['ALL', 'TOUT'],
  ['UPPER', 'UPPER'],
  ['LOWER', 'LOWER'],
  ['CORE', 'CORE'],
  ['FULL_BODY', 'FULL BODY'],
];

const ISSUE_LABELS = {
  PRESCRIPTION_INCOMPLETE: 'La prescription de cet exercice est incomplète.',
  PRESCRIPTION_NUMERIC_FIELD_INVALID: 'Une valeur de prescription doit être un nombre valide.',
  SUPERSET_GROUP_REQUIRED: 'Chaque exercice d’un superset doit appartenir à une paire.',
  SUPERSET_GROUP_MUST_BE_PAIRED: 'Un superset doit contenir exactement deux exercices par groupe.',
  DURATION_EXCEEDS_AVAILABLE_TIME: 'La séance dépasse le temps disponible.',
  DURATION_ESTIMATE_PARTIAL: 'Certaines durées ne sont pas renseignées : l’estimation reste partielle.',
  AUTO_PREPARATION_UNAVAILABLE: 'UGEROD ne trouve pas de préparation sûre avec ce contexte.',
  SESSION_HAS_NO_BLOCKS: 'Ajoute au moins un bloc à ta séance.',
  SESSION_HAS_NO_EXERCISES: 'Ajoute au moins un exercice à ta séance.',
  BLOCK_EMPTY: 'Un bloc ne contient encore aucun exercice.',
  DUPLICATE_EXERCISE: 'Un même exercice apparaît plusieurs fois dans la séance.',
  MODULE_NOT_ALLOWED: 'Ce type de bloc n’est pas disponible dans ce contexte.',
  CONDITIONING_MODE_REQUIRED: 'Choisis un type de conditioning.',
  CONDITIONING_MODE_NOT_AVAILABLE: 'Ce type de conditioning n’est pas disponible ici.',
  RUNNING_CONDITIONING_REQUIRES_COURSE: 'Ce mode de conditioning utilise la course comme mouvement de référence.',
  RUNNING_INTERVAL_STRUCTURE_REQUIRED: 'Renseigne le nombre de répétitions, le temps d’effort et la récupération.',
  RUNNING_BLOCK_TOO_SHORT: 'Prévois au moins 8 minutes pour ce bloc de course.',
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

function defaultWodMechanic(wodMechanics) {
  const available = wodMechanics ?? [];
  return (
    available.find((item) => item.mechanic_key === 'AMRAP')?.mechanic_key ??
    available[0]?.mechanic_key ??
    'AMRAP'
  );
}

function createBlock(moduleCode, gymStyles, wodMechanics) {
  const defaultStyle =
    moduleCode === 'STRENGTH'
      ? gymStyles.find((item) => item.is_default)?.style_code ?? 'CLASSIC_SETS'
      : null;

  const settings = {};
  let duration = '';

  if (moduleCode === 'WOD') {
    settings.mechanic_key = defaultWodMechanic(wodMechanics);
  }
  if (moduleCode === 'CONDITIONING') {
    settings.mechanic_key = 'RUN_CONTINUOUS';
  }
  if (moduleCode === 'TABATA' || moduleCode === 'TABATA_ABS') {
    settings.rounds = 8;
    settings.work_seconds = 20;
    settings.rest_seconds = 10;
    duration = '4';
  }

  return {
    clientId: `${moduleCode}-${Date.now()}-${Math.random()}`,
    module_code: moduleCode,
    title: MODULE_META[moduleCode]?.[0] ?? moduleCode,
    execution_style: defaultStyle,
    duration_minutes: duration,
    settings,
    items: [],
  };
}

function semanticExerciseText(item) {
  const p = item.prescription ?? {};
  const reps = toNumber(p.reps);
  const seconds = toNumber(p.duration_seconds);
  const distance = toNumber(p.distance_meters);
  const load = toNumber(p.load_kg);
  const sets = toNumber(p.sets);
  const rest = toNumber(p.rest_seconds);

  return [
    sets != null ? `${sets} séries` : null,
    reps != null ? `${reps} reps` : null,
    seconds != null ? `${seconds} s` : null,
    distance != null ? `${distance} m` : null,
    load != null ? `${load} kg` : null,
    rest != null ? `repos ${rest} s` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function conditioningTotalSeconds(block) {
  const mechanic = block.settings?.mechanic_key;
  if (mechanic === 'RUN_CONTINUOUS') {
    const minutes = toNumber(block.duration_minutes);
    return minutes != null ? Math.round(minutes * 60) : null;
  }

  const repeats = toNumber(block.settings?.repeats);
  const work = toNumber(block.settings?.work_seconds);
  const recovery = toNumber(block.settings?.recovery_seconds);
  if (repeats == null || work == null || recovery == null) return null;
  return Math.round(repeats * (work + recovery));
}

function buildPrescription(block, item) {
  const source = item.prescription ?? {};
  const prescription = {};
  const numericKeys = [
    'sets',
    'reps',
    'load_kg',
    'rest_seconds',
    'duration_seconds',
    'duration_minutes',
    'distance_meters',
  ];

  for (const key of numericKeys) {
    const value = toNumber(source[key]);
    if (value != null) prescription[key] = value;
  }

  if (block.module_code === 'TABATA' || block.module_code === 'TABATA_ABS') {
    prescription.work_seconds = 20;
    prescription.duration_seconds = 20;
    prescription.text = '20 s travail';
    prescription.protocol = {
      rounds: 8,
      work_seconds: 20,
      rest_seconds: 10,
    };
    return prescription;
  }

  if (block.module_code === 'CONDITIONING') {
    const mechanic = block.settings?.mechanic_key ?? null;
    const totalSeconds = conditioningTotalSeconds(block);
    const mode = CONDITIONING_MODES.find((entry) => entry.mechanic_key === mechanic);

    prescription.mechanic = mechanic;
    prescription.running_family_code = RUNNING_FAMILY_BY_MECHANIC[mechanic] ?? null;
    if (totalSeconds != null) prescription.duration_seconds = totalSeconds;
    prescription.text = totalSeconds != null
      ? `${Math.round((totalSeconds / 60) * 10) / 10} min · ${mode?.label_fr ?? 'Conditioning'}`
      : mode?.label_fr ?? 'Conditioning';

    return Object.fromEntries(
      Object.entries(prescription).filter(([, value]) => value != null && value !== '')
    );
  }

  const semantic = semanticExerciseText(item);
  const customText = String(source.text ?? '').trim();
  prescription.text = customText || semantic || null;

  if (block.module_code === 'WOD') {
    prescription.block_parameters = {
      ...(block.settings ?? {}),
      duration_minutes: toNumber(block.duration_minutes),
    };
  }

  return Object.fromEntries(
    Object.entries(prescription).filter(([, value]) => value != null && value !== '')
  );
}

function serializeBlocks(blocks) {
  return blocks.map((block) => ({
    module_code: block.module_code,
    title: block.title,
    execution_style: block.module_code === 'STRENGTH' ? block.execution_style : null,
    duration_minutes: toNumber(block.duration_minutes),
    settings: Object.fromEntries(
      Object.entries(block.settings ?? {}).map(([key, value]) => {
        const numeric = toNumber(value);
        return [key, numeric != null && key !== 'mechanic_key' ? numeric : value];
      })
    ),
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

function exerciseFromResult(exercise) {
  const trackingModes = Array.isArray(exercise.tracking_modes)
    ? exercise.tracking_modes
    : [];
  return {
    clientId: `${exercise.exercise_id}-${Date.now()}-${Math.random()}`,
    exercise_id: exercise.exercise_id,
    exercise_name: exercise.name,
    body_region: exercise.body_region,
    movement_pattern: exercise.movement_pattern,
    exercise_family: exercise.exercise_family,
    training_categories: exercise.training_categories ?? [],
    tracking_modes: trackingModes,
    prescription_type: exercise.prescription_type ?? null,
    warning_codes: exercise.warning_codes ?? [],
    prescription: {
      text: '',
      sets: '',
      reps: '',
      load_kg: '',
      rest_seconds: '',
      duration_seconds: '',
      duration_minutes: '',
      distance_meters: '',
    },
    notes: '',
  };
}

function findIssueExercise(issue, blocks) {
  if (!issue?.exercise_id) return null;
  return blocks
    .flatMap((block) => block.items ?? [])
    .find((item) => item.exercise_id === issue.exercise_id) ?? null;
}

function issueText(issue, blocks) {
  const code = issue?.code ?? 'UNKNOWN';
  const item = findIssueExercise(issue, blocks);
  const name = item?.exercise_name ?? 'Cet exercice';
  const details = Array.isArray(issue?.details) ? issue.details : [];

  if (code === 'EXERCISE_CAPABILITY_OR_USAGE_WARNING') {
    const capability = details.some((detail) =>
      ['CAPABILITY_COMPLEXITY_EXCEEDED', 'CAPABILITY_DIFFICULTY_EXCEEDED'].includes(detail)
    );
    const usage = details.includes('UNSUPPORTED_USAGE');

    if (capability && usage) {
      return `${name} : UGEROD manque encore de repères sur ton niveau et cet usage est inhabituel dans ce bloc. Garde-le seulement si ce choix est volontaire et maîtrisé.`;
    }
    if (capability) {
      return `${name} : ton niveau sur cet exercice n’est pas encore suffisamment documenté. Tu peux le garder si tu sais qu’il te convient.`;
    }
    if (usage) {
      return `${name} : cet exercice est inhabituel dans ce type de bloc. Tu peux le garder si c’est volontaire.`;
    }
    return `${name} : UGEROD te demande simplement de confirmer ce choix.`;
  }

  if (code === 'EXERCISE_HARD_GATE_FAILED') {
    const reasonCodes = issue?.details?.resolver?.exclusion_reason_codes ?? [];
    if (reasonCodes.includes('EQUIPMENT_MISSING_OR_INCOMPATIBLE')) {
      return `${name} : il manque le matériel nécessaire aujourd’hui.`;
    }
    if (reasonCodes.includes('PAIN_CONFLICT')) {
      return `${name} : cet exercice entre en conflit avec une zone à protéger.`;
    }
    return `${name} n’est pas compatible avec ton contexte actuel.`;
  }

  if (code === 'EXERCISE_MODULE_MISMATCH') {
    return `${name} n’est pas prévu pour ce type de bloc.`;
  }

  return ISSUE_LABELS[code] ?? 'UGEROD a détecté un point à vérifier dans cette séance.';
}

function mechanicTitle(block) {
  if (block.module_code !== 'WOD') return block.title;
  const key = block.settings?.mechanic_key;
  return key === 'FOR_TIME' ? 'FOR TIME' : key ?? 'WOD';
}

function moveInArray(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function UserSessionBuilderV3() {
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
  const [trainingFilter, setTrainingFilter] = useState('ALL');
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
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
  const wodMechanics = (bootstrap?.wod_mechanics ?? []).filter((item) =>
    PRIMARY_WOD_MECHANICS.has(item.mechanic_key)
  );
  const conditioningModes = bootstrap?.outdoor_conditioning_modes?.length
    ? bootstrap.outdoor_conditioning_modes
    : CONDITIONING_MODES;

  const manualMinutes = blocks.reduce(
    (total, block) => total + (toNumber(block.duration_minutes) ?? 0),
    0
  );

  async function handleEnvironment(nextEnvironment) {
    if (nextEnvironment === environmentCode) return;
    try {
      setBusy(true);
      setEnvironmentCode(nextEnvironment);
      setSurfaceCode(null);
      setValidation(null);
      setBlocks([]);
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
      if (!draftId) {
        const draft = await createUserSessionDraft({
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
        await updateUserSessionDraftContext({
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

  async function addBlock(moduleCode) {
    if (blocks.some((block) => block.module_code === moduleCode)) return;
    const nextBlock = createBlock(moduleCode, gymStyles, wodMechanics);

    if (moduleCode === 'WOD' && draftId) {
      try {
        const suggestion = await suggestUserSessionBuilderWodDuration(draftId);
        if (suggestion?.recommended_minutes) {
          nextBlock.duration_minutes = String(suggestion.recommended_minutes);
        }
      } catch {
        // Le WOD reste éditable même si la suggestion de durée n'est pas disponible.
      }
    }

    if (moduleCode === 'CONDITIONING' && environmentCode === 'OUTDOOR') {
      const runningExercise = bootstrap?.outdoor_conditioning_exercise;
      if (runningExercise?.exercise_id) {
        nextBlock.items = [exerciseFromResult(runningExercise)];
      }
    }

    setBlocks((current) => [...current, nextBlock]);
  }

  function patchBlock(index, patch) {
    setBlocks((current) => current.map((block, i) => (i === index ? { ...block, ...patch } : block)));
  }

  function patchBlockSettings(index, patch) {
    setBlocks((current) =>
      current.map((block, i) =>
        i === index
          ? { ...block, settings: { ...(block.settings ?? {}), ...patch } }
          : block
      )
    );
  }

  function removeBlock(index) {
    setBlocks((current) => current.filter((_, i) => i !== index));
  }

  function reorderBlock(index, offset) {
    setBlocks((current) => {
      const target = Math.max(0, Math.min(current.length - 1, index + offset));
      return moveInArray(current, index, target);
    });
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

  function reorderItem(blockIndex, itemIndex, offset) {
    setBlocks((current) =>
      current.map((block, b) => {
        if (b !== blockIndex) return block;
        const target = Math.max(0, Math.min(block.items.length - 1, itemIndex + offset));
        return { ...block, items: moveInArray(block.items, itemIndex, target) };
      })
    );
  }

  async function loadExercises(
    blockIndex,
    {
      query = exerciseQuery,
      category = trainingFilter,
      region = regionFilter,
      unavailable = includeUnavailable,
    } = {}
  ) {
    const block = blocks[blockIndex];
    if (!draftId || !block) return;
    try {
      setExerciseLoading(true);
      const response = await getUserSessionBuilderExercises({
        draftId,
        moduleCode: block.module_code,
        query: query.trim() || null,
        limit: 100,
        trainingCategory: category === 'ALL' ? null : category,
        bodyRegion: region === 'ALL' ? null : region,
        includeUnavailable: unavailable,
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
    setTrainingFilter('ALL');
    setRegionFilter('ALL');
    setIncludeUnavailable(false);
    setExerciseResults([]);
    setPickerVisible(true);
    loadExercises(blockIndex, {
      query: '',
      category: 'ALL',
      region: 'ALL',
      unavailable: false,
    });
  }

  function selectExercise(exercise) {
    if (pickerBlockIndex == null || !exercise?.selectable) return;
    setBlocks((current) =>
      current.map((block, blockIndex) => {
        if (blockIndex !== pickerBlockIndex) return block;
        if (block.items.some((item) => item.exercise_id === exercise.exercise_id)) return block;
        return {
          ...block,
          items: [...block.items, exerciseFromResult(exercise)],
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

  function addSuggestedTabata() {
    if (blocks.some((block) => block.module_code === 'TABATA')) {
      setStep('build');
      return;
    }
    const block = createBlock('TABATA', gymStyles, wodMechanics);
    setBlocks((current) => [...current, block]);
    setValidation(null);
    setStep('build');
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
            wodMechanics={wodMechanics}
            conditioningModes={conditioningModes}
            sessionMinutes={durationMinutes}
            manualMinutes={manualMinutes}
            onAddBlock={addBlock}
            onPatchBlock={patchBlock}
            onPatchBlockSettings={patchBlockSettings}
            onRemoveBlock={removeBlock}
            onReorderBlock={reorderBlock}
            onAddExercise={openPicker}
            onPatchPrescription={patchPrescription}
            onRemoveItem={removeItem}
            onReorderItem={reorderItem}
            onValidate={handleValidate}
            busy={busy}
          />
        ) : (
          <ReviewStep
            validation={validation}
            blocks={blocks}
            editableModules={editableModules}
            acceptWarnings={acceptWarnings}
            onAcceptWarnings={setAcceptWarnings}
            onEdit={() => setStep('build')}
            onAddTabata={addSuggestedTabata}
            onSaveLater={() => handleCommit(false)}
            onStart={() => handleCommit(true)}
            busy={busy}
          />
        )}

        <ExercisePicker
          visible={pickerVisible}
          query={exerciseQuery}
          onQuery={setExerciseQuery}
          trainingFilter={trainingFilter}
          onTrainingFilter={(value) => {
            setTrainingFilter(value);
            loadExercises(pickerBlockIndex, { category: value });
          }}
          regionFilter={regionFilter}
          onRegionFilter={(value) => {
            setRegionFilter(value);
            loadExercises(pickerBlockIndex, { region: value });
          }}
          includeUnavailable={includeUnavailable}
          onIncludeUnavailable={(value) => {
            setIncludeUnavailable(value);
            loadExercises(pickerBlockIndex, { unavailable: value });
          }}
          onSearch={() => loadExercises(pickerBlockIndex)}
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
        title="TU CHOISIS LE CŒUR, UGEROD COMPLÈTE"
        text="Choisis tes blocs, ton format et tes exercices. UGEROD prépare ensuite l’Unlock, l’échauffement et contrôle la cohérence."
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
          <SectionTitle title="SURFACE" />
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

      <SectionTitle title="MATÉRIEL DU JOUR" subtitle="Uniquement ton matériel de profil. Le lieu ne rajoute aucun équipement automatiquement." />
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
  wodMechanics,
  conditioningModes,
  sessionMinutes,
  manualMinutes,
  onAddBlock,
  onPatchBlock,
  onPatchBlockSettings,
  onRemoveBlock,
  onReorderBlock,
  onAddExercise,
  onPatchPrescription,
  onRemoveItem,
  onReorderItem,
  onValidate,
  busy,
}) {
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <InfoCard
        icon="sparkles-outline"
        title="CONSTRUIS SEULEMENT CE QUE TU VEUX FAIRE"
        text={
          automaticModules.length > 1
            ? 'Unlock et échauffement sont ajoutés automatiquement. Tu peux te concentrer sur le Skill, le WOD, la musculation ou le conditioning.'
            : 'UGEROD complète automatiquement la préparation à partir de tes choix.'
        }
      />

      <View style={styles.timeBudgetCard}>
        <View>
          <Text style={styles.timeBudgetValue}>{manualMinutes} MIN</Text>
          <Text style={styles.muted}>de blocs construits sur {sessionMinutes} min disponibles</Text>
        </View>
        <Ionicons name="time-outline" size={24} color={colors.primaryLight} />
      </View>

      <SectionTitle title="AJOUTER UN BLOC" subtitle="Un seul bloc de chaque type suffit : mets plusieurs exercices dedans." />
      <View style={styles.moduleGrid}>
        {editableModules.map((moduleCode) => {
          const meta = MODULE_META[moduleCode] ?? [moduleCode, '', 'add-circle-outline'];
          const added = blocks.some((block) => block.module_code === moduleCode);
          return (
            <Pressable
              key={moduleCode}
              disabled={added}
              onPress={() => onAddBlock(moduleCode)}
              style={[styles.moduleCard, added && styles.moduleCardAdded]}
            >
              <Ionicons name={added ? 'checkmark-circle' : meta[2]} size={22} color={added ? colors.textMuted : colors.primaryLight} />
              <Text style={[styles.moduleTitle, added && styles.mutedText]}>{meta[0].toUpperCase()}</Text>
              <Text style={styles.moduleSubtitle}>{added ? 'AJOUTÉ' : meta[1]}</Text>
            </Pressable>
          );
        })}
      </View>

      {blocks.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="add-circle-outline" size={25} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>COMMENCE PAR CE QUE TU VEUX FAIRE</Text>
          <Text style={styles.muted}>Par exemple : un Skill puis un AMRAP. UGEROD se charge de la préparation.</Text>
        </View>
      ) : null}

      {blocks.map((block, blockIndex) => (
        <DraggableBlock
          key={block.clientId}
          block={block}
          index={blockIndex}
          total={blocks.length}
          gymStyles={gymStyles}
          wodMechanics={wodMechanics}
          conditioningModes={conditioningModes}
          onPatch={(patch) => onPatchBlock(blockIndex, patch)}
          onSettings={(patch) => onPatchBlockSettings(blockIndex, patch)}
          onRemove={() => onRemoveBlock(blockIndex)}
          onReorder={(offset) => onReorderBlock(blockIndex, offset)}
          onAddExercise={() => onAddExercise(blockIndex)}
          onPatchPrescription={(itemIndex, key, value) => onPatchPrescription(blockIndex, itemIndex, key, value)}
          onRemoveItem={(itemIndex) => onRemoveItem(blockIndex, itemIndex)}
          onReorderItem={(itemIndex, offset) => onReorderItem(blockIndex, itemIndex, offset)}
        />
      ))}

      <PrimaryButton label="CONTRÔLER MA SÉANCE" onPress={onValidate} loading={busy} disabled={blocks.length === 0} />
    </ScrollView>
  );
}

function DraggableBlock({
  block,
  index,
  total,
  gymStyles,
  wodMechanics,
  conditioningModes,
  onPatch,
  onSettings,
  onRemove,
  onReorder,
  onAddExercise,
  onPatchPrescription,
  onRemoveItem,
  onReorderItem,
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
        onPanResponderMove: Animated.event([null, { dy: translateY }], { useNativeDriver: false }),
        onPanResponderRelease: (_, gesture) => {
          const rawOffset = Math.round(gesture.dy / 130);
          const maxUp = -index;
          const maxDown = total - index - 1;
          const offset = Math.max(maxUp, Math.min(maxDown, rawOffset));
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
          if (offset !== 0) onReorder(offset);
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [index, total, onReorder, translateY]
  );

  const isConditioning = block.module_code === 'CONDITIONING';

  return (
    <Animated.View style={[styles.blockCard, { transform: [{ translateY }] }]}>
      <View style={styles.blockHeader}>
        <View style={styles.flex}>
          <Text style={styles.blockEyebrow}>BLOC {String(index + 1).padStart(2, '0')}</Text>
          <Text style={styles.blockTitle}>{mechanicTitle(block).toUpperCase()}</Text>
        </View>
        <View style={styles.blockActions}>
          <View {...panResponder.panHandlers} style={styles.dragHandle}>
            <Ionicons name="reorder-three-outline" size={24} color={colors.textSecondary} />
          </View>
          <Pressable onPress={onRemove} style={styles.smallButton}>
            <Ionicons name="trash-outline" size={18} color={colors.brandRed} />
          </Pressable>
        </View>
      </View>
      <Text style={styles.dragHint}>MAINTIENS ≡ ET GLISSE POUR DÉPLACER LE BLOC</Text>

      {block.module_code === 'WOD' ? (
        <WodSettingsEditor
          block={block}
          wodMechanics={wodMechanics}
          onPatch={onPatch}
          onSettings={onSettings}
        />
      ) : isConditioning ? (
        <ConditioningSettingsEditor
          block={block}
          modes={conditioningModes}
          onPatch={onPatch}
          onSettings={onSettings}
        />
      ) : block.module_code === 'STRENGTH' && gymStyles.length ? (
        <>
          <Text style={styles.fieldLabel}>STRUCTURE</Text>
          <View style={styles.chips}>
            {gymStyles.map((style) => (
              <Chip
                key={style.style_code}
                label={style.label_fr.toUpperCase()}
                selected={block.execution_style === style.style_code}
                onPress={() => onPatch({ execution_style: style.style_code })}
              />
            ))}
          </View>
          <Field
            label="DURÉE DU BLOC (OPTIONNELLE)"
            value={block.duration_minutes}
            onChangeText={(value) => onPatch({ duration_minutes: value })}
            placeholder="ex. 20"
            keyboardType="numeric"
          />
        </>
      ) : block.module_code === 'TABATA' || block.module_code === 'TABATA_ABS' ? (
        <View style={styles.fixedProtocolCard}>
          <Ionicons name="timer-outline" size={20} color={colors.primaryLight} />
          <View style={styles.flex}>
            <Text style={styles.fixedProtocolTitle}>8 ROUNDS · 20 S / 10 S · 4 MIN</Text>
            <Text style={styles.muted}>Choisis simplement les exercices. UGEROD gère le chrono.</Text>
          </View>
        </View>
      ) : (
        <Field
          label="DURÉE DU BLOC (OPTIONNELLE)"
          value={block.duration_minutes}
          onChangeText={(value) => onPatch({ duration_minutes: value })}
          placeholder="ex. 10"
          keyboardType="numeric"
        />
      )}

      {isConditioning ? (
        <View style={styles.fixedProtocolCard}>
          <Ionicons name="walk-outline" size={20} color={colors.primaryLight} />
          <View style={styles.flex}>
            <Text style={styles.fixedProtocolTitle}>COURSE</Text>
            <Text style={styles.muted}>UGEROD utilise le mouvement Course pour ce bloc et enregistre uniquement ce que tu réalises.</Text>
          </View>
        </View>
      ) : (
        block.items.map((item, itemIndex) => (
          <ExerciseEditor
            key={item.clientId}
            block={block}
            item={item}
            itemIndex={itemIndex}
            itemCount={block.items.length}
            onPrescription={(key, value) => onPatchPrescription(itemIndex, key, value)}
            onRemove={() => onRemoveItem(itemIndex)}
            onReorder={(offset) => onReorderItem(itemIndex, offset)}
          />
        ))
      )}

      {!isConditioning ? (
        <Pressable onPress={onAddExercise} style={styles.addExerciseButton}>
          <Ionicons name="add" size={20} color={colors.primaryLight} />
          <Text style={styles.addExerciseText}>AJOUTER UN EXERCICE</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

function ConditioningSettingsEditor({ block, modes, onPatch, onSettings }) {
  const mechanic = block.settings?.mechanic_key ?? 'RUN_CONTINUOUS';
  const mode = modes.find((entry) => entry.mechanic_key === mechanic) ?? modes[0];
  const intervalMode = mechanic === 'RUN_INTERVALS' || mechanic === 'RUN_FARTLEK';

  function selectMode(next) {
    onSettings({
      mechanic_key: next,
      repeats: '',
      work_seconds: '',
      recovery_seconds: '',
    });
    onPatch({ duration_minutes: '' });
  }

  function patchInterval(key, value) {
    const next = {
      ...(block.settings ?? {}),
      [key]: value,
    };
    onSettings({ [key]: value });

    const repeats = toNumber(next.repeats);
    const work = toNumber(next.work_seconds);
    const recovery = toNumber(next.recovery_seconds);
    if (repeats != null && work != null && recovery != null) {
      const totalMinutes = Math.ceil((repeats * (work + recovery)) / 60);
      onPatch({ duration_minutes: String(totalMinutes) });
    } else {
      onPatch({ duration_minutes: '' });
    }
  }

  return (
    <View>
      <Text style={styles.fieldLabel}>TYPE DE CONDITIONING</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mechanicRow}>
        {modes.map((entry) => (
          <Chip
            key={entry.mechanic_key}
            label={entry.label_fr.toUpperCase()}
            selected={mechanic === entry.mechanic_key}
            onPress={() => selectMode(entry.mechanic_key)}
          />
        ))}
      </ScrollView>

      {mode?.description_fr ? (
        <Text style={styles.mechanicDescription}>{mode.description_fr}</Text>
      ) : null}

      {!intervalMode ? (
        <Field
          label="DURÉE TOTALE"
          value={block.duration_minutes}
          onChangeText={(value) => onPatch({ duration_minutes: value })}
          placeholder="ex. 20"
          keyboardType="numeric"
        />
      ) : (
        <>
          <View style={styles.fieldGrid}>
            <Field
              label={mechanic === 'RUN_FARTLEK' ? 'RELANCES' : 'RÉPÉTITIONS'}
              value={String(block.settings?.repeats ?? '')}
              onChangeText={(value) => patchInterval('repeats', value)}
              placeholder="ex. 5"
              keyboardType="numeric"
              compact
            />
            <Field
              label={mechanic === 'RUN_FARTLEK' ? 'PHASE VIVE S' : 'EFFORT S'}
              value={String(block.settings?.work_seconds ?? '')}
              onChangeText={(value) => patchInterval('work_seconds', value)}
              placeholder="ex. 120"
              keyboardType="numeric"
              compact
            />
            <Field
              label={mechanic === 'RUN_FARTLEK' ? 'ALLURE MODÉRÉE S' : 'RÉCUPÉRATION S'}
              value={String(block.settings?.recovery_seconds ?? '')}
              onChangeText={(value) => patchInterval('recovery_seconds', value)}
              placeholder="ex. 60"
              keyboardType="numeric"
              compact
            />
            <View style={[styles.field, styles.fieldCompact]}>
              <Text style={styles.fieldLabel}>DURÉE CALCULÉE</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyValue}>{block.duration_minutes ? `${block.duration_minutes} MIN` : '—'}</Text>
              </View>
            </View>
          </View>
        </>
      )}

      <View style={styles.semanticHint}>
        <Ionicons name="analytics-outline" size={18} color={colors.primaryLight} />
        <Text style={styles.semanticHintText}>LA DISTANCE EST OPTIONNELLE · UGEROD APPREND SUR LE TEMPS RÉELLEMENT EFFECTUÉ</Text>
      </View>
    </View>
  );
}

function WodSettingsEditor({ block, wodMechanics, onPatch, onSettings }) {
  const mechanic = block.settings?.mechanic_key ?? 'AMRAP';
  const mechanicMeta = wodMechanics.find((item) => item.mechanic_key === mechanic);

  function selectMechanic(next) {
    const cleanSettings = { mechanic_key: next };
    if (next === 'FOR_TIME' || next === 'CIRCUIT') cleanSettings.rounds = '';
    if (next === 'CIRCUIT') cleanSettings.rest_seconds = '';
    onSettings(cleanSettings);
  }

  return (
    <View>
      <Text style={styles.fieldLabel}>FORMAT DU WOD</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mechanicRow}>
        {wodMechanics.map((item) => (
          <Chip
            key={item.mechanic_key}
            label={item.display_name.toUpperCase()}
            selected={mechanic === item.mechanic_key}
            onPress={() => selectMechanic(item.mechanic_key)}
          />
        ))}
      </ScrollView>

      {mechanicMeta?.short_description ? (
        <Text style={styles.mechanicDescription}>{mechanicMeta.short_description}</Text>
      ) : null}

      {mechanic === 'AMRAP' ? (
        <>
          <Field
            label="DURÉE"
            value={block.duration_minutes}
            onChangeText={(value) => onPatch({ duration_minutes: value })}
            placeholder="UGEROD propose une durée"
            keyboardType="numeric"
          />
          <View style={styles.semanticHint}>
            <Ionicons name="infinite-outline" size={18} color={colors.primaryLight} />
            <Text style={styles.semanticHintText}>TOURS : LE PLUS POSSIBLE · PAS BESOIN DE LES RENSEIGNER</Text>
          </View>
        </>
      ) : null}

      {mechanic === 'FOR_TIME' ? (
        <View style={styles.fieldGrid}>
          <Field
            label="TOURS"
            value={String(block.settings?.rounds ?? '')}
            onChangeText={(value) => onSettings({ rounds: value })}
            placeholder="ex. 5"
            keyboardType="numeric"
            compact
          />
          <Field
            label="TIME CAP MIN (OPTIONNEL)"
            value={String(block.settings?.time_cap_minutes ?? block.duration_minutes ?? '')}
            onChangeText={(value) => {
              onSettings({ time_cap_minutes: value });
              onPatch({ duration_minutes: value });
            }}
            placeholder="ex. 20"
            keyboardType="numeric"
            compact
          />
        </View>
      ) : null}

      {mechanic === 'EMOM' ? (
        <Field
          label="DURÉE TOTALE"
          value={block.duration_minutes}
          onChangeText={(value) => onPatch({ duration_minutes: value })}
          placeholder="ex. 16"
          keyboardType="numeric"
        />
      ) : null}

      {mechanic === 'CIRCUIT' ? (
        <>
          <View style={styles.fieldGrid}>
            <Field
              label="TOURS"
              value={String(block.settings?.rounds ?? '')}
              onChangeText={(value) => onSettings({ rounds: value })}
              placeholder="ex. 5"
              keyboardType="numeric"
              compact
            />
            <Field
              label="REPOS / TOUR S"
              value={String(block.settings?.rest_seconds ?? '')}
              onChangeText={(value) => onSettings({ rest_seconds: value })}
              placeholder="optionnel"
              keyboardType="numeric"
              compact
            />
          </View>
          <Field
            label="DURÉE CIBLE (OPTIONNELLE)"
            value={block.duration_minutes}
            onChangeText={(value) => onPatch({ duration_minutes: value })}
            placeholder="ex. 18"
            keyboardType="numeric"
          />
        </>
      ) : null}
    </View>
  );
}

function ExerciseEditor({ block, item, itemIndex, itemCount, onPrescription, onRemove, onReorder }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
        onPanResponderMove: Animated.event([null, { dy: translateY }], { useNativeDriver: false }),
        onPanResponderRelease: (_, gesture) => {
          const rawOffset = Math.round(gesture.dy / 80);
          const maxUp = -itemIndex;
          const maxDown = itemCount - itemIndex - 1;
          const offset = Math.max(maxUp, Math.min(maxDown, rawOffset));
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
          if (offset !== 0) onReorder(offset);
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [itemIndex, itemCount, onReorder, translateY]
  );

  const strength = block.module_code === 'STRENGTH';
  const cardio = ['CARDIO', 'CONDITIONING'].includes(block.module_code);
  const tabata = ['TABATA', 'TABATA_ABS'].includes(block.module_code);
  const skill = ['SKILL', 'GYM'].includes(block.module_code);
  const trackingModes = item.tracking_modes ?? [];
  const hasReps = trackingModes.includes('reps') || (!trackingModes.length && !cardio);
  const hasTime = trackingModes.includes('time');
  const hasDistance = trackingModes.includes('distance');
  const hasLoad = trackingModes.includes('load');

  return (
    <Animated.View style={[styles.exerciseCard, { transform: [{ translateY }] }]}>
      <View style={styles.exerciseHeader}>
        <View {...panResponder.panHandlers} style={styles.exerciseDragHandle}>
          <Ionicons name="reorder-two-outline" size={21} color={colors.textMuted} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.exerciseName}>{item.exercise_name}</Text>
          <Text style={styles.muted}>{[item.body_region, item.movement_pattern].filter(Boolean).join(' · ')}</Text>
        </View>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      {tabata ? (
        <Text style={styles.tabataExerciseDose}>20 S DE TRAVAIL · ALTERNANCE GÉRÉE PAR UGEROD</Text>
      ) : strength ? (
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
        <View style={styles.fieldGrid}>
          {hasReps ? (
            <Field label={skill ? 'REPS / TENTATIVES' : 'REPS'} value={item.prescription.reps} onChangeText={(v) => onPrescription('reps', v)} placeholder="10" keyboardType="numeric" compact />
          ) : null}
          {hasTime ? (
            <Field label={skill ? 'TEMPS S' : 'TRAVAIL S'} value={item.prescription.duration_seconds} onChangeText={(v) => onPrescription('duration_seconds', v)} placeholder="30" keyboardType="numeric" compact />
          ) : null}
          {hasDistance ? (
            <Field label="DISTANCE M" value={item.prescription.distance_meters} onChangeText={(v) => onPrescription('distance_meters', v)} placeholder="200" keyboardType="numeric" compact />
          ) : null}
          {hasLoad ? (
            <Field label="CHARGE KG" value={item.prescription.load_kg} onChangeText={(v) => onPrescription('load_kg', v)} placeholder="optionnel" keyboardType="decimal-pad" compact />
          ) : null}
        </View>
      )}

      {(item.warning_codes ?? []).length ? (
        <Text style={styles.inlineWarning}>À CONFIRMER SELON TON NIVEAU</Text>
      ) : null}
    </Animated.View>
  );
}

function ReviewStep({
  validation,
  blocks,
  editableModules,
  acceptWarnings,
  onAcceptWarnings,
  onEdit,
  onAddTabata,
  onSaveLater,
  onStart,
  busy,
}) {
  const auto = validation?.auto_preparation;
  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const estimated = Number(validation?.duration_estimate?.estimated_minutes);
  const available = Number(validation?.duration_estimate?.available_minutes);
  const remaining = Number.isFinite(estimated) && Number.isFinite(available)
    ? Math.max(0, Math.round((available - estimated) * 10) / 10)
    : null;
  const canSuggestTabata =
    validation?.pass &&
    remaining != null &&
    remaining >= 4 &&
    editableModules.includes('TABATA') &&
    !blocks.some((block) => block.module_code === 'TABATA');

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
            {validation?.pass ? 'UGEROD a contrôlé tes choix et préparé l’échauffement.' : 'Corrige les points ci-dessous avant de démarrer.'}
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
          <Text style={styles.muted}>Préparation automatique UGEROD incluse.</Text>
          {remaining != null && remaining > 0 ? (
            <Text style={styles.remainingText}>ENVIRON {remaining} MIN RESTANTES</Text>
          ) : null}
        </View>
      ) : null}

      {canSuggestTabata ? (
        <Pressable onPress={onAddTabata} style={styles.tabataSuggestion}>
          <View style={styles.suggestionIcon}>
            <Ionicons name="timer-outline" size={22} color={colors.brandWhite} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.suggestionTitle}>COMPLÉTER AVEC UN TABATA ?</Text>
            <Text style={styles.suggestionBody}>Il reste assez de temps pour ajouter un Tabata de 4 min. Tu choisis les exercices, UGEROD gère le 20/10.</Text>
          </View>
          <Ionicons name="add-circle" size={23} color={colors.brandWhite} />
        </Pressable>
      ) : null}

      {errors.map((issue, index) => (
        <Issue key={`e-${index}`} text={issueText(issue, blocks)} tone="error" />
      ))}
      {warnings.map((issue, index) => (
        <Issue key={`w-${index}`} text={issueText(issue, blocks)} tone="warning" />
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

function ExercisePicker({
  visible,
  query,
  onQuery,
  trainingFilter,
  onTrainingFilter,
  regionFilter,
  onRegionFilter,
  includeUnavailable,
  onIncludeUnavailable,
  onSearch,
  results,
  loading,
  onSelect,
  onClose,
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>CATALOGUE</Text>
              <Text style={styles.modalTitle}>CHOISIR UN EXERCICE</Text>
            </View>
            <Pressable onPress={onClose}><Ionicons name="close" size={23} color={colors.textPrimary} /></Pressable>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              value={query}
              onChangeText={onQuery}
              onSubmitEditing={onSearch}
              placeholder="Ex. Sit-up, squat, rowing…"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
            />
            <Pressable onPress={onSearch} style={styles.searchButton}>
              <Ionicons name="search" size={20} color={colors.brandWhite} />
            </Pressable>
          </View>

          <Text style={styles.filterLabel}>TYPE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {TRAINING_FILTERS.map(([key, label]) => (
              <Chip key={key} label={label} selected={trainingFilter === key} onPress={() => onTrainingFilter(key)} />
            ))}
          </ScrollView>

          <Text style={styles.filterLabel}>ZONE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {REGION_FILTERS.map(([key, label]) => (
              <Chip key={key} label={label} selected={regionFilter === key} onPress={() => onRegionFilter(key)} />
            ))}
          </ScrollView>

          <Pressable
            onPress={() => onIncludeUnavailable(!includeUnavailable)}
            style={styles.unavailableToggle}
          >
            <Ionicons
              name={includeUnavailable ? 'checkbox' : 'square-outline'}
              size={18}
              color={includeUnavailable ? colors.primaryLight : colors.textMuted}
            />
            <Text style={styles.unavailableText}>AFFICHER AUSSI CE QUI NÉCESSITE UN AUTRE MATÉRIEL / CONTEXTE</Text>
          </Pressable>

          {loading ? <ActivityIndicator color={colors.primaryLight} style={styles.modalLoader} /> : null}
          <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled">
            {!loading && results.length === 0 ? (
              <View style={styles.noResults}>
                <Ionicons name="search-outline" size={24} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>AUCUN EXERCICE ICI</Text>
                <Text style={styles.muted}>Essaie une autre catégorie, une autre zone ou une recherche.</Text>
              </View>
            ) : null}

            {results.map((exercise) => (
              <Pressable
                key={exercise.exercise_id}
                disabled={!exercise.selectable}
                onPress={() => onSelect(exercise)}
                style={[styles.resultCard, !exercise.selectable && styles.resultDisabled]}
              >
                <View style={styles.flex}>
                  <Text style={styles.resultTitle}>{exercise.name}</Text>
                  <View style={styles.resultMetaRow}>
                    <MiniTag text={String(exercise.body_region ?? '').toUpperCase()} />
                    {(exercise.training_categories ?? []).slice(0, 2).map((category) => (
                      <MiniTag key={category} text={category} />
                    ))}
                  </View>
                  <Text style={styles.muted}>{[exercise.movement_pattern, exercise.difficulty].filter(Boolean).join(' · ')}</Text>
                  {(exercise.equipment ?? []).length ? (
                    <Text style={styles.resultEquipment}>MATÉRIEL · {exercise.equipment.map((eq) => eq.name).join(' · ')}</Text>
                  ) : (
                    <Text style={styles.bodyweightLabel}>POIDS DU CORPS</Text>
                  )}
                  {(exercise.warning_codes ?? []).length ? (
                    <Text style={styles.warningText}>À CONFIRMER SELON TON NIVEAU</Text>
                  ) : null}
                  {!exercise.selectable ? (
                    <Text style={styles.unavailableReason}>INDISPONIBLE AVEC LE CONTEXTE ACTUEL</Text>
                  ) : null}
                </View>
                <Ionicons name={exercise.selectable ? 'add-circle' : 'lock-closed-outline'} size={23} color={exercise.selectable ? colors.primaryLight : colors.textMuted} />
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

function MiniTag({ text }) {
  if (!text) return null;
  return (
    <View style={styles.miniTag}>
      <Text style={styles.miniTagText}>{text}</Text>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', compact = false }) {
  return (
    <View style={[styles.field, compact && styles.fieldCompact]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={String(value ?? '')}
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

function Issue({ text, tone }) {
  const errorTone = tone === 'error';
  return (
    <View style={[styles.issue, errorTone ? styles.issueError : styles.issueWarning]}>
      <Ionicons name={errorTone ? 'alert-circle-outline' : 'warning-outline'} size={20} color={errorTone ? colors.brandRed : '#F4B94E'} />
      <Text style={styles.issueText}>{text}</Text>
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
  content: { paddingHorizontal: spacing.lg, paddingTop: 18, paddingBottom: 52 },
  infoCard: { flexDirection: 'row', gap: 12, padding: 15, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(8,104,255,0.24)', backgroundColor: 'rgba(8,104,255,0.07)' },
  infoIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(8,104,255,0.12)' },
  infoTitle: { fontFamily: 'Oswald_700Bold', fontSize: 12, lineHeight: 16, letterSpacing: 0.7, color: colors.textPrimary, marginBottom: 4 },
  sectionTitleWrap: { marginTop: 25, marginBottom: 11 },
  sectionTitle: { fontFamily: 'Oswald_700Bold', fontSize: 13, letterSpacing: 0.8, color: colors.textPrimary },
  sectionSubtitle: { marginTop: 4, fontFamily: 'Oswald_400Regular', fontSize: 11, lineHeight: 16, color: colors.textMuted },
  environmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  environmentCard: { width: '48.5%', minHeight: 78, padding: 13, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'space-between' },
  environmentText: { fontFamily: 'Oswald_700Bold', fontSize: 11, letterSpacing: 0.6, color: colors.textSecondary },
  formatCard: { minHeight: 66, padding: 14, marginBottom: 9, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
  formatTitle: { fontFamily: 'Oswald_700Bold', fontSize: 11, letterSpacing: 0.5, color: colors.textPrimary },
  selectedCard: { borderColor: colors.primary, backgroundColor: 'rgba(8,104,255,0.08)' },
  selectedText: { color: colors.primaryLight },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  chipSelected: { borderColor: colors.primary, backgroundColor: 'rgba(8,104,255,0.12)' },
  chipText: { fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.4, color: colors.textSecondary },
  equipmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  equipmentChip: { width: '48.5%', minHeight: 60, padding: 12, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  equipmentChipSelected: { borderColor: colors.primary, backgroundColor: 'rgba(8,104,255,0.08)' },
  fullWidth: { width: '100%' },
  equipmentText: { fontFamily: 'Oswald_700Bold', fontSize: 10, color: colors.textSecondary },
  equipmentDetail: { marginTop: 5, fontFamily: 'Oswald_400Regular', fontSize: 9, color: colors.textMuted },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineAction: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  inlineActionText: { fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.5, color: colors.primaryLight },
  injuryCard: { minHeight: 66, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
  injuryTitle: { fontFamily: 'Oswald_700Bold', fontSize: 11, color: colors.textPrimary },
  timeBudgetCard: { marginTop: 14, padding: 15, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeBudgetValue: { fontFamily: 'BebasNeue_400Regular', fontSize: 28, lineHeight: 31, color: colors.textPrimary },
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  moduleCard: { width: '48.5%', minHeight: 92, padding: 13, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  moduleCardAdded: { opacity: 0.55 },
  moduleTitle: { marginTop: 10, fontFamily: 'Oswald_700Bold', fontSize: 11, color: colors.textPrimary },
  moduleSubtitle: { marginTop: 3, fontFamily: 'Oswald_400Regular', fontSize: 9.5, lineHeight: 14, color: colors.textMuted },
  mutedText: { color: colors.textMuted },
  emptyCard: { marginTop: 16, padding: 22, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', gap: 7 },
  emptyTitle: { fontFamily: 'Oswald_700Bold', fontSize: 11, letterSpacing: 0.5, color: colors.textPrimary },
  blockCard: { marginTop: 16, padding: 15, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  blockHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  blockEyebrow: { fontFamily: 'Oswald_700Bold', fontSize: 9, letterSpacing: 0.7, color: colors.primaryLight },
  blockTitle: { marginTop: 3, fontFamily: 'BebasNeue_400Regular', fontSize: 23, lineHeight: 26, color: colors.textPrimary },
  blockActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dragHandle: { width: 45, height: 43, borderRadius: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dragHint: { marginTop: 7, fontFamily: 'Oswald_600SemiBold', fontSize: 8, letterSpacing: 0.45, color: colors.textMuted },
  smallButton: { width: 43, height: 43, borderRadius: 12, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  field: { marginTop: 14 },
  fieldCompact: { width: '48%' },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  fieldLabel: { marginTop: 12, marginBottom: 7, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.7, color: colors.textSecondary },
  input: { minHeight: 48, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.textPrimary, fontFamily: 'Oswald_500Medium', fontSize: 13 },
  readOnlyField: { minHeight: 48, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, justifyContent: 'center' },
  readOnlyValue: { fontFamily: 'Oswald_700Bold', fontSize: 12, color: colors.primaryLight },
  mechanicRow: { gap: 8, paddingRight: 10 },
  mechanicDescription: { marginTop: 10, fontFamily: 'Oswald_400Regular', fontSize: 10.5, lineHeight: 15, color: colors.textMuted },
  semanticHint: { marginTop: 10, padding: 11, borderRadius: 12, backgroundColor: 'rgba(8,104,255,0.07)', flexDirection: 'row', alignItems: 'center', gap: 8 },
  semanticHintText: { flex: 1, fontFamily: 'Oswald_600SemiBold', fontSize: 8.5, lineHeight: 13, letterSpacing: 0.35, color: colors.textSecondary },
  fixedProtocolCard: { marginTop: 12, padding: 12, borderRadius: 13, backgroundColor: 'rgba(8,104,255,0.07)', flexDirection: 'row', alignItems: 'center', gap: 10 },
  fixedProtocolTitle: { fontFamily: 'Oswald_700Bold', fontSize: 10, color: colors.textPrimary },
  exerciseCard: { marginTop: 12, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  exerciseHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  exerciseDragHandle: { width: 30, height: 40, alignItems: 'center', justifyContent: 'center' },
  exerciseName: { fontFamily: 'Oswald_700Bold', fontSize: 12, color: colors.textPrimary },
  tabataExerciseDose: { marginTop: 10, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.5, color: colors.primaryLight },
  inlineWarning: { marginTop: 9, fontFamily: 'Oswald_600SemiBold', fontSize: 8.5, color: '#F4B94E' },
  addExerciseButton: { minHeight: 48, marginTop: 13, borderRadius: 13, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  addExerciseText: { fontFamily: 'Oswald_700Bold', fontSize: 10, letterSpacing: 0.6, color: colors.primaryLight },
  primaryButton: { minHeight: 56, marginTop: 22, paddingHorizontal: 18, borderRadius: 15, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryButtonText: { fontFamily: 'Oswald_700Bold', fontSize: 12, letterSpacing: 0.8, color: colors.brandWhite },
  disabled: { opacity: 0.35 },
  reviewHero: { padding: 16, borderRadius: 17, borderWidth: 1, flexDirection: 'row', gap: 12, alignItems: 'center' },
  reviewHeroOk: { borderColor: 'rgba(8,104,255,0.45)', backgroundColor: 'rgba(8,104,255,0.08)' },
  reviewHeroBad: { borderColor: 'rgba(255,69,69,0.4)', backgroundColor: 'rgba(255,69,69,0.06)' },
  reviewTitle: { fontFamily: 'Oswald_700Bold', fontSize: 13, color: colors.textPrimary },
  autoPreview: { marginTop: 14, padding: 15, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  autoRow: { marginTop: 11, flexDirection: 'row', alignItems: 'center', gap: 11 },
  autoTitle: { fontFamily: 'Oswald_700Bold', fontSize: 11, color: colors.textPrimary },
  summaryCard: { marginTop: 14, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  summaryValue: { fontFamily: 'BebasNeue_400Regular', fontSize: 28, lineHeight: 31, color: colors.textPrimary },
  remainingText: { marginTop: 8, fontFamily: 'Oswald_700Bold', fontSize: 9, letterSpacing: 0.5, color: colors.primaryLight },
  tabataSuggestion: { marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', gap: 11 },
  suggestionIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.13)', alignItems: 'center', justifyContent: 'center' },
  suggestionTitle: { fontFamily: 'Oswald_700Bold', fontSize: 11, color: colors.brandWhite },
  suggestionBody: { marginTop: 3, fontFamily: 'Oswald_400Regular', fontSize: 9.5, lineHeight: 14, color: 'rgba(255,255,255,0.8)' },
  issue: { marginTop: 12, padding: 14, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  issueError: { borderColor: 'rgba(255,69,69,0.42)', backgroundColor: 'rgba(255,69,69,0.06)' },
  issueWarning: { borderColor: 'rgba(244,185,78,0.38)', backgroundColor: 'rgba(244,185,78,0.055)' },
  issueText: { flex: 1, fontFamily: 'Oswald_400Regular', fontSize: 11, lineHeight: 16, color: colors.textSecondary },
  acceptCard: { marginTop: 14, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 },
  acceptText: { flex: 1, fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 0.45, color: colors.textSecondary },
  secondaryButton: { minHeight: 50, marginTop: 18, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontFamily: 'Oswald_700Bold', fontSize: 10, letterSpacing: 0.6, color: colors.textSecondary },
  saveLaterButton: { minHeight: 45, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
  saveLaterText: { fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 0.5, color: colors.textMuted },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.72)' },
  modalSheet: { maxHeight: '92%', minHeight: '72%', paddingHorizontal: spacing.lg, paddingTop: 16, paddingBottom: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalEyebrow: { fontFamily: 'Oswald_600SemiBold', fontSize: 8.5, letterSpacing: 0.7, color: colors.primaryLight },
  modalTitle: { marginTop: 2, fontFamily: 'BebasNeue_400Regular', fontSize: 24, color: colors.textPrimary },
  searchRow: { marginTop: 13, flexDirection: 'row', gap: 8 },
  searchInput: { flex: 1, minHeight: 48, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.textPrimary, fontFamily: 'Oswald_400Regular', fontSize: 12 },
  searchButton: { width: 49, minHeight: 48, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  filterLabel: { marginTop: 13, marginBottom: 7, fontFamily: 'Oswald_700Bold', fontSize: 8.5, letterSpacing: 0.7, color: colors.textMuted },
  filterRow: { gap: 7, paddingRight: 10 },
  unavailableToggle: { marginTop: 13, flexDirection: 'row', alignItems: 'center', gap: 8 },
  unavailableText: { flex: 1, fontFamily: 'Oswald_600SemiBold', fontSize: 8, lineHeight: 12, letterSpacing: 0.3, color: colors.textMuted },
  modalLoader: { marginTop: 16 },
  results: { paddingTop: 10, paddingBottom: 34 },
  resultCard: { minHeight: 92, marginTop: 9, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultDisabled: { opacity: 0.5 },
  resultTitle: { fontFamily: 'Oswald_700Bold', fontSize: 12, color: colors.textPrimary },
  resultMetaRow: { marginTop: 6, marginBottom: 5, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  miniTag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.background },
  miniTagText: { fontFamily: 'Oswald_600SemiBold', fontSize: 7.5, letterSpacing: 0.35, color: colors.textSecondary },
  resultEquipment: { marginTop: 5, fontFamily: 'Oswald_600SemiBold', fontSize: 8.5, color: colors.textMuted },
  bodyweightLabel: { marginTop: 5, fontFamily: 'Oswald_600SemiBold', fontSize: 8.5, color: colors.primaryLight },
  warningText: { marginTop: 5, fontFamily: 'Oswald_600SemiBold', fontSize: 8.5, color: '#F4B94E' },
  unavailableReason: { marginTop: 5, fontFamily: 'Oswald_600SemiBold', fontSize: 8, color: colors.brandRed },
  noResults: { paddingVertical: 30, alignItems: 'center', gap: 7 },
  errorBanner: { marginHorizontal: spacing.lg, marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,69,69,0.35)', backgroundColor: 'rgba(255,69,69,0.06)', flexDirection: 'row', alignItems: 'center', gap: 9 },
  errorText: { flex: 1, fontFamily: 'Oswald_400Regular', fontSize: 10.5, lineHeight: 15, color: colors.textSecondary },
  muted: { fontFamily: 'Oswald_400Regular', fontSize: 10.5, lineHeight: 15, color: colors.textMuted },
});
