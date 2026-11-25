import fs from 'node:fs';

function mustReplace(text, label, search, replacement) {
  const next = text.replace(search, replacement);
  if (next === text) throw new Error(`PLAY-010 patch failed: ${label}`);
  return next;
}

function patchOverview() {
  const path = 'src/components/workout/SessionOverviewSheet.js';
  let text = fs.readFileSync(path, 'utf8');

  const oldRow = `                              <View style={styles.exerciseCopy}>
                                <View style={styles.exerciseTitleRow}>
                                  <Text style={[styles.exerciseName, current && styles.exerciseNameCurrent]}>
                                    {exercise.name ?? 'Exercice'}
                                  </Text>
                                  <Pressable
                                    onPress={() =>
                                      setDetailExercise({
                                        exercise,
                                        blockTitle: block.title,
                                        canSwap,
                                      })
                                    }
                                    hitSlop={6}
                                    accessibilityRole="button"
                                    accessibilityLabel={\`Détails de \${exercise.name ?? 'l’exercice'}\`}
                                    style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
                                  >
                                    <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
                                  </Pressable>
                                </View>
                                {exercise.prescription ? (
                                  <PrescriptionLine text={exercise.prescription} styles={styles} />
                                ) : null}
                              </View>`;

  const newRow = `                              <View style={styles.exerciseCopy}>
                                <Text style={[styles.exerciseName, current && styles.exerciseNameCurrent]}>
                                  {exercise.name ?? 'Exercice'}
                                </Text>
                                {exercise.prescription ? (
                                  <PrescriptionLine text={exercise.prescription} styles={styles} />
                                ) : null}
                              </View>

                              <Pressable
                                onPress={() =>
                                  setDetailExercise({
                                    exercise,
                                    blockTitle: block.title,
                                    canSwap,
                                  })
                                }
                                accessibilityRole="button"
                                accessibilityLabel={\`Détails de \${exercise.name ?? 'l’exercice'}\`}
                                style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
                              >
                                <Ionicons name="ellipsis-horizontal" size={21} color={colors.textSecondary} />
                              </Pressable>`;

  text = mustReplace(text, 'move ellipsis to fixed right column', oldRow, newRow);

  text = mustReplace(
    text,
    'Plan B callback owns transition',
    `                onPress={() => {
                  onClose?.();
                  onPlanB?.();
                }}`,
    '                onPress={onPlanB}'
  );

  text = mustReplace(
    text,
    'ellipsis styles',
    `    exerciseCopy: { flex: 1 },
    exerciseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    exerciseName: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 13, color: colors.text },`,
    `    exerciseCopy: { flex: 1, minWidth: 0 },
    exerciseName: { fontFamily: 'Manrope_700Bold', fontSize: 13, color: colors.text },`
  );

  text = mustReplace(
    text,
    'ellipsis button visual weight',
    `    moreButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },`,
    `    moreButton: { width: 44, height: 44, marginRight: -4, flexShrink: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },`
  );

  if (text.includes('exerciseTitleRow')) throw new Error('PLAY-010 verification failed: exerciseTitleRow still present');
  fs.writeFileSync(path, text);
}

function patchSession() {
  const path = 'app/workout/session.js';
  let text = fs.readFileSync(path, 'utf8');

  text = mustReplace(
    text,
    'Plan B transition ref',
    `  const [overviewOpen, setOverviewOpen] = useState(false);
  const overviewShownForSessionRef = useRef(null);`,
    `  const [overviewOpen, setOverviewOpen] = useState(false);
  const overviewShownForSessionRef = useRef(null);
  const planBTransitionTimerRef = useRef(null);`
  );

  text = mustReplace(
    text,
    'Plan B transition effect and handler',
    `  useEffect(() => {
    if (!workout?.sessionId || overviewShownForSessionRef.current === workout.sessionId) return;
    overviewShownForSessionRef.current = workout.sessionId;
    if (!progressRecorded) setOverviewOpen(true);
  }, [progressRecorded, workout?.sessionId]);

  async function applySkillPlanB(action) {`,
    `  useEffect(() => {
    if (!workout?.sessionId || overviewShownForSessionRef.current === workout.sessionId) return;
    overviewShownForSessionRef.current = workout.sessionId;
    if (!progressRecorded) setOverviewOpen(true);
  }, [progressRecorded, workout?.sessionId]);

  useEffect(
    () => () => {
      if (planBTransitionTimerRef.current) clearTimeout(planBTransitionTimerRef.current);
    },
    []
  );

  function openPlanBFromOverview() {
    if (busyAction) return;
    if (planBTransitionTimerRef.current) clearTimeout(planBTransitionTimerRef.current);
    setOverviewOpen(false);
    planBTransitionTimerRef.current = setTimeout(() => {
      setPlanBOpen(true);
      planBTransitionTimerRef.current = null;
    }, 420);
  }

  async function applySkillPlanB(action) {`
  );

  text = mustReplace(
    text,
    'use sequenced Plan B callback',
    `        onPlanB={() => setPlanBOpen(true)}`,
    `        onPlanB={openPlanBFromOverview}`
  );

  fs.writeFileSync(path, text);
}

patchOverview();
patchSession();
console.log('PLAY-010 ellipsis placement + Plan B modal sequencing applied.');
