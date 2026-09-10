import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';

import { useUgerodTheme } from '../../contexts/UgerodThemeContext';

const wodBeep = require('../../../assets/sounds/tabata-beep.wav');
const WOD_ACCENT = '#5E6633';
const WOD_ACTION = '#FF6B19';
const RING_SEGMENTS = 48;

function normalizeMechanic(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_');
}

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function paramsFromBlock(block) {
  return (
    block?.source?.parameters ??
    block?.source?.mechanicJson?.parameters ??
    block?.source?.mechanic_json?.parameters ??
    {}
  );
}

function mechanicFromBlock(block) {
  return normalizeMechanic(
    block?.source?.mechanic ??
      block?.source?.mechanicJson?.mechanic_key ??
      block?.source?.mechanic_json?.mechanic_key ??
      block?.mechanic ??
      ''
  );
}

function variantFromBlock(block) {
  return normalizeMechanic(
    block?.source?.variant ??
      block?.source?.mechanicJson?.variant_key ??
      block?.source?.mechanic_json?.variant_key ??
      ''
  );
}

function prescriptionObject(exercise) {
  return exercise?.prescriptionJson ?? exercise?.prescription_json ?? {};
}

function overlayForExercise(exercise) {
  return prescriptionObject(exercise)?.mechanic_overlay ?? {};
}

function exercisePrescription(exercise) {
  if (typeof exercise?.prescription === 'string' && exercise.prescription.trim()) {
    return exercise.prescription.trim();
  }
  const p = prescriptionObject(exercise);
  if (p.execution_target_reps != null) {
    return `${p.execution_target_reps} ${p.reps_semantics === 'per_side' ? 'reps / côté' : 'reps'}`;
  }
  if (p.execution_target_duration_seconds != null) return `${p.execution_target_duration_seconds} sec`;
  if (p.execution_target_distance_meters != null) return `${p.execution_target_distance_meters} m`;
  return 'Prescription UGEROD';
}

function repsForStage(exercise, stage, direction = 'ascending') {
  const overlay = overlayForExercise(exercise);
  const p = prescriptionObject(exercise);
  const start = numberOr(
    overlay.start_reps ?? overlay.base_reps ?? p.execution_target_reps ?? p.reps_min,
    1
  );
  const increment = Math.max(1, numberOr(overlay.increment_reps, 1));
  if (direction === 'descending') {
    const first = numberOr(overlay.first_stage_reps, start);
    return Math.max(start, first - Math.max(0, stage - 1) * increment);
  }
  return Math.max(1, start + Math.max(0, stage - 1) * increment);
}

function pyramidReps(exercise, multiplier) {
  const overlay = overlayForExercise(exercise);
  const p = prescriptionObject(exercise);
  const base = Math.max(1, numberOr(overlay.base_reps ?? p.execution_target_reps ?? p.reps_min, 1));
  return Math.round(base * multiplier);
}

function playerTitle(mechanic, variant) {
  if (mechanic === 'PROGRESSIVE_INTERVAL' && variant === 'DEATH_BY') return 'Death By';
  if (mechanic === 'PROGRESSIVE_INTERVAL' && variant === 'DEATH_BY_COUPLET') return 'Death By Couplet';
  if (mechanic === 'COUPLET' && variant === 'ASCENDING_COUPLET') return 'Couplet ascendant';
  if (mechanic === 'COUPLET' && variant === 'DESCENDING_COUPLET') return 'Couplet descendant';
  const labels = {
    AMRAP: 'AMRAP',
    EMOM: 'EMOM',
    FOR_TIME: 'For Time',
    CIRCUIT: 'Circuit',
    HIIT: 'HIIT',
    LADDER: 'Ladder',
    PYRAMID: 'Pyramide',
    PROGRESSIVE_INTERVAL: 'Progressif',
    ODD_EVEN: 'Odd / Even',
    EVERY_X_MINUTES: 'Every X Minutes',
    CHIPPER: 'Chipper',
    REP_TARGET: 'Rep Target',
    COUPLET: 'Couplet',
    DECK: 'Deck-style',
    STRENGTH: 'Musculation',
    SETS_REPS: 'Séries / reps',
  };
  return labels[mechanic] ?? mechanic.replaceAll('_', ' ');
}

function totalSecondsForMechanic({ mechanic, params, durationMinutes, exerciseCount }) {
  const budget = Math.max(1, numberOr(params.wod_budget_minutes ?? durationMinutes, durationMinutes || 10)) * 60;
  if (mechanic === 'AMRAP') return Math.max(1, numberOr(params.duration_minutes, durationMinutes || 10)) * 60;
  if (mechanic === 'EMOM') {
    if (params.duration_minutes) return Math.max(1, numberOr(params.duration_minutes, durationMinutes || 10)) * 60;
    return Math.max(1, numberOr(params.cycles, 1)) * Math.max(1, exerciseCount) * Math.max(1, numberOr(params.station_seconds, 60));
  }
  if (mechanic === 'HIIT') {
    return Math.max(1, numberOr(params.rounds, 1)) * Math.max(1, numberOr(params.exercise_count, exerciseCount || 1)) *
      (Math.max(1, numberOr(params.work_seconds, 40)) + Math.max(0, numberOr(params.rest_seconds, 20)));
  }
  if (mechanic === 'FOR_TIME') return Math.max(1, numberOr(params.cap_seconds, budget));
  if (mechanic === 'ODD_EVEN') return Math.max(1, numberOr(params.cycles, 1)) * 2 * Math.max(1, numberOr(params.station_seconds, 60));
  if (mechanic === 'EVERY_X_MINUTES') return Math.max(1, numberOr(params.cycles, 1)) * Math.max(1, numberOr(params.interval_seconds, 120));
  if (mechanic === 'PROGRESSIVE_INTERVAL') return Math.max(1, numberOr(params.time_limit_seconds, budget));
  return null;
}

function protocolSummary(mechanic, params, exercises, durationMinutes) {
  if (mechanic === 'AMRAP') return `${numberOr(params.duration_minutes, durationMinutes)} min · maximum de tours`;
  if (mechanic === 'EMOM') return `${numberOr(params.station_seconds, 60)}s par station · ${numberOr(params.cycles, 1)} cycles`;
  if (mechanic === 'FOR_TIME') return `${numberOr(params.rounds, 1)} tours · cap ${formatClock(numberOr(params.cap_seconds, durationMinutes * 60))}`;
  if (mechanic === 'CIRCUIT') return `${numberOr(params.rounds, 1)} tours · ${numberOr(params.rest_between_rounds_seconds, 0)}s repos`;
  if (mechanic === 'HIIT') return `${numberOr(params.rounds, 1)} tours · ${numberOr(params.work_seconds, 40)}s / ${numberOr(params.rest_seconds, 20)}s`;
  if (mechanic === 'LADDER' || mechanic === 'COUPLET') return `${numberOr(params.rungs, 1)} étapes`;
  if (mechanic === 'PYRAMID') return `${(Array.isArray(params.multipliers) ? params.multipliers : [1, 2, 3, 2, 1]).join(' · ')}`;
  if (mechanic === 'ODD_EVEN') return `${numberOr(params.cycles, 1)} cycles · alternance impaire / paire`;
  if (mechanic === 'EVERY_X_MINUTES') return `${numberOr(params.cycles, 1)} cycles · départ toutes les ${formatClock(numberOr(params.interval_seconds, 120))}`;
  if (mechanic === 'PROGRESSIVE_INTERVAL') return `${formatClock(numberOr(params.interval_seconds, 60))} par étape · progression jusqu’à l’échec ou au cap`;
  if (mechanic === 'CHIPPER') return `${exercises.length} exercices · un seul passage`;
  if (mechanic === 'REP_TARGET') return `${numberOr(params.total_rep_target, 0)} reps au total`;
  if (mechanic === 'DECK') return `${numberOr(params.cards, 52)} cartes prévues`;
  if (mechanic === 'SETS_REPS' || mechanic === 'STRENGTH') return `${numberOr(params.sets, 1)} séries · ${numberOr(params.rest_between_exercises_seconds, 0)}s repos`;
  return `${durationMinutes} min`;
}

function appendRuntimeEvent(current, eventType, elapsedSeconds, payload = {}) {
  const safeElapsed = Math.max(0, Math.floor(numberOr(elapsedSeconds, 0)));
  const ordinal = Array.isArray(current) ? current.length : 0;
  return [
    ...(Array.isArray(current) ? current : []),
    {
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      idempotency_key: `play013:${eventType}:${ordinal}:${safeElapsed}`,
      payload: { elapsed_seconds: safeElapsed, ...payload },
    },
  ];
}

function useSecondClock({ started, paused, finished, maxSeconds, initialElapsed, onAutoFinish }) {
  const [elapsed, setElapsed] = useState(Math.max(0, numberOr(initialElapsed, 0)));
  useEffect(() => {
    if (!started || paused || finished) return undefined;
    const timer = setInterval(() => {
      setElapsed((current) => {
        const next = current + 1;
        if (maxSeconds != null && next >= maxSeconds) {
          setTimeout(() => onAutoFinish?.(maxSeconds), 0);
          return maxSeconds;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [finished, maxSeconds, onAutoFinish, paused, started]);
  return [elapsed, setElapsed];
}

export default function WodProtocolPlayerV3({
  block,
  initialRuntime = null,
  onBeforeStart,
  onRuntimeChange,
  canChangeFormat = false,
  onChangeFormat = null,
}) {
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const mechanic = mechanicFromBlock(block);
  const variant = variantFromBlock(block);
  const params = paramsFromBlock(block);
  const exercises = Array.isArray(block?.exercises) ? block.exercises : [];
  const durationMinutes = Math.max(1, numberOr(block?.durationMinutes, 10));
  const timedMechanics = useMemo(() => new Set([
    'AMRAP', 'EMOM', 'FOR_TIME', 'HIIT', 'ODD_EVEN', 'EVERY_X_MINUTES', 'PROGRESSIVE_INTERVAL',
  ]), []);

  const beepPlayer = useAudioPlayer(wodBeep, { keepAudioSessionActive: true });
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
  }, []);
  const playBeep = useCallback((count = 1) => {
    for (let index = 0; index < count; index += 1) {
      setTimeout(() => {
        try {
          beepPlayer.seekTo(0);
          beepPlayer.play();
        } catch {}
      }, index * 170);
    }
  }, [beepPlayer]);

  const [started, setStarted] = useState(Boolean(initialRuntime?.started));
  const [paused, setPaused] = useState(Boolean(initialRuntime?.paused));
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [finished, setFinished] = useState(Boolean(initialRuntime?.finished));
  const [finishReason, setFinishReason] = useState(initialRuntime?.finishReason ?? null);
  const [completedRounds, setCompletedRounds] = useState(Math.max(0, numberOr(initialRuntime?.completedRounds, 0)));
  const [manualStep, setManualStep] = useState(Math.max(1, numberOr(initialRuntime?.manualStep, 1)));
  const [currentItemIndex, setCurrentItemIndex] = useState(Math.max(0, numberOr(initialRuntime?.currentItemIndex, 0)));
  const [restRemaining, setRestRemaining] = useState(Math.max(0, numberOr(initialRuntime?.restRemaining, 0)));
  const [events, setEvents] = useState(Array.isArray(initialRuntime?.executionEvents) ? initialRuntime.executionEvents : []);
  const [roundSplits, setRoundSplits] = useState(Array.isArray(initialRuntime?.roundSplits) ? initialRuntime.roundSplits : []);

  const totalSeconds = useMemo(() => totalSecondsForMechanic({
    mechanic, params, durationMinutes, exerciseCount: exercises.length,
  }), [durationMinutes, exercises.length, mechanic, params]);

  const finish = useCallback((reason = 'completed', elapsedOverride = null) => {
    if (finished) return;
    setFinished(true);
    setPaused(false);
    setFinishReason(reason);
    setEvents((current) => appendRuntimeEvent(
      current,
      'WOD_FINISHED',
      elapsedOverride,
      { reason }
    ));
    playBeep(2);
    Vibration.vibrate([0, 100, 60, 100]);
  }, [finished, playBeep]);

  const handleAutoFinish = useCallback((seconds) => {
    if (mechanic === 'FOR_TIME' || mechanic === 'PROGRESSIVE_INTERVAL') finish('time_cap', seconds);
    else finish('timer_complete', seconds);
  }, [finish, mechanic]);

  const [elapsed] = useSecondClock({
    started,
    paused,
    finished,
    maxSeconds: totalSeconds,
    initialElapsed: initialRuntime?.elapsedSeconds ?? 0,
    onAutoFinish: handleAutoFinish,
  });

  useEffect(() => {
    if (restRemaining <= 0 || paused || finished) return undefined;
    const timer = setInterval(() => {
      setRestRemaining((current) => {
        if (current <= 1) {
          playBeep();
          Vibration.vibrate(60);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [finished, paused, playBeep, restRemaining > 0]);

  const derived = useMemo(() => {
    if (mechanic === 'EMOM') {
      const stationSeconds = Math.max(1, numberOr(params.station_seconds, 60));
      const minuteIndex = Math.floor(elapsed / stationSeconds);
      const exerciseIndex = minuteIndex % Math.max(1, exercises.length);
      return {
        phaseKey: `emom-${minuteIndex}`,
        currentExercise: exercises[exerciseIndex] ?? null,
        nextExercise: exercises[(exerciseIndex + 1) % Math.max(1, exercises.length)] ?? null,
        phaseRemaining: Math.max(0, stationSeconds - (elapsed % stationSeconds)),
        phaseDuration: stationSeconds,
        label: `Minute ${minuteIndex + 1}`,
      };
    }
    if (mechanic === 'HIIT') {
      const work = Math.max(1, numberOr(params.work_seconds, 40));
      const rest = Math.max(0, numberOr(params.rest_seconds, 20));
      const stationDuration = Math.max(1, work + rest);
      const stationIndex = Math.floor(elapsed / stationDuration);
      const within = elapsed % stationDuration;
      const inWork = within < work;
      const exerciseCount = Math.max(1, numberOr(params.exercise_count, exercises.length || 1));
      const exerciseIndex = stationIndex % Math.max(1, exercises.length);
      return {
        phaseKey: `hiit-${stationIndex}-${inWork ? 'work' : 'rest'}`,
        currentExercise: exercises[exerciseIndex] ?? null,
        nextExercise: exercises[(exerciseIndex + 1) % Math.max(1, exercises.length)] ?? null,
        phaseRemaining: inWork ? Math.max(0, work - within) : Math.max(0, stationDuration - within),
        phaseDuration: inWork ? work : Math.max(1, rest),
        phase: inWork ? 'Effort' : 'Récupération',
        round: Math.floor(stationIndex / exerciseCount) + 1,
      };
    }
    if (mechanic === 'ODD_EVEN') {
      const stationSeconds = Math.max(1, numberOr(params.station_seconds, 60));
      const minuteIndex = Math.floor(elapsed / stationSeconds);
      const odd = (minuteIndex + 1) % 2 === 1;
      const index = Math.max(0, numberOr(odd ? params.odd_position : params.even_position, odd ? 1 : 2) - 1);
      return {
        phaseKey: `odd-even-${minuteIndex}`,
        currentExercise: exercises[index] ?? exercises[0] ?? null,
        phaseRemaining: Math.max(0, stationSeconds - (elapsed % stationSeconds)),
        phaseDuration: stationSeconds,
        label: `Minute ${minuteIndex + 1} · ${odd ? 'impaire' : 'paire'}`,
      };
    }
    if (mechanic === 'EVERY_X_MINUTES') {
      const interval = Math.max(1, numberOr(params.interval_seconds, 120));
      const cycleIndex = Math.floor(elapsed / interval);
      return {
        phaseKey: `every-${cycleIndex}`,
        phaseRemaining: Math.max(0, interval - (elapsed % interval)),
        phaseDuration: interval,
        label: `Cycle ${cycleIndex + 1} / ${Math.max(1, numberOr(params.cycles, 1))}`,
      };
    }
    if (mechanic === 'PROGRESSIVE_INTERVAL') {
      const interval = Math.max(1, numberOr(params.interval_seconds, 60));
      const stage = Math.floor(elapsed / interval) + 1;
      return {
        phaseKey: `progressive-${stage}`,
        stage,
        phaseRemaining: Math.max(0, interval - (elapsed % interval)),
        phaseDuration: interval,
        label: `Étape ${stage}`,
      };
    }
    return {};
  }, [elapsed, exercises, mechanic, params]);

  const lastPhaseKey = useRef(null);

  useEffect(() => {
    if (!started || paused || finished || !derived.phaseKey) return;
    if (lastPhaseKey.current === derived.phaseKey) return;
    if (lastPhaseKey.current != null) {
      playBeep();
      Vibration.vibrate(70);
    }
    lastPhaseKey.current = derived.phaseKey;
  }, [derived.phaseKey, finished, paused, playBeep, started]);

  useEffect(() => {
    if (!started || paused || finished) return;
    const remaining = derived.phaseRemaining ??
      (totalSeconds != null ? Math.max(0, totalSeconds - elapsed) : null);
    if (remaining != null && remaining > 0 && remaining <= 3) {
      playBeep();
      Vibration.vibrate(30);
    }
  }, [derived.phaseRemaining, elapsed, finished, paused, playBeep, started, totalSeconds]);

  const runtime = useMemo(() => ({
    version: 'play-013-wod-player-v3',
    mechanic,
    variant: variant || null,
    started,
    paused,
    finished,
    finishReason,
    elapsedSeconds: elapsed,
    totalSeconds,
    completedRounds,
    manualStep,
    currentItemIndex,
    currentStage: derived.stage ?? null,
    phase: derived.phase ?? null,
    phaseRemainingSeconds: derived.phaseRemaining ?? null,
    parameters: params,
    controlledWindow: timedMechanics.has(mechanic),
    restRemaining,
    executionEvents: events,
    roundSplits,
  }), [
    completedRounds, currentItemIndex, derived.phase, derived.phaseRemaining, derived.stage,
    elapsed, events, finishReason, finished, manualStep, mechanic, params, paused,
    restRemaining, roundSplits, started, timedMechanics, totalSeconds, variant,
  ]);

  useEffect(() => {
    onRuntimeChange?.(runtime);
  }, [onRuntimeChange, runtime]);

  async function start() {
    if (starting || started || finished) return;
    setStarting(true);
    setStartError('');
    try {
      await onBeforeStart?.();
      setStarted(true);
      setPaused(false);
      setEvents((current) => appendRuntimeEvent(current, 'WOD_STARTED', 0));
      playBeep();
      Vibration.vibrate(60);
    } catch (error) {
      setStartError(error?.message ?? 'Impossible de démarrer le WOD.');
    } finally {
      setStarting(false);
    }
  }

  function togglePause() {
    if (!started || finished) return;
    const next = !paused;
    setPaused(next);
    setEvents((current) => appendRuntimeEvent(
      current,
      next ? 'WOD_PAUSED' : 'WOD_RESUMED',
      elapsed
    ));
  }

  function completeRound() {
    if (restRemaining > 0 || finished) return;
    const next = completedRounds + 1;
    setCompletedRounds(next);
    setRoundSplits((current) => [...current, { round_index: next, elapsed_seconds: elapsed }]);
    setEvents((current) => appendRuntimeEvent(current, 'ROUND_COMPLETED', elapsed, { round_index: next }));
    const target = params.rounds != null ? Math.max(1, numberOr(params.rounds, 1)) : null;
    if (mechanic !== 'AMRAP' && target != null && next >= target) {
      finish('rounds_complete', elapsed);
      return;
    }
    const rest = Math.max(0, numberOr(params.rest_between_rounds_seconds, 0));
    if (rest > 0) setRestRemaining(rest);
  }

  function completeStep(maxSteps) {
    setEvents((current) => appendRuntimeEvent(current, 'STEP_COMPLETED', elapsed, { step: manualStep }));
    if (manualStep >= maxSteps) {
      finish('steps_complete', elapsed);
      return;
    }
    setManualStep((value) => value + 1);
  }

  function completeItem() {
    setEvents((current) => appendRuntimeEvent(current, 'ITEM_COMPLETED', elapsed, { item_index: currentItemIndex }));
    if (currentItemIndex >= exercises.length - 1) {
      finish('sequence_complete', elapsed);
      return;
    }
    setCurrentItemIndex((value) => value + 1);
  }

  function completeSet() {
    if (restRemaining > 0) return;
    const sets = Math.max(1, numberOr(params.sets, 1));
    const total = sets * Math.max(1, exercises.length);
    setEvents((current) => appendRuntimeEvent(current, 'SET_COMPLETED', elapsed, { set_station: manualStep }));
    if (manualStep >= total) {
      finish('sets_complete', elapsed);
      return;
    }
    setManualStep((value) => value + 1);
    setRestRemaining(Math.max(0, numberOr(params.rest_between_exercises_seconds, 0)));
  }

  if (!mechanic) {
    return (
      <View style={styles.shell}>
        <Text style={styles.errorTitle}>Format indisponible</Text>
        <Text style={styles.muted}>Le WOD ne contient pas de mécanique exécutable.</Text>
      </View>
    );
  }

  const title = playerTitle(mechanic, variant);
  const summary = protocolSummary(mechanic, params, exercises, durationMinutes);

  return (
    <View style={styles.shell}>
      {!started && !finished ? (
        <StartPanel
          title={title}
          summary={summary}
          exercises={exercises}
          loading={starting}
          error={startError}
          onStart={start}
          canChangeFormat={canChangeFormat}
          onChangeFormat={onChangeFormat}
          styles={styles}
          colors={colors}
        />
      ) : null}

      {started && !finished ? (
        <>
          <View style={styles.runtimeHeader}>
            <View>
              <Text style={styles.runtimeEyebrow}>WOD EN COURS</Text>
              <Text style={styles.runtimeTitle}>{title}</Text>
            </View>
            <Pressable onPress={togglePause} style={styles.pauseButton}>
              <Ionicons name={paused ? 'play' : 'pause'} size={20} color={colors.text} />
            </Pressable>
          </View>

          {paused ? <View style={styles.pauseNotice}><Text style={styles.pauseNoticeText}>En pause</Text></View> : null}

          <RuntimeBody
            mechanic={mechanic}
            variant={variant}
            params={params}
            exercises={exercises}
            elapsed={elapsed}
            totalSeconds={totalSeconds}
            derived={derived}
            completedRounds={completedRounds}
            manualStep={manualStep}
            currentItemIndex={currentItemIndex}
            restRemaining={restRemaining}
            onRound={completeRound}
            onStep={completeStep}
            onItem={completeItem}
            onSet={completeSet}
            onFailure={() => finish('observed_failure', elapsed)}
            onDeckNext={() => {
              const deck = Array.isArray(params.deck_order) ? params.deck_order : [];
              setEvents((current) => appendRuntimeEvent(current, 'CARD_COMPLETED', elapsed, { card_index: currentItemIndex }));
              if (currentItemIndex >= deck.length - 1) finish('deck_complete', elapsed);
              else setCurrentItemIndex((value) => value + 1);
            }}
            styles={styles}
            colors={colors}
          />

          {mechanic !== 'PROGRESSIVE_INTERVAL' ? (
            <Pressable onPress={() => finish('manual_stop', elapsed)} style={styles.stopButton}>
              <Text style={styles.stopText}>Arrêter le WOD</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {finished ? (
        <View style={styles.finishedPanel}>
          <View style={styles.finishedIcon}><Ionicons name="checkmark" size={22} color="#FFFFFF" /></View>
          <Text style={styles.finishedTitle}>WOD terminé</Text>
          <Text style={styles.finishedMeta}>{title} · {formatClock(elapsed)}</Text>
          {finishReason === 'manual_stop' ? <Text style={styles.finishedNote}>Arrêt anticipé enregistré : UGEROD conservera uniquement le travail réellement observé.</Text> : null}
          {finishReason === 'time_cap' ? <Text style={styles.finishedNote}>Cap atteint : le résultat partiel sera conservé.</Text> : null}
          {finishReason === 'observed_failure' ? <Text style={styles.finishedNote}>Échec enregistré à l’étape {derived.stage ?? manualStep}.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function StartPanel({ title, summary, exercises, loading, error, onStart, canChangeFormat, onChangeFormat, styles, colors }) {
  return (
    <>
      <View style={styles.startTopRow}>
        <View style={styles.startHeader}>
          <View style={styles.readyDot} />
          <Text style={styles.readyLabel}>Prêt à démarrer</Text>
        </View>
        {canChangeFormat && typeof onChangeFormat === 'function' ? (
          <Pressable onPress={onChangeFormat} style={styles.changeFormatButton}>
            <Ionicons name="options-outline" size={16} color={WOD_ACCENT} />
            <Text style={styles.changeFormatText}>Changer</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.startTitle}>{title}</Text>
      <Text style={styles.startSummary}>{summary}</Text>
      <View style={styles.previewList}>
        {exercises.map((exercise, index) => (
          <View key={exercise?._uiKey ?? exercise?.sessionExerciseId ?? exercise?.id ?? index} style={styles.previewRow}>
            <View style={styles.previewIndex}><Text style={styles.previewIndexText}>{index + 1}</Text></View>
            <View style={styles.previewCopy}>
              <Text style={styles.previewName}>{String(exercise?.name ?? 'Exercice')}</Text>
              <Text style={styles.previewPrescription}>{exercisePrescription(exercise)}</Text>
            </View>
          </View>
        ))}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Pressable onPress={onStart} disabled={loading} style={[styles.primaryButton, loading && styles.disabled]}>
        {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="play" size={19} color="#FFFFFF" />}
        <Text style={styles.primaryButtonText}>{loading ? 'Démarrage…' : 'Démarrer le WOD'}</Text>
      </Pressable>
    </>
  );
}

function RuntimeBody(props) {
  const {
    mechanic, variant, params, exercises, elapsed, totalSeconds, derived,
    completedRounds, manualStep, currentItemIndex, restRemaining,
    onRound, onStep, onItem, onSet, onFailure, onDeckNext, styles, colors,
  } = props;

  if (mechanic === 'AMRAP') {
    const remaining = Math.max(0, numberOr(totalSeconds, 0) - elapsed);
    return <>
      <ProtocolRing value={remaining} total={totalSeconds} label="Temps restant" styles={styles} colors={colors} />
      <Metric value={completedRounds} label="Tours terminés" styles={styles} />
      <WorkList exercises={exercises} styles={styles} />
      <Action label="Tour terminé" icon="checkmark" onPress={onRound} styles={styles} />
    </>;
  }

  if (mechanic === 'FOR_TIME') {
    return <>
      <ProtocolRing value={elapsed} total={totalSeconds} label="Chrono" countUp styles={styles} colors={colors} />
      <View style={styles.metricPair}>
        <Metric value={formatClock(totalSeconds)} label="Cap" styles={styles} />
        <Metric value={`${completedRounds} / ${Math.max(1, numberOr(params.rounds, 1))}`} label="Tours" styles={styles} />
      </View>
      <WorkList exercises={exercises} styles={styles} />
      <Action label="Tour terminé" icon="checkmark" onPress={onRound} styles={styles} />
    </>;
  }

  if (mechanic === 'EMOM' || mechanic === 'ODD_EVEN') {
    return <>
      <ProtocolRing value={derived.phaseRemaining ?? 0} total={derived.phaseDuration ?? 60} label={derived.label ?? 'Intervalle'} styles={styles} colors={colors} />
      <CurrentExercise exercise={derived.currentExercise} nextExercise={derived.nextExercise} styles={styles} />
    </>;
  }

  if (mechanic === 'HIIT') {
    const recovery = derived.phase === 'Récupération';
    return <>
      <ProtocolRing
        value={derived.phaseRemaining ?? 0}
        total={derived.phaseDuration ?? 1}
        label={derived.phase ?? 'Effort'}
        phaseColor={recovery ? WOD_ACCENT : WOD_ACTION}
        styles={styles}
        colors={colors}
      />
      <Text style={styles.phaseMeta}>Tour {derived.round ?? 1} / {Math.max(1, numberOr(params.rounds, 1))}</Text>
      <CurrentExercise exercise={derived.currentExercise} nextExercise={derived.nextExercise} styles={styles} />
    </>;
  }

  if (mechanic === 'EVERY_X_MINUTES') {
    return <>
      <ProtocolRing value={derived.phaseRemaining ?? 0} total={derived.phaseDuration ?? 120} label={derived.label ?? 'Cycle'} styles={styles} colors={colors} />
      <Text style={styles.hint}>Réalise tout le travail ci-dessous puis récupère jusqu’au prochain départ.</Text>
      <WorkList exercises={exercises} styles={styles} />
    </>;
  }

  if (mechanic === 'PROGRESSIVE_INTERVAL') {
    const stage = derived.stage ?? 1;
    return <>
      <ProtocolRing value={derived.phaseRemaining ?? 0} total={derived.phaseDuration ?? 60} label={derived.label ?? `Étape ${stage}`} styles={styles} colors={colors} />
      <StageList exercises={exercises} stage={stage} direction="ascending" styles={styles} />
      <Text style={styles.hint}>{variant === 'DEATH_BY' || variant === 'DEATH_BY_COUPLET' ? 'Chaque intervalle augmente la dose. Arrête dès que la prescription ne tient plus dans le temps.' : 'La dose progresse à chaque intervalle.'}</Text>
      <Pressable onPress={onFailure} style={styles.failureButton}><Text style={styles.failureText}>Échec / arrêter ici</Text></Pressable>
    </>;
  }

  if (mechanic === 'CIRCUIT') {
    const rounds = Math.max(1, numberOr(params.rounds, 1));
    return <>
      <Metric value={`${Math.min(rounds, completedRounds + 1)} / ${rounds}`} label="Tour en cours" styles={styles} large />
      {restRemaining > 0 ? <ProtocolRing value={restRemaining} total={Math.max(1, numberOr(params.rest_between_rounds_seconds, restRemaining))} label="Récupération" phaseColor={WOD_ACCENT} styles={styles} colors={colors} /> : <WorkList exercises={exercises} styles={styles} />}
      <Action label="Tour terminé" icon="checkmark" onPress={onRound} disabled={restRemaining > 0} styles={styles} />
    </>;
  }

  if (mechanic === 'LADDER' || mechanic === 'COUPLET') {
    const rungs = Math.max(1, numberOr(params.rungs, 1));
    const descending = variant === 'DESCENDING_COUPLET' || params.sequence_direction === 'descending';
    return <>
      <Metric value={`${manualStep} / ${rungs}`} label="Étape" styles={styles} large />
      <StageList exercises={exercises} stage={manualStep} direction={descending ? 'descending' : 'ascending'} styles={styles} />
      <Action label={manualStep >= rungs ? 'Terminer le protocole' : 'Étape terminée'} icon="arrow-forward" onPress={() => onStep(rungs)} styles={styles} />
    </>;
  }

  if (mechanic === 'PYRAMID') {
    const multipliers = Array.isArray(params.multipliers) && params.multipliers.length ? params.multipliers.map((v) => numberOr(v, 1)) : [1, 2, 3, 2, 1];
    const cycles = Math.max(1, numberOr(params.cycles, 1));
    const totalSteps = multipliers.length * cycles;
    const index = (manualStep - 1) % multipliers.length;
    const multiplier = multipliers[index];
    return <>
      <Metric value={`×${multiplier}`} label={`Étape ${manualStep} / ${totalSteps}`} styles={styles} large />
      <View style={styles.sequenceStrip}>{multipliers.map((value, idx) => <View key={`${idx}-${value}`} style={[styles.sequenceItem, idx === index && styles.sequenceItemActive]}><Text style={[styles.sequenceText, idx === index && styles.sequenceTextActive]}>×{value}</Text></View>)}</View>
      <View style={styles.workList}>{exercises.map((exercise, idx) => <View key={exercise?._uiKey ?? exercise?.id ?? idx} style={styles.workRow}><Text style={styles.workName}>{exercise.name}</Text><Text style={styles.workPrescription}>{pyramidReps(exercise, multiplier)} reps</Text></View>)}</View>
      <Action label={manualStep >= totalSteps ? 'Terminer le protocole' : 'Étape terminée'} icon="arrow-forward" onPress={() => onStep(totalSteps)} styles={styles} />
    </>;
  }

  if (mechanic === 'CHIPPER' || mechanic === 'REP_TARGET') {
    const current = exercises[currentItemIndex] ?? exercises[0] ?? null;
    return <>
      <Metric value={`${Math.min(currentItemIndex + 1, exercises.length)} / ${exercises.length}`} label={mechanic === 'REP_TARGET' ? `Objectif ${numberOr(params.total_rep_target, 0)} reps` : 'Progression'} styles={styles} large />
      <CurrentExercise exercise={current} styles={styles} />
      <Action label={currentItemIndex >= exercises.length - 1 ? 'Terminer le WOD' : 'Exercice terminé'} icon="checkmark" onPress={onItem} styles={styles} />
    </>;
  }

  if (mechanic === 'DECK') {
    const deck = Array.isArray(params.deck_order) ? params.deck_order : [];
    const card = deck[currentItemIndex] ?? null;
    if (!card) return <View style={styles.warningBox}><Text style={styles.warningTitle}>Deck non matérialisé</Text><Text style={styles.muted}>Le backend doit fournir l’ordre des cartes avant le démarrage.</Text></View>;
    const suitIndex = Math.max(1, numberOr(card.suit_index, 1));
    const exercise = exercises[suitIndex - 1] ?? exercises[0] ?? null;
    const symbols = ['♠', '♥', '♦', '♣'];
    return <>
      <Text style={styles.phaseMeta}>Carte {currentItemIndex + 1} / {deck.length}</Text>
      <View style={styles.deckCard}>
        <Text style={styles.deckRank}>{symbols[suitIndex - 1] ?? '•'} {card.rank}</Text>
        <Text style={styles.deckName}>{exercise?.name ?? 'Exercice'}</Text>
        <Text style={styles.deckReps}>{numberOr(card.reps, 1)} reps</Text>
      </View>
      <Action label={currentItemIndex >= deck.length - 1 ? 'Terminer le deck' : 'Carte suivante'} icon="layers-outline" onPress={onDeckNext} styles={styles} />
    </>;
  }

  if (mechanic === 'SETS_REPS' || mechanic === 'STRENGTH') {
    const sets = Math.max(1, numberOr(params.sets, 1));
    const exerciseCount = Math.max(1, exercises.length);
    const exerciseIndex = (manualStep - 1) % exerciseCount;
    const setNumber = Math.floor((manualStep - 1) / exerciseCount) + 1;
    const current = exercises[exerciseIndex] ?? exercises[0] ?? null;
    return <>
      <Metric value={`${Math.min(setNumber, sets)} / ${sets}`} label="Série" styles={styles} large />
      {restRemaining > 0 ? <ProtocolRing value={restRemaining} total={Math.max(1, numberOr(params.rest_between_exercises_seconds, restRemaining))} label="Récupération" phaseColor={WOD_ACCENT} styles={styles} colors={colors} /> : <CurrentExercise exercise={current} nextExercise={exercises[(exerciseIndex + 1) % exerciseCount]} styles={styles} />}
      <Action label="Série terminée" icon="checkmark" onPress={onSet} disabled={restRemaining > 0} styles={styles} />
    </>;
  }

  return <WorkList exercises={exercises} styles={styles} />;
}

function ProtocolRing({ value, total, label, countUp = false, phaseColor = WOD_ACCENT, styles, colors }) {
  const safeTotal = Math.max(1, numberOr(total, 1));
  const safeValue = Math.max(0, numberOr(value, 0));
  const ratio = Math.max(0, Math.min(1, safeValue / safeTotal));
  const activeCount = Math.ceil(ratio * RING_SEGMENTS);
  const radius = 88;
  return (
    <View style={styles.ringWrap}>
      <View style={styles.ring}>
        {Array.from({ length: RING_SEGMENTS }).map((_, index) => {
          const angle = (index / RING_SEGMENTS) * Math.PI * 2 - Math.PI / 2;
          const active = index < activeCount;
          return <View key={index} style={[styles.ringTick, {
            left: 100 + Math.cos(angle) * radius - 2.5,
            top: 100 + Math.sin(angle) * radius - 6,
            backgroundColor: active ? phaseColor : colors.border,
            transform: [{ rotate: `${(index / RING_SEGMENTS) * 360}deg` }],
          }]} />;
        })}
        <View style={styles.ringCenter}>
          <Text style={styles.ringLabel}>{label}</Text>
          <Text style={styles.ringValue}>{formatClock(safeValue)}</Text>
          {countUp ? <Text style={styles.ringUnit}>écoulé</Text> : null}
        </View>
      </View>
    </View>
  );
}

function Metric({ value, label, styles, large = false }) {
  return <View style={[styles.metricCard, large && styles.metricCardLarge]}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, large && styles.metricValueLarge]}>{value}</Text></View>;
}

function CurrentExercise({ exercise, nextExercise, styles }) {
  if (!exercise) return null;
  return <View style={styles.currentCard}>
    <Text style={styles.currentLabel}>À faire maintenant</Text>
    <Text style={styles.currentName}>{exercise.name}</Text>
    <Text style={styles.currentPrescription}>{exercisePrescription(exercise)}</Text>
    {nextExercise ? <Text style={styles.nextText}>Ensuite · {nextExercise.name}</Text> : null}
  </View>;
}

function WorkList({ exercises, styles }) {
  return <View style={styles.workList}>{exercises.map((exercise, index) => <View key={exercise?._uiKey ?? exercise?.sessionExerciseId ?? exercise?.id ?? index} style={styles.workRow}><Text style={styles.workName}>{exercise?.name ?? 'Exercice'}</Text><Text style={styles.workPrescription}>{exercisePrescription(exercise)}</Text></View>)}</View>;
}

function StageList({ exercises, stage, direction, styles }) {
  return <View style={styles.workList}>{exercises.map((exercise, index) => <View key={exercise?._uiKey ?? exercise?.id ?? index} style={styles.workRow}><Text style={styles.workName}>{exercise?.name ?? 'Exercice'}</Text><Text style={styles.workPrescription}>{repsForStage(exercise, stage, direction)} reps</Text></View>)}</View>;
}

function Action({ label, icon, onPress, disabled = false, styles }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.primaryButton, disabled && styles.disabled]}><Ionicons name={icon} size={19} color="#FFFFFF" /><Text style={styles.primaryButtonText}>{label}</Text></Pressable>;
}

function createStyles(colors, isDark) {
  return StyleSheet.create({
    shell: {
      padding: 18,
      borderRadius: 22,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    startTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    startHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    changeFormatButton: { minHeight: 38, paddingHorizontal: 10, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    changeFormatText: { fontFamily: 'Manrope_700Bold', fontSize: 11, color: WOD_ACCENT },
    readyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: WOD_ACCENT },
    readyLabel: { fontFamily: 'Manrope_700Bold', fontSize: 11, color: WOD_ACCENT },
    startTitle: { marginTop: 8, fontFamily: 'Manrope_800ExtraBold', fontSize: 27, lineHeight: 33, color: colors.text },
    startSummary: { marginTop: 4, fontFamily: 'Manrope_500Medium', fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    previewList: { marginTop: 16, gap: 8 },
    previewRow: { minHeight: 58, padding: 12, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    previewIndex: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? 'rgba(94,102,51,0.24)' : 'rgba(94,102,51,0.12)' },
    previewIndexText: { fontFamily: 'Manrope_800ExtraBold', fontSize: 11, color: WOD_ACCENT },
    previewCopy: { flex: 1, minWidth: 0 },
    previewName: { fontFamily: 'Manrope_700Bold', fontSize: 14, color: colors.text },
    previewPrescription: { marginTop: 2, fontFamily: 'Manrope_700Bold', fontSize: 13, color: WOD_ACCENT },
    primaryButton: { minHeight: 52, marginTop: 15, paddingHorizontal: 16, borderRadius: 14, backgroundColor: WOD_ACCENT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    primaryButtonText: { fontFamily: 'Manrope_800ExtraBold', fontSize: 13, color: '#FFFFFF' },
    disabled: { opacity: 0.38 },
    errorText: { marginTop: 12, fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: WOD_ACTION },
    errorTitle: { fontFamily: 'Manrope_800ExtraBold', fontSize: 18, color: colors.text },
    muted: { marginTop: 5, fontFamily: 'Manrope_500Medium', fontSize: 12, lineHeight: 18, color: colors.textSecondary },
    runtimeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    runtimeEyebrow: { fontFamily: 'Manrope_800ExtraBold', fontSize: 9, letterSpacing: 0.7, color: WOD_ACCENT },
    runtimeTitle: { marginTop: 2, fontFamily: 'Manrope_800ExtraBold', fontSize: 22, color: colors.text },
    pauseButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    pauseNotice: { marginTop: 12, paddingVertical: 8, borderRadius: 999, alignItems: 'center', backgroundColor: colors.accentSoft },
    pauseNoticeText: { fontFamily: 'Manrope_700Bold', fontSize: 11, color: WOD_ACCENT },
    ringWrap: { marginTop: 16, alignItems: 'center' },
    ring: { width: 200, height: 200, position: 'relative', alignItems: 'center', justifyContent: 'center' },
    ringTick: { position: 'absolute', width: 5, height: 12, borderRadius: 3 },
    ringCenter: { width: 152, height: 152, borderRadius: 76, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    ringLabel: { fontFamily: 'Manrope_700Bold', fontSize: 10, color: colors.textSecondary },
    ringValue: { marginTop: 2, fontFamily: 'BebasNeue_400Regular', fontSize: 48, lineHeight: 54, color: colors.text },
    ringUnit: { marginTop: -3, fontFamily: 'Manrope_600SemiBold', fontSize: 9, color: colors.textMuted },
    metricPair: { flexDirection: 'row', gap: 8 },
    metricCard: { flex: 1, marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    metricCardLarge: { alignItems: 'center', paddingVertical: 15 },
    metricLabel: { fontFamily: 'Manrope_700Bold', fontSize: 9, color: colors.textMuted },
    metricValue: { marginTop: 2, fontFamily: 'BebasNeue_400Regular', fontSize: 28, color: colors.text },
    metricValueLarge: { fontSize: 43, lineHeight: 48 },
    phaseMeta: { marginTop: 11, textAlign: 'center', fontFamily: 'Manrope_700Bold', fontSize: 12, color: colors.textSecondary },
    currentCard: { marginTop: 14, padding: 16, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    currentLabel: { fontFamily: 'Manrope_700Bold', fontSize: 10, color: colors.textMuted },
    currentName: { marginTop: 4, fontFamily: 'Manrope_800ExtraBold', fontSize: 23, lineHeight: 29, color: colors.text },
    currentPrescription: { marginTop: 4, fontFamily: 'Manrope_800ExtraBold', fontSize: 16, color: WOD_ACCENT },
    nextText: { marginTop: 9, fontFamily: 'Manrope_600SemiBold', fontSize: 11, color: colors.textSecondary },
    workList: { marginTop: 13, gap: 7 },
    workRow: { minHeight: 48, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    workName: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 13, color: colors.text },
    workPrescription: { fontFamily: 'Manrope_800ExtraBold', fontSize: 13, color: WOD_ACCENT, textAlign: 'right' },
    hint: { marginTop: 12, fontFamily: 'Manrope_500Medium', fontSize: 12, lineHeight: 18, textAlign: 'center', color: colors.textSecondary },
    sequenceStrip: { marginTop: 12, flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
    sequenceItem: { minWidth: 37, height: 34, paddingHorizontal: 8, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
    sequenceItemActive: { borderColor: WOD_ACCENT, backgroundColor: isDark ? 'rgba(94,102,51,0.25)' : 'rgba(94,102,51,0.12)' },
    sequenceText: { fontFamily: 'Manrope_700Bold', fontSize: 10, color: colors.textMuted },
    sequenceTextActive: { color: WOD_ACCENT },
    stopButton: { marginTop: 14, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
    stopText: { fontFamily: 'Manrope_700Bold', fontSize: 11, color: WOD_ACTION },
    failureButton: { minHeight: 46, marginTop: 14, borderRadius: 13, borderWidth: 1, borderColor: WOD_ACTION, backgroundColor: isDark ? 'rgba(255,107,25,0.12)' : 'rgba(255,107,25,0.08)', alignItems: 'center', justifyContent: 'center' },
    failureText: { fontFamily: 'Manrope_800ExtraBold', fontSize: 11, color: WOD_ACTION },
    deckCard: { width: 176, minHeight: 215, alignSelf: 'center', marginTop: 12, padding: 17, borderRadius: 18, justifyContent: 'space-between', backgroundColor: isDark ? '#F7F8F3' : '#FFFFFF', borderWidth: 1, borderColor: isDark ? '#D9DED3' : colors.border },
    deckRank: { fontFamily: 'BebasNeue_400Regular', fontSize: 42, color: '#171A15' },
    deckName: { fontFamily: 'Manrope_800ExtraBold', fontSize: 14, lineHeight: 19, color: '#171A15', textAlign: 'center' },
    deckReps: { fontFamily: 'BebasNeue_400Regular', fontSize: 30, color: WOD_ACTION, textAlign: 'right' },
    warningBox: { marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: colors.background, borderWidth: 1, borderColor: WOD_ACTION },
    warningTitle: { fontFamily: 'Manrope_800ExtraBold', fontSize: 14, color: WOD_ACTION },
    finishedPanel: { alignItems: 'center', paddingVertical: 14 },
    finishedIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: WOD_ACCENT },
    finishedTitle: { marginTop: 10, fontFamily: 'Manrope_800ExtraBold', fontSize: 24, color: colors.text },
    finishedMeta: { marginTop: 3, fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: colors.textSecondary },
    finishedNote: { marginTop: 9, maxWidth: 330, fontFamily: 'Manrope_500Medium', fontSize: 12, lineHeight: 18, color: colors.textSecondary, textAlign: 'center' },
  });
}
