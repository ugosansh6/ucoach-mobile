const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const servicePath = path.join(root, 'src', 'services', 'workoutService.js');
const sessionPath = path.join(root, 'app', 'workout', 'session.js');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, content) {
  fs.writeFileSync(file, content, 'utf8');
}

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`Bloc attendu introuvable : ${label}`);
  }
  return content.replace(search, replacement);
}

let service = read(servicePath);

if (!service.includes('export async function getWorkoutSwapAvailability(')) {
  const anchor = 'export async function swapWorkoutExercise({';
  const addition = `export async function getWorkoutSwapAvailability(sessionId) {\n  if (!sessionId) {\n    return {\n      sessionId: null,\n      items: {},\n      version: null,\n    };\n  }\n\n  const { data, error } = await supabase.rpc(\n    'get_workout_swap_availability',\n    {\n      p_session_id: sessionId,\n    }\n  );\n\n  if (error) {\n    throw new Error(\n      error?.message ??\n        'Impossible de vérifier les remplacements disponibles.'\n    );\n  }\n\n  return {\n    sessionId:\n      data?.session_id ?? sessionId,\n    items:\n      data?.items ?? {},\n    version:\n      data?.version ?? null,\n  };\n}\n\n`;
  service = replaceOnce(service, anchor, addition + anchor, 'workoutService / swap anchor');
}

write(servicePath, service);

let session = read(sessionPath);

if (!session.includes('getWorkoutSwapAvailability,')) {
  if (session.includes('getWorkoutFormatOptions,\n   markWorkoutSessionStarted,')) {
    session = session.replace(
      'getWorkoutFormatOptions,\n   markWorkoutSessionStarted,',
      'getWorkoutFormatOptions,\n  getWorkoutSwapAvailability,\n  markWorkoutSessionStarted,'
    );
  } else {
    session = replaceOnce(
      session,
      'getWorkoutFormatOptions,\n  markWorkoutSessionStarted,',
      'getWorkoutFormatOptions,\n  getWorkoutSwapAvailability,\n  markWorkoutSessionStarted,',
      'session / service import'
    );
  }
}

if (!session.includes('const [\n    swapAvailability,')) {
  session = replaceOnce(
    session,
    "  const [swapError, setSwapError] =\n    useState('');\n",
    "  const [swapError, setSwapError] =\n    useState('');\n\n  const [\n    swapAvailability,\n    setSwapAvailability,\n  ] = useState({});\n\n  const [\n    swapAvailabilityLoading,\n    setSwapAvailabilityLoading,\n  ] = useState(false);\n",
    'session / swap state'
  );
}

if (!session.includes('const swapAvailabilityFingerprint =')) {
  session = replaceOnce(
    session,
    '  function moveActiveExercise(\n',
    `  const swapAvailabilityFingerprint =\n    useMemo(\n      () =>\n        sourceExercises\n          .filter(\n            (exercise) =>\n              exercise.sessionExerciseId\n          )\n          .map(\n            (exercise) =>\n              \`${'${exercise.sessionExerciseId}:${exercise.id}'}\`\n          )\n          .join('|'),\n      [sourceExercises]\n    );\n\n  const refreshSwapAvailability =\n    useCallback(async () => {\n      if (!workout.sessionId) {\n        setSwapAvailability({});\n        return;\n      }\n\n      setSwapAvailabilityLoading(true);\n\n      try {\n        const result =\n          await getWorkoutSwapAvailability(\n            workout.sessionId\n          );\n\n        setSwapAvailability(\n          result?.items ?? {}\n        );\n      } catch (error) {\n        console.warn(\n          'Swap availability',\n          error\n        );\n        setSwapAvailability({});\n      } finally {\n        setSwapAvailabilityLoading(false);\n      }\n    }, [workout.sessionId]);\n\n  useEffect(() => {\n    refreshSwapAvailability();\n  }, [\n    refreshSwapAvailability,\n    swapAvailabilityFingerprint,\n  ]);\n\n  function moveActiveExercise(\n`,
    'session / swap availability loader'
  );
}

if (!session.includes("swapAvailability?.[\n        exercise.sessionExerciseId")) {
  session = replaceOnce(
    session,
    "      !workout.sessionId\n    ) {\n      return;\n    }\n\n    setSwapError('');",
    "      !workout.sessionId ||\n      !exercise.sessionExerciseId ||\n      swapAvailability?.[\n        exercise.sessionExerciseId\n      ]?.available !== true\n    ) {\n      return;\n    }\n\n    setSwapError('');",
    'session / handleSwap availability guard'
  );
}

if (!session.includes('const swapAvailable =')) {
  session = replaceOnce(
    session,
    `                            const swapping =\n                              swappingExerciseKey ===\n                              exercise._uiKey;\n`,
    `                            const swapping =\n                              swappingExerciseKey ===\n                              exercise._uiKey;\n\n                            const swapState =\n                              exercise.sessionExerciseId\n                                ? swapAvailability[\n                                    exercise.sessionExerciseId\n                                  ]\n                                : null;\n\n                            const swapAvailable =\n                              swapState?.available ===\n                              true;\n\n                            const swapDisabled =\n                              Boolean(\n                                swappingExerciseKey\n                              ) ||\n                              swapAvailabilityLoading ||\n                              !swapAvailable;\n`,
    'session / per-exercise availability state'
  );
}

if (!session.includes('disabled={\n                                        swapDisabled')) {
  session = replaceOnce(
    session,
    `                                      disabled={\n                                        Boolean(\n                                          swappingExerciseKey\n                                        )\n                                      }\n`,
    `                                      disabled={\n                                        swapDisabled\n                                      }\n`,
    'session / swap button disabled state'
  );
}

if (!session.includes('!swapAvailable &&\n                                          { opacity: 0.28 }')) {
  session = replaceOnce(
    session,
    `                                        styles.swapButton,\n                                        swapping &&\n                                          styles.swapButtonLoading,\n`,
    `                                        styles.swapButton,\n                                        swapping &&\n                                          styles.swapButtonLoading,\n                                        (!swapAvailable ||\n                                          swapAvailabilityLoading) &&\n                                          { opacity: 0.28 },\n`,
    'session / swap button disabled visual'
  );
}

const iconOld = `                                          color={\n                                            colors.primaryLight\n                                          }\n`;
const iconNew = `                                          color={\n                                            swapAvailable &&\n                                            !swapAvailabilityLoading\n                                              ? colors.primaryLight\n                                              : colors.textMuted\n                                          }\n`;

const swapIconMarker = 'name="swap-horizontal-outline"';
const markerIndex = session.indexOf(swapIconMarker);
if (markerIndex !== -1) {
  const afterMarker = session.slice(markerIndex);
  if (!afterMarker.includes('swapAvailabilityLoading\n                                              ? colors.primaryLight')) {
    const localIconIndex = afterMarker.indexOf(iconOld);
    if (localIconIndex === -1) {
      throw new Error('Bloc attendu introuvable : session / swap icon color');
    }
    const absoluteIndex = markerIndex + localIconIndex;
    session =
      session.slice(0, absoluteIndex) +
      iconNew +
      session.slice(absoluteIndex + iconOld.length);
  }
}

write(sessionPath, session);

console.log('C50 front patch applied successfully.');
console.log('Modified: src/services/workoutService.js');
console.log('Modified: app/workout/session.js');
