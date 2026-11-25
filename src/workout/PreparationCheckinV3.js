import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
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

// Photos déjà présentes dans UGEROD, recadrées en fond de carte.
// On évite les anciennes miniatures trop abstraites / mal adaptées au format carré.
const locationImage = require('../../assets/branding/andrew-valdivia-UMTFo3cVmJ8-unsplash.jpg');
const equipmentImage = require('../../assets/branding/victor-freitas-WvDYdXDzkhs-unsplash.jpg');
const formImage = require('../../assets/branding/logan-weaver-lgnwvr-u76Gd0hP5w4-unsplash.jpg');
const painImage = require('../../assets/branding/edgar-chaparro-sHfo3WOgGTU-unsplash.jpg');

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
  return place ? `Extérieur · ${place.label}` : 'Extérieur · à préciser';
}

function normalizeEquipmentError(error) {
  const raw = String(error?.message ?? error ?? '').trim();
  const authMissing = /auth|session missing|session expir|jwt|token/i.test(raw);

  if (authMissing) {
    return {
      authMissing: true,
      message: 'Reconnecte-toi pour charger le matériel enregistré dans ton profil.',
    };
  }

  return {
    authMissing: false,
    message: 'Impossible de charger ton matériel pour le moment.',
  };
}

// Même compteur / même logique visuelle que la version d’origine.
function OriginalDurationSlider({ value, onChange, colors, styles }) {
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

  const panResponder = useMemo(
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
    <View style={styles.durationSliderCard}>
      <View style={styles.durationDigitalPanel}>
        <Text style={[styles.durationDigitalValue, { color: durationColor }]}>
          {value}
        </Text>
        <Text style={[styles.durationDigitalUnit, { color: durationColor }]}>MIN</Text>
      </View>

      <View style={styles.durationSliderRight}>
        <View
          onLayout={(event) => {
            const nextTrackWidth = event.nativeEvent.layout.width;
            trackWidthRef.current = nextTrackWidth;
            setTrackWidth(nextTrackWidth);
          }}
          style={styles.durationTrackTouch}
        >
          <View style={styles.durationTrack}>
            <View
              style={[
                styles.durationTrackProgress,
                { width: knobLeft, backgroundColor: durationColor },
              ]}
            />

            <View style={styles.durationPressZones}>
              {DURATIONS.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityLabel={`${item} minutes`}
                  onPress={() => onChange(item)}
                  style={styles.durationPressZone}
                />
              ))}
            </View>

            <View
              {...panResponder.panHandlers}
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
  image,
  icon,
  accent,
  selected,
  onPress,
  styles,
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
      <ImageBackground
        source={image}
        resizeMode="cover"
        style={styles.summaryImage}
        imageStyle={styles.summaryImageAsset}
      >
        <LinearGradient
          colors={[
            'rgba(5,8,12,0.04)',
            'rgba(5,8,12,0.42)',
            'rgba(5,8,12,0.94)',
          ]}
          locations={[0, 0.46, 1]}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.summaryTopRow}>
          <View style={[styles.summaryIcon, { backgroundColor: accent }]}>
            <Ionicons name={icon} size={17} color="#FFFFFF" />
          </View>
          <Ionicons
            name={selected ? 'chevron-up' : 'chevron-forward'}
            size={19}
            color="rgba(255,255,255,0.90)"
          />
        </View>

        <View style={styles.summaryCopy}>
          <Text style={styles.summaryTitle}>{title}</Text>
          <Text numberOfLines={2} style={styles.summaryValue}>
            {value}
          </Text>
        </View>
      </ImageBackground>
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

export default function PreparationCheckinV3() {
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;
  const { workout, preparation, updatePreparation } = useWorkout();

  const [expanded, setExpanded] = useState(null);
  const [referenceEquipment, setReferenceEquipment] = useState([]);
  const [equipmentLoading, setEquipmentLoading] = useState(true);
  const [equipmentError, setEquipmentError] = useState(null);
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
  const painZones = Array.isArray(preparation?.painZones)
    ? preparation.painZones
    : [];
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
    setEquipmentError(null);

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
      setEquipmentError(normalizeEquipmentError(error));
    } finally {
      setEquipmentLoading(false);
    }
  }, [updatePreparation]);

  useFocusEffect(
    useCallback(() => {
      loadEquipment();
    }, [loadEquipment])
  );

  // Quand on revient de la cartographie des gênes, la sélection effectuée
  // dans cet aller-retour vaut confirmation pour CE check-in uniquement.
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

  function confirmNoPain() {
    updatePreparation({ painZones: ['Aucune'] });
    setPainConfirmedToday(true);
    setExpanded(null);
  }

  function openPainZones() {
    painScreenOpenedRef.current = true;
    router.push('/workout/injuries');
  }

  function handleGenerate() {
    if (!painConfirmedToday) {
      setExpanded('pain');
      return;
    }

    if (
      environmentCode === 'OUTDOOR' &&
      (!preparation?.outdoorPlaceCode || !preparation?.surfaceCode)
    ) {
      setExpanded('location');
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

  const materialSummary = equipmentLoading
    ? 'Chargement…'
    : equipmentError
      ? 'Profil non chargé'
      : summarizeEquipment(equipment);
  const painSummary = painConfirmedToday ? summarizePain(painZones) : 'À confirmer';

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

        <OriginalDurationSlider
          value={duration}
          onChange={(next) => updatePreparation({ duration: next })}
          colors={colors}
          styles={styles}
        />

        <View style={styles.cardGrid}>
          <SummaryCard
            title="LIEU"
            value={environmentSummary(preparation)}
            image={locationImage}
            icon="location-outline"
            accent={colors.accent}
            selected={expanded === 'location'}
            onPress={() => togglePanel('location')}
            styles={styles}
          />
          <SummaryCard
            title="MATÉRIEL"
            value={materialSummary}
            image={equipmentImage}
            icon="barbell-outline"
            accent={colors.accent}
            selected={expanded === 'equipment'}
            onPress={() => togglePanel('equipment')}
            styles={styles}
          />
          <SummaryCard
            title="FORME"
            value={readinessOption.label}
            image={formImage}
            icon="pulse-outline"
            accent={colors.accent}
            selected={expanded === 'readiness'}
            onPress={() => togglePanel('readiness')}
            styles={styles}
          />
          <SummaryCard
            title="GÊNES"
            value={painSummary}
            image={painImage}
            icon={painConfirmedToday && painZones.includes('Aucune')
              ? 'shield-checkmark-outline'
              : 'shield-outline'}
            accent={painConfirmedToday ? colors.accent : colors.secondaryAccent}
            selected={expanded === 'pain'}
            onPress={() => togglePanel('pain')}
            styles={styles}
          />
        </View>

        {expanded === 'location' ? (
          <View style={styles.detailPanel}>
            <Text style={styles.detailEyebrow}>OÙ TU T’ENTRAÎNES ?</Text>
            <Text style={styles.detailHelp}>
              Le lieu décrit le contexte disponible. Le Coach garde la main sur le type de séance.
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
                      On le précise seulement quand le lieu peut correspondre à plusieurs sols.
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
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}

        {expanded === 'equipment' ? (
          <View style={styles.detailPanel}>
            <View style={styles.detailHeaderRow}>
              <View style={styles.flexOne}>
                <Text style={styles.detailEyebrow}>MATÉRIEL DU JOUR</Text>
                <Text style={styles.detailHelp}>
                  La base vient de ton profil. Garde seulement ce que tu as réellement avec toi aujourd’hui.
                </Text>
              </View>
              {equipmentLoading ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            </View>

            {equipmentError ? (
              <View style={styles.sessionNotice}>
                <Ionicons
                  name={equipmentError.authMissing ? 'person-circle-outline' : 'cloud-offline-outline'}
                  size={19}
                  color={colors.secondaryAccent}
                />
                <View style={styles.flexOne}>
                  <Text style={styles.sessionNoticeTitle}>
                    {equipmentError.authMissing ? 'SESSION À RECONNECTER' : 'MATÉRIEL À RECHARGER'}
                  </Text>
                  <Text style={styles.sessionNoticeText}>{equipmentError.message}</Text>
                </View>
                <Pressable
                  onPress={() => {
                    if (equipmentError.authMissing) router.push('/(auth)/login');
                    else loadEquipment();
                  }}
                  style={styles.sessionNoticeButton}
                >
                  <Text style={styles.sessionNoticeButtonText}>
                    {equipmentError.authMissing ? 'SE CONNECTER' : 'RÉESSAYER'}
                  </Text>
                </Pressable>
              </View>
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
                  <Text style={styles.inlineLinkText}>MODIFIER MA BASE DANS LE PROFIL</Text>
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
              Choisis l’état qui décrit ta capacité à t’entraîner aujourd’hui.
            </Text>
            <View style={styles.readinessStack}>
              {READINESS_OPTIONS.map((item) => {
                const selected = readinessOption.value === item.value;
                return (
                  <Pressable
                    key={item.value}
                    onPress={() => {
                      updatePreparation({ readiness: item.value });
                      setExpanded(null);
                    }}
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
              Confirme simplement ce qui est vrai aujourd’hui. Rien n’est considéré comme validé par défaut.
            </Text>

            <Pressable
              onPress={confirmNoPain}
              style={({ pressed }) => [
                styles.painChoice,
                painConfirmedToday && painZones.includes('Aucune') && styles.painChoiceSafe,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="shield-checkmark-outline" size={21} color={colors.success} />
              <View style={styles.flexOne}>
                <Text style={styles.painChoiceTitle}>AUCUNE GÊNE</Text>
                <Text style={styles.painChoiceText}>Je confirme pour la séance d’aujourd’hui.</Text>
              </View>
              {painConfirmedToday && painZones.includes('Aucune') ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              ) : null}
            </Pressable>

            <Pressable
              onPress={openPainZones}
              style={({ pressed }) => [styles.painChoice, pressed && styles.pressed]}
            >
              <Ionicons name="medical-outline" size={21} color={colors.secondaryAccent} />
              <View style={styles.flexOne}>
                <Text style={styles.painChoiceTitle}>J’AI UNE GÊNE</Text>
                <Text style={styles.painChoiceText}>
                  {painConfirmedToday && !painZones.includes('Aucune')
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

        <Pressable
          onPress={handleGenerate}
          disabled={equipmentLoading}
          style={({ pressed }) => [
            styles.primaryButton,
            equipmentLoading && styles.primaryButtonDisabled,
            pressed && !equipmentLoading && styles.pressed,
          ]}
        >
          {equipmentLoading ? (
            <ActivityIndicator size="small" color={colors.textOnAccent} />
          ) : (
            <>
              <Text style={styles.primaryButtonText}>VOIR MA SÉANCE</Text>
              <Ionicons name="arrow-forward" size={21} color={colors.textOnAccent} />
            </>
          )}
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

function createStyles(colors, isDark) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.xl, paddingTop: 8, paddingBottom: 30 },
    flexOne: { flex: 1 },
    pressed: { opacity: 0.72 },

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
      fontSize: 9,
      lineHeight: 12,
      letterSpacing: 1,
      color: colors.textSecondary,
    },
    title: {
      ...typography.display,
      fontSize: 29,
      lineHeight: 32,
      letterSpacing: 1.4,
      color: colors.text,
    },
    dot: { color: colors.accent },
    brandIcon: { width: 42, height: 42 },
    intro: {
      marginTop: 3,
      marginBottom: 6,
      fontFamily: 'Oswald_400Regular',
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },

    // Compteur d’origine
    durationSliderCard: {
      minHeight: 112,
      marginTop: 12,
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
    durationDigitalPanel: {
      width: 104,
      marginLeft: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    durationDigitalValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 62,
      lineHeight: 60,
      letterSpacing: 2.4,
      textAlign: 'center',
    },
    durationDigitalUnit: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 2.2,
      marginTop: -2,
      textAlign: 'center',
    },
    durationSliderRight: { flex: 1, justifyContent: 'center' },
    durationTrackTouch: { height: 60, justifyContent: 'center' },
    durationTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      position: 'relative',
    },
    durationTrackProgress: { height: 4, borderRadius: 2 },
    durationPressZones: {
      position: 'absolute',
      left: -18,
      right: -18,
      top: -24,
      bottom: -24,
      flexDirection: 'row',
      zIndex: 1,
    },
    durationPressZone: { flex: 1 },
    durationKnob: {
      position: 'absolute',
      top: -18,
      zIndex: 3,
      width: 40,
      height: 40,
      marginLeft: -20,
      borderRadius: 20,
      borderWidth: 2,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.22,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },

    cardGrid: {
      marginTop: 14,
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 10,
    },
    summaryCard: {
      width: '48.5%',
      height: 142,
      borderRadius: 17,
      overflow: 'hidden',
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    summaryImage: { flex: 1, padding: 11, justifyContent: 'space-between' },
    summaryImageAsset: {
      borderRadius: 16,
      opacity: isDark ? 0.92 : 0.88,
    },
    summaryTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    summaryIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    summaryCopy: { minHeight: 48, justifyContent: 'flex-end' },
    summaryTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 11,
      letterSpacing: 1,
      color: '#FFFFFF',
      textShadowColor: 'rgba(0,0,0,0.35)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    summaryValue: {
      marginTop: 3,
      fontFamily: 'Oswald_500Medium',
      fontSize: 12,
      lineHeight: 16,
      color: '#FFFFFF',
      textShadowColor: 'rgba(0,0,0,0.42)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
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
      fontSize: 12,
      letterSpacing: 0.9,
      color: colors.text,
    },
    detailHelp: {
      marginTop: 3,
      fontFamily: 'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    subsectionTitle: {
      marginTop: 16,
      fontFamily: 'Oswald_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
      color: colors.text,
    },
    choiceGrid: {
      marginTop: 10,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
    },
    choiceChip: {
      minHeight: 38,
      paddingHorizontal: 11,
      paddingVertical: 8,
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
      fontSize: 9,
      letterSpacing: 0.4,
      color: colors.textSecondary,
    },
    choiceChipTextSelected: { color: colors.textOnAccent },

    quickActions: { marginTop: 11, flexDirection: 'row', gap: 7 },
    quickButton: {
      flex: 1,
      minHeight: 35,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    quickButtonText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 8,
      letterSpacing: 0.4,
      color: colors.textSecondary,
    },
    equipmentGrid: {
      marginTop: 9,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
    },
    equipmentChoice: {
      width: '48.5%',
      flexGrow: 1,
      minHeight: 53,
      paddingHorizontal: 10,
      paddingVertical: 8,
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
      fontSize: 9,
      lineHeight: 12,
      color: colors.text,
    },
    equipmentChoiceDetail: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 8,
      color: colors.textMuted,
    },
    inlineLink: {
      marginTop: 12,
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    inlineLinkText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 9,
      letterSpacing: 0.4,
      color: colors.accent,
    },

    sessionNotice: {
      marginTop: 11,
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
    sessionNoticeTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 9,
      letterSpacing: 0.5,
      color: colors.text,
    },
    sessionNoticeText: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 9,
      lineHeight: 13,
      color: colors.textSecondary,
    },
    sessionNoticeButton: {
      minHeight: 32,
      paddingHorizontal: 9,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sessionNoticeButtonText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 8,
      letterSpacing: 0.35,
      color: colors.accent,
    },

    readinessStack: { marginTop: 10, gap: 7 },
    readinessChoice: {
      minHeight: 63,
      padding: 10,
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
      width: 35,
      height: 35,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    readinessTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 10,
      letterSpacing: 0.5,
      color: colors.text,
    },
    readinessDescription: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 10,
      color: colors.textSecondary,
    },

    painChoice: {
      marginTop: 9,
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
    painChoiceSafe: {
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
    },
    painChoiceTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 10,
      letterSpacing: 0.45,
      color: colors.text,
    },
    painChoiceText: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 10,
      lineHeight: 14,
      color: colors.textSecondary,
    },

    focusSection: { marginTop: 18 },
    focusTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 11,
      letterSpacing: 0.8,
      color: colors.text,
    },
    focusHelp: {
      marginTop: 3,
      fontFamily: 'Oswald_400Regular',
      fontSize: 10,
      lineHeight: 15,
      color: colors.textSecondary,
    },
    focusRow: { paddingTop: 9, paddingRight: 20, gap: 7 },

    primaryButton: {
      marginTop: 18,
      minHeight: 58,
      borderRadius: 15,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    primaryButtonDisabled: { opacity: 0.58 },
    primaryButtonText: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 21,
      letterSpacing: 1.1,
      color: colors.textOnAccent,
    },

    resumePanel: {
      marginTop: 12,
      padding: 11,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    resumeTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 9,
      letterSpacing: 0.45,
      color: colors.text,
    },
    resumeText: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 9,
      lineHeight: 13,
      color: colors.textSecondary,
    },
    resumeButton: {
      minHeight: 34,
      paddingHorizontal: 10,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    resumeButtonText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 8,
      letterSpacing: 0.4,
      color: colors.textOnAccent,
    },
    bottomSpace: { height: 22 },
  });
}
