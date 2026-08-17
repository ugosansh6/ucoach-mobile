import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../src/constants';
import {
  confirmPerformanceRecordSuggestion,
  getExerciseRecordMetricOptions,
  getPerformanceRecordBook,
  getStrengthCurve,
  saveManualBenchmarkRecord,
  saveManualExerciseRecord,
  searchRecordExercises,
} from '../../src/services/performanceRecordService';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');

const BENCHMARK_METRICS = [
  { metric_key: 'time_seconds', display_name: 'Meilleur temps', canonical_unit: 's' },
  { metric_key: 'score_reps', display_name: 'Meilleur score en reps', canonical_unit: 'reps' },
  { metric_key: 'score_rounds', display_name: 'Meilleur score en rounds', canonical_unit: 'rounds' },
];

function formatValue(value, unit) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';

  if (unit === 's') {
    const minutes = Math.floor(numeric / 60);
    const seconds = Math.round(numeric % 60);
    if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, '0')}`;
    return `${Math.round(numeric)} s`;
  }

  if (unit === 'kg') return `${numeric.toFixed(numeric % 1 ? 1 : 0)} kg`;
  if (unit === 'm') return `${Math.round(numeric)} m`;
  if (unit === 'reps') return `${Math.round(numeric)} reps`;
  if (unit === 'rounds') return `${numeric} rounds`;
  return `${numeric} ${unit ?? ''}`.trim();
}

function recordLabel(record) {
  if (record.metric_key === 'load_for_reps') {
    const reps = Number(record.qualifier?.reps ?? record.qualifier_json?.reps ?? 0);
    return reps > 0 ? `${reps}RM` : 'CHARGE';
  }
  if (record.metric_key === 'max_unbroken_reps') return 'MAX UNBROKEN';
  if (record.metric_key === 'time_for_distance_seconds') {
    const distance = Number(record.qualifier?.distance_m ?? record.qualifier_json?.distance_m ?? 0);
    return distance > 0 ? `${distance} M` : 'CHRONO';
  }
  if (record.metric_key === 'hold_seconds') return 'MAINTIEN';
  if (record.metric_key === 'distance_m') return 'DISTANCE';
  return String(record.metric_name ?? record.metric_key ?? 'RECORD').toUpperCase();
}

function sourceLabel(value) {
  switch (value) {
    case 'manual': return 'SAISI';
    case 'ugerod_session': return 'UGEROD';
    case 'external_import': return 'SÉANCE EXTERNE';
    case 'engine_detected': return 'DÉTECTÉ';
    default: return 'CONFIRMÉ';
  }
}

export default function PersonalRecordsScreen() {
  const params = useLocalSearchParams();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [expandedExerciseId, setExpandedExerciseId] = useState(null);
  const [curveByExercise, setCurveByExercise] = useState({});
  const [curveLoading, setCurveLoading] = useState(null);
  const [entryOpen, setEntryOpen] = useState(false);

  const load = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      setBook(await getPerformanceRecordBook());
    } catch (loadError) {
      setError(loadError?.message ?? 'Impossible de charger le carnet.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (String(params?.add ?? '') === '1') {
      setEntryOpen(true);
    }
  }, [params?.add]);

  const records = book?.current_records ?? book?.currentRecords ?? [];
  const suggestions = book?.suggestions_to_confirm ?? book?.suggestionsToConfirm ?? [];

  const exerciseGroups = useMemo(() => {
    const groups = new Map();

    records
      .filter((item) => item.subject_kind === 'exercise')
      .forEach((item) => {
        const key = item.exercise_id;
        if (!groups.has(key)) {
          groups.set(key, {
            exerciseId: key,
            name: item.exercise_name ?? 'Mouvement',
            records: [],
          });
        }
        groups.get(key).records.push(item);
      });

    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [records]);

  const benchmarks = records
    .filter((item) => item.subject_kind === 'benchmark')
    .sort((a, b) => String(a.benchmark_name ?? '').localeCompare(String(b.benchmark_name ?? ''), 'fr'));

  async function toggleExercise(group) {
    if (expandedExerciseId === group.exerciseId) {
      setExpandedExerciseId(null);
      return;
    }

    setExpandedExerciseId(group.exerciseId);

    if (curveByExercise[group.exerciseId]) return;

    const hasLoadRecord = group.records.some((item) => item.metric_key === 'load_for_reps');
    if (!hasLoadRecord) return;

    try {
      setCurveLoading(group.exerciseId);
      const curve = await getStrengthCurve(group.exerciseId);
      setCurveByExercise((current) => ({ ...current, [group.exerciseId]: curve }));
    } catch (curveError) {
      console.warn('PR strength curve', curveError);
    } finally {
      setCurveLoading(null);
    }
  }

  async function confirmSuggestion(entryId) {
    try {
      await confirmPerformanceRecordSuggestion(entryId);
      await load({ refresh: true });
    } catch (confirmError) {
      Alert.alert('Impossible de confirmer', confirmError?.message ?? 'Réessaie plus tard.');
    }
  }

  if (loading && !book) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color={colors.primaryLight} />
        <Text style={styles.loadingText}>OUVERTURE DU CARNET...</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <ImageBackground source={backgroundImage} style={styles.background} resizeMode="cover">
        <View style={styles.darkOverlay} />
        <LinearGradient
          colors={['rgba(7,9,12,0.40)', 'rgba(7,9,12,0.82)', 'rgba(7,9,12,0.99)']}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => load({ refresh: true })}
                tintColor={colors.primaryLight}
              />
            }
          >
            <View style={styles.header}>
              <Pressable onPress={() => router.back()} style={styles.backButton}>
                <Ionicons name="arrow-back" size={21} color={colors.textPrimary} />
              </Pressable>
              <View style={styles.headerText}>
                <Text style={styles.eyebrow}>TES RÉFÉRENCES</Text>
                <Text style={styles.title}>
                  CARNET DE PR<Text style={styles.blueDot}>.</Text>
                </Text>
              </View>
              <Pressable onPress={() => setEntryOpen(true)} style={styles.addButton}>
                <Ionicons name="add" size={22} color={colors.brandWhite} />
              </Pressable>
            </View>

            <Text style={styles.intro}>
              Tes records réels restent distincts des capacités estimées par UGEROD. Une estimation aide le coach, mais ne devient jamais un PR sans preuve réelle.
            </Text>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {suggestions.length > 0 ? (
              <>
                <SectionHeader title="À CONFIRMER" meta={`${suggestions.length} DÉTECTION${suggestions.length > 1 ? 'S' : ''}`} />
                <View style={styles.suggestionList}>
                  {suggestions.map((item) => (
                    <View key={item.entry_id} style={styles.suggestionCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestionTitle}>NOUVEAU RECORD POTENTIEL</Text>
                        <Text style={styles.suggestionValue}>
                          {formatValue(item.metric_value, item.unit)}
                        </Text>
                      </View>
                      <Pressable onPress={() => confirmSuggestion(item.entry_id)} style={styles.confirmButton}>
                        <Text style={styles.confirmText}>CONFIRMER</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            <SectionHeader title="MOUVEMENTS" meta={`${exerciseGroups.length} RÉFÉRENCE${exerciseGroups.length > 1 ? 'S' : ''}`} />

            {exerciseGroups.length > 0 ? (
              <View style={styles.bookSection}>
                {exerciseGroups.map((group, index) => {
                  const expanded = expandedExerciseId === group.exerciseId;
                  const curve = curveByExercise[group.exerciseId];
                  const curveRefs = curve?.references ?? [];

                  return (
                    <View key={group.exerciseId} style={[styles.exerciseShell, index < exerciseGroups.length - 1 && styles.bookDivider]}>
                      <Pressable onPress={() => toggleExercise(group)} style={styles.exerciseHeader}>
                        <View style={styles.bookMark} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.exerciseName}>{group.name.toUpperCase()}</Text>
                          <Text style={styles.exerciseCount}>
                            {group.records.length} record{group.records.length > 1 ? 's' : ''} confirmé{group.records.length > 1 ? 's' : ''}
                          </Text>
                        </View>
                        <Ionicons
                          name={expanded ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color={colors.textMuted}
                        />
                      </Pressable>

                      {expanded ? (
                        <View style={styles.exerciseDetails}>
                          {group.records.map((record) => (
                            <RecordRow key={record.entry_id} label={recordLabel(record)} record={record} />
                          ))}

                          {curveLoading === group.exerciseId ? (
                            <ActivityIndicator size="small" color={colors.primaryLight} style={{ marginVertical: 14 }} />
                          ) : curveRefs.length > 0 ? (
                            <>
                              <Text style={styles.estimateTitle}>COURBE DE FORCE UGEROD</Text>
                              {curveRefs.map((ref) => (
                                <View key={`${group.exerciseId}-${ref.reps}`} style={styles.curveRow}>
                                  <View>
                                    <Text style={styles.curveLabel}>{ref.reps}RM</Text>
                                    <Text style={styles.curveStatus}>
                                      {ref.status === 'CONFIRMED'
                                        ? 'CONFIRMÉ'
                                        : ref.status === 'OBSERVED'
                                          ? 'OBSERVÉ'
                                          : 'ESTIMÉ'}
                                    </Text>
                                  </View>
                                  <Text style={styles.curveValue}>
                                    {ref.status === 'ESTIMATED' ? '~' : ''}{formatValue(ref.display_kg ?? ref.load_kg, 'kg')}
                                  </Text>
                                </View>
                              ))}
                              <Text style={styles.estimateHint}>
                                Les valeurs estimées sont indicatives. UGEROD privilégie toujours une performance confirmée ou observée.
                              </Text>
                            </>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : (
              <EmptyCard text="Ton carnet est vide. Ajoute une première référence pour aider UGEROD à mieux calibrer ton niveau." />
            )}

            <SectionHeader title="BENCHMARKS" meta="CROSSFIT" />

            {benchmarks.length > 0 ? (
              <View style={styles.bookSection}>
                {benchmarks.map((record, index) => (
                  <View key={record.entry_id} style={[styles.benchmarkRow, index < benchmarks.length - 1 && styles.bookDivider]}>
                    <View>
                      <Text style={styles.exerciseName}>{String(record.benchmark_name ?? 'BENCHMARK').toUpperCase()}</Text>
                      <Text style={styles.exerciseCount}>{recordLabel(record)}</Text>
                    </View>
                    <Text style={styles.benchmarkValue}>{formatValue(record.metric_value, record.unit)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyCard text="Fran, Murph ou autre benchmark apparaîtront ici lorsqu’ils seront enregistrés." />
            )}

            <Pressable onPress={() => setEntryOpen(true)} style={styles.bigAddButton}>
              <Ionicons name="add-circle-outline" size={20} color={colors.brandWhite} />
              <Text style={styles.bigAddText}>AJOUTER / MODIFIER UN PR</Text>
            </Pressable>

            <View style={styles.bottomSpace} />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>

      <RecordEntryModal
        visible={entryOpen}
        onClose={() => setEntryOpen(false)}
        onSaved={async () => {
          setEntryOpen(false);
          await load({ refresh: true });
        }}
      />
    </View>
  );
}

function RecordRow({ label, record }) {
  return (
    <View style={styles.recordRow}>
      <View>
        <Text style={styles.recordLabel}>{label}</Text>
        <Text style={styles.recordSource}>{sourceLabel(record.source_kind)}</Text>
      </View>
      <Text style={styles.recordValue}>{formatValue(record.metric_value, record.unit)}</Text>
    </View>
  );
}

function SectionHeader({ title, meta }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionMeta}>{meta}</Text>
    </View>
  );
}

function EmptyCard({ text }) {
  return (
    <View style={styles.emptyCard}>
      <Ionicons name="book-outline" size={20} color={colors.textMuted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function RecordEntryModal({ visible, onClose, onSaved }) {
  const [kind, setKind] = useState('exercise');
  const [search, setSearch] = useState('');
  const [exercises, setExercises] = useState([]);
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [selectedMetric, setSelectedMetric] = useState(null);
  const [value, setValue] = useState('');
  const [reps, setReps] = useState('');
  const [distance, setDistance] = useState('');
  const [benchmarkName, setBenchmarkName] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);

  useEffect(() => {
    if (!visible || kind !== 'exercise' || selectedExercise) return undefined;

    const timeout = setTimeout(async () => {
      try {
        setExercises(await searchRecordExercises(search));
      } catch (error) {
        console.warn('PR exercise search', error);
      }
    }, 180);

    return () => clearTimeout(timeout);
  }, [visible, kind, search, selectedExercise]);

  function reset() {
    setKind('exercise');
    setSearch('');
    setExercises([]);
    setSelectedExercise(null);
    setMetrics([]);
    setSelectedMetric(null);
    setValue('');
    setReps('');
    setDistance('');
    setBenchmarkName('');
    setSaving(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function selectExercise(exercise) {
    try {
      setSelectedExercise(exercise);
      setLoadingOptions(true);
      const options = await getExerciseRecordMetricOptions(exercise.id);
      setMetrics(options?.metrics ?? []);
    } catch (error) {
      Alert.alert('Impossible de charger les métriques', error?.message ?? 'Réessaie.');
      setSelectedExercise(null);
    } finally {
      setLoadingOptions(false);
    }
  }

  async function save() {
    const numericValue = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      Alert.alert('Valeur invalide', 'Renseigne une valeur supérieure à 0.');
      return;
    }

    try {
      setSaving(true);

      if (kind === 'benchmark') {
        if (!benchmarkName.trim() || !selectedMetric) {
          Alert.alert('Informations manquantes', 'Choisis le benchmark et sa métrique.');
          return;
        }

        await saveManualBenchmarkRecord({
          benchmarkName: benchmarkName.trim(),
          metricKey: selectedMetric.metric_key,
          metricValue: numericValue,
        });
      } else {
        if (!selectedExercise || !selectedMetric) {
          Alert.alert('Informations manquantes', 'Choisis un mouvement et un type de record.');
          return;
        }

        const qualifier = {};

        if (selectedMetric.metric_key === 'load_for_reps') {
          const numericReps = Number(reps);
          if (!Number.isInteger(numericReps) || numericReps < 1) {
            Alert.alert('Répétitions invalides', 'Renseigne le nombre de répétitions du record.');
            return;
          }
          qualifier.reps = numericReps;
        }

        if (selectedMetric.metric_key === 'time_for_distance_seconds') {
          const numericDistance = Number(String(distance).replace(',', '.'));
          if (!Number.isFinite(numericDistance) || numericDistance <= 0) {
            Alert.alert('Distance invalide', 'Renseigne la distance du chrono.');
            return;
          }
          qualifier.distance_m = numericDistance;
        }

        await saveManualExerciseRecord({
          exerciseId: selectedExercise.id,
          metricKey: selectedMetric.metric_key,
          metricValue: numericValue,
          qualifier,
        });
      }

      reset();
      await onSaved();
    } catch (error) {
      Alert.alert('Enregistrement impossible', error?.message ?? 'Réessaie plus tard.');
    } finally {
      setSaving(false);
    }
  }

  const activeMetrics = kind === 'benchmark' ? BENCHMARK_METRICS : metrics;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>CARNET</Text>
              <Text style={styles.modalTitle}>AJOUTER UN RECORD</Text>
            </View>
            <Pressable onPress={close} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.kindRow}>
              {[
                ['exercise', 'MOUVEMENT'],
                ['benchmark', 'BENCHMARK'],
              ].map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => {
                    setKind(key);
                    setSelectedExercise(null);
                    setSelectedMetric(null);
                    setMetrics([]);
                    setValue('');
                  }}
                  style={[styles.kindButton, kind === key && styles.kindButtonActive]}
                >
                  <Text style={[styles.kindText, kind === key && styles.kindTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {kind === 'exercise' ? (
              !selectedExercise ? (
                <>
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Rechercher un mouvement..."
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                  <View style={styles.searchResults}>
                    {exercises.map((exercise) => (
                      <Pressable key={exercise.id} onPress={() => selectExercise(exercise)} style={styles.searchRow}>
                        <Text style={styles.searchName}>{exercise.name}</Text>
                        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : (
                <Pressable onPress={() => { setSelectedExercise(null); setSelectedMetric(null); }} style={styles.selectionCard}>
                  <View>
                    <Text style={styles.selectionLabel}>MOUVEMENT</Text>
                    <Text style={styles.selectionValue}>{selectedExercise.name.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.changeText}>CHANGER</Text>
                </Pressable>
              )
            ) : (
              <TextInput
                value={benchmarkName}
                onChangeText={setBenchmarkName}
                placeholder="Ex. Fran, Murph..."
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
            )}

            {loadingOptions ? (
              <ActivityIndicator size="small" color={colors.primaryLight} style={{ marginVertical: 20 }} />
            ) : activeMetrics.length > 0 && (kind === 'benchmark' || selectedExercise) ? (
              <>
                <Text style={styles.formLabel}>TYPE DE RECORD</Text>
                <View style={styles.metricChips}>
                  {activeMetrics.map((metric) => (
                    <Pressable
                      key={metric.metric_key}
                      onPress={() => setSelectedMetric(metric)}
                      style={[styles.metricChip, selectedMetric?.metric_key === metric.metric_key && styles.metricChipActive]}
                    >
                      <Text style={[styles.metricChipText, selectedMetric?.metric_key === metric.metric_key && styles.metricChipTextActive]}>
                        {String(metric.display_name ?? metric.metric_key).toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {selectedMetric ? (
              <>
                {selectedMetric.metric_key === 'load_for_reps' ? (
                  <>
                    <Text style={styles.formLabel}>NOMBRE DE RÉPÉTITIONS</Text>
                    <TextInput
                      value={reps}
                      onChangeText={setReps}
                      keyboardType="number-pad"
                      placeholder="Ex. 1, 3, 5"
                      placeholderTextColor={colors.textMuted}
                      style={styles.input}
                    />
                  </>
                ) : null}

                {selectedMetric.metric_key === 'time_for_distance_seconds' ? (
                  <>
                    <Text style={styles.formLabel}>DISTANCE (M)</Text>
                    <TextInput
                      value={distance}
                      onChangeText={setDistance}
                      keyboardType="decimal-pad"
                      placeholder="Ex. 500"
                      placeholderTextColor={colors.textMuted}
                      style={styles.input}
                    />
                  </>
                ) : null}

                <Text style={styles.formLabel}>
                  {selectedMetric.canonical_unit === 'kg'
                    ? 'CHARGE (KG)'
                    : selectedMetric.canonical_unit === 's'
                      ? 'TEMPS (SECONDES)'
                      : selectedMetric.canonical_unit === 'm'
                        ? 'DISTANCE (M)'
                        : 'VALEUR'}
                </Text>
                <TextInput
                  value={value}
                  onChangeText={setValue}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />
              </>
            ) : null}

            <Pressable disabled={saving || !selectedMetric} onPress={save} style={[styles.saveButton, (!selectedMetric || saving) && styles.saveButtonDisabled]}>
              {saving ? <ActivityIndicator size="small" color={colors.brandWhite} /> : <Text style={styles.saveText}>ENREGISTRER</Text>}
            </Pressable>
            <View style={{ height: 30 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  background: { flex: 1 },
  darkOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,6,9,0.58)' },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 70 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  loadingText: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 11, letterSpacing: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 13 },
  backButton: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  headerText: { flex: 1 },
  eyebrow: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 1.4 },
  title: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 34 },
  blueDot: { color: colors.primaryLight },
  addButton: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  intro: { color: colors.textSecondary, fontFamily: 'Oswald_400Regular', fontSize: 13, lineHeight: 20, marginBottom: 6 },
  errorText: { color: colors.brandRed, fontFamily: 'Oswald_400Regular', fontSize: 12, marginTop: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 25, marginBottom: 10 },
  sectionTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 14, letterSpacing: 0.7 },
  sectionMeta: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 9, letterSpacing: 0.5 },
  suggestionList: { gap: 8 },
  suggestionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: 'rgba(36,82,135,0.16)', borderWidth: 1, borderColor: 'rgba(73,157,255,0.18)' },
  suggestionTitle: { color: colors.textSecondary, fontFamily: 'Oswald_600SemiBold', fontSize: 10 },
  suggestionValue: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 24, marginTop: 2 },
  confirmButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.primaryLight },
  confirmText: { color: colors.brandWhite, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.6 },
  bookSection: { borderRadius: 18, paddingHorizontal: 16, backgroundColor: 'rgba(12,15,20,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  exerciseShell: { paddingVertical: 3 },
  bookDivider: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  exerciseHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 15 },
  bookMark: { width: 3, height: 31, borderRadius: 999, backgroundColor: colors.primaryLight },
  exerciseName: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 13 },
  exerciseCount: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 10, marginTop: 2 },
  exerciseDetails: { paddingBottom: 13, paddingLeft: 13 },
  recordRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  recordLabel: { color: colors.textSecondary, fontFamily: 'Oswald_600SemiBold', fontSize: 11 },
  recordSource: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 8, marginTop: 2 },
  recordValue: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 22 },
  estimateTitle: { color: colors.primaryLight, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.8, marginTop: 14, marginBottom: 4 },
  curveRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  curveLabel: { color: colors.textSecondary, fontFamily: 'Oswald_600SemiBold', fontSize: 11 },
  curveStatus: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 8 },
  curveValue: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 19 },
  estimateHint: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 10, lineHeight: 15, marginTop: 5 },
  benchmarkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15 },
  benchmarkValue: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 23 },
  emptyCard: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 17, borderRadius: 17, backgroundColor: 'rgba(12,15,20,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  emptyText: { flex: 1, color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 12, lineHeight: 18 },
  bigAddButton: { flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', marginTop: 25, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.primaryLight },
  bigAddText: { color: colors.brandWhite, fontFamily: 'Oswald_600SemiBold', fontSize: 11, letterSpacing: 0.6 },
  bottomSpace: { height: 20 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.68)' },
  modalSheet: { maxHeight: '88%', minHeight: '58%', backgroundColor: '#0B0F14', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10 },
  modalHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 15 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalEyebrow: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 1.1 },
  modalTitle: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 28 },
  modalClose: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  kindRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  kindButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  kindButtonActive: { backgroundColor: 'rgba(73,157,255,0.14)', borderColor: 'rgba(73,157,255,0.25)' },
  kindText: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 10 },
  kindTextActive: { color: colors.primaryLight },
  input: { minHeight: 48, borderRadius: 12, paddingHorizontal: 14, color: colors.textPrimary, fontFamily: 'Oswald_400Regular', fontSize: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 10 },
  searchResults: { borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)' },
  searchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  searchName: { color: colors.textSecondary, fontFamily: 'Oswald_500Medium', fontSize: 12 },
  selectionCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 13, borderRadius: 13, backgroundColor: 'rgba(73,157,255,0.10)', marginBottom: 10 },
  selectionLabel: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 8 },
  selectionValue: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 12, marginTop: 2 },
  changeText: { color: colors.primaryLight, fontFamily: 'Oswald_600SemiBold', fontSize: 9 },
  formLabel: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.6, marginTop: 10, marginBottom: 7 },
  metricChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 5 },
  metricChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  metricChipActive: { backgroundColor: 'rgba(73,157,255,0.15)', borderColor: 'rgba(73,157,255,0.28)' },
  metricChipText: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 9 },
  metricChipTextActive: { color: colors.primaryLight },
  saveButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.primaryLight, marginTop: 18 },
  saveButtonDisabled: { opacity: 0.35 },
  saveText: { color: colors.brandWhite, fontFamily: 'Oswald_600SemiBold', fontSize: 11, letterSpacing: 0.8 },
});
