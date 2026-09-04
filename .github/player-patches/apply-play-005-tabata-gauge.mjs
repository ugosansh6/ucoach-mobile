import fs from 'node:fs';

function mustReplace(text, label, search, replacement) {
  const next = text.replace(search, replacement);
  if (next === text) {
    throw new Error(`PLAY-005 patch failed: ${label}`);
  }
  return next;
}

const path = 'app/workout/session-focused-core.js';
let text = fs.readFileSync(path, 'utf8');

if (!text.includes("const TABATA_WORK_COLOR = '#FF6B19';")) {
  text = mustReplace(
    text,
    'insert Tabata palette',
    "const BLOCK_LABELS = {\n  unlock: 'Unlock',\n  tabata: 'Tabata',\n  warmup: 'Warm-up',\n  skill: 'Skill',\n  wod: 'WOD',\n};",
    "const BLOCK_LABELS = {\n  unlock: 'Unlock',\n  tabata: 'Tabata',\n  warmup: 'Warm-up',\n  skill: 'Skill',\n  wod: 'WOD',\n};\n\n// PLAY-005: le Tabata garde la même identité kaki/orange en clair comme en sombre.\nconst TABATA_WORK_COLOR = '#FF6B19';\nconst TABATA_REST_COLOR = '#5E6633';"
  );
}

const focusedTabata = `function FocusedTabata({ block, onFinish, styles, colors }) {
  const protocol = prescriptionObject(block?.exercises?.[0])?.protocol ?? {};
  const rounds = Math.max(1, Number(block?.source?.rounds ?? protocol?.rounds ?? 8) || 8);
  const workSeconds = Math.max(1, Number(block?.source?.workSeconds ?? block?.source?.work_seconds ?? protocol?.work_seconds ?? 20) || 20);
  const restSeconds = Math.max(1, Number(block?.source?.restSeconds ?? block?.source?.rest_seconds ?? protocol?.rest_seconds ?? 10) || 10);
  const cycleSeconds = workSeconds + restSeconds;
  const totalSeconds = rounds * cycleSeconds;
  const exerciseCount = Math.max(1, block?.exercises?.length ?? 0);

  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [displayExerciseIndex, setDisplayExerciseIndex] = useState(0);

  useEffect(() => {
    if (!started || paused || elapsed >= totalSeconds) return undefined;
    const timer = setInterval(() => setElapsed((current) => Math.min(totalSeconds, current + 1)), 1000);
    return () => clearInterval(timer);
  }, [elapsed, paused, started, totalSeconds]);

  const roundIndex = Math.min(rounds - 1, Math.floor(elapsed / cycleSeconds));
  const within = elapsed % cycleSeconds;
  const finished = elapsed >= totalSeconds;
  const resting = started && !finished && within >= workSeconds;
  const hasNextRound = roundIndex < rounds - 1;
  const remaining = finished ? 0 : resting ? cycleSeconds - within : workSeconds - within;
  const segmentDuration = resting ? restSeconds : workSeconds;
  const segmentProgressPercent = finished
    ? 0
    : segmentDuration > 0
      ? Math.max(0, Math.min(100, (remaining / segmentDuration) * 100))
      : 0;
  const progressPercent = totalSeconds > 0
    ? Math.max(0, Math.min(100, (elapsed / totalSeconds) * 100))
    : 0;
  const phaseColor = resting ? TABATA_REST_COLOR : TABATA_WORK_COLOR;
  const phaseLabel = finished ? 'Terminé' : started ? (resting ? 'Récupération' : 'Effort') : 'Prêt';
  const scheduledExerciseIndex = resting && hasNextRound
    ? (roundIndex + 1) % exerciseCount
    : roundIndex % exerciseCount;
  const activeExercise = block.exercises[displayExerciseIndex] ?? block.exercises[scheduledExerciseIndex] ?? block.exercises[0];

  useEffect(() => {
    setDisplayExerciseIndex(scheduledExerciseIndex);
  }, [scheduledExerciseIndex]);

  function moveDisplayedExercise(direction) {
    if (exerciseCount <= 1) return;
    setDisplayExerciseIndex((current) => (current + direction + exerciseCount) % exerciseCount);
  }

  return (
    <View style={styles.timerCard}>
      <View style={styles.tabataPhaseBadge}>
        <View style={[styles.tabataPhaseDot, { backgroundColor: phaseColor }]} />
        <Text style={[styles.timerEyebrow, { color: phaseColor }]}>{phaseLabel}</Text>
      </View>

      <Text style={styles.timerValue}>{remaining}</Text>
      <Text style={styles.timerUnit}>secondes</Text>

      <View style={styles.tabataCountdownWrap}>
        <View style={styles.tabataCountdownHeader}>
          <Text style={styles.tabataCountdownLabel}>
            {resting ? 'Décompte récupération' : 'Décompte effort'}
          </Text>
          <Text style={[styles.tabataCountdownValue, { color: phaseColor }]}>
            {remaining}s / {segmentDuration}s
          </Text>
        </View>
        <View style={styles.tabataCountdownTrack}>
          <View
            style={[
              styles.tabataCountdownFill,
              {
                width: \`\${segmentProgressPercent}%\`,
                backgroundColor: phaseColor,
              },
            ]}
          />
        </View>
      </View>

      <View style={styles.tabataGlobalHeader}>
        <Text style={styles.timerRound}>Tour {Math.min(rounds, roundIndex + 1)} / {rounds}</Text>
        <Text style={styles.tabataGlobalLabel}>Progression du Tabata</Text>
      </View>
      <View style={styles.tabataGlobalTrack}>
        <View
          style={[
            styles.tabataGlobalFill,
            { width: \`\${progressPercent}%\`, backgroundColor: TABATA_REST_COLOR },
          ]}
        />
      </View>

      <View style={styles.timerExerciseCard}>
        <Text style={styles.timerExerciseLabel}>
          {!started ? 'Premier exercice' : resting && displayExerciseIndex === scheduledExerciseIndex && hasNextRound ? 'À venir' : 'Exercice actuel'}
        </Text>
        <Text style={styles.timerExerciseName}>{displayExerciseName(activeExercise)}</Text>
        {activeExercise?.prescription ? (
          <Text style={[styles.timerExercisePrescription, { color: TABATA_REST_COLOR }]}>{String(activeExercise.prescription)}</Text>
        ) : null}

        {exerciseCount > 1 ? (
          <View style={styles.exerciseNav}>
            <Pressable onPress={() => moveDisplayedExercise(-1)} style={styles.navButton}>
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </Pressable>
            <View style={styles.navDots}>
              {block.exercises.map((exercise, index) => (
                <View
                  key={exercise?._uiKey ?? exercise?.sessionExerciseId ?? \`\${index}\`}
                  style={[
                    styles.navDot,
                    index === displayExerciseIndex && styles.navDotActive,
                    index === displayExerciseIndex && { backgroundColor: TABATA_REST_COLOR },
                  ]}
                />
              ))}
            </View>
            <Pressable onPress={() => moveDisplayedExercise(1)} style={styles.navButton}>
              <Ionicons name="chevron-forward" size={20} color={colors.text} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {!started ? (
        <Pressable onPress={() => setStarted(true)} style={[styles.primaryButtonLarge, { backgroundColor: TABATA_REST_COLOR }]}>
          <Ionicons name="play" size={19} color={colors.textOnAccent} />
          <Text style={styles.primaryButtonTextLarge}>Démarrer le Tabata</Text>
        </Pressable>
      ) : elapsed < totalSeconds ? (
        <Pressable onPress={() => setPaused((value) => !value)} style={styles.secondaryWideButton}>
          <Ionicons name={paused ? 'play' : 'pause'} size={19} color={colors.text} />
          <Text style={styles.secondaryWideText}>{paused ? 'Reprendre' : 'Pause'}</Text>
        </Pressable>
      ) : (
        <Pressable onPress={onFinish} style={[styles.primaryButtonLarge, { backgroundColor: TABATA_REST_COLOR }]}>
          <Ionicons name="checkmark" size={19} color={colors.textOnAccent} />
          <Text style={styles.primaryButtonTextLarge}>Terminer le Tabata</Text>
        </Pressable>
      )}

      {started && elapsed < totalSeconds ? (
        <Pressable onPress={onFinish} style={styles.stopButton}>
          <Text style={[styles.stopButtonText, { color: TABATA_WORK_COLOR }]}>Arrêter le bloc</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
`;

text = mustReplace(
  text,
  'replace focused Tabata renderer',
  /function FocusedTabata\(\{ block, onFinish, styles, colors \}\) \{[\s\S]*?\n\}\n\n(?=function SwapModal)/,
  `${focusedTabata}\n`
);

if (!text.includes('tabataCountdownTrack:')) {
  text = mustReplace(
    text,
    'insert Tabata gauge styles',
    "    timerRound: {\n      marginTop: 8,\n      fontFamily: 'Manrope_700Bold',\n      fontSize: 13,\n      color: colors.textSecondary,\n    },",
    "    tabataPhaseBadge: {\n      minHeight: 28,\n      paddingHorizontal: 11,\n      borderRadius: 999,\n      flexDirection: 'row',\n      alignItems: 'center',\n      justifyContent: 'center',\n      gap: 7,\n      backgroundColor: colors.background,\n      borderWidth: 1,\n      borderColor: colors.border,\n    },\n    tabataPhaseDot: { width: 8, height: 8, borderRadius: 4 },\n    tabataCountdownWrap: { width: '100%', marginTop: 20 },\n    tabataCountdownHeader: {\n      flexDirection: 'row',\n      alignItems: 'center',\n      justifyContent: 'space-between',\n      marginBottom: 8,\n    },\n    tabataCountdownLabel: {\n      fontFamily: 'Manrope_700Bold',\n      fontSize: 11,\n      color: colors.textSecondary,\n    },\n    tabataCountdownValue: {\n      fontFamily: 'Manrope_800ExtraBold',\n      fontSize: 12,\n    },\n    tabataCountdownTrack: {\n      width: '100%',\n      height: 14,\n      borderRadius: 999,\n      overflow: 'hidden',\n      backgroundColor: colors.surfacePressed,\n      borderWidth: 1,\n      borderColor: colors.border,\n    },\n    tabataCountdownFill: { height: '100%', borderRadius: 999 },\n    tabataGlobalHeader: {\n      width: '100%',\n      marginTop: 14,\n      flexDirection: 'row',\n      alignItems: 'center',\n      justifyContent: 'space-between',\n    },\n    timerRound: {\n      fontFamily: 'Manrope_700Bold',\n      fontSize: 13,\n      color: colors.textSecondary,\n    },\n    tabataGlobalLabel: {\n      fontFamily: 'Manrope_600SemiBold',\n      fontSize: 10,\n      color: colors.textMuted,\n    },\n    tabataGlobalTrack: {\n      width: '100%',\n      height: 4,\n      marginTop: 7,\n      borderRadius: 999,\n      overflow: 'hidden',\n      backgroundColor: colors.border,\n    },\n    tabataGlobalFill: { height: 4, borderRadius: 999 },"
  );
}

if (!text.includes("const TABATA_REST_COLOR = '#5E6633';")) {
  throw new Error('PLAY-005 patch verification failed: missing kaki token');
}
if (!text.includes('tabataCountdownTrack')) {
  throw new Error('PLAY-005 patch verification failed: missing countdown gauge');
}
if (!text.includes('segmentProgressPercent')) {
  throw new Error('PLAY-005 patch verification failed: missing segment countdown');
}

fs.writeFileSync(path, text);
console.log('PLAY-005 Tabata countdown gauge patch applied.');
