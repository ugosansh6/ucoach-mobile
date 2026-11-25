const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sessionPath = path.join(root, 'app', 'workout', 'session.js');
const wodPlayerPath = path.join(root, 'src', 'components', 'workout', 'WodProtocolPlayer.js');

function readWithEol(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return {
    eol: raw.includes('\r\n') ? '\r\n' : '\n',
    text: raw.replace(/\r\n/g, '\n'),
  };
}

function writeWithEol(file, text, eol) {
  fs.writeFileSync(file, text.replace(/\n/g, eol), 'utf8');
}

function replaceOnce(text, search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`Bloc attendu introuvable : ${label}`);
  }
  return text.replace(search, replacement);
}

// ---------------------------------------------------------------------------
// app/workout/session.js
// - retour robuste
// - cercle bloc = sélection/désélection, jamais validation
// - formatage des descriptions numérotées
// ---------------------------------------------------------------------------
const sessionFile = readWithEol(sessionPath);
let session = sessionFile.text;

if (!session.includes('function formatExerciseDetailText(value) {')) {
  const formatter = [
    'function formatExerciseDetailText(value) {',
    "  if (typeof value !== 'string') {",
    "    return value ?? '';",
    '  }',
    '',
    '  return value',
    "    .replace(/\\\\r\\\\n|\\\\n|\\\\r/g, '\\n')",
    "    .replace(/\\r\\n?/g, '\\n')",
    "    .replace(/(^|\\n)\\s*(\\d+)[.)-]?\\s+/g, (_, prefix, number) =>",
    "      prefix + number + '. '",
    '    )',
    "    .replace(/\\n{3,}/g, '\\n\\n')",
    '    .trim();',
    '}',
    '',
  ].join('\n');

  session = replaceOnce(
    session,
    'function normalizeBlockId(value) {\n',
    formatter + 'function normalizeBlockId(value) {\n',
    'session / detail formatter'
  );
}

for (const [search, replacement, label] of [
  ['{exercise.description}', '{formatExerciseDetailText(exercise.description)}', 'description'],
  ['{exercise.instructions}', '{formatExerciseDetailText(exercise.instructions)}', 'instructions'],
  ['{exercise.tips}', '{formatExerciseDetailText(exercise.tips)}', 'tips'],
]) {
  if (!session.includes(replacement) && session.includes(search)) {
    session = session.replace(search, replacement);
  }
}

session = replaceOnce(
  session,
  `  function handleBack() {\n    router.back();\n  }`,
  `  function handleBack() {\n    if (router.canGoBack()) {\n      router.back();\n      return;\n    }\n\n    router.replace('/workout/preparation');\n  }`,
  'session / back fallback'
);

if (!session.includes('function toggleBlockExerciseSelection(')) {
  session = replaceOnce(
    session,
    '  function canValidateBlock(block) {\n',
    `  function toggleBlockExerciseSelection(\n    blockId\n  ) {\n    if (\n      validatedBlocks.includes(\n        blockId\n      )\n    ) {\n      return;\n    }\n\n    const blockExercises =\n      sourceExercises.filter(\n        (exercise) =>\n          normalizeBlockId(\n            exercise.blockKey ??\n              exercise.block\n          ) === blockId\n      );\n\n    if (blockExercises.length === 0) {\n      return;\n    }\n\n    const hasPending =\n      blockExercises.some(\n        (exercise) =>\n          exercise.status ===\n          'pending'\n      );\n\n    const nextExercises =\n      sourceExercises.map(\n        (exercise) => {\n          const sameBlock =\n            normalizeBlockId(\n              exercise.blockKey ??\n                exercise.block\n            ) === blockId;\n\n          if (!sameBlock) {\n            return exercise;\n          }\n\n          if (hasPending) {\n            return exercise.status ===\n              'pending'\n              ? {\n                  ...exercise,\n                  status: 'completed',\n                }\n              : exercise;\n          }\n\n          return exercise.status ===\n            'completed'\n            ? {\n                ...exercise,\n                status: 'pending',\n              }\n            : exercise;\n        }\n      );\n\n    if (workout.exercises?.length) {\n      updateWorkout({\n        exercises: nextExercises,\n      });\n    } else {\n      setDevExercises(\n        nextExercises\n      );\n    }\n\n    setExpandedBlocks(\n      (current) => ({\n        ...current,\n        [blockId]: true,\n      })\n    );\n  }\n\n  function canValidateBlock(block) {\n`,
    'session / block selection toggle'
  );
}

const oldBlockStatusCall = `                      <BlockStatus\n                        validated={\n                          block.validated\n                        }\n                        locked={locked}\n                        onPress={\n                          block.id !== 'wod' &&\n                          !block.validated &&\n                          !locked &&\n                          !concealed &&\n                          canValidate\n                            ? () =>\n                                validateBlock(\n                                  block.id\n                                )\n                            : null\n                        }\n                      />`;

const newBlockStatusCall = `                      <BlockStatus\n                        validated={\n                          block.validated\n                        }\n                        locked={locked}\n                        selected={\n                          block.exercises.length > 0 &&\n                          block.exercises.every(\n                            (exercise) =>\n                              exercise.status !==\n                              'pending'\n                          )\n                        }\n                        onPress={\n                          block.id !== 'wod' &&\n                          !block.validated &&\n                          !locked &&\n                          !concealed &&\n                          canValidate\n                            ? () =>\n                                toggleBlockExerciseSelection(\n                                  block.id\n                                )\n                            : null\n                        }\n                      />`;

if (!session.includes('toggleBlockExerciseSelection(\n                                  block.id')) {
  session = replaceOnce(
    session,
    oldBlockStatusCall,
    newBlockStatusCall,
    'session / BlockStatus call'
  );
}

if (!session.includes('  selected,\n  onPress,\n}) {')) {
  session = replaceOnce(
    session,
    `function BlockStatus({\n  validated,\n  locked,\n  onPress,\n}) {`,
    `function BlockStatus({\n  validated,\n  locked,\n  selected,\n  onPress,\n}) {`,
    'session / BlockStatus selected prop'
  );
}

session = session.replace(
  '        accessibilityLabel="Valider le bloc"',
  '        accessibilityLabel="Sélectionner ou désélectionner les exercices du bloc"'
);

if (!session.includes('          selected &&\n            styles.blockStatusSelected,')) {
  session = replaceOnce(
    session,
    `          styles.blockStatusActionable,\n          pressed &&`,
    `          styles.blockStatusActionable,\n          selected &&\n            styles.blockStatusSelected,\n          pressed &&`,
    'session / selected block status style use'
  );
}

if (!session.includes('  blockStatusSelected: {')) {
  session = replaceOnce(
    session,
    `  blockStatusPressed: {\n    backgroundColor:\n      'rgba(8,104,255,0.24)',\n  },`,
    `  blockStatusSelected: {\n    borderColor:\n      colors.primary,\n    backgroundColor:\n      colors.primary,\n  },\n\n  blockStatusPressed: {\n    backgroundColor:\n      'rgba(8,104,255,0.24)',\n  },`,
    'session / selected block status style'
  );
}

writeWithEol(sessionPath, session, sessionFile.eol);

// ---------------------------------------------------------------------------
// WodProtocolPlayer.js
// - même beep que Tabata sur les timers/protocoles du WOD
// ---------------------------------------------------------------------------
const wodFile = readWithEol(wodPlayerPath);
let wod = wodFile.text;

if (!wod.includes("from 'expo-audio';")) {
  wod = replaceOnce(
    wod,
    "import { Ionicons } from '@expo/vector-icons';\n",
    "import { Ionicons } from '@expo/vector-icons';\nimport { setAudioModeAsync, useAudioPlayer } from 'expo-audio';\n",
    'wod player / expo-audio import'
  );
}

if (!wod.includes('const wodBeep = require(')) {
  wod = replaceOnce(
    wod,
    `import {\n  colors,\n  spacing,\n} from '../../constants';\n`,
    `import {\n  colors,\n  spacing,\n} from '../../constants';\n\nconst wodBeep = require('../../../assets/sounds/tabata-beep.wav');\n`,
    'wod player / beep asset'
  );
}

if (!wod.includes('const beepPlayer =\n    useAudioPlayer(wodBeep);')) {
  wod = replaceOnce(
    wod,
    `  const durationMinutes =\n    numberOr(\n      block?.durationMinutes,\n      10\n    );\n`,
    `  const durationMinutes =\n    numberOr(\n      block?.durationMinutes,\n      10\n    );\n\n  const beepPlayer =\n    useAudioPlayer(wodBeep);\n\n  useEffect(() => {\n    setAudioModeAsync({\n      playsInSilentMode: true,\n    }).catch((error) => {\n      console.warn(\n        'WOD audio mode',\n        error\n      );\n    });\n  }, []);\n\n  const playBeep =\n    useCallback(\n      (count = 1) => {\n        for (\n          let index = 0;\n          index < count;\n          index += 1\n        ) {\n          setTimeout(() => {\n            try {\n              beepPlayer.seekTo(0);\n              beepPlayer.play();\n            } catch (error) {\n              console.warn(\n                'WOD beep',\n                error\n              );\n            }\n          }, index * 170);\n        }\n      },\n      [beepPlayer]\n    );\n`,
    'wod player / beep setup'
  );
}

if (!wod.includes('      playBeep(2);\n      Vibration.vibrate([\n        0,\n        120,')) {
  wod = replaceOnce(
    wod,
    `      Vibration.vibrate([\n        0,\n        120,\n        80,\n        120,\n      ]);\n    }, [finished, mechanic]);`,
    `      playBeep(2);\n      Vibration.vibrate([\n        0,\n        120,\n        80,\n        120,\n      ]);\n    }, [finished, mechanic, playBeep]);`,
    'wod player / auto-finish beep'
  );
}

if (!wod.includes('          playBeep();\n          Vibration.vibrate(70);\n          return 0;')) {
  wod = replaceOnce(
    wod,
    `        if (current <= 1) {\n          Vibration.vibrate(70);\n          return 0;\n        }`,
    `        if (current <= 1) {\n          playBeep();\n          Vibration.vibrate(70);\n          return 0;\n        }`,
    'wod player / rest-end beep'
  );

  wod = wod.replace(
    '  }, [restRemaining > 0]);',
    '  }, [playBeep, restRemaining > 0]);'
  );
}

if (!wod.includes('      playBeep();\n      Vibration.vibrate(70);')) {
  wod = replaceOnce(
    wod,
    `    if (lastPhaseKey.current != null) {\n      Vibration.vibrate(70);\n    }`,
    `    if (lastPhaseKey.current != null) {\n      playBeep();\n      Vibration.vibrate(70);\n    }`,
    'wod player / phase transition beep'
  );

  wod = replaceOnce(
    wod,
    `    derived.phaseKey,\n    finished,\n    started,\n  ]);`,
    `    derived.phaseKey,\n    finished,\n    playBeep,\n    started,\n  ]);`,
    'wod player / phase transition deps'
  );
}

if (!wod.includes('      playBeep();\n      Vibration.vibrate(30);')) {
  wod = replaceOnce(
    wod,
    `    if (\n      remaining != null &&\n      remaining > 0 &&\n      remaining <= 3\n    ) {\n      Vibration.vibrate(30);\n    }`,
    `    if (\n      remaining != null &&\n      remaining > 0 &&\n      remaining <= 3\n    ) {\n      playBeep();\n      Vibration.vibrate(30);\n    }`,
    'wod player / countdown beep'
  );

  wod = replaceOnce(
    wod,
    `    paused,\n    started,\n    totalSeconds,\n  ]);`,
    `    paused,\n    playBeep,\n    started,\n    totalSeconds,\n  ]);`,
    'wod player / countdown deps'
  );
}

if (!wod.includes('    playBeep();\n    Vibration.vibrate(60);')) {
  wod = replaceOnce(
    wod,
    `    setStarted(true);\n    setPaused(false);\n    setFinishReason(null);\n    Vibration.vibrate(60);`,
    `    setStarted(true);\n    setPaused(false);\n    setFinishReason(null);\n    playBeep();\n    Vibration.vibrate(60);`,
    'wod player / start beep'
  );
}

if (!wod.includes('    playBeep(2);\n    Vibration.vibrate([\n      0,\n      100,')) {
  wod = replaceOnce(
    wod,
    `    setFinished(true);\n    setPaused(false);\n    setFinishReason(reason);\n    Vibration.vibrate([\n      0,\n      100,`,
    `    setFinished(true);\n    setPaused(false);\n    setFinishReason(reason);\n    playBeep(2);\n    Vibration.vibrate([\n      0,\n      100,`,
    'wod player / manual finish beep'
  );
}

writeWithEol(wodPlayerPath, wod, wodFile.eol);

console.log('SESSION V5 PATCH APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/session.js');
console.log('Modified: src/components/workout/WodProtocolPlayer.js');
console.log('Behavior: block circle selects/deselects only; final validation stays on TERMINER.');
console.log('Navigation: back uses history, with /workout/preparation fallback.');
console.log('Audio: WOD timers now beep on start, last 3 seconds, phase changes and finish.');
console.log('Text: literal \\n converted to line breaks and numbered steps normalized.');
