import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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
    description: 'Séance plus légère.',
    icon: 'battery-dead-outline',
  },
  {
    value: 6,
    label: 'Normal',
    description: 'Entraînement habituel.',
    icon: 'battery-half-outline',
  },
  {
    value: 9,
    label: 'En forme',
    description: 'Je peux pousser davantage.',
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
        detail = fixedLoads.map((row) => `${row.quantity}×${row.load} kg`).join(' · ');
      } else if (adjustable) {
        detail = `${adjustable.min_load_kg}–${adjustable.max_load_kg} kg`;
      } else if (hasUnknownLoad) {
        detail = 'Charge non renseignée';
      } else if (quantity > 1) {
        detail = `×${quantity}`;
      }

      return { id: item.id, name: item.name, detail };
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
  if (zones.includes('Aucune')) return 'Aucune gêne';
  if (zones.length === 0) return 'À confirmer';
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
  return place ? place.label : 'Extérieur · à préciser';
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

function SummaryCard({ title, value, icon, accent, selected, onPress, warning, styles, colors }) {
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
        <Ionicons name={icon} size={76} color={accent} style={styles.summaryWatermark} />

        <View style={styles.summaryTopRow}>
          <View style={[styles.summaryIcon, { backgroundColor: accent }]}>
            <Ionicons name={icon} size={18} color={colors.textOnAccent} />
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </View>

        <View style={styles.summaryCopy}>
          <Text style={[styles.summaryTitle, { color: accent }]}>{title}</Text>
          <Text
            numberOfLines={2}
            style={[styles.summaryValue, warning && { color: colors.secondaryAccent }]}
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
          size={17}
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
        size={21}
        color={selected ? colors.accent : colors.textMuted}
      />
    </Pressable>
  );
}

function SheetShell({ visible, title, onClose, children, styles, colors, footer = null }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View style={styles.sheetCard} accessibilityViewIsModal>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.sheetClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetScrollContent}
          >
            {children}
          </ScrollView>
          {footer}
        </View>
      </View>
    </Modal>
  );
}

export default function PreparationCheckinV4() {
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;
  const { workout, preparation, updatePreparation } = useWorkout();

  const [sheet, setSheet] = useState(null);
  const [referenceEquipment, setReferenceEquipment] = useState([]);
  const [equipmentLoading, setEquipmentLoading] = useState(true);
  const [equipmentError, setEquipmentError] = useState('');
  const [equipmentNeedsLogin, setEquipmentNeedsLogin] = useState(false);
  const [painConfirmedToday, setPainConfirmedToday] = useState(false);
  const painScreenOpenedRef = useRef(false);
  const equipmentRef = useRef(preparation?.equipment ?? []);
  equipmentRef.current = preparation?.equipment ?? [];

  const duration = DURATIONS.includes(Number(preparation?.duration))
    ? Number(preparation.duration)
    : 45;
  const environmentCode = String(preparation?.environmentCode ?? 'HOME').toUpperCase();
  const readiness = Number(preparation?.readiness ?? 6);
  const readinessOption = readinessBand(readiness);
  const painZones = Array.isArray(preparation?.painZones) ? preparation.painZones : [];
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

      const current = Array.isArray(equipmentRef.current) ? equipmentRef.current : [];
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

  useFocusEffect(
    useCallback(() => {
      if (!painScreenOpenedRef.current) return;
      painScreenOpenedRef.current = false;
      const zones = Array.isArray(preparation?.painZones)
        ? preparation.painZones.filter(Boolean)
        : [];
      if (zones.length > 0) setPainConfirmedToday(true);
    }, [preparation?.painZones])
  );

  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  function selectEnvironment(code) {
    updatePreparation({
      environmentCode: code,
      formatCode: null,
      executionStyle: null,
      outdoorPlaceCode: null,
      surfaceCode: null,
    });
    if (code !== 'OUTDOOR') setSheet(null);
  }

  function selectOutdoorPlace(item) {
    updatePreparation({
      outdoorPlaceCode: item.code,
      surfaceCode: item.surface ?? null,
      formatCode: null,
    });
    if (item.surface) setSheet(null);
  }

  function selectTerrain(code) {
    updatePreparation({ surfaceCode: code });
    setSheet(null);
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

  function selectReadiness(value) {
    updatePreparation({ readiness: value });
    setSheet(null);
  }

  function confirmNoPain() {
    updatePreparation({ painZones: ['Aucune'] });
    setPainConfirmedToday(true);
    setSheet(null);
  }

  function openPainZones() {
    painScreenOpenedRef.current = true;
    setSheet(null);
    router.push('/workout/injuries');
  }

  function handleGenerate() {
    if (!painConfirmedToday) {
      setSheet('pain');
      return;
    }

    if (
      environmentCode === 'OUTDOOR' &&
      (!preparation?.outdoorPlaceCode || !preparation?.surfaceCode)
    ) {
      setSheet('location');
      return;
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

  const equipmentSummary = equipmentLoading
    ? 'Chargement…'
    : equipmentNeedsLogin
      ? 'Profil non chargé'
      : summarizeEquipment(equipment);
  const painSummary = painConfirmedToday ? summarizePain(painZones) : 'À confirmer';
  const painAccent =
    painConfirmedToday && painZones.includes('Aucune')
      ? colors.success
      : colors.secondaryAccent;
  const canGenerate =
    !equipmentLoading &&
    painConfirmedToday &&
    (environmentCode !== 'OUTDOOR' ||
      Boolean(preparation?.outdoorPlaceCode && preparation?.surfaceCode));

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

        <Text style={styles.intro}>Ajuste ta séance du jour.</Text>

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
            selected={sheet === 'location'}
            onPress={() => setSheet('location')}
            styles={styles}
            colors={colors}
          />
          <SummaryCard
            title="MATÉRIEL"
            value={equipmentSummary}
            icon="barbell-outline"
            accent={colors.accent}
            selected={sheet === 'equipment'}
            onPress={() => setSheet('equipment')}
            styles={styles}
            colors={colors}
          />
          <SummaryCard
            title="FORME"
            value={readinessOption.label}
            icon="pulse-outline"
            accent={colors.accent}
            selected={sheet === 'readiness'}
            onPress={() => setSheet('readiness')}
            styles={styles}
            colors={colors}
          />
          <SummaryCard
            title="GÊNES"
            value={painSummary}
            icon={
              painConfirmedToday && painZones.includes('Aucune')
                ? 'shield-checkmark-outline'
                : 'medical-outline'
            }
            accent={painAccent}
            selected={sheet === 'pain'}
            warning={!painConfirmedToday || !painZones.includes('Aucune')}
            onPress={() => setSheet('pain')}
            styles={styles}
            colors={colors}
          />
        </View>

        <View style={styles.focusSection}>
          <Text style={styles.focusTitle}>UNE ENVIE AUJOURD’HUI ?</Text>
          <Text style={styles.focusHelp}>Optionnel · UGEROD en tient compte.</Text>
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
          <Ionicons name="arrow-forward" size={22} color={colors.textOnAccent} />
        </Pressable>

        {hasActiveSession ? (
          <View style={styles.resumePanel}>
            <Ionicons name="play-circle-outline" size={22} color={colors.accent} />
            <View style={styles.flexOne}>
              <Text style={styles.resumeTitle}>
                {sessionStarted ? 'SÉANCE EN COURS' : 'SÉANCE DÉJÀ GÉNÉRÉE'}
              </Text>
              <Text style={styles.resumeText}>Reprends la séance existante.</Text>
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

      <SheetShell
        visible={sheet === 'location'}
        title="OÙ TU T’ENTRAÎNES ?"
        onClose={() => setSheet(null)}
        styles={styles}
        colors={colors}
      >
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
            <Text style={styles.subsectionTitle}>LIEU EXTÉRIEUR</Text>
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
                <Text style={styles.subsectionTitle}>PRÉCISE LE TERRAIN</Text>
                <View style={styles.choiceGrid}>
                  {TERRAIN_OPTIONS.map((item) => (
                    <ChoiceChip
                      key={item.code}
                      label={item.label}
                      selected={preparation?.surfaceCode === item.code}
                      onPress={() => selectTerrain(item.code)}
                      styles={styles}
                      colors={colors}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </SheetShell>

      <SheetShell
        visible={sheet === 'equipment'}
        title="MATÉRIEL DU JOUR"
        onClose={() => setSheet(null)}
        styles={styles}
        colors={colors}
        footer={
          <Pressable onPress={() => setSheet(null)} style={styles.sheetDoneButton}>
            <Text style={styles.sheetDoneButtonText}>TERMINÉ</Text>
          </Pressable>
        }
      >
        <Text style={styles.sheetHelp}>Sélectionne ce que tu as avec toi aujourd’hui.</Text>

        {equipmentLoading ? (
          <View style={styles.sheetLoading}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : equipmentNeedsLogin ? (
          <View style={styles.infoRow}>
            <Ionicons name="person-circle-outline" size={20} color={colors.accent} />
            <Text style={styles.infoText}>Reconnecte-toi pour récupérer ton matériel enregistré.</Text>
          </View>
        ) : equipmentError ? (
          <Pressable onPress={loadEquipment} style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
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
              onPress={() => {
                setSheet(null);
                router.push({
                  pathname: '/profile/equipment',
                  params: { returnTo: '/workout/preparation' },
                });
              }}
              style={styles.inlineLink}
            >
              <Text style={styles.inlineLinkText}>MODIFIER MON MATÉRIEL</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.accent} />
            </Pressable>
          </>
        )}
      </SheetShell>

      <SheetShell
        visible={sheet === 'readiness'}
        title="COMMENT TU TE SENS ?"
        onClose={() => setSheet(null)}
        styles={styles}
        colors={colors}
      >
        <View style={styles.readinessStack}>
          {READINESS_OPTIONS.map((item) => {
            const selected = readinessOption.value === item.value;
            return (
              <Pressable
                key={item.value}
                onPress={() => selectReadiness(item.value)}
                style={({ pressed }) => [
                  styles.readinessChoice,
                  selected && styles.readinessChoiceSelected,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.readinessIcon}>
                  <Ionicons
                    name={item.icon}
                    size={23}
                    color={selected ? colors.accent : colors.textSecondary}
                  />
                </View>
                <View style={styles.flexOne}>
                  <Text style={styles.readinessTitle}>{item.label.toUpperCase()}</Text>
                  <Text style={styles.readinessDescription}>{item.description}</Text>
                </View>
                {selected ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </SheetShell>

      <SheetShell
        visible={sheet === 'pain'}
        title="UNE GÊNE AUJOURD’HUI ?"
        onClose={() => setSheet(null)}
        styles={styles}
        colors={colors}
      >
        <Text style={styles.sheetHelp}>À confirmer avant chaque séance.</Text>
        <Pressable
          onPress={confirmNoPain}
          style={({ pressed }) => [
            styles.painChoice,
            painConfirmedToday && painZones.includes('Aucune') && styles.painChoiceSafe,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="shield-checkmark-outline" size={23} color={colors.success} />
          <View style={styles.flexOne}>
            <Text style={styles.painChoiceTitle}>AUCUNE GÊNE</Text>
            <Text style={styles.painChoiceText}>Je confirme pour aujourd’hui.</Text>
          </View>
          {painConfirmedToday && painZones.includes('Aucune') ? (
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          ) : null}
        </Pressable>
        <Pressable
          onPress={openPainZones}
          style={({ pressed }) => [styles.painChoice, pressed && styles.pressed]}
        >
          <Ionicons name="medical-outline" size={23} color={colors.secondaryAccent} />
          <View style={styles.flexOne}>
            <Text style={styles.painChoiceTitle}>J’AI UNE GÊNE</Text>
            <Text style={styles.painChoiceText}>
              {painConfirmedToday && !painZones.includes('Aucune')
                ? summarizePain(painZones)
                : 'Choisir la ou les zones à protéger.'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      </SheetShell>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.xl, paddingTop: 8, paddingBottom: 30 },
    flexOne: { flex: 1 },
    pressed: { opacity: 0.72 },

    header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11 },
    headerButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerCopy: { flex: 1 },
    eyebrow: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 1,
      color: colors.textSecondary,
    },
    title: {
      ...typography.display,
      fontSize: 33,
      lineHeight: 36,
      letterSpacing: 1.4,
      color: colors.text,
    },
    dot: { color: colors.accent },
    brandIcon: { width: 44, height: 44 },
    intro: {
      marginTop: 4,
      fontFamily: 'Oswald_400Regular',
      fontSize: 15,
      lineHeight: 21,
      color: colors.textSecondary,
    },

    durationShell: {
      marginTop: 18,
      minHeight: 116,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 17,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 20,
    },
    durationReadout: {
      width: 106,
      marginLeft: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    durationValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 64,
      lineHeight: 62,
      letterSpacing: 2.4,
      textAlign: 'center',
    },
    durationUnit: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 13,
      lineHeight: 16,
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
      top: -19,
      zIndex: 3,
      width: 42,
      height: 42,
      marginLeft: -21,
      borderRadius: 21,
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
      minHeight: 138,
      maxHeight: 160,
      aspectRatio: 1.12,
      borderRadius: 18,
      overflow: 'hidden',
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    summaryInner: {
      flex: 1,
      padding: 13,
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
      right: -10,
      top: 30,
      opacity: 0.1,
      transform: [{ rotate: '-8deg' }],
    },
    summaryTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    summaryIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    summaryCopy: { minHeight: 62, justifyContent: 'flex-end', paddingRight: 8 },
    summaryTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 20,
      lineHeight: 23,
      letterSpacing: 0.8,
    },
    summaryValue: {
      marginTop: 5,
      fontFamily: 'Oswald_500Medium',
      fontSize: 16,
      lineHeight: 20,
      color: colors.textSecondary,
    },

    focusSection: { marginTop: 20 },
    focusTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 16,
      letterSpacing: 0.75,
      color: colors.text,
    },
    focusHelp: {
      marginTop: 3,
      fontFamily: 'Oswald_400Regular',
      fontSize: 14,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    focusRow: { paddingTop: 10, paddingRight: 20, gap: 8 },

    primaryButton: {
      marginTop: 18,
      minHeight: 60,
      borderRadius: 16,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
    },
    primaryButtonPending: { opacity: 0.66 },
    primaryButtonText: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 24,
      letterSpacing: 1.2,
      color: colors.textOnAccent,
    },

    resumePanel: {
      marginTop: 12,
      padding: 12,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    resumeTitle: { fontFamily: 'Oswald_700Bold', fontSize: 12, color: colors.text },
    resumeText: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 13,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    resumeButton: {
      minHeight: 36,
      paddingHorizontal: 11,
      borderRadius: 9,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resumeButtonText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 11,
      letterSpacing: 0.4,
      color: colors.accent,
    },

    modalRoot: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.18)',
    },
    modalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.48)',
    },
    sheetCard: {
      width: '100%',
      maxWidth: 620,
      maxHeight: '86%',
      alignSelf: 'center',
      backgroundColor: colors.background,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    sheetHandle: {
      width: 42,
      height: 4,
      borderRadius: 2,
      alignSelf: 'center',
      marginTop: 9,
      backgroundColor: colors.borderStrong,
    },
    sheetHeader: {
      minHeight: 66,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sheetTitle: {
      flex: 1,
      paddingRight: 12,
      fontFamily: 'Oswald_700Bold',
      fontSize: 21,
      lineHeight: 26,
      letterSpacing: 0.6,
      color: colors.text,
    },
    sheetClose: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sheetScrollContent: {
      paddingHorizontal: 18,
      paddingTop: 16,
      paddingBottom: 20,
    },
    sheetHelp: {
      fontFamily: 'Oswald_400Regular',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    sheetDoneButton: {
      marginHorizontal: 18,
      marginTop: 4,
      marginBottom: 16,
      minHeight: 52,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    sheetDoneButtonText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 15,
      letterSpacing: 0.7,
      color: colors.textOnAccent,
    },
    sheetLoading: {
      minHeight: 100,
      alignItems: 'center',
      justifyContent: 'center',
    },

    subsectionTitle: {
      marginTop: 22,
      fontFamily: 'Oswald_700Bold',
      fontSize: 14,
      letterSpacing: 0.7,
      color: colors.text,
    },
    choiceGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    choiceChip: {
      minHeight: 44,
      paddingHorizontal: 13,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    choiceChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    choiceChipText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 12,
      letterSpacing: 0.35,
      color: colors.textSecondary,
    },
    choiceChipTextSelected: { color: colors.textOnAccent },

    quickActions: { marginTop: 14, flexDirection: 'row', gap: 8 },
    quickButton: {
      flex: 1,
      minHeight: 44,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    quickButtonText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 11,
      letterSpacing: 0.35,
      color: colors.textSecondary,
    },
    equipmentGrid: {
      marginTop: 10,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    equipmentChoice: {
      width: '48%',
      flexGrow: 1,
      minHeight: 62,
      paddingHorizontal: 11,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    equipmentChoiceSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    equipmentChoiceTitle: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 13,
      lineHeight: 16,
      color: colors.text,
    },
    equipmentChoiceDetail: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 11,
      color: colors.textMuted,
    },
    inlineLink: {
      marginTop: 14,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    inlineLinkText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 13,
      letterSpacing: 0.3,
      color: colors.accent,
    },
    infoRow: {
      marginTop: 14,
      padding: 12,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 9,
      backgroundColor: colors.accentSoft,
    },
    infoText: {
      flex: 1,
      fontFamily: 'Oswald_400Regular',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    errorRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
    errorText: {
      flex: 1,
      fontFamily: 'Oswald_400Regular',
      fontSize: 13,
      color: colors.error,
    },

    readinessStack: { gap: 9 },
    readinessChoice: {
      minHeight: 76,
      padding: 12,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
    },
    readinessChoiceSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    readinessIcon: {
      width: 42,
      height: 42,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    readinessTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 15,
      letterSpacing: 0.45,
      color: colors.text,
    },
    readinessDescription: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },

    painChoice: {
      marginTop: 10,
      minHeight: 78,
      padding: 13,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    painChoiceSafe: { borderColor: colors.success, backgroundColor: colors.successSoft },
    painChoiceTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 15,
      letterSpacing: 0.4,
      color: colors.text,
    },
    painChoiceText: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },

    bottomSpace: { height: 24 },
  });
}
