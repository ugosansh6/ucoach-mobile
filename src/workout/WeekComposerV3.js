import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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

const DURATIONS = [30, 45, 60, 75, 90];
const ENVIRONMENTS = [
  { code: 'HOME', label: 'Maison', icon: 'home-outline' },
  { code: 'BOX', label: 'Box', icon: 'fitness-outline' },
  { code: 'GYM', label: 'Salle', icon: 'barbell-outline' },
  { code: 'OUTDOOR', label: 'Extérieur', icon: 'sunny-outline' },
];

const FALLBACK_INTENTS = [
  { key: 'STRENGTH', label: 'Force', subtitle: 'Construire autour d’un travail de force.' , focus: 'Strength' },
  { key: 'CONDITIONING', label: 'Conditioning', subtitle: 'Faire monter le moteur et la densité.' , focus: 'Conditioning' },
  { key: 'TECHNIQUE', label: 'Technique', subtitle: 'Travailler proprement un mouvement ou une qualité.' , focus: 'General Fitness' },
  { key: 'FULL_BODY', label: 'Full body', subtitle: 'Une séance équilibrée et complète.' , focus: 'General Fitness' },
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

export default function WeekComposerV3() {
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
  const [selectedItem, setSelectedItem] = useState(null);

  const [duration, setDuration] = useState(60);
  const [environmentCode, setEnvironmentCode] = useState('HOME');
  const [equipmentCatalog, setEquipmentCatalog] = useState([]);
  const [equipmentIds, setEquipmentIds] = useState([]);
  const [intent, setIntent] = useState(null);
  const [architectures, setArchitectures] = useState([]);
  const [architecture, setArchitecture] = useState(null);
  const [candidateMap, setCandidateMap] = useState({});
  const [selectionMap, setSelectionMap] = useState({});
  const [exerciseBlockIndex, setExerciseBlockIndex] = useState(0);
  const [mechanic, setMechanic] = useState(null);

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

        const candidates = (contract?.visibleItems ?? []).filter(
          (item) => item?.recommendedDate === dateKey && !item?.sessionId
        );
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
        setEquipmentIds((presetRows ?? []).map((row) => String(row.equipment_id)).filter(Boolean));

        const coachIntent = coachIntentFromItem(item);
        if (coachIntent) setIntent(coachIntent);
      } catch (loadError) {
        console.warn('[WeekComposerV3] load failed', loadError);
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
    try {
      const presetRows = await getUserEnvironmentEquipmentPreset(code);
      setEquipmentIds((presetRows ?? []).map((row) => String(row.equipment_id)).filter(Boolean));
    } catch (loadError) {
      console.warn('[WeekComposerV3] equipment preset failed', loadError);
      setEquipmentIds([]);
    }
  }

  function toggleEquipment(id) {
    setEquipmentIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  }

  async function goToIntent() {
    setStep(1);
  }

  async function goToArchitecture() {
    if (!intent) return;
    try {
      setBusy(true);
      const targets = await getComposerArchitectureTargets(duration);
      const next = buildComposerArchitectures({
        durationMinutes: duration,
        intentKey: intent.key,
        targets,
      });
      setArchitectures(next);
      setArchitecture(next[0] ?? null);
      setStep(2);
    } catch (loadError) {
      console.warn('[WeekComposerV3] architecture failed', loadError);
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
      const results = await Promise.all(
        blocks.map(async (block) => {
          const candidates = await getComposerExerciseCandidates({
            blockType: block.type,
            focus: intent?.focus ?? 'General Fitness',
            targetRegion: intent?.targetRegion ?? selectedItem?.plannedContext?.targetRegion ?? null,
            environmentCode,
            equipmentIds,
            limit: 8,
          });
          return [block.type, candidates];
        })
      );
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
      console.warn('[WeekComposerV3] candidate load failed', loadError);
      setError('Impossible de charger les mouvements proposés.');
    } finally {
      setBusy(false);
    }
  }

  function toggleExercise(type, id) {
    const max = maxForBlock(type);
    setSelectionMap((current) => {
      const selected = current[type] ?? [];
      if (selected.includes(id)) {
        return { ...current, [type]: selected.filter((value) => value !== id) };
      }
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
    const wodCount = (selectionMap.WOD ?? []).length;
    const options = getComposerMechanicOptions({
      wodMinutes: wodBlock?.minutes ?? 12,
      exerciseCount: wodCount,
    });
    setMechanic(options[0] ?? null);
    setStep(4);
  }

  function selectedExercises(type) {
    const ids = new Set(selectionMap[type] ?? []);
    return (candidateMap[type] ?? []).filter((candidate) => ids.has(candidate.id));
  }

  function equipmentNames() {
    const selected = new Set(equipmentIds);
    return equipmentCatalog
      .filter((item) => selected.has(String(item.id)))
      .map((item) => item.name)
      .filter(Boolean);
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
      if (planItemId) {
        await updateWeekPlanItemContext({ planItemId, context });
      } else {
        const created = await createAssistedWeekPlanItem({ recommendedDate: dateKey, context });
        planItemId = created?.planItemId ?? null;
      }

      const draft = {
        target_date: dateKey,
        duration_minutes: duration,
        environment_code: environmentCode,
        equipment_ids: equipmentIds,
        intent: {
          key: intent?.key ?? null,
          label: intent?.label ?? null,
          focus: intent?.focus ?? null,
        },
        architecture: {
          key: architecture?.key ?? null,
          title: architecture?.title ?? null,
          blocks: (architecture?.blocks ?? []).map((block) => ({
            type: block.type,
            label: block.label,
            minutes: block.minutes,
            exercises: selectedExercises(block.type).map((exercise) => ({
              id: exercise.id,
              name: exercise.name,
            })),
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
      console.warn('[WeekComposerV3] save failed', saveError);
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
  const mechanicOptions = getComposerMechanicOptions({
    wodMinutes: wodBlock?.minutes ?? 12,
    exerciseCount: (selectionMap.WOD ?? []).length,
  });
  const estimatedMinutes = (architecture?.blocks ?? []).reduce((sum, block) => sum + Number(block.minutes ?? 0), 0);

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
          <View style={styles.stepWrap}>
            <Text style={styles.kicker}>POSE LE CADRE.</Text>
            <Text style={styles.question}>Combien de temps et où tu t’entraînes ?</Text>
            <Text style={styles.helper}>Deux contraintes essentielles. Le matériel reste optionnel.</Text>

            <Text style={styles.sectionLabel}>TEMPS</Text>
            <View style={styles.choiceRow}>
              {DURATIONS.map((value) => (
                <Pressable key={value} onPress={() => setDuration(value)} style={[styles.smallChoice, duration === value && styles.smallChoiceSelected]}>
                  <Text style={[styles.smallChoiceText, duration === value && styles.smallChoiceTextSelected]}>{value} min</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLabel}>LIEU</Text>
            <View style={styles.environmentGrid}>
              {ENVIRONMENTS.map((item) => (
                <Pressable key={item.code} onPress={() => chooseEnvironment(item.code)} style={[styles.environmentCard, environmentCode === item.code && styles.environmentCardSelected]}>
                  <Ionicons name={item.icon} size={21} color={environmentCode === item.code ? colors.textOnAccent : colors.text} />
                  <Text style={[styles.environmentText, environmentCode === item.code && styles.environmentTextSelected]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>MATÉRIEL · OPTIONNEL</Text>
              <Text style={styles.counterText}>{equipmentIds.length} sélectionné{equipmentIds.length > 1 ? 's' : ''}</Text>
            </View>
            <View style={styles.choiceRow}>
              {equipmentCatalog.filter((item) => item.id !== 'E00').slice(0, 12).map((item) => (
                <Pressable key={item.id} onPress={() => toggleEquipment(String(item.id))} style={[styles.equipmentChip, equipmentIds.includes(String(item.id)) && styles.equipmentChipSelected]}>
                  <Text style={[styles.equipmentChipText, equipmentIds.includes(String(item.id)) && styles.equipmentChipTextSelected]}>{item.name}</Text>
                </Pressable>
              ))}
            </View>

            <PrimaryButton label="CONTINUER" onPress={goToIntent} styles={styles} colors={colors} />
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
                  {selectedExercises(block.type).map((exercise) => (
                    <Text key={exercise.id} style={styles.recapExercise}>• {exercise.name}</Text>
                  ))}
                  {block.type === 'WOD' && mechanic ? (
                    <Text style={styles.recapMechanic}>{mechanic.title}</Text>
                  ) : null}
                </View>
              ))}
            </View>

            <View style={styles.coachGuard}>
              <View style={styles.coachRule} />
              <Text style={styles.coachGuardText}>
                Les blocs, mouvements et la mécanique seront conservés. UGEROD pourra ensuite finaliser la dose — reps, charge, volume et repos — sans réécrire tes choix.
              </Text>
            </View>

            <PrimaryButton label={busy ? 'ENREGISTREMENT…' : 'AJOUTER À MA SEMAINE'} onPress={addToWeek} disabled={busy} loading={busy} styles={styles} colors={colors} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
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
    stepWrap: { marginTop: 34 },
    kicker: { fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.45, color: colors.accent },
    question: { marginTop: 9, fontFamily: fontFamilies.display, fontSize: 31, lineHeight: 36, color: colors.text },
    helper: { marginTop: 10, fontFamily: fontFamilies.regular, fontSize: 14, lineHeight: 21, color: colors.textSecondary },
    sectionLabel: { marginTop: 30, marginBottom: 11, fontFamily: fontFamilies.bold, fontSize: 10, letterSpacing: 1.15, color: colors.textSecondary },
    sectionHeaderRow: { marginTop: 4, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    counterText: { marginBottom: 10, fontFamily: fontFamilies.medium, fontSize: 11, color: colors.textMuted },
    choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
    smallChoice: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    smallChoiceSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    smallChoiceText: { fontFamily: fontFamilies.semiBold, fontSize: 13, color: colors.text },
    smallChoiceTextSelected: { color: colors.textOnAccent },
    environmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    environmentCard: { minWidth: '47%', flexGrow: 1, minHeight: 70, paddingHorizontal: 15, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 },
    environmentCardSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    environmentText: { fontFamily: fontFamilies.semiBold, fontSize: 14, color: colors.text },
    environmentTextSelected: { color: colors.textOnAccent },
    equipmentChip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    equipmentChipSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated ?? colors.surface },
    equipmentChipText: { fontFamily: fontFamilies.medium, fontSize: 12, color: colors.textSecondary },
    equipmentChipTextSelected: { color: colors.accent, fontFamily: fontFamilies.semiBold },
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
  });
}
