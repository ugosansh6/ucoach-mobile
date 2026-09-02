import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useCallback, useMemo, useRef, useState } from 'react';

import { spacing, typography } from '../constants';
import { useUgerodTheme } from '../contexts/UgerodThemeContext';
import { useWorkout } from '../contexts/WorkoutContext';
import {
  getEquipmentCatalog,
  getUserEquipmentInventory,
} from '../services/equipmentService';

const darkBrandIcon = require('../../assets/branding/ugerod-icon.png');
const lightBrandIcon = require('../../assets/branding/LOGO VERSION NOIR.png');

const DURATIONS = [20, 30, 45, 60, 75, 90];

const ENVIRONMENTS = [
  { code: 'HOME', label: 'Maison', icon: 'home-outline' },
  { code: 'BOX', label: 'Box', icon: 'fitness-outline' },
  { code: 'GYM', label: 'Salle', icon: 'barbell-outline' },
  { code: 'OUTDOOR', label: 'Extérieur', icon: 'sunny-outline' },
];

const OUTDOOR_PLACES = [
  { code: 'CITY_URBAN', label: 'Ville', surface: null },
  { code: 'PARK', label: 'Parc', surface: null },
  { code: 'ATHLETICS_TRACK', label: 'Piste d’athlétisme', surface: 'TRACK' },
  { code: 'GRASS_FIELD', label: 'Pelouse / herbe', surface: 'GRASS' },
  { code: 'FOREST_PATH', label: 'Forêt / sentier', surface: null },
  { code: 'MOUNTAIN', label: 'Montagne', surface: null },
  { code: 'BEACH', label: 'Plage', surface: 'SAND' },
  { code: 'STREET_WORKOUT', label: 'Street workout', surface: null },
  { code: 'OTHER', label: 'Autre', surface: null },
];

const TERRAIN_OPTIONS = [
  { code: 'GRASS', label: 'Herbe / sol souple' },
  { code: 'ROAD', label: 'Sol dur / bitume' },
  { code: 'TRAIL', label: 'Sentier / irrégulier' },
  { code: 'SAND', label: 'Sable' },
  { code: 'MIXED', label: 'Mixte' },
];

const READINESS_OPTIONS = [
  {
    value: 3,
    label: 'Fatigué',
    description: 'J’ai besoin d’une séance plus légère.',
    icon: 'battery-dead-outline',
  },
  {
    value: 6,
    label: 'Normal',
    description: 'Je peux m’entraîner normalement.',
    icon: 'battery-half-outline',
  },
  {
    value: 9,
    label: 'En forme',
    description: 'Je peux pousser davantage aujourd’hui.',
    icon: 'flash-outline',
  },
];

const FOCUS_OPTIONS = [
  { value: null, label: 'UGEROD choisit' },
  { value: 'Upper', label: 'Haut' },
  { value: 'Lower', label: 'Jambes' },
  { value: 'Core', label: 'Core' },
  { value: 'Full Body', label: 'Full body' },
];

const LOAD_CAPABLE_EQUIPMENT_IDS = new Set(['E03', 'E04', 'E09', 'E14']);

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
        detail = fixedLoads
          .map((row) => `${row.quantity}×${row.load} kg`)
          .join(' · ');
      } else if (adjustable) {
        detail = `${adjustable.min_load_kg}–${adjustable.max_load_kg} kg`;
      } else if (hasUnknownLoad) {
        detail = 'Charge non renseignée';
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

function readinessBand(value) {
  const numeric = Number(value ?? 6);
  if (numeric <= 4) return READINESS_OPTIONS[0];
  if (numeric >= 8) return READINESS_OPTIONS[2];
  return READINESS_OPTIONS[1];
}

function summarizeEquipment(equipment) {
  const values = (Array.isArray(equipment) ? equipment : []).filter(Boolean);
  if (values.length === 0 || (values.length === 1 && values[0] === 'Poids du corps')) {
    return 'Poids du corps';
  }
  const names = values.filter((item) => item !== 'Poids du corps');
  if (names.length <= 2) return names.join(' · ');
  return `${names.slice(0, 2).join(' · ')} · +${names.length - 2}`;
}

function summarizePain(painZones) {
  const zones = Array.isArray(painZones) ? painZones.filter(Boolean) : [];
  if (zones.length === 0) return 'À confirmer';
  if (zones.includes('Aucune')) return 'Aucune gêne';
  if (zones.length <= 2) return zones.join(' · ');
  return `${zones.slice(0, 2).join(' · ')} · +${zones.length - 2}`;
}

function environmentSummary(preparation) {
  const code = String(preparation?.environmentCode ?? 'HOME').toUpperCase();
  const environment = ENVIRONMENTS.find((item) => item.code === code);
  if (code !== 'OUTDOOR') return environment?.label ?? 'Maison';

  const place = OUTDOOR_PLACES.find(
    (item) => item.code === preparation?.outdoorPlaceCode
  );
  return place ? `Extérieur · ${place.label}` : 'Extérieur · à préciser';
}

function isAuthSessionError(error) {
  const value = String(error?.message ?? error ?? '').toLowerCase();
  return (
    value.includes('auth session missing') ||
    value.includes('jwt') ||
    value.includes('not authenticated') ||
    value.includes('session')
  );
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
    const nextIndex = Math.max(
      0,
      Math.min(DURATIONS.length - 1, Math.round(clampedX / liveStep))
    );
    const nextValue = DURATIONS[nextIndex];

    if (nextValue !== valueRef.current) {
      valueRef.current = nextValue;
      onChangeRef.current(nextValue);
    }
  };

  const knobPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          dragOriginXRef.current = currentIndexRef.current * stepRef.current;
        },
        onPanResponderMove: (_event, gestureState) => {
          updateFromXRef.current?.(dragOriginXRef.current + gestureState.dx);
        },
        onPanResponderRelease: (_event, gestureState) => {
          updateFromXRef.current?.(dragOriginXRef.current + gestureState.dx);
        },
        onPanResponderTerminate: (_event, gestureState) => {
          updateFromXRef.current?.(dragOriginXRef.current + gestureState.dx);
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    []
  );

  const knobLeft = currentIndex * step;
  const durationColor =
    value <= 30
      ? colors.accent
      : value >= 75
        ? colors.secondaryAccent
        : colors.text;

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
            <View
              style={[
                styles.durationProgress,
                { width: knobLeft, backgroundColor: durationColor },
              ]}
            />
            <View style={styles.durationHitRow}>
              {DURATIONS.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityLabel={`${item} minutes`}
                  onPress={() => onChange(item)}
                  style={styles.durationHit}
                />
              ))}
            </View>
            <View
              {...knobPanResponder.panHandlers}
              style={[
                styles.durationKnob,
                { left: knobLeft, borderColor: durationColor },
              ]}
            >
              <Ionicons name="stopwatch-outline" size={18} color={colors.text} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  accent,
  titleColor,
  emphasized = true,
  selected,
  onPress,
  warning,
  styles,
  colors,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.summaryCard,
        selected && { borderColor: accent },
        pressed && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={[colors.surfaceElevated, colors.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.summaryInner}
      >
        <View style={[styles.summaryAccentBar, { backgroundColor: accent }]} />
        <Ionicons
          name={icon}
          size={76}
          color={accent}
          style={styles.summaryWatermark}
        />

        <View style={styles.summaryTopRow}>
          <View style={[styles.summaryIcon, { backgroundColor: accent }]}>
            <Ionicons name={icon} size={18} color={colors.textOnAccent} />
          </View>
          <Ionicons
            name={selected ? 'chevron-up' : 'chevron-forward'}
            size={19}
            color={colors.textSecondary}
          />
        </View>

        <View style={styles.summaryCopy}>
          <Text
            style={[
              styles.summaryTitle,
              emphasized && styles.summaryTitleEmphasized,
              { color: titleColor ?? accent },
            ]}
          >
            {title}
          </Text>
          <Text
            numberOfLines={2}
            style={[
              styles.summaryValue,
              warning && { color: colors.secondaryAccent },
            ]}
          >
            {value}
          </Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

function ChoiceChip({ label, selected, onPress, styles, colors, icon = null }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceChip,
        selected && styles.choiceChipSelected,
        pressed && styles.pressed,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={16}
          color={selected ? colors.textOnAccent : colors.textSecondary}
        />
      ) : null}
      <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

function EquipmentChoice({ item, selected, onPress, colors, styles }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.equipmentChoice,
        selected && styles.equipmentChoiceSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.flexOne}>
        <Text style={styles.equipmentChoiceTitle}>{item.name.toUpperCase()}</Text>
        {item.detail ? (
          <Text numberOfLines={1} style={styles.equipmentChoiceDetail}>
            {item.detail}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={19}
        color={selected ? colors.accent : colors.textMuted}
      />
    </Pressable>
  );
}

export default function PreparationCheckinV2() {
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;
  const { workout, preparation, updatePreparation } = useWorkout();

  const [expanded, setExpanded] = useState(null);
  const [referenceEquipment, setReferenceEquipment] = useState([]);
  const [equipmentLoading, setEquipmentLoading] = useState(true);
  const [equipmentError, setEquipmentError] = useState('');
  const [equipmentNeedsLogin, setEquipmentNeedsLogin] = useState(false);
  const equipmentRef = useRef(preparation?.equipment ?? []);
  equipmentRef.current = preparation?.equipment ?? [];

  const duration = DURATIONS.includes(Number(preparation?.duration))
    ? Number(preparation.duration)
    : 45;
  const environmentCode = String(preparation?.environmentCode ?? 'HOME').toUpperCase();
  const readiness = Number(preparation?.readiness ?? 6);
  const readinessOption = readinessBand(readiness);
  const painZones = Array.isArray(preparation?.painZones)
    ? preparation.painZones
    : [];
  const painConfirmed = painZones.length > 0;
  const equipment =
    Array.isArray(preparation?.equipment) && preparation.equipment.length > 0
      ? preparation.equipment
      : ['Poids du corps'];
  const focus = preparation?.region ?? null;
  const selectedPlace = OUTDOOR_PLACES.find(
    (item) => item.code === preparation?.outdoorPlaceCode
  );
  const placeNeedsTerrain =
    environmentCode === 'OUTDOOR' && selectedPlace && !selectedPlace.surface;

  const normalizedStatus = String(workout?.status ?? '').toLowerCase();
  const hasActiveSession =
    Boolean(workout?.sessionId) && !['completed', 'abandoned'].includes(normalizedStatus);
  const sessionStarted = Boolean(
    workout?.sessionStarted ||
      workout?.startedAt ||
      workout?.wodStarted ||
      workout?.wodStartedAt ||
      workout?.wodRuntime?.started ||
      normalizedStatus === 'in_progress'
  );

  const loadEquipment = useCallback(async () => {
    setEquipmentLoading(true);
    setEquipmentError('');
    setEquipmentNeedsLogin(false);

    try {
      const [catalog, inventory] = await Promise.all([
        getEquipmentCatalog(),
        getUserEquipmentInventory(),
      ]);
      const reference = buildReferenceEquipment(catalog, inventory);
      setReferenceEquipment(reference);

      const current = Array.isArray(equipmentRef.current)
        ? equipmentRef.current
        : [];
      const allowedNames = new Set(reference.map((item) => item.name));

      if (current.length === 0) {
        updatePreparation({
          equipment:
            reference.length > 0
              ? reference.map((item) => item.name)
              : ['Poids du corps'],
        });
      } else {
        const sanitized = current.filter(
          (name) => name === 'Poids du corps' || allowedNames.has(name)
        );
        const normalized = sanitized.length > 0 ? sanitized : ['Poids du corps'];
        if (normalized.join('|') !== current.join('|')) {
          updatePreparation({ equipment: normalized });
        }
      }
    } catch (error) {
      if (isAuthSessionError(error)) {
        setEquipmentNeedsLogin(true);
        setEquipmentError('');
      } else {
        setEquipmentError('Impossible de charger ton matériel pour le moment.');
      }
    } finally {
      setEquipmentLoading(false);
    }
  }, [updatePreparation]);

  useFocusEffect(
    useCallback(() => {
      loadEquipment();
    }, [loadEquipment])
  );

  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  function togglePanel(panel) {
    setExpanded((current) => (current === panel ? null : panel));
  }

  function selectEnvironment(code) {
    updatePreparation({
      environmentCode: code,
      formatCode: null,
      executionStyle: null,
      outdoorPlaceCode: null,
      surfaceCode: null,
    });
  }

  function selectOutdoorPlace(item) {
    updatePreparation({
      outdoorPlaceCode: item.code,
      surfaceCode: item.surface ?? null,
      formatCode: null,
    });
  }

  function toggleEquipment(name) {
    const isSelected = equipment.includes(name);
    let next;

    if (isSelected) {
      const filtered = equipment.filter((item) => item !== name);
      next = filtered.length > 0 ? filtered : ['Poids du corps'];
    } else if (name === 'Poids du corps') {
      next = ['Poids du corps'];
    } else {
      next = [...equipment.filter((item) => item !== 'Poids du corps'), name];
    }

    updatePreparation({ equipment: next });
  }

  function selectAllProfileEquipment() {
    updatePreparation({
      equipment:
        referenceEquipment.length > 0
          ? referenceEquipment.map((item) => item.name)
          : ['Poids du corps'],
    });
  }

  function handleGenerate() {
    if (!painConfirmed) {
      setExpanded('pain');
      return;
    }

    if (environmentCode === 'OUTDOOR') {
      if (!preparation?.outdoorPlaceCode || !preparation?.surfaceCode) {
        setExpanded('location');
        return;
      }
    }

    updatePreparation({
      duration,
      readiness: readinessOption.value,
      equipment,
      region: focus,
      environmentCode,
    });
    router.push('/workout/generating');
  }

  const canGenerate =
    !equipmentLoading &&
    painConfirmed &&
    (environmentCode !== 'OUTDOOR' ||
      Boolean(preparation?.outdoorPlaceCode && preparation?.surfaceCode));

  const equipmentSummary = equipmentLoading
    ? 'Chargement…'
    : equipmentNeedsLogin
      ? 'Profil non chargé'
      : summarizeEquipment(equipment);

  const painAccent =
    painConfirmed && painZones.includes('Aucune')
      ? colors.success
      : colors.secondaryAccent;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Pressable onPress={handleBack} hitSlop={12} style={styles.headerButton}>
            <Ionicons name="arrow-back" size={21} color={colors.text} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>SÉANCE DU JOUR</Text>
            <Text style={styles.title}>
              PRÉPARATION<Text style={styles.dot}>.</Text>
            </Text>
          </View>
          <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
        </View>

        <Text style={styles.intro}>
          Vérifie ce qui change aujourd’hui. UGEROD s’occupe du reste.
        </Text>

        <DurationControl
          value={duration}
          onChange={(next) => updatePreparation({ duration: next })}
          colors={colors}
          styles={styles}
        />

        <View style={styles.cardGrid}>
          <SummaryCard
            title="LIEU"
            value={environmentSummary(preparation)}
            icon="location-outline"
            accent={colors.accent}
            selected={expanded === 'location'}
            onPress={() => togglePanel('location')}
            styles={styles}
            colors={colors}
          />
          <SummaryCard
            title="MATÉRIEL"
            value={equipmentSummary}
            icon="barbell-outline"
            accent={colors.accent}
            titleColor={colors.accent}
            emphasized
            selected={expanded === 'equipment'}
            onPress={() => togglePanel('equipment')}
            styles={styles}
            colors={colors}
          />
          <SummaryCard
            title="FORME"
            value={readinessOption.label}
            icon="pulse-outline"
            accent={colors.accent}
            selected={expanded === 'readiness'}
            onPress={() => togglePanel('readiness')}
            styles={styles}
            colors={colors}
          />
          <SummaryCard
            title="GÊNES"
            value={summarizePain(painZones)}
            icon={
              painConfirmed && painZones.includes('Aucune')
                ? 'shield-checkmark-outline'
                : 'medical-outline'
            }
            accent={painAccent}
            titleColor={painAccent}
            emphasized
            selected={expanded === 'pain'}
            warning={!painConfirmed || !painZones.includes('Aucune')}
            onPress={() => togglePanel('pain')}
            styles={styles}
            colors={colors}
          />
        </View>

        {expanded === 'location' ? (
          <View style={styles.detailPanel}>
            <Text style={styles.detailEyebrow}>OÙ TU T’ENTRAÎNES ?</Text>
            <Text style={styles.detailHelp}>
              Le lieu décrit ce qui est possible. Il ne décide jamais du type de séance à la place du Coach.
            </Text>
            <View style={styles.choiceGrid}>
              {ENVIRONMENTS.map((item) => (
                <ChoiceChip
                  key={item.code}
                  label={item.label}
                  icon={item.icon}
                  selected={environmentCode === item.code}
                  onPress={() => selectEnvironment(item.code)}
                  styles={styles}
                  colors={colors}
                />
              ))}
            </View>

            {environmentCode === 'OUTDOOR' ? (
              <>
                <Text style={styles.subsectionTitle}>TON LIEU EXTÉRIEUR</Text>
                <View style={styles.choiceGrid}>
                  {OUTDOOR_PLACES.map((item) => (
                    <ChoiceChip
                      key={item.code}
                      label={item.label}
                      selected={preparation?.outdoorPlaceCode === item.code}
                      onPress={() => selectOutdoorPlace(item)}
                      styles={styles}
                      colors={colors}
                    />
                  ))}
                </View>

                {placeNeedsTerrain ? (
                  <>
                    <Text style={styles.subsectionTitle}>QUEL TERRAIN ?</Text>
                    <Text style={styles.detailHelp}>
                      Seulement parce que ce lieu peut avoir plusieurs types de sol.
                    </Text>
                    <View style={styles.choiceGrid}>
                      {TERRAIN_OPTIONS.map((item) => (
                        <ChoiceChip
                          key={item.code}
                          label={item.label}
                          selected={preparation?.surfaceCode === item.code}
                          onPress={() => updatePreparation({ surfaceCode: item.code })}
                          styles={styles}
                          colors={colors}
                        />
                      ))}
                    </View>
                  </>
                ) : selectedPlace ? (
                  <View style={styles.contextOkRow}>
                    <Ionicons name="checkmark-circle" size={17} color={colors.success} />
                    <Text style={styles.contextOkText}>
                      Le terrain est suffisamment clair pour construire la séance.
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}

            <View style={styles.autoRow}>
              <Ionicons name="sparkles-outline" size={17} color={colors.accent} />
              <View style={styles.autoCopy}>
                <Text style={styles.autoTitle}>TYPE DE SÉANCE · UGEROD CHOISIT</Text>
                <Text style={styles.autoText}>
                  Le programme, ta récupération et tes contraintes restent prioritaires.
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {expanded === 'equipment' ? (
          <View style={styles.detailPanel}>
            <View style={styles.detailHeaderRow}>
              <View style={styles.flexOne}>
                <Text style={styles.detailEyebrow}>MATÉRIEL DU JOUR</Text>
                <Text style={styles.detailHelp}>
                  Ta base vient du profil. Décoche simplement ce que tu n’as pas avec toi aujourd’hui.
                </Text>
              </View>
              {equipmentLoading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : null}
            </View>

            {equipmentNeedsLogin ? (
              <View style={styles.infoRow}>
                <Ionicons name="person-circle-outline" size={19} color={colors.accent} />
                <Text style={styles.infoText}>
                  Reconnecte ta session pour récupérer automatiquement le matériel enregistré dans ton profil.
                </Text>
              </View>
            ) : equipmentError ? (
              <Pressable onPress={loadEquipment} style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={17} color={colors.error} />
                <Text style={styles.errorText}>{equipmentError} Réessayer.</Text>
              </Pressable>
            ) : (
              <>
                <View style={styles.quickActions}>
                  <Pressable onPress={selectAllProfileEquipment} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>TOUT MON MATÉRIEL</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => updatePreparation({ equipment: ['Poids du corps'] })}
                    style={styles.quickButton}
                  >
                    <Text style={styles.quickButtonText}>POIDS DU CORPS</Text>
                  </Pressable>
                </View>

                <View style={styles.equipmentGrid}>
                  <EquipmentChoice
                    item={{ name: 'Poids du corps', detail: null }}
                    selected={equipment.includes('Poids du corps')}
                    onPress={() => toggleEquipment('Poids du corps')}
                    colors={colors}
                    styles={styles}
                  />
                  {referenceEquipment.map((item) => (
                    <EquipmentChoice
                      key={item.id}
                      item={item}
                      selected={equipment.includes(item.name)}
                      onPress={() => toggleEquipment(item.name)}
                      colors={colors}
                      styles={styles}
                    />
                  ))}
                </View>

                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/profile/equipment',
                      params: { returnTo: '/workout/preparation' },
                    })
                  }
                  style={styles.inlineLink}
                >
                  <Text style={styles.inlineLinkText}>MODIFIER MON MATÉRIEL DISPO</Text>
                  <Ionicons name="chevron-forward" size={17} color={colors.accent} />
                </Pressable>
              </>
            )}
          </View>
        ) : null}

        {expanded === 'readiness' ? (
          <View style={styles.detailPanel}>
            <Text style={styles.detailEyebrow}>COMMENT TU TE SENS ?</Text>
            <Text style={styles.detailHelp}>
              Choisis simplement l’état qui décrit ta capacité à t’entraîner aujourd’hui.
            </Text>
            <View style={styles.readinessStack}>
              {READINESS_OPTIONS.map((item) => {
                const selected = readinessOption.value === item.value;
                return (
                  <Pressable
                    key={item.value}
                    onPress={() => updatePreparation({ readiness: item.value })}
                    style={({ pressed }) => [
                      styles.readinessChoice,
                      selected && styles.readinessChoiceSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.readinessIcon}>
                      <Ionicons
                        name={item.icon}
                        size={20}
                        color={selected ? colors.accent : colors.textSecondary}
                      />
                    </View>
                    <View style={styles.flexOne}>
                      <Text style={styles.readinessTitle}>{item.label.toUpperCase()}</Text>
                      <Text style={styles.readinessDescription}>{item.description}</Text>
                    </View>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {expanded === 'pain' ? (
          <View style={styles.detailPanel}>
            <Text style={styles.detailEyebrow}>UNE GÊNE AUJOURD’HUI ?</Text>
            <Text style={styles.detailHelp}>
              Confirme-le à chaque séance : cette information protège directement la sélection des exercices.
            </Text>
            <Pressable
              onPress={() => updatePreparation({ painZones: ['Aucune'] })}
              style={({ pressed }) => [
                styles.painChoice,
                painConfirmed && painZones.includes('Aucune') && styles.painChoiceSafe,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="shield-checkmark-outline" size={21} color={colors.success} />
              <View style={styles.flexOne}>
                <Text style={styles.painChoiceTitle}>AUCUNE GÊNE</Text>
                <Text style={styles.painChoiceText}>
                  Je peux m’entraîner normalement aujourd’hui.
                </Text>
              </View>
              {painConfirmed && painZones.includes('Aucune') ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => router.push('/workout/injuries')}
              style={({ pressed }) => [styles.painChoice, pressed && styles.pressed]}
            >
              <Ionicons name="medical-outline" size={21} color={colors.secondaryAccent} />
              <View style={styles.flexOne}>
                <Text style={styles.painChoiceTitle}>J’AI UNE GÊNE</Text>
                <Text style={styles.painChoiceText}>
                  {painConfirmed && !painZones.includes('Aucune')
                    ? summarizePain(painZones)
                    : 'Choisir la ou les zones à protéger.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.focusSection}>
          <Text style={styles.focusTitle}>UNE ENVIE AUJOURD’HUI ?</Text>
          <Text style={styles.focusHelp}>
            Optionnel. UGEROD essaie de la respecter sans casser la logique de ton programme.
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.focusRow}
          >
            {FOCUS_OPTIONS.map((item) => (
              <ChoiceChip
                key={item.label}
                label={item.label}
                selected={focus === item.value}
                onPress={() => updatePreparation({ region: item.value })}
                styles={styles}
                colors={colors}
              />
            ))}
          </ScrollView>
        </View>

        {environmentCode === 'OUTDOOR' &&
        (!preparation?.outdoorPlaceCode || !preparation?.surfaceCode) ? (
          <View style={styles.requiredNotice}>
            <Ionicons name="location-outline" size={17} color={colors.secondaryAccent} />
            <Text style={styles.requiredNoticeText}>
              Précise ton lieu extérieur et, si nécessaire, le terrain.
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleGenerate}
          disabled={equipmentLoading}
          style={({ pressed }) => [
            styles.primaryButton,
            !canGenerate && styles.primaryButtonPending,
            pressed && !equipmentLoading && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>VOIR MA SÉANCE</Text>
          <Ionicons name="arrow-forward" size={21} color={colors.textOnAccent} />
        </Pressable>

        {hasActiveSession ? (
          <View style={styles.resumePanel}>
            <Ionicons name="play-circle-outline" size={21} color={colors.accent} />
            <View style={styles.flexOne}>
              <Text style={styles.resumeTitle}>
                {sessionStarted ? 'SÉANCE EN COURS' : 'SÉANCE DÉJÀ GÉNÉRÉE'}
              </Text>
              <Text style={styles.resumeText}>
                Tu peux reprendre la séance existante sans perdre ta progression.
              </Text>
            </View>
            <Pressable
              onPress={() => router.replace('/workout/session')}
              style={styles.resumeButton}
            >
              <Text style={styles.resumeButtonText}>REPRENDRE</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.bottomSpace} />
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.xl, paddingTop: 8, paddingBottom: 30 },
    header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11 },
    headerButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerCopy: { flex: 1 },
    eyebrow: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      lineHeight: 13,
      letterSpacing: 1,
      color: colors.textSecondary,
    },
    title: {
      ...typography.display,
      fontSize: 31,
      lineHeight: 34,
      letterSpacing: 1.4,
      color: colors.text,
    },
    dot: { color: colors.accent },
    brandIcon: { width: 42, height: 42 },
    intro: {
      marginTop: 3,
      fontFamily: 'Oswald_400Regular',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },

    durationShell: {
      marginTop: 20,
      minHeight: 112,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 16,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 20,
    },
    durationReadout: {
      width: 104,
      marginLeft: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    durationValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 62,
      lineHeight: 60,
      letterSpacing: 2.4,
      textAlign: 'center',
    },
    durationUnit: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 12,
      lineHeight: 15,
      letterSpacing: 2.2,
      marginTop: -2,
      textAlign: 'center',
    },
    durationSliderColumn: { flex: 1, justifyContent: 'center' },
    durationTrackTouch: { height: 60, justifyContent: 'center' },
    durationTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      position: 'relative',
    },
    durationProgress: { height: 4, borderRadius: 2 },
    durationHitRow: {
      position: 'absolute',
      left: -18,
      right: -18,
      top: -24,
      bottom: -24,
      flexDirection: 'row',
      zIndex: 1,
    },
    durationHit: { flex: 1 },
    durationKnob: {
      position: 'absolute',
      top: -18,
      zIndex: 3,
      width: 40,
      height: 40,
      marginLeft: -20,
      borderRadius: 20,
      borderWidth: 2,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },

    cardGrid: {
      marginTop: 14,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    summaryCard: {
      flexGrow: 1,
      flexBasis: '47%',
      minWidth: 145,
      minHeight: 128,
      maxHeight: 150,
      aspectRatio: 1.18,
      borderRadius: 17,
      overflow: 'hidden',
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    summaryInner: {
      flex: 1,
      padding: 12,
      justifyContent: 'space-between',
      overflow: 'hidden',
    },
    summaryAccentBar: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 4,
      opacity: 0.95,
    },
    summaryWatermark: {
      position: 'absolute',
      right: -8,
      top: 28,
      opacity: 0.11,
      transform: [{ rotate: '-8deg' }],
    },
    summaryTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    summaryIcon: {
      width: 36,
      height: 36,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    summaryCopy: { minHeight: 58, justifyContent: 'flex-end', paddingRight: 8 },
    summaryTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 15,
      lineHeight: 19,
      letterSpacing: 0.9,
    },
    summaryTitleEmphasized: {
      fontSize: 20,
      lineHeight: 23,
      letterSpacing: 0.8,
    },
    summaryValue: {
      marginTop: 5,
      fontFamily: 'Oswald_500Medium',
      fontSize: 14,
      lineHeight: 18,
      color: colors.textSecondary,
    },

    detailPanel: {
      marginTop: 10,
      borderRadius: 18,
      padding: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    detailHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    detailEyebrow: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 14,
      letterSpacing: 0.9,
      color: colors.text,
    },
    detailHelp: {
      marginTop: 4,
      fontFamily: 'Oswald_400Regular',
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    subsectionTitle: {
      marginTop: 16,
      fontFamily: 'Oswald_700Bold',
      fontSize: 12,
      letterSpacing: 0.8,
      color: colors.text,
    },
    choiceGrid: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    choiceChip: {
      minHeight: 40,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    choiceChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    choiceChipText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      letterSpacing: 0.4,
      color: colors.textSecondary,
    },
    choiceChipTextSelected: { color: colors.textOnAccent },
    contextOkRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
    contextOkText: {
      flex: 1,
      fontFamily: 'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 15,
      color: colors.textSecondary,
    },
    autoRow: {
      marginTop: 15,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 9,
    },
    autoCopy: { flex: 1 },
    autoTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 10,
      letterSpacing: 0.5,
      color: colors.accent,
    },
    autoText: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 15,
      color: colors.textSecondary,
    },

    quickActions: { marginTop: 11, flexDirection: 'row', gap: 7 },
    quickButton: {
      flex: 1,
      minHeight: 38,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    quickButtonText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      letterSpacing: 0.4,
      color: colors.textSecondary,
    },
    equipmentGrid: { marginTop: 9, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    equipmentChoice: {
      width: '48.5%',
      flexGrow: 1,
      minHeight: 57,
      paddingHorizontal: 10,
      paddingVertical: 9,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    equipmentChoiceSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    equipmentChoiceTitle: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 11,
      lineHeight: 14,
      color: colors.text,
    },
    equipmentChoiceDetail: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 9,
      color: colors.textMuted,
    },
    inlineLink: {
      marginTop: 12,
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    inlineLinkText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 11,
      letterSpacing: 0.4,
      color: colors.accent,
    },
    infoRow: {
      marginTop: 11,
      padding: 10,
      borderRadius: 11,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: colors.accentSoft,
    },
    infoText: {
      flex: 1,
      fontFamily: 'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    errorRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
    errorText: {
      flex: 1,
      fontFamily: 'Oswald_400Regular',
      fontSize: 11,
      color: colors.error,
    },

    readinessStack: { marginTop: 10, gap: 7 },
    readinessChoice: {
      minHeight: 66,
      padding: 11,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    readinessChoiceSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    readinessIcon: {
      width: 37,
      height: 37,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    readinessTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 12,
      letterSpacing: 0.5,
      color: colors.text,
    },
    readinessDescription: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 15,
      color: colors.textSecondary,
    },

    painChoice: {
      marginTop: 9,
      minHeight: 68,
      padding: 11,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    painChoiceSafe: { borderColor: colors.success, backgroundColor: colors.successSoft },
    painChoiceTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 12,
      letterSpacing: 0.45,
      color: colors.text,
    },
    painChoiceText: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 15,
      color: colors.textSecondary,
    },

    focusSection: { marginTop: 18 },
    focusTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 13,
      letterSpacing: 0.8,
      color: colors.text,
    },
    focusHelp: {
      marginTop: 3,
      fontFamily: 'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    focusRow: { paddingTop: 9, paddingRight: 20, gap: 7 },
    requiredNotice: {
      marginTop: 10,
      padding: 10,
      borderRadius: 11,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.secondaryAccentSoft,
      borderWidth: 1,
      borderColor: colors.secondaryAccent,
    },
    requiredNoticeText: {
      flex: 1,
      fontFamily: 'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 15,
      color: colors.textSecondary,
    },

    primaryButton: {
      marginTop: 16,
      minHeight: 58,
      borderRadius: 15,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
    },
    primaryButtonPending: { opacity: 0.78 },
    primaryButtonText: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 23,
      letterSpacing: 1.2,
      color: colors.textOnAccent,
    },
    resumePanel: {
      marginTop: 11,
      padding: 11,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    resumeTitle: { fontFamily: 'Oswald_700Bold', fontSize: 10, color: colors.text },
    resumeText: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 10,
      lineHeight: 14,
      color: colors.textSecondary,
    },
    resumeButton: {
      minHeight: 34,
      paddingHorizontal: 10,
      borderRadius: 9,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resumeButtonText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 9,
      letterSpacing: 0.4,
      color: colors.accent,
    },
    flexOne: { flex: 1 },
    pressed: { opacity: 0.72 },
    bottomSpace: { height: 24 },
  });
}
