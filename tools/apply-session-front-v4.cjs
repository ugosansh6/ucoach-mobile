const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sessionPath = path.join(root, 'app', 'workout', 'session.js');
const servicePath = path.join(root, 'src', 'services', 'workoutService.js');
const soundDir = path.join(root, 'assets', 'sounds');
const soundPath = path.join(soundDir, 'tabata-beep.wav');

function readNormalized(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function writePreservingWindows(file, content) {
  fs.writeFileSync(file, content.replace(/\n/g, '\r\n'), 'utf8');
}

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`Bloc attendu introuvable : ${label}`);
  }
  return content.replace(search, replacement);
}

function replaceRegexOnce(content, regex, replacement, label) {
  const matches = content.match(regex);
  if (!matches) {
    throw new Error(`Bloc attendu introuvable : ${label}`);
  }
  return content.replace(regex, replacement);
}

function ensureExpoAudio() {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  if (pkg.dependencies?.['expo-audio']) {
    console.log(`expo-audio déjà installé (${pkg.dependencies['expo-audio']}).`);
    return;
  }

  console.log('Installation de expo-audio pour le beep Tabata...');
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(command, ['expo', 'install', 'expo-audio'], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error('Installation de expo-audio impossible. Aucun patch front n’a été appliqué.');
  }
}

function createBeepWav(file) {
  if (fs.existsSync(file)) {
    console.log('tabata-beep.wav déjà présent.');
    return;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });

  const sampleRate = 44100;
  const durationSeconds = 0.11;
  const frequency = 880;
  const amplitude = 0.34;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    const fadeIn = Math.min(1, i / (sampleRate * 0.008));
    const fadeOut = Math.min(1, (sampleCount - i) / (sampleRate * 0.018));
    const envelope = Math.min(fadeIn, fadeOut);
    const sample = Math.sin(2 * Math.PI * frequency * t) * amplitude * envelope;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }

  fs.writeFileSync(file, buffer);
  console.log('Créé : assets/sounds/tabata-beep.wav');
}

ensureExpoAudio();
createBeepWav(soundPath);

// ---------------------------------------------------------------------------
// workoutService.js — RPE caché côté UI + enrichissement métadonnées exercice.
// ---------------------------------------------------------------------------
let service = readNormalized(servicePath);

if (!service.includes('function stripRpeFromPrescription(')) {
  service = replaceOnce(
    service,
    'function formatPrescription(exercise) {\n',
    `function stripRpeFromPrescription(value) {\n  if (typeof value !== 'string') {\n    return value;\n  }\n\n  return value\n    .replace(/\\s*[·|•]\\s*RPE\\s*\\d+(?:[.,]\\d+)?(?:\\s*[–-]\\s*\\d+(?:[.,]\\d+)?)?/gi, '')\n    .replace(/RPE\\s*\\d+(?:[.,]\\d+)?(?:\\s*[–-]\\s*\\d+(?:[.,]\\d+)?)?\\s*[·|•]?\\s*/gi, '')\n    .replace(/\\s*[·|•]\\s*$/g, '')\n    .replace(/^\\s*[·|•]\\s*/g, '')\n    .replace(/\\s{2,}/g, ' ')\n    .trim();\n}\n\nfunction formatPrescription(exercise) {\n`,
    'workoutService / strip RPE helper'
  );
}

service = service.replace(
  '    return exercise.prescription;\n',
  '    return stripRpeFromPrescription(exercise.prescription);\n'
);
service = service.replace(
  '    return prescription.text.trim();\n',
  '    return stripRpeFromPrescription(prescription.text.trim());\n'
);

service = service.replace(
  /\n  const rpeMin = formatNumber\(\n    prescription\.target_rpe_min\n  \);\n  const rpeMax = formatNumber\(\n    prescription\.target_rpe_max\n  \);\n\n  if \(rpeMin \|\| rpeMax\) \{\n    pieces\.push\([\s\S]*?\n    \);\n  \}\n/,
  '\n'
);

if (!service.includes('async function enrichWorkoutExerciseMetadata(')) {
  service = replaceOnce(
    service,
    'async function resolveFocusForGeneration() {\n',
    `async function enrichWorkoutExerciseMetadata(workout) {\n  const source = Array.isArray(workout?.exercises)\n    ? workout.exercises\n    : [];\n\n  const ids = [\n    ...new Set(\n      source\n        .map((exercise) => exercise.id)\n        .filter(Boolean)\n    ),\n  ];\n\n  if (ids.length === 0) {\n    return workout;\n  }\n\n  const { data, error } = await supabase\n    .from('exercises')\n    .select('id, description, instructions, tips, image_path')\n    .in('id', ids);\n\n  if (error) {\n    console.warn('Exercise metadata enrichment', error.message);\n    return workout;\n  }\n\n  const metaById = new Map(\n    (data ?? []).map((item) => [\n      item.id,\n      item,\n    ])\n  );\n\n  return {\n    ...workout,\n    exercises: source.map((exercise) => {\n      const meta = metaById.get(exercise.id);\n\n      if (!meta) {\n        return exercise;\n      }\n\n      return {\n        ...exercise,\n        description:\n          meta.description ??\n          exercise.description ??\n          null,\n        instructions:\n          meta.instructions ??\n          exercise.instructions ??\n          null,\n        tips:\n          meta.tips ??\n          exercise.tips ??\n          null,\n        imagePath:\n          meta.image_path ??\n          exercise.imagePath ??\n          null,\n      };\n    }),\n  };\n}\n\nasync function resolveFocusForGeneration() {\n`,
    'workoutService / metadata enrichment helper'
  );
}

if (!service.includes('const mappedWorkout =\n    mapGeneratedWorkout(\n      data,')) {
  service = replaceOnce(
    service,
    `  return mapGeneratedWorkout(\n    data,\n    preparation\n  );\n}\n\nfunction parseLoadKg`,
    `  const mappedWorkout =\n    mapGeneratedWorkout(\n      data,\n      preparation\n    );\n\n  return enrichWorkoutExerciseMetadata(\n    mappedWorkout\n  );\n}\n\nfunction parseLoadKg`,
    'workoutService / generation enrichment'
  );
}

if (!service.includes('const mappedWorkout =\n    mapGeneratedWorkout(\n      {\n        ...data.generated_workout,')) {
  service = replaceOnce(
    service,
    `  return mapGeneratedWorkout(\n    {\n      ...data.generated_workout,\n      session_id: sessionId,\n      status:\n        data.status ??\n        data.generated_workout.status ??\n        'generated',\n    },\n    preparationSnapshot ?? {}\n  );\n}\n\nexport async function changeWorkoutFormat`,
    `  const mappedWorkout =\n    mapGeneratedWorkout(\n      {\n        ...data.generated_workout,\n        session_id: sessionId,\n        status:\n          data.status ??\n          data.generated_workout.status ??\n          'generated',\n      },\n      preparationSnapshot ?? {}\n    );\n\n  return enrichWorkoutExerciseMetadata(\n    mappedWorkout\n  );\n}\n\nexport async function changeWorkoutFormat`,
    'workoutService / reload enrichment'
  );
}

writePreservingWindows(servicePath, service);

// ---------------------------------------------------------------------------
// session.js — finitions Session V4 validées.
// ---------------------------------------------------------------------------
let session = readNormalized(sessionPath);

if (!session.includes("from 'expo-audio';")) {
  session = replaceOnce(
    session,
    "import { Ionicons } from '@expo/vector-icons';\n",
    "import { Ionicons } from '@expo/vector-icons';\nimport { setAudioModeAsync, useAudioPlayer } from 'expo-audio';\n",
    'session / expo-audio import'
  );
}

if (!session.includes('const tabataBeep = require(')) {
  session = replaceOnce(
    session,
    "const workoutBackground = require('../../assets/backgrounds/welcome-default.jpg');\n",
    "const workoutBackground = require('../../assets/backgrounds/welcome-default.jpg');\nconst tabataBeep = require('../../assets/sounds/tabata-beep.wav');\n",
    'session / beep asset'
  );
}

session = session.replace(
  /\n\s*<Text\n\s*style=\{styles\.summaryMeta\}\n\s*>\n\s*WOD SURPRISE\n\s*<\/Text>/,
  ''
);

if (!session.includes('onPress={\n                          block.id !== \'wod\'')) {
  session = replaceOnce(
    session,
    `                      <BlockStatus\n                        validated={\n                          block.validated\n                        }\n                        locked={locked}\n                      />`,
    `                      <BlockStatus\n                        validated={\n                          block.validated\n                        }\n                        locked={locked}\n                        onPress={\n                          block.id !== 'wod' &&\n                          !block.validated &&\n                          !locked &&\n                          !concealed &&\n                          canValidate\n                            ? () =>\n                                validateBlock(\n                                  block.id\n                                )\n                            : null\n                        }\n                      />`,
    'session / clickable block status'
  );
}

session = session.replace(
  /\n\s*\{block\.id ===\n\s*'tabata' \? \(\n\s*<Text\n\s*style=\{styles\.tabataPosition\}\n\s*>\n\s*EXERCICE \{exercise\.tabataPosition\}\n\s*<\/Text>\n\s*\) : null\}/,
  ''
);

session = session.replace(
  /\n\s*\{!block\.validated \? \(\n\s*<Text\n\s*style=\{styles\.statusHint\}\n\s*>\n\s*Le cercle sert uniquement à signaler une exception\. En validant le bloc, tout exercice encore à faire sera enregistré comme réalisé\.\n\s*<\/Text>\n\s*\) : null\}/,
  ''
);

if (!session.includes('style={styles.exerciseDetailImage}')) {
  session = replaceRegexOnce(
    session,
    /                                \{detailsExpanded \? \(\n                                  <View\n                                    style=\{styles\.exerciseDetails\}\n                                  >[\s\S]*?                                  <\/View>\n                                \) : null\}/,
    `                                {detailsExpanded ? (\n                                  <View\n                                    style={styles.exerciseDetails}\n                                  >\n                                    {exercise.imagePath &&\n                                    /^https?:\\/\\//i.test(\n                                      exercise.imagePath\n                                    ) ? (\n                                      <Image\n                                        source={{\n                                          uri: exercise.imagePath,\n                                        }}\n                                        style={styles.exerciseDetailImage}\n                                        resizeMode="cover"\n                                      />\n                                    ) : null}\n\n                                    {exercise.description ? (\n                                      <View style={styles.exerciseDetailSection}>\n                                        <Text style={styles.exerciseDetailLabel}>\n                                          PRÉSENTATION\n                                        </Text>\n                                        <Text style={styles.exerciseDescription}>\n                                          {exercise.description}\n                                        </Text>\n                                      </View>\n                                    ) : null}\n\n                                    {exercise.instructions ? (\n                                      <View style={styles.exerciseDetailSection}>\n                                        <Text style={styles.exerciseDetailLabel}>\n                                          EXÉCUTION\n                                        </Text>\n                                        <Text style={styles.exerciseDescription}>\n                                          {exercise.instructions}\n                                        </Text>\n                                      </View>\n                                    ) : null}\n\n                                    {!exercise.description &&\n                                    !exercise.instructions ? (\n                                      <Text style={styles.exerciseDescription}>\n                                        Les consignes détaillées de ce mouvement ne sont pas encore renseignées.\n                                      </Text>\n                                    ) : null}\n\n                                    {exercise.tips ? (\n                                      <View\n                                        style={styles.tipRow}\n                                      >\n                                        <Ionicons\n                                          name="bulb-outline"\n                                          size={18}\n                                          color={\n                                            colors.primaryLight\n                                          }\n                                        />\n                                        <View style={styles.tipTextWrap}>\n                                          <Text style={styles.exerciseDetailLabel}>\n                                            CONSEIL UGEROD\n                                          </Text>\n                                          <Text\n                                            style={styles.tipText}\n                                          >\n                                            {exercise.tips}\n                                          </Text>\n                                        </View>\n                                      </View>\n                                    ) : null}\n                                  </View>\n                                ) : null}`,
    'session / exercise details'
  );
}

if (!session.includes('const previousByInstance =\n        new Map(\n          sourceExercises')) {
  session = replaceRegexOnce(
    session,
    /      if \(blockId === 'wod'\) \{[\s\S]*?      \}\n\n      setExpandedExercises\(/,
    `      const previousByInstance =\n        new Map(\n          sourceExercises\n            .filter(\n              (item) =>\n                item.sessionExerciseId\n            )\n            .map((item) => [\n              item.sessionExerciseId,\n              item,\n            ])\n        );\n\n      const refreshed =\n        await reloadWorkoutSession({\n          sessionId:\n            workout.sessionId,\n          preparationSnapshot:\n            workout.preparationSnapshot,\n        });\n\n      updateWorkout({\n        ...refreshed,\n        exercises:\n          refreshed.exercises.map(\n            (item) => {\n              if (\n                item.sessionExerciseId ===\n                exercise.sessionExerciseId\n              ) {\n                return {\n                  ...item,\n                  status: 'adapted',\n                  adaptationSource: 'swap',\n                };\n              }\n\n              const previous =\n                previousByInstance.get(\n                  item.sessionExerciseId\n                );\n\n              return previous\n                ? {\n                    ...item,\n                    status:\n                      previous.status,\n                    adaptationSource:\n                      previous.adaptationSource ??\n                      null,\n                  }\n                : item;\n            }\n          ),\n        validatedBlocks,\n      });\n\n      setExpandedExercises(`,
    'session / unified swap reload'
  );
}

if (!session.includes('function BlockStatus({\n  validated,\n  locked,\n  onPress,')) {
  session = replaceOnce(
    session,
    `function BlockStatus({\n  validated,\n  locked,\n}) {`,
    `function BlockStatus({\n  validated,\n  locked,\n  onPress,\n}) {`,
    'session / BlockStatus signature'
  );

  session = replaceOnce(
    session,
    `  return (\n    <View\n      style={styles.blockStatusPending}\n    />\n  );\n}\n\nfunction ExerciseStatusModal`,
    `  if (onPress) {\n    return (\n      <Pressable\n        onPress={(event) => {\n          event?.stopPropagation?.();\n          onPress();\n        }}\n        hitSlop={10}\n        accessibilityRole="button"\n        accessibilityLabel="Valider le bloc"\n        style={({ pressed }) => [\n          styles.blockStatusPending,\n          styles.blockStatusActionable,\n          pressed &&\n            styles.blockStatusPressed,\n        ]}\n      />\n    );\n  }\n\n  return (\n    <View\n      style={styles.blockStatusPending}\n    />\n  );\n}\n\nfunction ExerciseStatusModal`,
    'session / BlockStatus actionable pending'
  );
}

if (!session.includes('const beepPlayer =\n    useAudioPlayer(tabataBeep);')) {
  session = replaceOnce(
    session,
    `  const [paused, setPaused] =\n    useState(false);\n\n  const lastBuzzSecond =`,
    `  const [paused, setPaused] =\n    useState(false);\n\n  const beepPlayer =\n    useAudioPlayer(tabataBeep);\n\n  useEffect(() => {\n    setAudioModeAsync({\n      playsInSilentMode: true,\n    }).catch((error) => {\n      console.warn(\n        'Tabata audio mode',\n        error\n      );\n    });\n  }, []);\n\n  const playBeep =\n    useCallback(\n      (count = 1) => {\n        for (\n          let index = 0;\n          index < count;\n          index += 1\n        ) {\n          setTimeout(() => {\n            try {\n              beepPlayer.seekTo(0);\n              beepPlayer.play();\n            } catch (error) {\n              console.warn(\n                'Tabata beep',\n                error\n              );\n            }\n          }, index * 170);\n        }\n      },\n      [beepPlayer]\n    );\n\n  const lastBuzzSecond =`,
    'session / Tabata audio player'
  );

  session = session.replace(
    `            setPhase('rest');\n            Vibration.vibrate(80);\n            return restSeconds;`,
    `            setPhase('rest');\n            Vibration.vibrate(80);\n            playBeep(1);\n            return restSeconds;`
  );

  session = session.replace(
    `            Vibration.vibrate([\n              0,\n              120,\n              80,\n              120,\n            ]);\n            return 0;`,
    `            Vibration.vibrate([\n              0,\n              120,\n              80,\n              120,\n            ]);\n            playBeep(3);\n            return 0;`
  );

  session = session.replace(
    `          setPhase('work');\n          Vibration.vibrate(80);\n          return workSeconds;`,
    `          setPhase('work');\n          Vibration.vibrate(80);\n          playBeep(1);\n          return workSeconds;`
  );

  session = session.replace(
    `    workSeconds,\n  ]);`,
    `    workSeconds,\n    playBeep,\n  ]);`
  );

  session = session.replace(
    `    lastBuzzSecond.current =\n      remaining;\n    Vibration.vibrate(35);`,
    `    lastBuzzSecond.current =\n      remaining;\n    Vibration.vibrate(35);\n    playBeep(1);`
  );

  session = session.replace(
    `    remaining,\n    running,\n  ]);`,
    `    remaining,\n    running,\n    playBeep,\n  ]);`
  );

  session = session.replace(
    `    lastBuzzSecond.current = null;\n    Vibration.vibrate(60);\n  }`,
    `    lastBuzzSecond.current = null;\n    Vibration.vibrate(60);\n    playBeep(1);\n  }`
  );
}

if (!session.includes('blockStatusActionable: {')) {
  session = replaceOnce(
    session,
    `  blockStatusLocked: {\n`,
    `  blockStatusActionable: {\n    borderColor:\n      'rgba(8,104,255,0.62)',\n    backgroundColor:\n      'rgba(8,104,255,0.08)',\n  },\n\n  blockStatusPressed: {\n    backgroundColor:\n      'rgba(8,104,255,0.24)',\n  },\n\n  blockStatusLocked: {\n`,
    'session / actionable block status styles'
  );
}

if (!session.includes('exerciseDetailImage: {')) {
  session = replaceOnce(
    session,
    `  exerciseDescription: {\n`,
    `  exerciseDetailImage: {\n    width: '100%',\n    height: 170,\n    borderRadius: 10,\n    marginBottom: 12,\n    backgroundColor:\n      'rgba(255,255,255,0.04)',\n  },\n\n  exerciseDetailSection: {\n    gap: 4,\n    marginBottom: 10,\n  },\n\n  exerciseDetailLabel: {\n    fontFamily:\n      'Oswald_700Bold',\n    fontSize: 9,\n    lineHeight: 13,\n    letterSpacing: 0.75,\n    color:\n      colors.primaryLight,\n  },\n\n  exerciseDescription: {\n`,
    'session / exercise detail styles'
  );

  session = replaceOnce(
    session,
    `  tipText: {\n    flex: 1,`,
    `  tipTextWrap: {\n    flex: 1,\n    gap: 3,\n  },\n\n  tipText: {\n    flex: 1,`,
    'session / tip text wrapper style'
  );
}

writePreservingWindows(sessionPath, session);

console.log('');
console.log('SESSION V4 FRONT PATCH APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/session.js');
console.log('Modified: src/services/workoutService.js');
console.log('Generated: assets/sounds/tabata-beep.wav');
console.log('Dependency: expo-audio');
console.log('');
console.log('À tester : cercle de validation bloc, détails exercice, swap, Tabata + beep, absence RPE/WOD SURPRISE.');
