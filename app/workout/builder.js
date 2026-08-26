import { Ionicons } from '@expo/vector-icons';
import {
  router,
  useFocusEffect,
} from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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

import {
  colors,
  spacing,
} from '../../src/constants';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import {
  getEquipmentCatalog,
} from '../../src/services/equipmentService';
import {
  reloadWorkoutSession,
} from '../../src/services/workoutService';
import {
  commitUserSessionDraft,
  createUserSessionDraft,
  getUserSessionBuilderBootstrap,
  getUserSessionBuilderExercises,
  replaceUserSessionDraftStructure,
  updateUserSessionDraftContext,
  validateUserSessionDraft,
} from '../../src/services/userSessionBuilderService';

const brandIcon = require('../../assets/branding/ugerod-icon.png');

const DURATIONS = [20, 30, 45, 60, 75, 90];
const TARGETS = [
  { value: 'Full Body', label: 'CORPS ENTIER' },
  { value: 'Upper', label: 'HAUT DU CORPS' },
  { value: 'Lower', label: 'BAS DU CORPS' },
  { value: 'Core', label: 'CORE' },
];

const ENVIRONMENTS = {
  HOME: {
    icon: 'home-outline',
    location: 'HOME',
  },
  BOX: {
    icon: 'flash-outline',
    location: 'GYM_BOX',
  },
  GYM: {
    icon: 'barbell-outline',
    location: 'GYM_BOX',
  },
  OUTDOOR: {
    icon: 'leaf-outline',
    location: 'OUTDOOR',
  },
};

const SURFACES = {
  INDOOR_FLOOR: 'SOL INTÉRIEUR',
  RUBBER: 'SOL CAOUTCHOUC',
  GRASS: 'HERBE',
  TRACK: 'PISTE',
  ROAD: 'ROUTE',
  TRAIL: 'CHEMIN / TRAIL',
  SAND: 'SABLE',
  MIXED: 'MIXTE',
};

const MODULE_META = {
  UNLOCK: {
    label: 'Unlock',
    subtitle: 'Préparation articulaire',
    icon: 'body-outline',
  },
  WARMUP: {
    label: 'Échauffement',
    subtitle: 'Montée en température',
    icon: 'flame-outline',
  },
  TABATA: {
    label: 'Tabata',
    subtitle: 'Bloc court et rythmé',
    icon: 'timer-outline',
  },
  TABATA_ABS: {
    label: 'Tabata abdos',
    subtitle: 'Core court et rythmé',
    icon: 'timer-outline',
  },
  CORE: {
    label: 'Core',
    subtitle: 'Travail du tronc',
    icon: 'ellipse-outline',
  },
  SKILL: {
    label: 'Skill / Gym',
    subtitle: 'Technique ou compétence',
    icon: 'navigate-outline',
  },
  GYM: {
    label: 'Gym',
    subtitle: 'Gymnastique au poids du corps',
    icon: 'accessibility-outline',
  },
  STRENGTH: {
    label: 'Musculation',
    subtitle: 'Séries, reps, charge, repos',
    icon: 'barbell-outline',
  },
  WOD: {
    label: 'WOD',
    subtitle: 'Bloc principal',
    icon: 'flash-outline',
  },
  CARDIO: {
    label: 'Cardio',
    subtitle: 'Machine ou effort continu',
    icon: 'heart-outline',
  },
  CONDITIONING: {
    label: 'Conditioning',
    subtitle: 'Effort cardio / métabolique',
    icon: 'pulse-outline',
  },
};

const ISSUE_LABELS = {
  EXERCISE_HARD_GATE_FAILED:
    'Un exercice n’est pas compatible avec ton contexte.',
  PRESCRIPTION_INCOMPLETE:
    'Une prescription est incomplète.',
  SUPERSET_GROUP_REQUIRED:
    'Chaque exercice d’un superset doit appartenir à une paire.',
  SUPERSET_GROUP_MUST_BE_PAIRED:
    'Un superset doit contenir exactement deux exercices par groupe.',
  DURATION_EXCEEDED:
    'La séance dépasse le temps disponible.',
  DURATION_ESTIMATE_PARTIAL:
    'La durée ne peut être estimée complètement avec les informations saisies.',
};

function readinessFromScore(score) {
  const numeric = Number(score ?? 6);

  if (numeric <= 4) {
    return 'low';
  }

  if (numeric >= 8) {
    return 'high';
  }

  return 'normal';
}

function readinessLabel(value) {
  if (value === 'low') {
    return 'FAIBLE';
  }

  if (value === 'high') {
    return 'TRÈS EN FORME';
  }

  return 'NORMALE';
}

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return null;
  }

  const numeric = Number(
    String(value).replace(',', '.')
  );

  return Number.isFinite(numeric)
    ? numeric
    : null;
}

function createClientBlock(moduleCode, gymStyles) {
  const defaultStyle =
    moduleCode === 'STRENGTH'
      ? gymStyles?.find((item) => item.is_default)
          ?.style_code ?? 'CLASSIC_SETS'
      : null;

  return {
    clientId: `${moduleCode}-${Date.now()}-${Math.random()}`,
    module_code: moduleCode,
    title: MODULE_META[moduleCode]?.label ?? moduleCode,
    execution_style: defaultStyle,
    duration_minutes: '',
    settings: {},
    items: [],
  };
}

function hydrateDraftBlocks(blocks) {
  return (blocks ?? []).map((block) => ({
    clientId: block.id ?? `${block.module_code}-${Math.random()}`,
    module_code: block.module_code,
    title:
      block.title ??
      MODULE_META[block.module_code]?.label ??
      block.module_code,
    execution_style: block.execution_style ?? null,
    duration_minutes:
      block.duration_minutes == null
        ? ''
        : String(block.duration_minutes),
    settings: block.settings ?? {},
    items: (block.items ?? []).map((item) => ({
      clientId: item.id ?? `${item.exercise_id}-${Math.random()}`,
      exercise_id: item.exercise_id,
      exercise_name: item.exercise_name,
      body_region: item.body_region,
      movement_pattern: item.movement_pattern,
      tracking_modes: item.tracking_modes ?? [],
      group_key: item.group_key ?? null,
      prescription: {
        text: item.prescription?.text ?? '',
        sets:
          item.prescription?.sets == null
            ? ''
            : String(item.prescription.sets),
        reps:
          item.prescription?.reps == null
            ? ''
            : String(item.prescription.reps),
        load_kg:
          item.prescription?.load_kg == null
            ? ''
            : String(item.prescription.load_kg),
        rest_seconds:
          item.prescription?.rest_seconds == null
            ? ''
            : String(item.prescription.rest_seconds),
        duration_minutes:
          item.prescription?.duration_minutes == null
            ? ''
            : String(item.prescription.duration_minutes),
        distance_meters:
          item.prescription?.distance_meters == null
            ? ''
            : String(item.prescription.distance_meters),
      },
      notes: item.notes ?? '',
    })),
  }));
}

function buildPrescription(block, item) {
  const moduleCode = block.module_code;
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

  if (customText) {
    prescription.text = customText;
  } else if (
    moduleCode === 'STRENGTH' &&
    sets != null &&
    reps != null
  ) {
    prescription.text = [
      `${sets} × ${reps}`,
      load != null ? `${load} kg` : null,
      rest != null ? `repos ${rest} s` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  } else if (
    ['CARDIO', 'CONDITIONING'].includes(moduleCode) &&
    (duration != null || distance != null)
  ) {
    prescription.text = [
      duration != null ? `${duration} min` : null,
      distance != null ? `${distance} m` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  } else if (duration != null) {
    prescription.text = `${duration} min`;
  }

  return prescription;
}

function serializeBlocks(blocks) {
  return blocks.map((block) => ({
    module_code: block.module_code,
    title: block.title,
    execution_style:
      block.module_code === 'STRENGTH'
        ? block.execution_style
        : null,
    duration_minutes:
      toNumber(block.duration_minutes),
    settings: block.settings ?? {},
    items: block.items.map((item, index) => ({
      exercise_id: item.exercise_id,
      group_key:
        block.module_code === 'STRENGTH' &&
        block.execution_style === 'SUPERSETS'
          ? String.fromCharCode(
              65 + Math.floor(index / 2)
            )
          : block.module_code === 'STRENGTH' &&
              block.execution_style === 'CIRCUIT'
            ? 'CIRCUIT'
            : null,
      prescription: buildPrescription(
        block,
        item
      ),
      notes: item.notes?.trim() || null,
    })),
  }));
}

function getIssueText(issue) {
  const code = issue?.code ?? 'UNKNOWN';
  return ISSUE_LABELS[code] ??
    code.replaceAll('_', ' ');
}

export default function UserSessionBuilderScreen() {
  const {
    preparation,
    setGeneratedWorkout,
  } = useWorkout();

  const [step, setStep] = useState('context');
  const [bootstrap, setBootstrap] = useState(null);
  const [equipmentCatalog, setEquipmentCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [environmentCode, setEnvironmentCode] = useState('HOME');
  const [surfaceCode, setSurfaceCode] = useState(null);
  const [durationMinutes, setDurationMinutes] = useState(
    preparation.duration ?? 45
  );
  const [readiness, setReadiness] = useState(
    readinessFromScore(preparation.readiness)
  );
  const [targetRegion, setTargetRegion] = useState('Full Body');
  const [formatCode, setFormatCode] = useState(null);
  const [selectedEquipment, setSelectedEquipment] = useState(
    () =>
      (preparation.equipment ?? []).filter(
        (name) => name && name !== 'Poids du corps'
      )
  );
  const [injuredZones, setInjuredZones] = useState(
    () =>
      (preparation.painZones ?? []).filter(
        (zone) => zone && zone !== 'Aucune'
      )
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

  const loadBootstrap = useCallback(
    async (environment) => {
      const data =
        await getUserSessionBuilderBootstrap(
          environment
        );

      setBootstrap(data);

      const formats = data?.formats ?? [];
      setFormatCode((current) => {
        if (
          current &&
          formats.some(
            (item) => item.format_code === current
          )
        ) {
          return current;
        }

        return (
          formats.find((item) => item.is_default)
            ?.format_code ??
          formats[0]?.format_code ??
          null
        );
      });

      return data;
    },
    []
  );

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const [, catalog] = await Promise.all([
          loadBootstrap('HOME'),
          getEquipmentCatalog(),
        ]);

        if (active) {
          setEquipmentCatalog(catalog ?? []);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Impossible de charger le constructeur.'
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [loadBootstrap]);

  useFocusEffect(
    useCallback(() => {
      setInjuredZones(
        (preparation.painZones ?? []).filter(
          (zone) => zone && zone !== 'Aucune'
        )
      );
    }, [preparation.painZones])
  );

  const formats = bootstrap?.formats ?? [];
  const selectedFormat = formats.find(
    (item) => item.format_code === formatCode
  );
  const allowedModules =
    selectedFormat?.module_order ??
    (bootstrap?.modules ?? []).map(
      (item) => item.module_code
    );
  const gymStyles =
    bootstrap?.gym_execution_styles ?? [];

  const equipmentForEnvironment = useMemo(() => {
    const location =
      ENVIRONMENTS[environmentCode]?.location;

    return equipmentCatalog.filter((item) =>
      location
        ? (item.locations ?? []).includes(location)
        : true
    );
  }, [equipmentCatalog, environmentCode]);

  const equipmentCategories = useMemo(() => {
    const grouped = new Map();

    for (const item of equipmentForEnvironment) {
      const category = item.category ?? 'Autre';
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category).push(item);
    }

    return Array.from(grouped.entries());
  }, [equipmentForEnvironment]);

  async function handleEnvironment(nextEnvironment) {
    if (nextEnvironment === environmentCode) {
      return;
    }

    try {
      setBusy(true);
      setEnvironmentCode(nextEnvironment);
      setSurfaceCode(null);
      setValidation(null);

      const data = await loadBootstrap(
        nextEnvironment
      );

      const location =
        ENVIRONMENTS[nextEnvironment]?.location;
      const allowedEquipmentNames = new Set(
        equipmentCatalog
          .filter((item) =>
            location
              ? (item.locations ?? []).includes(location)
              : true
          )
          .map((item) => item.name)
      );

      setSelectedEquipment((current) =>
        current.filter((name) =>
          allowedEquipmentNames.has(name)
        )
      );

      const nextFormat =
        data?.formats?.find((item) => item.is_default)
          ?.format_code ??
        data?.formats?.[0]?.format_code ??
        null;

      setFormatCode(nextFormat);
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : 'Impossible de changer d’environnement.'
      );
    } finally {
      setBusy(false);
    }
  }

  function handleBack() {
    if (step === 'review') {
      setStep('build');
      return;
    }

    if (step === 'build') {
      setStep('context');
      return;
    }

    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }

  function toggleEquipment(name) {
    setSelectedEquipment((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    );
  }

  async function handleContextContinue() {
    if (
      environmentCode === 'OUTDOOR' &&
      !surfaceCode
    ) {
      Alert.alert(
        'Surface nécessaire',
        'Choisis la surface sur laquelle tu vas t’entraîner.'
      );
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
          targetRegion,
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
          surfaceCode:
            surfaceCode ?? '',
          formatCode:
            formatCode ?? '',
          readiness,
          focus: 'General Fitness',
          targetRegion,
          progressionIntent: 'MAINTAIN',
          availableEquipment: selectedEquipment,
          injuredZones,
        });
      }

      const allowed = new Set(
        selectedFormat?.module_order ??
          allowedModules
      );

      setBlocks((current) =>
        current.filter((block) =>
          allowed.has(block.module_code)
        )
      );
      setValidation(null);
      setStep('build');
    } catch (contextError) {
      setError(
        contextError instanceof Error
          ? contextError.message
          : 'Impossible de préparer le brouillon.'
      );
    } finally {
      setBusy(false);
    }
  }

  function addBlock(moduleCode) {
    setBlocks((current) => [
      ...current,
      createClientBlock(
        moduleCode,
        gymStyles
      ),
    ]);
  }

  function removeBlock(index) {
    setBlocks((current) =>
      current.filter((_, itemIndex) =>
        itemIndex !== index
      )
    );
  }

  function moveBlock(index, direction) {
    setBlocks((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[target]] = [
        next[target],
        next[index],
      ];
      return next;
    });
  }

  function updateBlock(index, patch) {
    setBlocks((current) =>
      current.map((block, itemIndex) =>
        itemIndex === index
          ? { ...block, ...patch }
          : block
      )
    );
  }

  function updateItem(blockIndex, itemIndex, patch) {
    setBlocks((current) =>
      current.map((block, currentBlockIndex) => {
        if (currentBlockIndex !== blockIndex) {
          return block;
        }

        return {
          ...block,
          items: block.items.map((item, currentItemIndex) =>
            currentItemIndex === itemIndex
              ? { ...item, ...patch }
              : item
          ),
        };
      })
    );
  }

  function updateItemPrescription(
    blockIndex,
    itemIndex,
    key,
    value
  ) {
    setBlocks((current) =>
      current.map((block, currentBlockIndex) => {
        if (currentBlockIndex !== blockIndex) {
          return block;
        }

        return {
          ...block,
          items: block.items.map((item, currentItemIndex) =>
            currentItemIndex === itemIndex
              ? {
                  ...item,
                  prescription: {
                    ...(item.prescription ?? {}),
                    [key]: value,
                  },
                }
              : item
          ),
        };
      })
    );
  }

  function removeItem(blockIndex, itemIndex) {
    setBlocks((current) =>
      current.map((block, currentBlockIndex) =>
        currentBlockIndex === blockIndex
          ? {
              ...block,
              items: block.items.filter(
                (_, currentItemIndex) =>
                  currentItemIndex !== itemIndex
              ),
            }
          : block
      )
    );
  }

  function moveItem(blockIndex, itemIndex, direction) {
    setBlocks((current) =>
      current.map((block, currentBlockIndex) => {
        if (currentBlockIndex !== blockIndex) {
          return block;
        }

        const target = itemIndex + direction;
        if (target < 0 || target >= block.items.length) {
          return block;
        }

        const items = [...block.items];
        [items[itemIndex], items[target]] = [
          items[target],
          items[itemIndex],
        ];
        return { ...block, items };
      })
    );
  }

  async function loadExercises(
    blockIndex,
    query = ''
  ) {
    const block = blocks[blockIndex];
    if (!draftId || !block) {
      return;
    }

    try {
      setExerciseLoading(true);
      const response =
        await getUserSessionBuilderExercises({
          draftId,
          moduleCode: block.module_code,
          query: query.trim() || null,
          limit: 60,
        });

      setExerciseResults(
        response?.results ?? []
      );
    } catch (exerciseError) {
      Alert.alert(
        'Exercices indisponibles',
        exerciseError instanceof Error
          ? exerciseError.message
          : 'Impossible de charger les exercices.'
      );
    } finally {
      setExerciseLoading(false);
    }
  }

  function openExercisePicker(blockIndex) {
    setPickerBlockIndex(blockIndex);
    setExerciseQuery('');
    setExerciseResults([]);
    setPickerVisible(true);
    loadExercises(blockIndex, '');
  }

  function selectExercise(exercise) {
    if (
      pickerBlockIndex == null ||
      !exercise?.selectable
    ) {
      return;
    }

    setBlocks((current) =>
      current.map((block, blockIndex) => {
        if (blockIndex !== pickerBlockIndex) {
          return block;
        }

        if (
          block.items.some(
            (item) =>
              item.exercise_id === exercise.exercise_id
          )
        ) {
          return block;
        }

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
              tracking_modes:
                exercise.tracking_modes ?? [],
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
    if (!draftId) {
      throw new Error('Brouillon introuvable.');
    }

    const saved =
      await replaceUserSessionDraftStructure({
        draftId,
        blocks: serializeBlocks(blocks),
      });

    setBlocks(
      hydrateDraftBlocks(saved?.blocks)
    );
    return saved;
  }

  async function handleSaveDraft() {
    try {
      setBusy(true);
      await saveStructure();
      Alert.alert(
        'Brouillon enregistré',
        'Ta construction est sauvegardée.'
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Impossible de sauvegarder la séance.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleValidate() {
    try {
      setBusy(true);
      setError(null);
      await saveStructure();
      const result =
        await validateUserSessionDraft(draftId);
      setValidation(result);
      setAcceptWarnings(false);
      setStep('review');
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : 'Impossible de contrôler la séance.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit(startNow) {
    try {
      setBusy(true);
      setError(null);
      await saveStructure();
      const freshValidation =
        await validateUserSessionDraft(draftId);
      setValidation(freshValidation);

      if (!freshValidation?.pass) {
        setStep('review');
        return;
      }

      const warningCount =
        Number(freshValidation?.warning_count ?? 0);

      if (warningCount > 0 && !acceptWarnings) {
        Alert.alert(
          'Avertissements à confirmer',
          'Consulte les avertissements puis confirme que tu souhaites conserver tes choix.'
        );
        return;
      }

      const result =
        await commitUserSessionDraft({
          draftId,
          startNow,
          acceptWarnings,
        });

      if (startNow && result?.session_id) {
        const workout = await reloadWorkoutSession({
          sessionId: result.session_id,
        });
        setGeneratedWorkout(workout);
        router.replace('/workout/session');
        return;
      }

      Alert.alert(
        'Séance enregistrée',
        'Elle est prête pour plus tard.',
        [
          {
            text: 'OK',
            onPress: () => router.replace('/(tabs)'),
          },
        ]
      );
    } catch (commitError) {
      setError(
        commitError instanceof Error
          ? commitError.message
          : 'Impossible d’enregistrer la séance.'
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator
          color={colors.primaryLight}
          size="large"
        />
        <Text style={styles.centerStateText}>
          PRÉPARATION DU CONSTRUCTEUR…
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flexOne}
        behavior={
          Platform.OS === 'ios'
            ? 'padding'
            : undefined
        }
      >
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="arrow-back"
              size={22}
              color={colors.textPrimary}
            />
          </Pressable>

          <View style={styles.headerText}>
            <Text style={styles.headerEyebrow}>
              CONSTRUCTION MANUELLE
            </Text>
            <Text style={styles.headerTitle}>
              CRÉER MA SÉANCE
              <Text style={styles.blueDot}>.</Text>
            </Text>
          </View>

          <Image
            source={brandIcon}
            style={styles.brandIcon}
            resizeMode="contain"
          />
        </View>

        <StepBar step={step} />

        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons
              name="alert-circle-outline"
              size={19}
              color={colors.brandRed}
            />
            <Text style={styles.errorBannerText}>
              {error}
            </Text>
          </View>
        ) : null}

        {step === 'context' ? (
          <ContextStep
            bootstrap={bootstrap}
            environmentCode={environmentCode}
            onEnvironment={handleEnvironment}
            durationMinutes={durationMinutes}
            onDuration={setDurationMinutes}
            readiness={readiness}
            onReadiness={setReadiness}
            targetRegion={targetRegion}
            onTargetRegion={setTargetRegion}
            formatCode={formatCode}
            onFormatCode={setFormatCode}
            surfaceCode={surfaceCode}
            onSurfaceCode={setSurfaceCode}
            equipmentCategories={equipmentCategories}
            selectedEquipment={selectedEquipment}
            onToggleEquipment={toggleEquipment}
            onClearEquipment={() => setSelectedEquipment([])}
            injuredZones={injuredZones}
            onManageInjuries={() =>
              router.push('/workout/injuries')
            }
            onContinue={handleContextContinue}
            busy={busy}
          />
        ) : step === 'build' ? (
          <BuildStep
            blocks={blocks}
            allowedModules={allowedModules}
            gymStyles={gymStyles}
            onAddBlock={addBlock}
            onRemoveBlock={removeBlock}
            onMoveBlock={moveBlock}
            onUpdateBlock={updateBlock}
            onAddExercise={openExercisePicker}
            onRemoveItem={removeItem}
            onMoveItem={moveItem}
            onUpdateItem={updateItem}
            onUpdatePrescription={
              updateItemPrescription
            }
            onSave={handleSaveDraft}
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
            onStartNow={() => handleCommit(true)}
            busy={busy}
          />
        )}

        <ExercisePicker
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          query={exerciseQuery}
          onQuery={setExerciseQuery}
          onSearch={() =>
            loadExercises(
              pickerBlockIndex,
              exerciseQuery
            )
          }
          results={exerciseResults}
          loading={exerciseLoading}
          onSelect={selectExercise}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StepBar({ step }) {
  const steps = [
    ['context', '01', 'CONTEXTE'],
    ['build', '02', 'BLOCS'],
    ['review', '03', 'CONTRÔLE'],
  ];
  const activeIndex =
    steps.findIndex(([key]) => key === step);

  return (
    <View style={styles.stepBar}>
      {steps.map(([key, number, label], index) => {
        const active = index === activeIndex;
        const done = index < activeIndex;

        return (
          <View
            key={key}
            style={styles.stepItem}
          >
            <View
              style={[
                styles.stepCircle,
                (active || done) &&
                  styles.stepCircleActive,
              ]}
            >
              <Text
                style={[
                  styles.stepNumber,
                  (active || done) &&
                    styles.stepNumberActive,
                ]}
              >
                {done ? '✓' : number}
              </Text>
            </View>
            <Text
              style={[
                styles.stepLabel,
                active && styles.stepLabelActive,
              ]}
            >
              {label}
            </Text>
          </View>
        );
      })}
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
  targetRegion,
  onTargetRegion,
  formatCode,
  onFormatCode,
  surfaceCode,
  onSurfaceCode,
  equipmentCategories,
  selectedEquipment,
  onToggleEquipment,
  onClearEquipment,
  injuredZones,
  onManageInjuries,
  onContinue,
  busy,
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <IntroCard
        icon="construct-outline"
        title="TU GARDES LA MAIN"
        text="Choisis tes blocs et tes exercices. Ugerod contrôle ensuite le matériel, le contexte et les garde-fous sans reconstruire ta séance à ta place."
      />

      <SectionTitle
        title="OÙ TU T’ENTRAÎNES ?"
        subtitle="Le catalogue et les blocs s’adaptent à l’environnement."
      />

      <View style={styles.environmentGrid}>
        {(bootstrap?.environments ?? []).map((item) => {
          const selected =
            item.environment_code === environmentCode;
          return (
            <Pressable
              key={item.environment_code}
              onPress={() =>
                onEnvironment(item.environment_code)
              }
              style={({ pressed }) => [
                styles.environmentCard,
                selected && styles.optionCardSelected,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={
                  ENVIRONMENTS[item.environment_code]
                    ?.icon ?? 'location-outline'
                }
                size={24}
                color={
                  selected
                    ? colors.primaryLight
                    : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.environmentTitle,
                  selected && styles.selectedText,
                ]}
              >
                {item.label_fr.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle title="TEMPS DISPONIBLE" />
      <View style={styles.chipRow}>
        {DURATIONS.map((value) => (
          <ChoiceChip
            key={value}
            label={`${value} MIN`}
            selected={durationMinutes === value}
            onPress={() => onDuration(value)}
          />
        ))}
      </View>

      <SectionTitle title="INTENTION" />
      <View style={styles.chipRow}>
        {TARGETS.map((item) => (
          <ChoiceChip
            key={item.value}
            label={item.label}
            selected={targetRegion === item.value}
            onPress={() =>
              onTargetRegion(item.value)
            }
          />
        ))}
      </View>

      {(bootstrap?.formats ?? []).length > 0 ? (
        <>
          <SectionTitle
            title="FORMAT DE SÉANCE"
            subtitle="Le format détermine les blocs disponibles."
          />
          <View style={styles.stackGap}>
            {(bootstrap.formats ?? []).map((format) => {
              const selected =
                format.format_code === formatCode;
              return (
                <Pressable
                  key={format.format_code}
                  onPress={() =>
                    onFormatCode(format.format_code)
                  }
                  style={({ pressed }) => [
                    styles.formatCard,
                    selected && styles.optionCardSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.formatCardMain}>
                    <Text
                      style={[
                        styles.formatTitle,
                        selected && styles.selectedText,
                      ]}
                    >
                      {format.label_fr.toUpperCase()}
                    </Text>
                    <Text style={styles.formatDescription}>
                      {format.description_fr}
                    </Text>
                  </View>
                  <Ionicons
                    name={
                      selected
                        ? 'checkmark-circle'
                        : 'ellipse-outline'
                    }
                    size={21}
                    color={
                      selected
                        ? colors.primaryLight
                        : colors.textMuted
                    }
                  />
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {(bootstrap?.surface_options ?? []).length > 0 &&
      (environmentCode === 'OUTDOOR' || surfaceCode) ? (
        <>
          <SectionTitle
            title="SURFACE"
            subtitle={
              environmentCode === 'OUTDOOR'
                ? 'Obligatoire en extérieur.'
                : 'Optionnel.'
            }
          />
          <View style={styles.chipRow}>
            {(bootstrap.surface_options ?? []).map(
              (surface) => (
                <ChoiceChip
                  key={surface}
                  label={SURFACES[surface] ?? surface}
                  selected={surfaceCode === surface}
                  onPress={() => onSurfaceCode(surface)}
                />
              )
            )}
          </View>
        </>
      ) : null}

      <SectionTitle
        title="FORME DU JOUR"
        subtitle="Ugerod l’utilise comme information de contexte, pas pour remplacer tes choix."
      />
      <View style={styles.chipRow}>
        {['low', 'normal', 'high'].map((value) => (
          <ChoiceChip
            key={value}
            label={readinessLabel(value)}
            selected={readiness === value}
            onPress={() => onReadiness(value)}
          />
        ))}
      </View>

      <SectionTitle
        title="MATÉRIEL DISPONIBLE"
        subtitle="Sélection explicite : Ugerod ne supposera pas une machine ou une charge absente."
      />

      <Pressable
        onPress={onClearEquipment}
        style={({ pressed }) => [
          styles.clearEquipmentButton,
          selectedEquipment.length === 0 &&
            styles.clearEquipmentButtonSelected,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name="body-outline"
          size={18}
          color={
            selectedEquipment.length === 0
              ? colors.primaryLight
              : colors.textMuted
          }
        />
        <Text
          style={[
            styles.clearEquipmentText,
            selectedEquipment.length === 0 &&
              styles.selectedText,
          ]}
        >
          POIDS DU CORPS / AUCUN MATÉRIEL
        </Text>
      </Pressable>

      {equipmentCategories.map(([category, items]) => (
        <View key={category} style={styles.equipmentCategory}>
          <Text style={styles.equipmentCategoryTitle}>
            {category.toUpperCase()}
          </Text>
          <View style={styles.chipRow}>
            {items.map((item) => (
              <ChoiceChip
                key={item.id}
                label={item.name.toUpperCase()}
                selected={selectedEquipment.includes(
                  item.name
                )}
                onPress={() =>
                  onToggleEquipment(item.name)
                }
              />
            ))}
          </View>
        </View>
      ))}

      <SectionTitle title="GÊNES / BLESSURES" />
      <Pressable
        onPress={onManageInjuries}
        style={({ pressed }) => [
          styles.injuryCard,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={
            injuredZones.length > 0
              ? 'medical-outline'
              : 'shield-checkmark-outline'
          }
          size={21}
          color={
            injuredZones.length > 0
              ? colors.brandRed
              : colors.primaryLight
          }
        />
        <View style={styles.flexOne}>
          <Text style={styles.injuryTitle}>
            {injuredZones.length > 0
              ? `${injuredZones.length} ZONE${
                  injuredZones.length > 1 ? 'S' : ''
                } À PROTÉGER`
              : 'AUCUNE GÊNE'}
          </Text>
          {injuredZones.length > 0 ? (
            <Text style={styles.injuryText}>
              {injuredZones.join(' · ')}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textMuted}
        />
      </Pressable>

      <PrimaryButton
        label="CONSTRUIRE MA SÉANCE"
        icon="arrow-forward"
        onPress={onContinue}
        busy={busy}
      />
      <View style={styles.bottomSpace} />
    </ScrollView>
  );
}

function BuildStep({
  blocks,
  allowedModules,
  gymStyles,
  onAddBlock,
  onRemoveBlock,
  onMoveBlock,
  onUpdateBlock,
  onAddExercise,
  onRemoveItem,
  onMoveItem,
  onUpdateItem,
  onUpdatePrescription,
  onSave,
  onValidate,
  busy,
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.builderTopRow}>
        <View style={styles.flexOne}>
          <Text style={styles.builderHeadline}>
            COMPOSE TA SÉANCE
          </Text>
          <Text style={styles.builderSubline}>
            Ajoute les blocs dans l’ordre où tu veux les réaliser.
          </Text>
        </View>
        <Pressable
          onPress={onSave}
          disabled={busy}
          style={({ pressed }) => [
            styles.saveDraftButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name="save-outline"
            size={18}
            color={colors.primaryLight}
          />
          <Text style={styles.saveDraftText}>SAUVER</Text>
        </Pressable>
      </View>

      <SectionTitle title="AJOUTER UN BLOC" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.modulePicker}
      >
        {allowedModules.map((moduleCode) => {
          const meta = MODULE_META[moduleCode] ?? {
            label: moduleCode,
            subtitle: '',
            icon: 'add-outline',
          };
          return (
            <Pressable
              key={moduleCode}
              onPress={() => onAddBlock(moduleCode)}
              style={({ pressed }) => [
                styles.moduleAddCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.moduleAddIcon}>
                <Ionicons
                  name={meta.icon}
                  size={21}
                  color={colors.primaryLight}
                />
              </View>
              <Text style={styles.moduleAddTitle}>
                {meta.label.toUpperCase()}
              </Text>
              <Ionicons
                name="add-circle"
                size={20}
                color={colors.primaryLight}
              />
            </Pressable>
          );
        })}
      </ScrollView>

      {blocks.length === 0 ? (
        <View style={styles.emptyBuilderCard}>
          <Ionicons
            name="layers-outline"
            size={29}
            color={colors.textMuted}
          />
          <Text style={styles.emptyBuilderTitle}>
            TA SÉANCE EST VIDE
          </Text>
          <Text style={styles.emptyBuilderText}>
            Commence par ajouter un bloc ci-dessus. Tu pourras ensuite choisir les exercices et leur prescription.
          </Text>
        </View>
      ) : (
        <View style={styles.blocksStack}>
          {blocks.map((block, blockIndex) => (
            <BuilderBlock
              key={block.clientId}
              block={block}
              blockIndex={blockIndex}
              totalBlocks={blocks.length}
              gymStyles={gymStyles}
              onRemove={() => onRemoveBlock(blockIndex)}
              onMoveUp={() => onMoveBlock(blockIndex, -1)}
              onMoveDown={() => onMoveBlock(blockIndex, 1)}
              onUpdate={(patch) =>
                onUpdateBlock(blockIndex, patch)
              }
              onAddExercise={() =>
                onAddExercise(blockIndex)
              }
              onRemoveItem={(itemIndex) =>
                onRemoveItem(blockIndex, itemIndex)
              }
              onMoveItem={(itemIndex, direction) =>
                onMoveItem(
                  blockIndex,
                  itemIndex,
                  direction
                )
              }
              onUpdateItem={(itemIndex, patch) =>
                onUpdateItem(
                  blockIndex,
                  itemIndex,
                  patch
                )
              }
              onUpdatePrescription={(
                itemIndex,
                key,
                value
              ) =>
                onUpdatePrescription(
                  blockIndex,
                  itemIndex,
                  key,
                  value
                )
              }
            />
          ))}
        </View>
      )}

      <PrimaryButton
        label="CONTRÔLER MA SÉANCE"
        icon="shield-checkmark-outline"
        onPress={onValidate}
        busy={busy}
        disabled={blocks.length === 0}
      />
      <View style={styles.bottomSpace} />
    </ScrollView>
  );
}

function BuilderBlock({
  block,
  blockIndex,
  totalBlocks,
  gymStyles,
  onRemove,
  onMoveUp,
  onMoveDown,
  onUpdate,
  onAddExercise,
  onRemoveItem,
  onMoveItem,
  onUpdateItem,
  onUpdatePrescription,
}) {
  const meta = MODULE_META[block.module_code] ?? {
    label: block.module_code,
    subtitle: '',
    icon: 'layers-outline',
  };

  return (
    <View style={styles.blockCard}>
      <View style={styles.blockHeader}>
        <View style={styles.blockIndexBadge}>
          <Text style={styles.blockIndexText}>
            {String(blockIndex + 1).padStart(2, '0')}
          </Text>
        </View>
        <View style={styles.flexOne}>
          <Text style={styles.blockTitle}>
            {meta.label.toUpperCase()}
          </Text>
          <Text style={styles.blockSubtitle}>
            {meta.subtitle}
          </Text>
        </View>
        <View style={styles.blockActions}>
          <IconAction
            icon="arrow-up"
            onPress={onMoveUp}
            disabled={blockIndex === 0}
          />
          <IconAction
            icon="arrow-down"
            onPress={onMoveDown}
            disabled={blockIndex === totalBlocks - 1}
          />
          <IconAction
            icon="trash-outline"
            onPress={onRemove}
            danger
          />
        </View>
      </View>

      <View style={styles.blockConfigRow}>
        <View style={styles.flexOne}>
          <FieldLabel label="DURÉE DU BLOC (OPTIONNEL)" />
          <TextInput
            value={String(block.duration_minutes ?? '')}
            onChangeText={(value) =>
              onUpdate({ duration_minutes: value })
            }
            placeholder="ex. 15"
            placeholderTextColor={colors.textDisabled}
            keyboardType="number-pad"
            style={styles.compactInput}
          />
        </View>
      </View>

      {block.module_code === 'STRENGTH' &&
      gymStyles.length > 0 ? (
        <View style={styles.styleSelectorWrap}>
          <FieldLabel label="FORMAT D’EXÉCUTION" />
          <View style={styles.chipRow}>
            {gymStyles.map((style) => (
              <ChoiceChip
                key={style.style_code}
                label={style.label_fr.toUpperCase()}
                selected={
                  block.execution_style === style.style_code
                }
                onPress={() =>
                  onUpdate({
                    execution_style: style.style_code,
                  })
                }
              />
            ))}
          </View>
          {block.execution_style === 'SUPERSETS' ? (
            <Text style={styles.blockHint}>
              Les exercices sont appairés automatiquement dans l’ordre : A1/A2, B1/B2…
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.exerciseList}>
        {block.items.map((item, itemIndex) => (
          <BuilderExercise
            key={item.clientId}
            item={item}
            itemIndex={itemIndex}
            totalItems={block.items.length}
            moduleCode={block.module_code}
            executionStyle={block.execution_style}
            onRemove={() => onRemoveItem(itemIndex)}
            onMoveUp={() => onMoveItem(itemIndex, -1)}
            onMoveDown={() => onMoveItem(itemIndex, 1)}
            onUpdate={(patch) =>
              onUpdateItem(itemIndex, patch)
            }
            onUpdatePrescription={(key, value) =>
              onUpdatePrescription(
                itemIndex,
                key,
                value
              )
            }
          />
        ))}
      </View>

      <Pressable
        onPress={onAddExercise}
        style={({ pressed }) => [
          styles.addExerciseButton,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name="add"
          size={20}
          color={colors.primaryLight}
        />
        <Text style={styles.addExerciseText}>
          AJOUTER UN EXERCICE
        </Text>
      </Pressable>
    </View>
  );
}

function BuilderExercise({
  item,
  itemIndex,
  totalItems,
  moduleCode,
  executionStyle,
  onRemove,
  onMoveUp,
  onMoveDown,
  onUpdate,
  onUpdatePrescription,
}) {
  const supersetLabel =
    moduleCode === 'STRENGTH' &&
    executionStyle === 'SUPERSETS'
      ? `${String.fromCharCode(
          65 + Math.floor(itemIndex / 2)
        )}${(itemIndex % 2) + 1}`
      : null;

  return (
    <View style={styles.exerciseCard}>
      <View style={styles.exerciseHeader}>
        {supersetLabel ? (
          <View style={styles.supersetBadge}>
            <Text style={styles.supersetBadgeText}>
              {supersetLabel}
            </Text>
          </View>
        ) : (
          <Text style={styles.exerciseOrder}>
            {itemIndex + 1}
          </Text>
        )}
        <View style={styles.flexOne}>
          <Text style={styles.exerciseName}>
            {item.exercise_name}
          </Text>
          <Text style={styles.exerciseMeta}>
            {[item.movement_pattern, item.body_region]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <View style={styles.exerciseActions}>
          <IconAction
            icon="chevron-up"
            onPress={onMoveUp}
            disabled={itemIndex === 0}
          />
          <IconAction
            icon="chevron-down"
            onPress={onMoveDown}
            disabled={itemIndex === totalItems - 1}
          />
          <IconAction
            icon="close"
            onPress={onRemove}
            danger
          />
        </View>
      </View>

      {moduleCode === 'STRENGTH' ? (
        <View style={styles.prescriptionGrid}>
          <NumberField
            label="SÉRIES"
            value={item.prescription?.sets}
            onChange={(value) =>
              onUpdatePrescription('sets', value)
            }
          />
          <NumberField
            label="REPS"
            value={item.prescription?.reps}
            onChange={(value) =>
              onUpdatePrescription('reps', value)
            }
          />
          <NumberField
            label="CHARGE KG"
            value={item.prescription?.load_kg}
            onChange={(value) =>
              onUpdatePrescription('load_kg', value)
            }
            decimal
          />
          <NumberField
            label="REPOS SEC"
            value={item.prescription?.rest_seconds}
            onChange={(value) =>
              onUpdatePrescription(
                'rest_seconds',
                value
              )
            }
          />
        </View>
      ) : ['CARDIO', 'CONDITIONING'].includes(
          moduleCode
        ) ? (
        <View style={styles.prescriptionGrid}>
          <NumberField
            label="DURÉE MIN"
            value={item.prescription?.duration_minutes}
            onChange={(value) =>
              onUpdatePrescription(
                'duration_minutes',
                value
              )
            }
          />
          <NumberField
            label="DISTANCE M"
            value={item.prescription?.distance_meters}
            onChange={(value) =>
              onUpdatePrescription(
                'distance_meters',
                value
              )
            }
          />
        </View>
      ) : (
        <View style={styles.freePrescriptionWrap}>
          <FieldLabel label="CE QUE TU VEUX FAIRE" />
          <TextInput
            value={item.prescription?.text ?? ''}
            onChangeText={(value) =>
              onUpdatePrescription('text', value)
            }
            placeholder="ex. 3 × 8 reps propres, 5 min de pratique…"
            placeholderTextColor={colors.textDisabled}
            multiline
            style={styles.textArea}
          />
          <NumberField
            label="DURÉE MIN (OPTIONNEL)"
            value={item.prescription?.duration_minutes}
            onChange={(value) =>
              onUpdatePrescription(
                'duration_minutes',
                value
              )
            }
          />
        </View>
      )}

      <TextInput
        value={item.notes ?? ''}
        onChangeText={(value) =>
          onUpdate({ notes: value })
        }
        placeholder="Note perso (optionnel)"
        placeholderTextColor={colors.textDisabled}
        style={styles.noteInput}
      />
    </View>
  );
}

function ReviewStep({
  validation,
  blocks,
  acceptWarnings,
  onAcceptWarnings,
  onEdit,
  onSaveLater,
  onStartNow,
  busy,
}) {
  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const pass = Boolean(validation?.pass);
  const duration = validation?.duration_estimate;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.reviewHero,
          pass
            ? styles.reviewHeroPass
            : styles.reviewHeroFail,
        ]}
      >
        <View
          style={[
            styles.reviewIcon,
            pass
              ? styles.reviewIconPass
              : styles.reviewIconFail,
          ]}
        >
          <Ionicons
            name={
              pass
                ? 'checkmark'
                : 'alert-outline'
            }
            size={29}
            color={
              pass
                ? colors.primaryLight
                : colors.brandRed
            }
          />
        </View>
        <Text style={styles.reviewTitle}>
          {pass
            ? 'TA SÉANCE EST PRÊTE'
            : 'QUELQUES POINTS À CORRIGER'}
        </Text>
        <Text style={styles.reviewText}>
          {pass
            ? 'Ugerod a contrôlé le contexte, le matériel et les garde-fous sans remplacer tes choix.'
            : 'Corrige les éléments bloquants puis relance le contrôle.'}
        </Text>
      </View>

      {duration ? (
        <View style={styles.durationSummaryCard}>
          <View>
            <Text style={styles.durationSummaryLabel}>
              DURÉE ESTIMÉE
            </Text>
            <Text style={styles.durationSummaryValue}>
              {duration.estimated_minutes ?? '—'}
              <Text style={styles.durationSummaryUnit}>
                {' '}MIN
              </Text>
            </Text>
          </View>
          <View style={styles.durationSummaryRight}>
            <Text style={styles.durationSummaryTarget}>
              / {duration.available_minutes ?? '—'} MIN DISPONIBLES
            </Text>
            <Text style={styles.durationSummaryStatus}>
              {duration.status ?? '—'}
            </Text>
          </View>
        </View>
      ) : null}

      {errors.length > 0 ? (
        <IssueSection
          title="À CORRIGER"
          issues={errors}
          tone="error"
        />
      ) : null}

      {warnings.length > 0 ? (
        <>
          <IssueSection
            title="À SAVOIR"
            issues={warnings}
            tone="warning"
          />
          <Pressable
            onPress={() =>
              onAcceptWarnings(!acceptWarnings)
            }
            style={({ pressed }) => [
              styles.warningConsent,
              acceptWarnings &&
                styles.warningConsentSelected,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={
                acceptWarnings
                  ? 'checkmark-circle'
                  : 'ellipse-outline'
              }
              size={21}
              color={
                acceptWarnings
                  ? colors.primaryLight
                  : colors.textMuted
              }
            />
            <Text style={styles.warningConsentText}>
              JE CONSERVE MES CHOIX MALGRÉ CES AVERTISSEMENTS
            </Text>
          </Pressable>
        </>
      ) : null}

      <SectionTitle title="RÉCAPITULATIF" />
      <View style={styles.reviewBlocks}>
        {blocks.map((block, index) => (
          <View
            key={block.clientId}
            style={styles.reviewBlockRow}
          >
            <Text style={styles.reviewBlockIndex}>
              {String(index + 1).padStart(2, '0')}
            </Text>
            <View style={styles.flexOne}>
              <Text style={styles.reviewBlockTitle}>
                {(MODULE_META[block.module_code]?.label ??
                  block.module_code
                ).toUpperCase()}
              </Text>
              <Text style={styles.reviewBlockMeta}>
                {block.items.length} exercice
                {block.items.length > 1 ? 's' : ''}
                {block.duration_minutes
                  ? ` · ${block.duration_minutes} min`
                  : ''}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        onPress={onEdit}
        style={({ pressed }) => [
          styles.secondaryButton,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name="create-outline"
          size={19}
          color={colors.primaryLight}
        />
        <Text style={styles.secondaryButtonText}>
          MODIFIER LA SÉANCE
        </Text>
      </Pressable>

      <PrimaryButton
        label="COMMENCER MAINTENANT"
        icon="play"
        onPress={onStartNow}
        busy={busy}
        disabled={!pass}
      />

      <Pressable
        onPress={onSaveLater}
        disabled={!pass || busy}
        style={({ pressed }) => [
          styles.saveLaterButton,
          !pass && styles.buttonDisabled,
          pressed && pass && styles.pressed,
        ]}
      >
        <Ionicons
          name="bookmark-outline"
          size={19}
          color={colors.textPrimary}
        />
        <Text style={styles.saveLaterText}>
          ENREGISTRER POUR PLUS TARD
        </Text>
      </Pressable>
      <View style={styles.bottomSpace} />
    </ScrollView>
  );
}

function ExercisePicker({
  visible,
  onClose,
  query,
  onQuery,
  onSearch,
  results,
  loading,
  onSelect,
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalScreen}>
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.modalEyebrow}>
              CATALOGUE FILTRÉ
            </Text>
            <Text style={styles.modalTitle}>
              AJOUTER UN EXERCICE
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={styles.modalClose}
          >
            <Ionicons
              name="close"
              size={23}
              color={colors.textPrimary}
            />
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Ionicons
            name="search"
            size={19}
            color={colors.textMuted}
          />
          <TextInput
            value={query}
            onChangeText={onQuery}
            onSubmitEditing={onSearch}
            placeholder="Rechercher un exercice…"
            placeholderTextColor={colors.textDisabled}
            returnKeyType="search"
            style={styles.searchInput}
          />
          <Pressable
            onPress={onSearch}
            style={styles.searchButton}
          >
            <Text style={styles.searchButtonText}>
              OK
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.modalLoading}>
            <ActivityIndicator
              color={colors.primaryLight}
            />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.exerciseResults}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {results.map((exercise) => (
              <Pressable
                key={exercise.exercise_id}
                onPress={() => onSelect(exercise)}
                disabled={!exercise.selectable}
                style={({ pressed }) => [
                  styles.exerciseResultCard,
                  !exercise.selectable &&
                    styles.exerciseResultDisabled,
                  pressed &&
                    exercise.selectable &&
                    styles.pressed,
                ]}
              >
                <View style={styles.flexOne}>
                  <View style={styles.resultTopLine}>
                    <Text
                      style={[
                        styles.exerciseResultName,
                        !exercise.selectable &&
                          styles.exerciseResultNameDisabled,
                      ]}
                    >
                      {exercise.name}
                    </Text>
                    {exercise.recent_exposures_28d > 0 ? (
                      <View style={styles.recentBadge}>
                        <Text style={styles.recentBadgeText}>
                          {exercise.recent_exposures_28d}× / 28J
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.exerciseResultMeta}>
                    {[
                      exercise.movement_pattern,
                      exercise.body_region,
                      exercise.difficulty,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {(exercise.equipment ?? []).length > 0 ? (
                    <Text style={styles.exerciseResultEquipment}>
                      {(exercise.equipment ?? [])
                        .map((item) => item.name)
                        .join(' · ')}
                    </Text>
                  ) : null}
                  {!exercise.selectable ? (
                    <Text style={styles.blockedReason}>
                      {(
                        exercise.hard_reason_codes ?? []
                      )
                        .map((code) =>
                          getIssueText({ code })
                        )
                        .join(' · ')}
                    </Text>
                  ) : (exercise.warning_codes ?? []).length > 0 ? (
                    <Text style={styles.warningReason}>
                      Choix possible · Ugerod signalera les adaptations au contrôle.
                    </Text>
                  ) : null}
                </View>
                <Ionicons
                  name={
                    exercise.selectable
                      ? 'add-circle'
                      : 'lock-closed-outline'
                  }
                  size={22}
                  color={
                    exercise.selectable
                      ? colors.primaryLight
                      : colors.textDisabled
                  }
                />
              </Pressable>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function IssueSection({ title, issues, tone }) {
  return (
    <View style={styles.issueSection}>
      <Text
        style={[
          styles.issueTitle,
          tone === 'error'
            ? styles.issueTitleError
            : styles.issueTitleWarning,
        ]}
      >
        {title}
      </Text>
      <View style={styles.stackGapSmall}>
        {issues.map((issue, index) => (
          <View
            key={`${issue.code}-${index}`}
            style={styles.issueRow}
          >
            <Ionicons
              name={
                tone === 'error'
                  ? 'close-circle-outline'
                  : 'information-circle-outline'
              }
              size={19}
              color={
                tone === 'error'
                  ? colors.brandRed
                  : colors.warning
              }
            />
            <Text style={styles.issueText}>
              {getIssueText(issue)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function IntroCard({ icon, title, text }) {
  return (
    <View style={styles.introCard}>
      <View style={styles.introIcon}>
        <Ionicons
          name={icon}
          size={22}
          color={colors.primaryLight}
        />
      </View>
      <View style={styles.flexOne}>
        <Text style={styles.introTitle}>{title}</Text>
        <Text style={styles.introText}>{text}</Text>
      </View>
    </View>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <View style={styles.sectionTitleWrap}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? (
        <Text style={styles.sectionSubtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

function FieldLabel({ label }) {
  return (
    <Text style={styles.fieldLabel}>{label}</Text>
  );
}

function NumberField({
  label,
  value,
  onChange,
  decimal = false,
}) {
  return (
    <View style={styles.numberField}>
      <FieldLabel label={label} />
      <TextInput
        value={String(value ?? '')}
        onChangeText={onChange}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        placeholder="—"
        placeholderTextColor={colors.textDisabled}
        style={styles.numberInput}
      />
    </View>
  );
}

function ChoiceChip({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceChip,
        selected && styles.choiceChipSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.choiceChipText,
          selected && styles.choiceChipTextSelected,
        ]}
      >
        {label}
      </Text>
      {selected ? (
        <Ionicons
          name="checkmark"
          size={15}
          color={colors.primaryLight}
        />
      ) : null}
    </Pressable>
  );
}

function IconAction({
  icon,
  onPress,
  disabled = false,
  danger = false,
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconAction,
        disabled && styles.iconActionDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={
          disabled
            ? colors.textDisabled
            : danger
              ? colors.brandRed
              : colors.textSecondary
        }
      />
    </Pressable>
  );
}

function PrimaryButton({
  label,
  icon,
  onPress,
  busy,
  disabled = false,
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      style={({ pressed }) => [
        styles.primaryButton,
        (busy || disabled) && styles.buttonDisabled,
        pressed && !busy && !disabled && styles.primaryButtonPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={colors.brandWhite}
        />
      ) : (
        <>
          <Text style={styles.primaryButtonText}>
            {label}
          </Text>
          <Ionicons
            name={icon}
            size={20}
            color={colors.brandWhite}
          />
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: 14,
  },
  centerStateText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },
  header: {
    minHeight: 76,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerText: {
    flex: 1,
    marginLeft: 13,
  },
  headerEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 1.15,
    color: colors.textMuted,
  },
  headerTitle: {
    marginTop: 2,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 29,
    lineHeight: 31,
    letterSpacing: 1.3,
    color: colors.textPrimary,
  },
  blueDot: {
    color: colors.primaryLight,
  },
  brandIcon: {
    width: 36,
    height: 36,
  },
  pressed: {
    opacity: 0.72,
  },
  stepBar: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 13,
    flexDirection: 'row',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    backgroundColor: colors.backgroundSoft,
  },
  stepItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  stepCircle: {
    width: 25,
    height: 25,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stepCircleActive: {
    borderColor: 'rgba(29,140,255,0.45)',
    backgroundColor: colors.primaryTransparent,
  },
  stepNumber: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    color: colors.textMuted,
  },
  stepNumberActive: {
    color: colors.primaryLight,
  },
  stepLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.6,
    color: colors.textMuted,
  },
  stepLabelActive: {
    color: colors.textPrimary,
  },
  errorBanner: {
    marginHorizontal: spacing.xl,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: colors.errorTransparent,
    borderWidth: 1,
    borderColor: 'rgba(255,59,59,0.35)',
  },
  errorBannerText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 20,
  },
  introCard: {
    padding: 16,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(29,140,255,0.20)',
  },
  introIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTransparent,
  },
  introTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },
  introText: {
    marginTop: 4,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  sectionTitleWrap: {
    marginTop: 24,
    marginBottom: 11,
  },
  sectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    letterSpacing: 0.75,
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
  },
  environmentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  environmentCard: {
    width: '48%',
    minHeight: 92,
    padding: 14,
    borderRadius: 15,
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionCardSelected: {
    borderColor: 'rgba(29,140,255,0.55)',
    backgroundColor: colors.primaryTransparent,
  },
  environmentTitle: {
    marginTop: 14,
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.55,
    color: colors.textSecondary,
  },
  selectedText: {
    color: colors.primaryLight,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceChip: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  choiceChipSelected: {
    backgroundColor: colors.primaryTransparent,
    borderColor: 'rgba(29,140,255,0.48)',
  },
  choiceChipText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.45,
    color: colors.textSecondary,
  },
  choiceChipTextSelected: {
    color: colors.primaryLight,
  },
  stackGap: {
    gap: 9,
  },
  stackGapSmall: {
    gap: 7,
  },
  formatCard: {
    minHeight: 72,
    padding: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formatCardMain: {
    flex: 1,
  },
  formatTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.55,
    color: colors.textPrimary,
  },
  formatDescription: {
    marginTop: 4,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
  },
  clearEquipmentButton: {
    minHeight: 46,
    paddingHorizontal: 13,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearEquipmentButtonSelected: {
    backgroundColor: colors.primaryTransparent,
    borderColor: 'rgba(29,140,255,0.45)',
  },
  clearEquipmentText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.45,
    color: colors.textSecondary,
  },
  equipmentCategory: {
    marginTop: 16,
  },
  equipmentCategoryTitle: {
    marginBottom: 8,
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.7,
    color: colors.textMuted,
  },
  injuryCard: {
    minHeight: 64,
    padding: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  injuryTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    color: colors.textPrimary,
  },
  injuryText: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
  primaryButton: {
    minHeight: 54,
    marginTop: 26,
    paddingHorizontal: 18,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: colors.primary,
  },
  primaryButtonPressed: {
    transform: [{ scale: 0.992 }],
    opacity: 0.86,
  },
  primaryButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    letterSpacing: 0.75,
    color: colors.brandWhite,
  },
  buttonDisabled: {
    opacity: 0.38,
  },
  bottomSpace: {
    height: 38,
  },
  builderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  builderHeadline: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 30,
    lineHeight: 32,
    letterSpacing: 1.1,
    color: colors.textPrimary,
  },
  builderSubline: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
  },
  saveDraftButton: {
    minHeight: 38,
    paddingHorizontal: 11,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryTransparent,
    borderWidth: 1,
    borderColor: 'rgba(29,140,255,0.25)',
  },
  saveDraftText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.5,
    color: colors.primaryLight,
  },
  modulePicker: {
    gap: 9,
    paddingRight: spacing.xl,
  },
  moduleAddCard: {
    width: 126,
    minHeight: 104,
    padding: 12,
    borderRadius: 14,
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moduleAddIcon: {
    width: 35,
    height: 35,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTransparent,
  },
  moduleAddTitle: {
    marginVertical: 8,
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.45,
    color: colors.textPrimary,
  },
  emptyBuilderCard: {
    marginTop: 22,
    padding: 28,
    borderRadius: 17,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  emptyBuilderTitle: {
    marginTop: 11,
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.6,
    color: colors.textPrimary,
  },
  emptyBuilderText: {
    marginTop: 6,
    textAlign: 'center',
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 16,
    color: colors.textMuted,
  },
  blocksStack: {
    marginTop: 22,
    gap: 14,
  },
  blockCard: {
    padding: 15,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  blockIndexBadge: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTransparent,
  },
  blockIndexText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 19,
    color: colors.primaryLight,
  },
  blockTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    letterSpacing: 0.6,
    color: colors.textPrimary,
  },
  blockSubtitle: {
    marginTop: 2,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    color: colors.textMuted,
  },
  blockActions: {
    flexDirection: 'row',
    gap: 3,
  },
  iconAction: {
    width: 31,
    height: 31,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundSoft,
  },
  iconActionDisabled: {
    opacity: 0.35,
  },
  blockConfigRow: {
    marginTop: 15,
    flexDirection: 'row',
    gap: 10,
  },
  fieldLabel: {
    marginBottom: 6,
    fontFamily: 'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.55,
    color: colors.textMuted,
  },
  compactInput: {
    minHeight: 41,
    paddingHorizontal: 12,
    borderRadius: 11,
    fontFamily: 'Oswald_500Medium',
    fontSize: 12,
    color: colors.textPrimary,
    backgroundColor: colors.backgroundSoft,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  styleSelectorWrap: {
    marginTop: 15,
  },
  blockHint: {
    marginTop: 8,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    lineHeight: 14,
    color: colors.textMuted,
  },
  exerciseList: {
    marginTop: 14,
    gap: 9,
  },
  exerciseCard: {
    padding: 12,
    borderRadius: 13,
    backgroundColor: colors.backgroundSoft,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  exerciseOrder: {
    width: 23,
    textAlign: 'center',
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 19,
    color: colors.textMuted,
  },
  supersetBadge: {
    minWidth: 31,
    height: 31,
    paddingHorizontal: 6,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTransparent,
  },
  supersetBadgeText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    color: colors.primaryLight,
  },
  exerciseName: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    color: colors.textPrimary,
  },
  exerciseMeta: {
    marginTop: 2,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    color: colors.textMuted,
  },
  exerciseActions: {
    flexDirection: 'row',
    gap: 2,
  },
  prescriptionGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  numberField: {
    minWidth: 92,
    flexGrow: 1,
    flexBasis: '45%',
  },
  numberInput: {
    minHeight: 40,
    paddingHorizontal: 11,
    borderRadius: 10,
    fontFamily: 'Oswald_500Medium',
    fontSize: 12,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  freePrescriptionWrap: {
    marginTop: 12,
  },
  textArea: {
    minHeight: 70,
    padding: 11,
    borderRadius: 10,
    textAlignVertical: 'top',
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteInput: {
    minHeight: 38,
    marginTop: 10,
    paddingHorizontal: 10,
    borderRadius: 9,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  addExerciseButton: {
    minHeight: 44,
    marginTop: 12,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.primaryTransparent,
    borderWidth: 1,
    borderColor: 'rgba(29,140,255,0.24)',
  },
  addExerciseText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.55,
    color: colors.primaryLight,
  },
  reviewHero: {
    padding: 22,
    borderRadius: 18,
    alignItems: 'center',
    borderWidth: 1,
  },
  reviewHeroPass: {
    backgroundColor: colors.primaryTransparent,
    borderColor: 'rgba(29,140,255,0.28)',
  },
  reviewHeroFail: {
    backgroundColor: colors.errorTransparent,
    borderColor: 'rgba(255,59,59,0.28)',
  },
  reviewIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  reviewIconPass: {
    backgroundColor: 'rgba(29,140,255,0.12)',
    borderColor: 'rgba(29,140,255,0.30)',
  },
  reviewIconFail: {
    backgroundColor: 'rgba(255,59,59,0.10)',
    borderColor: 'rgba(255,59,59,0.30)',
  },
  reviewTitle: {
    marginTop: 13,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 29,
    letterSpacing: 1.1,
    color: colors.textPrimary,
  },
  reviewText: {
    marginTop: 6,
    maxWidth: 330,
    textAlign: 'center',
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  durationSummaryCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  durationSummaryLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.7,
    color: colors.textMuted,
  },
  durationSummaryValue: {
    marginTop: 3,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 34,
    color: colors.textPrimary,
  },
  durationSummaryUnit: {
    fontSize: 17,
    color: colors.primaryLight,
  },
  durationSummaryRight: {
    alignItems: 'flex-end',
  },
  durationSummaryTarget: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    color: colors.textSecondary,
  },
  durationSummaryStatus: {
    marginTop: 4,
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    color: colors.primaryLight,
  },
  issueSection: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  issueTitle: {
    marginBottom: 10,
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.65,
  },
  issueTitleError: {
    color: colors.brandRed,
  },
  issueTitleWarning: {
    color: colors.warning,
  },
  issueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  issueText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textSecondary,
  },
  warningConsent: {
    minHeight: 52,
    marginTop: 10,
    paddingHorizontal: 13,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  warningConsentSelected: {
    borderColor: 'rgba(29,140,255,0.38)',
  },
  warningConsentText: {
    flex: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 14,
    letterSpacing: 0.4,
    color: colors.textSecondary,
  },
  reviewBlocks: {
    gap: 8,
  },
  reviewBlockRow: {
    minHeight: 58,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  reviewBlockIndex: {
    width: 27,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 19,
    color: colors.primaryLight,
  },
  reviewBlockTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    color: colors.textPrimary,
  },
  reviewBlockMeta: {
    marginTop: 2,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    color: colors.textMuted,
  },
  secondaryButton: {
    minHeight: 48,
    marginTop: 21,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primaryTransparent,
    borderWidth: 1,
    borderColor: 'rgba(29,140,255,0.25)',
  },
  secondaryButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.55,
    color: colors.primaryLight,
  },
  saveLaterButton: {
    minHeight: 50,
    marginTop: 10,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  saveLaterText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.55,
    color: colors.textPrimary,
  },
  modalScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    minHeight: 76,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  modalEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.9,
    color: colors.primaryLight,
  },
  modalTitle: {
    marginTop: 2,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 27,
    color: colors.textPrimary,
  },
  modalClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  searchRow: {
    minHeight: 50,
    marginHorizontal: spacing.xl,
    marginTop: 15,
    paddingLeft: 13,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    color: colors.textPrimary,
  },
  searchButton: {
    alignSelf: 'stretch',
    minWidth: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSoft,
  },
  searchButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    color: colors.primaryLight,
  },
  modalLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseResults: {
    padding: spacing.xl,
    gap: 8,
  },
  exerciseResultCard: {
    minHeight: 78,
    padding: 13,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exerciseResultDisabled: {
    opacity: 0.48,
  },
  resultTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exerciseResultName: {
    flex: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    color: colors.textPrimary,
  },
  exerciseResultNameDisabled: {
    color: colors.textSecondary,
  },
  exerciseResultMeta: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    color: colors.textMuted,
  },
  exerciseResultEquipment: {
    marginTop: 4,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    color: colors.textSecondary,
  },
  recentBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.primaryTransparent,
  },
  recentBadgeText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 8,
    color: colors.primaryLight,
  },
  blockedReason: {
    marginTop: 5,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    lineHeight: 13,
    color: colors.brandRed,
  },
  warningReason: {
    marginTop: 5,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    lineHeight: 13,
    color: colors.warning,
  },
});
