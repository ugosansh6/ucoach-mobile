import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return source.replace(from, to);
}

// PLAY-013: remove the duplicated outer format card and put the format action
// directly in the unified player shell.
{
  const path = 'app/workout/session-focused-core.js';
  let s = read(path);
  const before = `              <View style={styles.wodWrap}>
                <View style={styles.formatRowStandalone}>
                  <View style={styles.formatCopy}>
                    <Text style={styles.formatLabel}>Format du WOD</Text>
                    <Text style={styles.formatValue}>{String(workout?.format ?? activeBlock?.source?.mechanicLabel ?? 'UGEROD')}</Text>
                  </View>
                  {remainingFormatChanges > 0 && !workout?.wodStarted && !workout?.wodStartedAt && !workout?.wodRuntime?.started ? (
                    <Pressable onPress={openFormatModal} style={styles.smallActionButton}>
                      <Ionicons name="options-outline" size={16} color={colors.accent} />
                      <Text style={styles.smallActionText}>Changer</Text>
                    </Pressable>
                  ) : null}
                </View>

                <WodProtocolPlayer
                  key={\`${'${'}workout?.sessionId ?? 'dev'}-${'${'}workout?.format ?? activeBlock?.mechanic ?? 'wod'}\`}
                  block={activeBlock}
                  initialRuntime={workout?.wodRuntime ?? null}
                  onBeforeStart={handleWodStart}
                  onRuntimeChange={handleWodRuntime}
                />`;
  const after = `              <View style={styles.wodWrap}>
                <WodProtocolPlayer
                  key={\`${'${'}workout?.sessionId ?? 'dev'}-${'${'}workout?.format ?? activeBlock?.mechanic ?? 'wod'}\`}
                  block={activeBlock}
                  initialRuntime={workout?.wodRuntime ?? null}
                  canChangeFormat={remainingFormatChanges > 0 && !workout?.wodStarted && !workout?.wodStartedAt && !workout?.wodRuntime?.started}
                  onChangeFormat={openFormatModal}
                  onBeforeStart={handleWodStart}
                  onRuntimeChange={handleWodRuntime}
                />`;
  s = replaceOnce(s, before, after, 'integrated format change action');
  write(path, s);
}

// PLAY-012/013: preserve audio transitions, execution-event schema and exact
// stage transitions in the new player.
{
  const path = 'src/components/workout/WodProtocolPlayerV3.js';
  let s = read(path);

  s = replaceOnce(
    s,
    `function useSecondClock({ started, paused, finished, maxSeconds, initialElapsed, onAutoFinish }) {
  const [elapsed, setElapsed] = useState(Math.max(0, numberOr(initialElapsed, 0)));`,
    `function appendRuntimeEvent(current, eventType, elapsedSeconds, payload = {}) {
  const safeElapsed = Math.max(0, Math.floor(numberOr(elapsedSeconds, 0)));
  const ordinal = Array.isArray(current) ? current.length : 0;
  return [
    ...(Array.isArray(current) ? current : []),
    {
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      idempotency_key: \`play013:\${eventType}:\${ordinal}:\${safeElapsed}\`,
      payload: { elapsed_seconds: safeElapsed, ...payload },
    },
  ];
}

function useSecondClock({ started, paused, finished, maxSeconds, initialElapsed, onAutoFinish }) {
  const [elapsed, setElapsed] = useState(Math.max(0, numberOr(initialElapsed, 0)));`,
    'runtime event helper'
  );

  s = replaceOnce(
    s,
    `  onBeforeStart,
  onRuntimeChange,
}) {`,
    `  onBeforeStart,
  onRuntimeChange,
  canChangeFormat = false,
  onChangeFormat = null,
}) {`,
    'player format props'
  );

  s = replaceOnce(
    s,
    `    setEvents((current) => [...current, {
      event_type: 'WOD_FINISHED',
      elapsed_seconds: elapsedOverride,
      reason,
    }]);`,
    `    setEvents((current) => appendRuntimeEvent(
      current,
      'WOD_FINISHED',
      elapsedOverride,
      { reason }
    ));`,
    'finish event'
  );

  s = s.replace(
    `      setEvents((current) => [...current, { event_type: 'WOD_STARTED', elapsed_seconds: 0 }]);`,
    `      setEvents((current) => appendRuntimeEvent(current, 'WOD_STARTED', 0));`
  );
  s = s.replace(
    `    setEvents((current) => [...current, {
      event_type: next ? 'WOD_PAUSED' : 'WOD_RESUMED',
      elapsed_seconds: elapsed,
    }]);`,
    `    setEvents((current) => appendRuntimeEvent(
      current,
      next ? 'WOD_PAUSED' : 'WOD_RESUMED',
      elapsed
    ));`
  );
  s = s.replace(
    `    setEvents((current) => [...current, { event_type: 'ROUND_COMPLETED', round_index: next, elapsed_seconds: elapsed }]);`,
    `    setEvents((current) => appendRuntimeEvent(current, 'ROUND_COMPLETED', elapsed, { round_index: next }));`
  );

  s = replaceOnce(
    s,
    `  function completeStep(maxSteps) {
    if (manualStep >= maxSteps) {
      finish('steps_complete', elapsed);
      return;
    }
    setEvents((current) => [...current, { event_type: 'STEP_COMPLETED', step: manualStep, elapsed_seconds: elapsed }]);
    setManualStep((value) => value + 1);
  }`,
    `  function completeStep(maxSteps) {
    setEvents((current) => appendRuntimeEvent(current, 'STEP_COMPLETED', elapsed, { step: manualStep }));
    if (manualStep >= maxSteps) {
      finish('steps_complete', elapsed);
      return;
    }
    setManualStep((value) => value + 1);
  }`,
    'step events include final step'
  );

  s = replaceOnce(
    s,
    `  function completeItem() {
    if (currentItemIndex >= exercises.length - 1) {
      finish('sequence_complete', elapsed);
      return;
    }
    setEvents((current) => [...current, { event_type: 'ITEM_COMPLETED', item_index: currentItemIndex, elapsed_seconds: elapsed }]);
    setCurrentItemIndex((value) => value + 1);
  }`,
    `  function completeItem() {
    setEvents((current) => appendRuntimeEvent(current, 'ITEM_COMPLETED', elapsed, { item_index: currentItemIndex }));
    if (currentItemIndex >= exercises.length - 1) {
      finish('sequence_complete', elapsed);
      return;
    }
    setCurrentItemIndex((value) => value + 1);
  }`,
    'item events include final item'
  );

  s = replaceOnce(
    s,
    `  function completeSet() {
    if (restRemaining > 0) return;
    const sets = Math.max(1, numberOr(params.sets, 1));
    const total = sets * Math.max(1, exercises.length);
    if (manualStep >= total) {
      finish('sets_complete', elapsed);
      return;
    }
    setEvents((current) => [...current, { event_type: 'SET_COMPLETED', set_station: manualStep, elapsed_seconds: elapsed }]);
    setManualStep((value) => value + 1);
    setRestRemaining(Math.max(0, numberOr(params.rest_between_exercises_seconds, 0)));
  }`,
    `  function completeSet() {
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
  }`,
    'set events include final set'
  );

  s = s.replace(
    `        currentExercise: exercises[exerciseIndex] ?? null,`,
    `        phaseKey: \`emom-\${minuteIndex}\`,
        currentExercise: exercises[exerciseIndex] ?? null,`
  );
  s = s.replace(
    `        currentExercise: exercises[exerciseIndex] ?? null,
        nextExercise: exercises[(exerciseIndex + 1) % Math.max(1, exercises.length)] ?? null,
        phaseRemaining: inWork ?`,
    `        phaseKey: \`hiit-\${stationIndex}-\${inWork ? 'work' : 'rest'}\`,
        currentExercise: exercises[exerciseIndex] ?? null,
        nextExercise: exercises[(exerciseIndex + 1) % Math.max(1, exercises.length)] ?? null,
        phaseRemaining: inWork ?`
  );
  s = s.replace(
    `      return {
        currentExercise: exercises[index] ?? exercises[0] ?? null,
        phaseRemaining: Math.max(0, stationSeconds - (elapsed % stationSeconds)),`,
    `      return {
        phaseKey: \`odd-even-\${minuteIndex}\`,
        currentExercise: exercises[index] ?? exercises[0] ?? null,
        phaseRemaining: Math.max(0, stationSeconds - (elapsed % stationSeconds)),`
  );
  s = s.replace(
    `      return {
        phaseRemaining: Math.max(0, interval - (elapsed % interval)),
        phaseDuration: interval,
        label: \`Cycle \${cycleIndex + 1} / \${Math.max(1, numberOr(params.cycles, 1))}\`,`,
    `      return {
        phaseKey: \`every-\${cycleIndex}\`,
        phaseRemaining: Math.max(0, interval - (elapsed % interval)),
        phaseDuration: interval,
        label: \`Cycle \${cycleIndex + 1} / \${Math.max(1, numberOr(params.cycles, 1))}\`,`
  );
  s = s.replace(
    `      const stage = Math.floor(Math.max(0, elapsed - 1) / interval) + 1;
      return {
        stage,`,
    `      const stage = Math.floor(elapsed / interval) + 1;
      return {
        phaseKey: \`progressive-\${stage}\`,
        stage,`
  );

  s = replaceOnce(
    s,
    `  }, [elapsed, exercises, mechanic, params]);

  const runtime = useMemo(() => ({`,
    `  }, [elapsed, exercises, mechanic, params]);

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

  const runtime = useMemo(() => ({`,
    'phase cues'
  );

  s = replaceOnce(
    s,
    `          loading={starting}
          error={startError}
          onStart={start}
          styles={styles}
          colors={colors}`,
    `          loading={starting}
          error={startError}
          onStart={start}
          canChangeFormat={canChangeFormat}
          onChangeFormat={onChangeFormat}
          styles={styles}
          colors={colors}`,
    'start panel format props'
  );

  s = replaceOnce(
    s,
    `function StartPanel({ title, summary, exercises, loading, error, onStart, styles, colors }) {
  return (
    <>
      <View style={styles.startHeader}>
        <View style={styles.readyDot} />
        <Text style={styles.readyLabel}>Prêt à démarrer</Text>
      </View>`,
    `function StartPanel({ title, summary, exercises, loading, error, onStart, canChangeFormat, onChangeFormat, styles, colors }) {
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
      </View>`,
    'start integrated format button'
  );

  s = replaceOnce(
    s,
    `            onDeckNext={() => {
              const deck = Array.isArray(params.deck_order) ? params.deck_order : [];
              if (currentItemIndex >= deck.length - 1) finish('deck_complete', elapsed);
              else setCurrentItemIndex((value) => value + 1);
            }}`,
    `            onDeckNext={() => {
              const deck = Array.isArray(params.deck_order) ? params.deck_order : [];
              setEvents((current) => appendRuntimeEvent(current, 'CARD_COMPLETED', elapsed, { card_index: currentItemIndex }));
              if (currentItemIndex >= deck.length - 1) finish('deck_complete', elapsed);
              else setCurrentItemIndex((value) => value + 1);
            }}`,
    'deck execution event'
  );

  s = replaceOnce(
    s,
    `    startHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    readyDot:`,
    `    startTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    startHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    changeFormatButton: { minHeight: 38, paddingHorizontal: 10, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    changeFormatText: { fontFamily: 'Manrope_700Bold', fontSize: 11, color: WOD_ACCENT },
    readyDot:`,
    'format button styles'
  );

  write(path, s);
}

// PLAY-012: protocol timing is trustworthy at protocol level, but passage of
// time alone must not create per-exercise capability measurements.
{
  const path = 'src/services/wodProtocolOutcome.js';
  let s = read(path);

  s = s.replace(/\n    for \(let interval = 0; interval < intervals; interval \+= 1\) \{[\s\S]*?\n    \}\n  \} else if \(\n    mechanic === 'EVERY_X_MINUTES'/, `\n  } else if (\n    mechanic === 'EVERY_X_MINUTES'`);
  s = s.replace(/\n    for \(let cycle = 0; cycle < cycles; cycle \+= 1\) \{[\s\S]*?\n    \}\n  \} else if \(mechanic === 'HIIT'\)/, `\n  } else if (mechanic === 'HIIT')`);
  s = s.replace(/\n    for \(let station = 0; station < stations; station \+= 1\) \{[\s\S]*?\n    \}\n  \} else if \(\n    mechanic === 'LADDER'/, `\n  } else if (\n    mechanic === 'LADDER'`);

  s = replaceOnce(
    s,
    `    outcome.items_completed = itemsCompleted;
    outcome.planned_items = wodExercises.length;
    outcome.protocol_completed = completed;
    outcome.completion_ratio =
      wodExercises.length > 0
        ? clamp01(
            itemsCompleted / wodExercises.length
          )
        : 0;

    for (`,
    `    outcome.items_completed = itemsCompleted;
    outcome.planned_items = wodExercises.length;
    outcome.protocol_completed = completed;
    outcome.completion_ratio =
      wodExercises.length > 0
        ? clamp01(
            itemsCompleted / wodExercises.length
          )
        : 0;

    let completedRepTarget = 0;
    let repTargetExact = true;

    for (`,
    'rep target accumulators'
  );

  s = replaceOnce(
    s,
    `      const distance = executionTargetValue(
        prescription,
        'execution_target_distance_meters',
        'distance_meters_min',
        'distance_meters_max'
      );

      if (
        reps != null ||`,
    `      const distance = executionTargetValue(
        prescription,
        'execution_target_distance_meters',
        'distance_meters_min',
        'distance_meters_max'
      );

      if (mechanic === 'REP_TARGET') {
        if (reps == null) repTargetExact = false;
        else completedRepTarget += reps;
      }

      if (
        reps != null ||`,
    'rep target completed reps'
  );

  s = replaceOnce(
    s,
    `      }
    }
  } else if (mechanic === 'DECK') {`,
    `      }
    }

    if (mechanic === 'REP_TARGET') {
      const targetReps = numberOrNull(parameters.total_rep_target);
      if (targetReps != null && targetReps > 0 && repTargetExact) {
        outcome.reps_completed = completedRepTarget;
        outcome.target_reps = targetReps;
        outcome.completion_ratio = clamp01(completedRepTarget / targetReps);
      }
    }
  } else if (mechanic === 'DECK') {`,
    'rep target outcome'
  );

  if (s.includes('controlled_interval') || s.includes('every_x_cycle') || s.includes('controlled_work_interval')) {
    throw new Error('Unsafe time-only per-exercise capability inference still present');
  }
  write(path, s);
}
