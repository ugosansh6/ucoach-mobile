import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  createAssistedWeekPlanItem,
  getWeekReadContract,
  updateWeekPlanItemContext,
} from '../services/weeklyPlanService';

const DURATIONS = [20, 30, 45, 60, 75, 90];
const ENVIRONMENTS = [
  { code: 'HOME', label: 'Maison', icon: 'home-outline' },
  { code: 'BOX', label: 'Box', icon: 'fitness-outline' },
  { code: 'GYM', label: 'Salle', icon: 'barbell-outline' },
  { code: 'OUTDOOR', label: 'Extérieur', icon: 'sunny-outline' },
];
const REGIONS = [
  { value: null, label: 'UGEROD choisit' },
  { value: 'Upper', label: 'Haut' },
  { value: 'Lower', label: 'Jambes' },
  { value: 'Core', label: 'Core' },
  { value: 'Full Body', label: 'Full body' },
];
const OUTDOOR_PLACES = [
  { code: 'CITY_URBAN', label: 'Ville', surface: null, terrains: ['ROAD', 'GRASS', 'MIXED'] },
  { code: 'PARK', label: 'Parc', surface: null, terrains: ['GRASS', 'ROAD', 'TRAIL', 'MIXED'] },
  { code: 'ATHLETICS_TRACK', label: 'Piste', surface: 'TRACK', terrains: [] },
  { code: 'FOREST_PATH', label: 'Forêt', surface: null, terrains: ['TRAIL', 'GRASS', 'MIXED'] },
  { code: 'MOUNTAIN', label: 'Montagne', surface: null, terrains: ['TRAIL', 'GRASS', 'MIXED'] },
  { code: 'BEACH', label: 'Plage', surface: 'SAND', terrains: [] },
  { code: 'STREET_WORKOUT', label: 'Street workout', surface: null, terrains: ['ROAD', 'GRASS', 'MIXED'] },
  { code: 'OTHER', label: 'Autre', surface: null, terrains: ['GRASS', 'ROAD', 'TRAIL', 'SAND', 'MIXED'] },
];
const TERRAINS = [
  { code: 'GRASS', label: 'Herbe' },
  { code: 'ROAD', label: 'Sol dur' },
  { code: 'TRAIL', label: 'Sentier' },
  { code: 'SAND', label: 'Sable' },
  { code: 'MIXED', label: 'Mixte' },
];

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
  if (!date) return 'PLUS TARD';
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date).toUpperCase();
}

function priorityKey(priority) {
  if (!priority) return null;
  if (typeof priority === 'string') return priority;
  return priority.key ?? priority.priority_key ?? priority.name ?? priority.code ?? null;
}

function humanize(value) {
  if (!value) return 'Séance assistée';
  const labels = {
    push_vertical: 'Poussée verticale',
    'push vertical': 'Poussée verticale',
    pull_vertical: 'Tirage vertical',
    'pull vertical': 'Tirage vertical',
    push_horizontal: 'Poussée horizontale',
    'push horizontal': 'Poussée horizontale',
    pull_horizontal: 'Tirage horizontal',
    'pull horizontal': 'Tirage horizontal',
    strength: 'Force',
    conditioning: 'Conditioning',
    cardio: 'Cardio',
    skill: 'Technique',
    week_balance: 'Équilibre',
  };
  const raw = String(value).trim();
  const normalized = raw.toLowerCase().replace(/[-]+/g, '_');
  return labels[normalized]
    ?? labels[normalized.replace(/_/g, ' ')]
    ?? raw.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function itemLabel(item) {
  return item?.coachProjection?.presentation?.title
    ?? humanize(priorityKey(item?.coachProjection?.priority));
}

function normalizeEquipment(catalog, presetRows, environmentCode) {
  const ids = new Set((presetRows ?? []).map((row) => String(row.equipment_id ?? '')).filter(Boolean));
  const names = (catalog ?? [])
    .filter((item) => item?.id && item.id !== 'E00' && ids.has(String(item.id)))
    .map((item) => item.name)
    .filter(Boolean);
  if (names.length > 0) return names;
  return ['BOX', 'GYM'].includes(environmentCode) ? [] : ['Poids du corps'];
}

function Chip({ label, selected, onPress, icon, styles, colors }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
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
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export default function WeekFuturePreparation() {
  const params = useLocalSearchParams();
  const dateKey = firstParam(params?.date);
  const requestedPlanItemId = firstParam(params?.planItemId) ?? null;
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [selectedPlanItemId, setSelectedPlanItemId] = useState(requestedPlanItemId);
  const [hydratedPlanItemId, setHydratedPlanItemId] = useState(null);

  const [duration, setDuration] = useState(45);
  const [environmentCode, setEnvironmentCode] = useState('HOME');
  const [equipment, setEquipment] = useState(['Poids du corps']);
  const [equipmentOptions, setEquipmentOptions] = useState([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [outdoorPlaceCode, setOutdoorPlaceCode] = useState(null);
  const [surfaceCode, setSurfaceCode] = useState(null);
  const [targetRegion, setTargetRegion] = useState(null);

  const selectedItem = useMemo(
    () => candidates.find((item) => item.planItemId === selectedPlanItemId) ?? null,
    [candidates, selectedPlanItemId]
  );
  const selectedPlace = OUTDOOR_PLACES.find((item) => item.code === outdoorPlaceCode) ?? null;
  const allowedTerrains = selectedPlace?.terrains?.length
    ? TERRAINS.filter((terrain) => selectedPlace.terrains.includes(terrain.code))
    : [];
  const outdoorComplete = environmentCode !== 'OUTDOOR'
    || Boolean(selectedPlace && (selectedPlace.surface || surfaceCode));

  const loadEquipmentPreset = useCallback(async (environment, preserve = null) => {
    setEquipmentLoading(true);
    try {
      const [catalog, rows] = await Promise.all([
        getEquipmentCatalog(),
        getUserEnvironmentEquipmentPreset(environment),
      ]);
      const preset = normalizeEquipment(catalog, rows, environment);
      setEquipmentOptions(preset.filter((name) => name !== 'Poids du corps'));
      if (Array.isArray(preserve)) {
        setEquipment(preserve);
      } else {
        setEquipment(preset);
      }
    } catch (loadError) {
      console.warn('[WeekFuturePreparation] equipment preset failed', loadError);
      setEquipmentOptions([]);
      if (!Array.isArray(preserve)) {
        setEquipment(['BOX', 'GYM'].includes(environment) ? [] : ['Poids du corps']);
      }
    } finally {
      setEquipmentLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!dateKey || !parseDateKey(dateKey)) {
        setError('Date de préparation invalide.');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError('');
        const contract = await getWeekReadContract({ anchorDate: parseDateKey(dateKey) });
        if (!active) return;
        const dayCandidates = (contract?.visibleItems ?? []).filter(
          (item) => item?.recommendedDate === dateKey && !item?.sessionId
        );
        setCandidates(dayCandidates);
        setSelectedPlanItemId((current) => {
          if (current && dayCandidates.some((item) => item.planItemId === current)) return current;
          if (requestedPlanItemId && dayCandidates.some((item) => item.planItemId === requestedPlanItemId)) {
            return requestedPlanItemId;
          }
          return dayCandidates[0]?.planItemId ?? null;
        });
      } catch (loadError) {
        console.warn('[WeekFuturePreparation] week load failed', loadError);
        if (active) setError('Impossible de charger ce jour pour le moment.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [dateKey, requestedPlanItemId]);

  useEffect(() => {
    if (!selectedItem) {
      if (!selectedPlanItemId && candidates.length === 0 && hydratedPlanItemId !== '__empty__') {
        setHydratedPlanItemId('__empty__');
        setDuration(45);
        setEnvironmentCode('HOME');
        setOutdoorPlaceCode(null);
        setSurfaceCode(null);
        setTargetRegion(null);
        loadEquipmentPreset('HOME');
      }
      return;
    }
    if (hydratedPlanItemId === selectedItem.planItemId) return;

    const future = selectedItem?.plannedContext?.futureContext ?? {};
    const nextDuration = Number(future.durationMinutes ?? selectedItem?.plannedContext?.durationMinutes ?? 45);
    const nextEnvironment = String(future.environmentCode ?? selectedItem?.plannedContext?.environmentCode ?? 'HOME').toUpperCase();
    const savedEquipment = future.version
      ? (Array.isArray(future.equipment) ? future.equipment : [])
      : null;

    setHydratedPlanItemId(selectedItem.planItemId);
    setDuration(DURATIONS.includes(nextDuration) ? nextDuration : 45);
    setEnvironmentCode(nextEnvironment);
    setOutdoorPlaceCode(future.outdoorPlaceCode ?? null);
    setSurfaceCode(future.surfaceCode ?? null);
    setTargetRegion(future.targetRegion ?? null);
    loadEquipmentPreset(nextEnvironment, savedEquipment);
  }, [candidates.length, hydratedPlanItemId, loadEquipmentPreset, selectedItem, selectedPlanItemId]);

  function chooseEnvironment(code) {
    setEnvironmentCode(code);
    setOutdoorPlaceCode(null);
    setSurfaceCode(null);
    loadEquipmentPreset(code);
  }

  function chooseOutdoorPlace(place) {
    setOutdoorPlaceCode(place.code);
    setSurfaceCode(place.surface ?? null);
  }

  function toggleEquipment(name) {
    setEquipment((current) => {
      if (current.includes(name)) {
        const next = current.filter((item) => item !== name);
        if (next.length === 0 && !['BOX', 'GYM'].includes(environmentCode)) return ['Poids du corps'];
        return next;
      }
      if (name === 'Poids du corps') return ['Poids du corps'];
      return [...current.filter((item) => item !== 'Poids du corps'), name];
    });
  }

  async function save() {
    if (!dateKey || !outdoorComplete || saving) return;
    const context = {
      duration_minutes: duration,
      environment_code: environmentCode,
      equipment,
      surface_code: environmentCode === 'OUTDOOR' ? surfaceCode : null,
      outdoor_place_code: environmentCode === 'OUTDOOR' ? outdoorPlaceCode : null,
      target_region: targetRegion,
    };

    try {
      setSaving(true);
      setError('');
      if (selectedPlanItemId) {
        await updateWeekPlanItemContext({ planItemId: selectedPlanItemId, context });
      } else {
        await createAssistedWeekPlanItem({ recommendedDate: dateKey, context });
      }
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/planning');
    } catch (saveError) {
      console.warn('[WeekFuturePreparation] save failed', saveError);
      setError(saveError?.message ?? 'Impossible d’enregistrer cette préparation.');
      Alert.alert('Préparation non enregistrée', saveError?.message ?? 'Réessaie dans un instant.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={styles.centerState}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.muted}>UGEROD prépare ce créneau…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/planning')}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={21} color={colors.text} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{dateLabel(dateKey)}</Text>
            <Text style={styles.title}>Préparer à l’avance<Text style={styles.dot}>.</Text></Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="time-outline" size={20} color={colors.accent} />
          <Text style={styles.infoText}>
            On enregistre seulement ce que tu sais déjà. Ta forme et tes gênes seront confirmées le jour J avant de finaliser la séance.
          </Text>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {candidates.length > 1 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>QUELLE INTENTION ?</Text>
            <View style={styles.wrapRow}>
              {candidates.map((item) => (
                <Chip
                  key={item.planItemId}
                  label={itemLabel(item)}
                  selected={selectedPlanItemId === item.planItemId}
                  onPress={() => setSelectedPlanItemId(item.planItemId)}
                  styles={styles}
                  colors={colors}
                />
              ))}
            </View>
          </View>
        ) : null}

        {selectedItem ? (
          <View style={styles.intentCard}>
            <Text style={styles.intentEyebrow}>DIRECTION UGEROD</Text>
            <Text style={styles.intentTitle}>{itemLabel(selectedItem)}</Text>
            {selectedItem?.coachProjection?.presentation?.description ? (
              <Text style={styles.intentText}>{selectedItem.coachProjection.presentation.description}</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.intentCard}>
            <Text style={styles.intentEyebrow}>CRÉNEAU LIBRE</Text>
            <Text style={styles.intentTitle}>Séance assistée</Text>
            <Text style={styles.intentText}>UGEROD ajoutera ce créneau à ta semaine sans créer de dette ni modifier ton objectif hebdomadaire.</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>DURÉE PRÉVUE</Text>
          <View style={styles.wrapRow}>
            {DURATIONS.map((value) => (
              <Chip
                key={value}
                label={`${value} min`}
                selected={duration === value}
                onPress={() => setDuration(value)}
                styles={styles}
                colors={colors}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>LIEU PRÉVU</Text>
          <View style={styles.wrapRow}>
            {ENVIRONMENTS.map((item) => (
              <Chip
                key={item.code}
                label={item.label}
                icon={item.icon}
                selected={environmentCode === item.code}
                onPress={() => chooseEnvironment(item.code)}
                styles={styles}
                colors={colors}
              />
            ))}
          </View>
        </View>

        {environmentCode === 'OUTDOOR' ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CONTEXTE EXTÉRIEUR</Text>
            <View style={styles.wrapRow}>
              {OUTDOOR_PLACES.map((place) => (
                <Chip
                  key={place.code}
                  label={place.label}
                  selected={outdoorPlaceCode === place.code}
                  onPress={() => chooseOutdoorPlace(place)}
                  styles={styles}
                  colors={colors}
                />
              ))}
            </View>
            {selectedPlace && !selectedPlace.surface ? (
              <>
                <Text style={[styles.sectionLabel, styles.subLabel]}>TERRAIN</Text>
                <View style={styles.wrapRow}>
                  {allowedTerrains.map((terrain) => (
                    <Chip
                      key={terrain.code}
                      label={terrain.label}
                      selected={surfaceCode === terrain.code}
                      onPress={() => setSurfaceCode(terrain.code)}
                      styles={styles}
                      colors={colors}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>MATÉRIEL PRÉVU</Text>
          {equipmentLoading ? (
            <ActivityIndicator size="small" color={colors.accent} style={styles.inlineLoader} />
          ) : (
            <View style={styles.wrapRow}>
              <Chip
                label="Poids du corps"
                selected={equipment.includes('Poids du corps')}
                onPress={() => toggleEquipment('Poids du corps')}
                styles={styles}
                colors={colors}
              />
              {equipmentOptions.map((name) => (
                <Chip
                  key={name}
                  label={name}
                  selected={equipment.includes(name)}
                  onPress={() => toggleEquipment(name)}
                  styles={styles}
                  colors={colors}
                />
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PRÉFÉRENCE DE ZONE</Text>
          <Text style={styles.sectionHelp}>Optionnel. La direction Coach reste prioritaire lorsqu’elle s’applique.</Text>
          <View style={styles.wrapRow}>
            {REGIONS.map((region) => (
              <Chip
                key={region.label}
                label={region.label}
                selected={targetRegion === region.value}
                onPress={() => setTargetRegion(region.value)}
                styles={styles}
                colors={colors}
              />
            ))}
          </View>
        </View>

        <Pressable
          onPress={save}
          disabled={saving || equipmentLoading || !outdoorComplete}
          style={({ pressed }) => [
            styles.saveButton,
            (saving || equipmentLoading || !outdoorComplete) && styles.saveButtonDisabled,
            pressed && !saving && styles.pressed,
          ]}
        >
          {saving ? <ActivityIndicator size="small" color={colors.textOnAccent} /> : null}
          <Text style={styles.saveButtonText}>{saving ? 'ENREGISTREMENT…' : 'ENREGISTRER POUR CE JOUR'}</Text>
          {!saving ? <Ionicons name="checkmark" size={20} color={colors.textOnAccent} /> : null}
        </Pressable>

        {!outdoorComplete ? (
          <Text style={styles.validationText}>Précise le lieu et le terrain avant d’enregistrer.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.xl, paddingTop: 10, paddingBottom: 44 },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    muted: { fontFamily: fontFamilies.medium, color: colors.textSecondary, fontSize: 13 },
    pressed: { opacity: 0.76 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 72 },
    backButton: {
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
      fontFamily: fontFamilies.bold,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 1.2,
      color: colors.accent,
    },
    title: {
      fontFamily: fontFamilies.display,
      fontSize: 32,
      lineHeight: 36,
      letterSpacing: 0.7,
      color: colors.text,
      marginTop: 2,
    },
    dot: { color: colors.secondaryAccent },
    infoCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 13,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 10,
    },
    infoText: { flex: 1, fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
    errorText: { marginTop: 10, fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 17, color: colors.error },
    intentCard: {
      marginTop: 18,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    intentEyebrow: { fontFamily: fontFamilies.bold, fontSize: 9, letterSpacing: 1.1, color: colors.textSecondary },
    intentTitle: { fontFamily: fontFamilies.display, fontSize: 25, lineHeight: 29, color: colors.text, marginTop: 4 },
    intentText: { fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 5 },
    section: { marginTop: 24 },
    sectionLabel: { fontFamily: fontFamilies.bold, fontSize: 10, lineHeight: 14, letterSpacing: 1.1, color: colors.textSecondary, marginBottom: 9 },
    subLabel: { marginTop: 16 },
    sectionHelp: { fontFamily: fontFamilies.regular, fontSize: 11, lineHeight: 16, color: colors.textMuted, marginTop: -4, marginBottom: 10 },
    wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontFamily: fontFamilies.semiBold, fontSize: 12, lineHeight: 16, color: colors.text },
    chipTextSelected: { color: colors.textOnAccent },
    inlineLoader: { alignSelf: 'flex-start', marginVertical: 8 },
    saveButton: {
      minHeight: 52,
      marginTop: 30,
      borderRadius: 14,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
      paddingHorizontal: 16,
    },
    saveButtonDisabled: { opacity: 0.48 },
    saveButtonText: { fontFamily: fontFamilies.bold, fontSize: 12, letterSpacing: 0.8, color: colors.textOnAccent },
    validationText: { fontFamily: fontFamilies.medium, fontSize: 11, lineHeight: 16, color: colors.secondaryAccent, textAlign: 'center', marginTop: 8 },
  });
}
