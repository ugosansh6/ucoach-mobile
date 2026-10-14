import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
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

function priorityKey(priority) {
  if (!priority) return null;
  if (typeof priority === 'string') return priority;
  return priority.key ?? priority.priority_key ?? priority.name ?? priority.code ?? null;
}

function humanize(value) {
  if (!value) return null;
  const labels = {
    push_vertical: 'Poussée verticale',
    pull_vertical: 'Tirage vertical',
    push_horizontal: 'Poussée horizontale',
    pull_horizontal: 'Tirage horizontal',
    strength: 'Force',
    conditioning: 'Conditioning',
    cardio: 'Cardio',
    skill: 'Technique',
    mobility: 'Mobilité',
    week_balance: 'Équilibre',
    upper: 'Haut du corps',
    lower: 'Bas du corps',
    core: 'Tronc',
    full_body: 'Full body',
  };
  const raw = String(value).trim();
  const normalized = raw.toLowerCase().replace(/[-\s]+/g, '_');
  return labels[normalized]
    ?? raw.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function itemLabel(item) {
  return item?.coachProjection?.presentation?.title
    ?? humanize(priorityKey(item?.coachProjection?.priority))
    ?? humanize(item?.plannedContext?.focus)
    ?? 'Séance assistée';
}

function summarizeEquipment(equipment) {
  const values = (Array.isArray(equipment) ? equipment : []).filter(Boolean);
  if (values.length === 0) return null;
  if (values.length <= 3) return values.join(' · ');
  return `${values.slice(0, 3).join(' · ')} · +${values.length - 3}`;
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

function ChoiceChip({ label, selected, onPress, icon = null, styles, colors }) {
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
      <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function SheetShell({ visible, title, onClose, children, styles, colors }) {
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Fermer" />
        <View style={styles.sheetCard} accessibilityViewIsModal>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.sheetClose}>
              <Ionicons name="close" size={23} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function WeekComposerV2() {
  const params = useLocalSearchParams();
  const dateKey = firstParam(params?.date);
  const requestedPlanItemId = firstParam(params?.planItemId) ?? null;
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const [duration, setDuration] = useState(45);
  const [environmentCode, setEnvironmentCode] = useState('HOME');
  const [equipment, setEquipment] = useState(['Poids du corps']);
  const [equipmentOptions, setEquipmentOptions] = useState([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [outdoorPlaceCode, setOutdoorPlaceCode] = useState(null);
  const [surfaceCode, setSurfaceCode] = useState(null);

  const selectedPlace = OUTDOOR_PLACES.find((item) => item.code === outdoorPlaceCode) ?? null;
  const terrainOptions = selectedPlace?.terrains?.length
    ? TERRAINS.filter((item) => selectedPlace.terrains.includes(item.code))
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
      setEquipment(Array.isArray(preserve) ? preserve : preset);
    } catch (loadError) {
      console.warn('[WeekComposerV2] equipment preset failed', loadError);
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
        setError('Date de composition invalide.');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError('');
        const contract = await getWeekReadContract({ anchorDate: new Date() });
        if (!active) return;
        const candidates = (contract?.visibleItems ?? []).filter(
          (item) => item?.recommendedDate === dateKey && !item?.sessionId
        );
        const item = requestedPlanItemId
          ? candidates.find((candidate) => candidate.planItemId === requestedPlanItemId) ?? candidates[0] ?? null
          : candidates[0] ?? null;
        setSelectedItem(item);

        const future = item?.plannedContext?.futureContext ?? {};
        const nextDuration = Number(future.durationMinutes ?? item?.plannedContext?.durationMinutes ?? 45);
        const nextEnvironment = String(
          future.environmentCode ?? item?.plannedContext?.environmentCode ?? 'HOME'
        ).toUpperCase();
        const savedEquipment = future.version
          ? (Array.isArray(future.equipment) ? future.equipment : [])
          : (Array.isArray(item?.plannedContext?.equipment) && item.plannedContext.equipment.length > 0
              ? item.plannedContext.equipment
              : null);

        setDuration(DURATIONS.includes(nextDuration) ? nextDuration : 45);
        setEnvironmentCode(nextEnvironment);
        setOutdoorPlaceCode(future.outdoorPlaceCode ?? null);
        setSurfaceCode(future.surfaceCode ?? null);
        await loadEquipmentPreset(nextEnvironment, savedEquipment);
      } catch (loadError) {
        console.warn('[WeekComposerV2] load failed', loadError);
        if (active) setError('Impossible de préparer ce créneau pour le moment.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [dateKey, loadEquipmentPreset, requestedPlanItemId]);

  function selectEnvironment(code) {
    setEnvironmentCode(code);
    setOutdoorPlaceCode(null);
    setSurfaceCode(null);
    loadEquipmentPreset(code);
  }

  function selectOutdoorPlace(place) {
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

  async function keepFrame() {
    if (!dateKey || saving || !outdoorComplete) return;
    const context = {
      duration_minutes: duration,
      environment_code: environmentCode,
      equipment,
      surface_code: environmentCode === 'OUTDOOR' ? surfaceCode : null,
      outdoor_place_code: environmentCode === 'OUTDOOR' ? outdoorPlaceCode : null,
      target_region: selectedItem?.plannedContext?.futureContext?.targetRegion
        ?? selectedItem?.plannedContext?.targetRegion
        ?? null,
    };

    try {
      setSaving(true);
      setError('');
      const mutation = selectedItem?.planItemId
        ? await updateWeekPlanItemContext({ planItemId: selectedItem.planItemId, context })
        : await createAssistedWeekPlanItem({ recommendedDate: dateKey, context });

      if (!selectedItem?.planItemId && mutation?.planItemId) {
        const refreshed = await getWeekReadContract({ anchorDate: new Date() });
        const created = (refreshed?.visibleItems ?? []).find(
          (item) => item?.planItemId === mutation.planItemId
        ) ?? null;
        if (created) setSelectedItem(created);
      }
      setConfirmed(true);
    } catch (saveError) {
      console.warn('[WeekComposerV2] persist frame failed', saveError);
      setError(saveError?.message ?? 'Impossible d’enregistrer ce cadre.');
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
        </View>
      </SafeAreaView>
    );
  }

  const directionTitle = itemLabel(selectedItem);
  const directionDescription = selectedItem?.coachProjection?.presentation?.description ?? null;
  const equipmentSummary = summarizeEquipment(equipment);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/planning')}
            hitSlop={12}
            style={styles.headerButton}
          >
            <Ionicons name="arrow-back" size={21} color={colors.text} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{dateLabel(dateKey)}</Text>
            <Text style={styles.title}>Composer<Text style={styles.dot}>.</Text></Text>
          </View>
          <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {!confirmed ? (
          <View style={styles.proposalWrap}>
            <Text style={styles.proposalEyebrow}>{selectedItem ? 'POUR CETTE SÉANCE' : 'JE TE PROPOSE'}</Text>
            <Text style={styles.proposalTitle}>{directionTitle}</Text>
            {directionDescription ? (
              <Text style={styles.proposalDescription}>{directionDescription}</Text>
            ) : null}

            <View style={styles.divider} />

            <View style={styles.frameHeaderRow}>
              <Text style={styles.frameLabel}>CADRE</Text>
              <Pressable onPress={() => setAdjustOpen(true)} hitSlop={10}>
                <Text style={styles.adjustText}>Ajuster</Text>
              </Pressable>
            </View>

            <View style={styles.frameInline}>
              <Text style={styles.frameValue}>{duration} MIN</Text>
              <View style={styles.frameDot} />
              <Text style={styles.frameValue}>{environmentLabel(environmentCode).toUpperCase()}</Text>
            </View>
            {equipmentSummary ? (
              <Text style={styles.equipmentSummary}>{equipmentSummary}</Text>
            ) : null}

            {!outdoorComplete ? (
              <Text style={styles.validationText}>Précise le lieu et le terrain extérieur.</Text>
            ) : null}

            <Pressable
              onPress={keepFrame}
              disabled={saving || equipmentLoading || !outdoorComplete}
              style={({ pressed }) => [
                styles.primaryButton,
                (saving || equipmentLoading || !outdoorComplete) && styles.disabled,
                pressed && !saving && styles.pressed,
              ]}
            >
              {saving ? <ActivityIndicator size="small" color={colors.textOnAccent} /> : null}
              <Text style={styles.primaryButtonText}>{saving ? 'ENREGISTREMENT…' : 'GARDER CE CADRE'}</Text>
              {!saving ? <Ionicons name="arrow-forward" size={19} color={colors.textOnAccent} /> : null}
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.compactTrail}>
              <Text style={styles.compactMeta}>{duration} MIN · {environmentLabel(environmentCode).toUpperCase()}</Text>
              <Text style={styles.compactDirection}>{directionTitle}</Text>
            </View>

            <View style={styles.nextMoment}>
              <Text style={styles.nextEyebrow}>LA SÉANCE PREND FORME.</Text>
              <Text style={styles.nextTitle}>Voilà comment je construirais ta séance.</Text>
              <View style={styles.openCanvas}>
                <View style={styles.canvasRule} />
                <Text style={styles.canvasLabel}>STRUCTURE</Text>
                <Text style={styles.canvasPlaceholder}>La proposition de structure sera branchée ici sur la décision UGEROD du Composer.</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <SheetShell
        visible={adjustOpen}
        title="Ajuster le cadre"
        onClose={() => setAdjustOpen(false)}
        styles={styles}
        colors={colors}
      >
        <Text style={styles.sheetSectionLabel}>DURÉE</Text>
        <View style={styles.wrapRow}>
          {DURATIONS.map((value) => (
            <ChoiceChip
              key={value}
              label={`${value} min`}
              selected={duration === value}
              onPress={() => setDuration(value)}
              styles={styles}
              colors={colors}
            />
          ))}
        </View>

        <Text style={[styles.sheetSectionLabel, styles.sheetSectionGap]}>LIEU</Text>
        <View style={styles.wrapRow}>
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
            <Text style={[styles.sheetSectionLabel, styles.sheetSectionGap]}>CONTEXTE EXTÉRIEUR</Text>
            <View style={styles.wrapRow}>
              {OUTDOOR_PLACES.map((place) => (
                <ChoiceChip
                  key={place.code}
                  label={place.label}
                  selected={outdoorPlaceCode === place.code}
                  onPress={() => selectOutdoorPlace(place)}
                  styles={styles}
                  colors={colors}
                />
              ))}
            </View>
            {selectedPlace && !selectedPlace.surface ? (
              <>
                <Text style={[styles.sheetSectionLabel, styles.sheetSectionGap]}>TERRAIN</Text>
                <View style={styles.wrapRow}>
                  {terrainOptions.map((terrain) => (
                    <ChoiceChip
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
          </>
        ) : null}

        <Text style={[styles.sheetSectionLabel, styles.sheetSectionGap]}>MATÉRIEL</Text>
        {equipmentLoading ? (
          <ActivityIndicator size="small" color={colors.accent} style={styles.inlineLoader} />
        ) : (
          <View style={styles.equipmentList}>
            <Pressable
              onPress={() => toggleEquipment('Poids du corps')}
              style={({ pressed }) => [styles.equipmentRow, pressed && styles.pressed]}
            >
              <Text style={styles.equipmentRowText}>Poids du corps</Text>
              <Ionicons
                name={equipment.includes('Poids du corps') ? 'checkmark-circle' : 'ellipse-outline'}
                size={21}
                color={equipment.includes('Poids du corps') ? colors.accent : colors.textMuted}
              />
            </Pressable>
            {equipmentOptions.map((name) => (
              <Pressable
                key={name}
                onPress={() => toggleEquipment(name)}
                style={({ pressed }) => [styles.equipmentRow, pressed && styles.pressed]}
              >
                <Text style={styles.equipmentRowText}>{name}</Text>
                <Ionicons
                  name={equipment.includes(name) ? 'checkmark-circle' : 'ellipse-outline'}
                  size={21}
                  color={equipment.includes(name) ? colors.accent : colors.textMuted}
                />
              </Pressable>
            ))}
          </View>
        )}

        <Pressable
          onPress={() => setAdjustOpen(false)}
          disabled={!outdoorComplete}
          style={({ pressed }) => [styles.sheetConfirm, !outdoorComplete && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.sheetConfirmText}>APPLIQUER</Text>
        </Pressable>
      </SheetShell>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.xl, paddingTop: 8, paddingBottom: 56 },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.74 },
    disabled: { opacity: 0.45 },

    header: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 74 },
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
      fontFamily: fontFamilies.bold,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 1.2,
      color: colors.accent,
    },
    title: {
      fontFamily: fontFamilies.display,
      fontSize: 33,
      lineHeight: 37,
      letterSpacing: 0.6,
      color: colors.text,
      marginTop: 1,
    },
    dot: { color: colors.secondaryAccent },
    brandIcon: { width: 38, height: 38 },
    errorText: { marginTop: 8, fontFamily: fontFamilies.medium, fontSize: 12, color: colors.error },

    proposalWrap: { marginTop: 36 },
    proposalEyebrow: {
      fontFamily: fontFamilies.bold,
      fontSize: 10,
      letterSpacing: 1.45,
      color: colors.accent,
    },
    proposalTitle: {
      marginTop: 8,
      fontFamily: fontFamilies.display,
      fontSize: 42,
      lineHeight: 46,
      letterSpacing: 0.2,
      color: colors.text,
      textTransform: 'uppercase',
    },
    proposalDescription: {
      marginTop: 14,
      maxWidth: 520,
      fontFamily: fontFamilies.regular,
      fontSize: 14,
      lineHeight: 21,
      color: colors.textSecondary,
    },
    divider: { height: 1, backgroundColor: colors.border, marginTop: 34, marginBottom: 24 },
    frameHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    frameLabel: {
      fontFamily: fontFamilies.bold,
      fontSize: 10,
      letterSpacing: 1.4,
      color: colors.textSecondary,
    },
    adjustText: {
      fontFamily: fontFamilies.semiBold,
      fontSize: 13,
      color: colors.textSecondary,
      textDecorationLine: 'underline',
    },
    frameInline: { marginTop: 14, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
    frameValue: {
      fontFamily: fontFamilies.display,
      fontSize: 31,
      lineHeight: 35,
      color: colors.text,
      letterSpacing: 0.3,
    },
    frameDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent },
    equipmentSummary: {
      marginTop: 8,
      fontFamily: fontFamilies.regular,
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    validationText: { marginTop: 10, fontFamily: fontFamilies.medium, fontSize: 11, color: colors.secondaryAccent },
    primaryButton: {
      marginTop: 38,
      minHeight: 54,
      borderRadius: 15,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
      paddingHorizontal: 18,
    },
    primaryButtonText: {
      fontFamily: fontFamilies.bold,
      fontSize: 12,
      letterSpacing: 0.9,
      color: colors.textOnAccent,
    },

    compactTrail: {
      marginTop: 24,
      paddingBottom: 18,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    compactMeta: {
      fontFamily: fontFamilies.bold,
      fontSize: 11,
      letterSpacing: 1.0,
      color: colors.textSecondary,
    },
    compactDirection: {
      marginTop: 5,
      fontFamily: fontFamilies.semiBold,
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
      textTransform: 'uppercase',
    },
    nextMoment: { marginTop: 42 },
    nextEyebrow: {
      fontFamily: fontFamilies.bold,
      fontSize: 10,
      letterSpacing: 1.4,
      color: colors.accent,
    },
    nextTitle: {
      marginTop: 8,
      fontFamily: fontFamilies.display,
      fontSize: 36,
      lineHeight: 41,
      color: colors.text,
    },
    openCanvas: { marginTop: 34, minHeight: 180 },
    canvasRule: { width: 28, height: 3, borderRadius: 2, backgroundColor: colors.accent, marginBottom: 14 },
    canvasLabel: {
      fontFamily: fontFamilies.bold,
      fontSize: 10,
      letterSpacing: 1.4,
      color: colors.textSecondary,
    },
    canvasPlaceholder: {
      marginTop: 12,
      fontFamily: fontFamilies.regular,
      fontSize: 13,
      lineHeight: 20,
      color: colors.textMuted,
      maxWidth: 480,
    },

    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.46)' },
    sheetCard: {
      maxHeight: '88%',
      backgroundColor: colors.surfaceElevated ?? colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 9 },
    sheetHeader: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
    sheetTitle: { flex: 1, fontFamily: fontFamilies.display, fontSize: 25, color: colors.text },
    sheetClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    sheetContent: { paddingHorizontal: spacing.xl, paddingTop: 22, paddingBottom: 34 },
    sheetSectionLabel: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.15, color: colors.textSecondary, marginBottom: 10 },
    sheetSectionGap: { marginTop: 24 },
    wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    choiceChip: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    choiceChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    choiceChipText: { fontFamily: fontFamilies.semiBold, fontSize: 12, color: colors.text },
    choiceChipTextSelected: { color: colors.textOnAccent },
    inlineLoader: { alignSelf: 'flex-start', marginVertical: 8 },
    equipmentList: { gap: 8 },
    equipmentRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    equipmentRowText: { flex: 1, fontFamily: fontFamilies.medium, fontSize: 13, color: colors.text },
    sheetConfirm: { minHeight: 50, marginTop: 28, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    sheetConfirmText: { fontFamily: fontFamilies.bold, fontSize: 12, letterSpacing: 0.9, color: colors.textOnAccent },
  });
}
