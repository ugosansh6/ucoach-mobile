import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = {
  service: path.join(root, 'src/services/workoutService.js'),
  session: path.join(root, 'app/workout/session.js'),
  player: path.join(root, 'src/components/workout/WodProtocolPlayer.js'),
};

function read(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Fichier introuvable: ${file}`);
  }
  return fs.readFileSync(file, 'utf8');
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) {
    throw new Error(`Patch impossible (${label}): bloc attendu introuvable.`);
  }
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch ambigu (${label}): bloc trouvé plusieurs fois.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let service = read(files.service);
let session = read(files.session);
let player = read(files.player);

// ---------------------------------------------------------------------------
// src/services/workoutService.js
// ---------------------------------------------------------------------------
service = replaceOnce(
  service,
`  return data ?? {
    status: 'UNKNOWN',
  };
}

function normalizeEquipmentForBackend(equipment) {`,
`  return data ?? {
    status: 'UNKNOWN',
  };
}

export async function markWorkoutWodRevealed({
  sessionId,
}) {
  if (!sessionId) {
    return { status: 'NO_SESSION' };
  }

  const { data, error } = await supabase.rpc(
    'mark_wod_revealed',
    { p_session_id: sessionId }
  );

  if (error) {
    throw new Error(
      error?.message ??
        'Impossible de révéler le WOD.'
    );
  }

  return data ?? { status: 'UNKNOWN' };
}

export async function markWorkoutWodStarted({
  sessionId,
}) {
  if (!sessionId) {
    return { status: 'NO_SESSION' };
  }

  const { data, error } = await supabase.rpc(
    'mark_wod_started',
    { p_session_id: sessionId }
  );

  if (error) {
    throw new Error(
      error?.message ??
        'Impossible de démarrer le WOD.'
    );
  }

  return data ?? { status: 'UNKNOWN' };
}

function normalizeEquipmentForBackend(equipment) {`,
  'service lifecycle RPCs'
);

service = replaceOnce(
  service,
`  return {
    sessionId:
      data?.session_id ?? sessionId,
    subscriptionTier:
      data?.subscription_tier ?? 'FREE',
    currentMechanic:
      data?.current_mechanic ?? null,
    currentVariant:
      data?.current_variant ?? null,
    options:
      Array.isArray(data?.options)
        ? data.options
        : [],
    version:
      data?.version ?? null,
  };
}`,
`  return {
    sessionId:
      data?.session_id ?? sessionId,
    subscriptionTier:
      data?.subscription_tier ?? 'FREE',
    currentMechanic:
      data?.current_mechanic ?? null,
    currentVariant:
      data?.current_variant ?? null,
    wodRevealedAt:
      data?.wod_revealed_at ?? null,
    wodStartedAt:
      data?.wod_started_at ?? null,
    formatChangeCount:
      Number(data?.format_change_count ?? 0),
    formatChangeLimit:
      Number(data?.format_change_limit ?? 3),
    remainingFormatChanges:
      Number(data?.remaining_format_changes ?? 0),
    formatLocked:
      Boolean(data?.format_locked),
    options:
      Array.isArray(data?.options)
        ? data.options
        : [],
    version:
      data?.version ?? null,
  };
}`,
  'service format metadata'
);

service = replaceOnce(
  service,
`  const { data, error } = await supabase
    .from('workout_sessions')
    .select('id, status, generated_workout')
    .eq('id', sessionId)
    .single();`,
`  const { data, error } = await supabase
    .from('workout_sessions')
    .select(
      'id, status, generated_workout, wod_revealed_at, wod_started_at, format_change_count'
    )
    .eq('id', sessionId)
    .single();`,
  'service reload lifecycle select'
);

service = replaceOnce(
  service,
`  return enrichWorkoutExerciseMetadata(
    mappedWorkout
  );
}

export async function changeWorkoutFormat({`,
`  const enriched =
    await enrichWorkoutExerciseMetadata(
      mappedWorkout
    );
  const formatChangeCount =
    Number(data?.format_change_count ?? 0);
  const formatChangeLimit = 3;

  return {
    ...enriched,
    wodRevealed:
      Boolean(data?.wod_revealed_at),
    wodRevealedAt:
      data?.wod_revealed_at ?? null,
    wodStarted:
      Boolean(data?.wod_started_at),
    wodStartedAt:
      data?.wod_started_at ?? null,
    formatChangeCount,
    formatChangeLimit,
    remainingFormatChanges:
      Math.max(
        0,
        formatChangeLimit -
          formatChangeCount
      ),
    formatLocked:
      Boolean(data?.wod_started_at) ||
      formatChangeCount >=
        formatChangeLimit,
  };
}

export async function changeWorkoutFormat({`,
  'service reload lifecycle mapping'
);

service = replaceOnce(
  service,
`  if (
    data?.classification ===
    'NOT_RECOMMENDED'
  ) {
    throw new Error(
      'Ce format n’est pas adapté à cette séance.'
    );
  }

  return data;`,
`  if (
    data?.classification ===
    'NOT_RECOMMENDED'
  ) {
    throw new Error(
      'Ce format n’est pas adapté à cette séance.'
    );
  }

  if (
    data?.classification ===
    'LOCKED_AFTER_WOD_START'
  ) {
    throw new Error(
      'Le format est verrouillé : le WOD a déjà commencé.'
    );
  }

  if (
    data?.classification ===
    'LOCKED_AFTER_FORMAT_CHANGE_LIMIT'
  ) {
    throw new Error(
      'La limite de 3 changements de format est atteinte.'
    );
  }

  return data;`,
  'service lock errors'
);

// ---------------------------------------------------------------------------
// app/workout/session.js
// ---------------------------------------------------------------------------
session = replaceOnce(
  session,
`  getWorkoutSwapAvailability,
  markWorkoutSessionStarted,
  reloadWorkoutSession,`,
`  getWorkoutSwapAvailability,
  markWorkoutSessionStarted,
  markWorkoutWodRevealed,
  markWorkoutWodStarted,
  reloadWorkoutSession,`,
  'session imports'
);

session = replaceOnce(
  session,
`  const [
    wodRevealed,
    setWodRevealed,
  ] = useState(
    Boolean(workout.wodRevealed)
  );

  const blocks = useMemo(`,
`  const [
    wodRevealed,
    setWodRevealed,
  ] = useState(
    Boolean(
      workout.wodRevealed ||
        workout.wodRevealedAt
    )
  );

  const [
    formatChangeCount,
    setFormatChangeCount,
  ] = useState(
    Number(workout.formatChangeCount ?? 0)
  );

  const [
    formatChangeLimit,
    setFormatChangeLimit,
  ] = useState(
    Number(workout.formatChangeLimit ?? 3)
  );

  const [
    formatLocked,
    setFormatLocked,
  ] = useState(
    Boolean(
      workout.formatLocked ||
        workout.wodStarted ||
        workout.wodStartedAt ||
        workout.wodRuntime?.started
    )
  );

  const remainingFormatChanges =
    Math.max(
      0,
      formatChangeLimit -
        formatChangeCount
    );

  useEffect(() => {
    setWodRevealed(
      Boolean(
        workout.wodRevealed ||
          workout.wodRevealedAt
      )
    );
    setFormatChangeCount(
      Number(
        workout.formatChangeCount ?? 0
      )
    );
    setFormatChangeLimit(
      Number(
        workout.formatChangeLimit ?? 3
      )
    );
    setFormatLocked(
      Boolean(
        workout.formatLocked ||
          workout.wodStarted ||
          workout.wodStartedAt ||
          workout.wodRuntime?.started
      )
    );
  }, [
    workout.sessionId,
    workout.wodRevealed,
    workout.wodRevealedAt,
    workout.wodStarted,
    workout.wodStartedAt,
    workout.wodRuntime?.started,
    workout.formatChangeCount,
    workout.formatChangeLimit,
    workout.formatLocked,
  ]);

  const blocks = useMemo(`,
  'session format lifecycle state'
);

session = replaceOnce(
  session,
`  function revealWod() {
    if (
      !wodUnlocked ||
      wodRevealed
    ) {
      return;
    }

    setWodRevealed(true);
    setExpandedBlocks(
      (current) => ({
        ...current,
        wod: true,
      })
    );
    updateWorkout({
      wodRevealed: true,
    });
  }

  const handleWodRuntimeChange =`,
`  async function revealWod() {
    if (
      !wodUnlocked ||
      wodRevealed
    ) {
      return;
    }

    setSwapError('');

    try {
      const result =
        workout.sessionId
          ? await markWorkoutWodRevealed({
              sessionId:
                workout.sessionId,
            })
          : null;
      const nextCount =
        Number(
          result?.format_change_count ??
            formatChangeCount
        );
      const nextLimit =
        Number(
          result?.format_change_limit ??
            formatChangeLimit
        );
      const nextLocked =
        Boolean(
          result?.format_locked ??
            nextCount >= nextLimit
        );

      setWodRevealed(true);
      setFormatChangeCount(nextCount);
      setFormatChangeLimit(nextLimit);
      setFormatLocked(nextLocked);
      setExpandedBlocks(
        (current) => ({
          ...current,
          wod: true,
        })
      );
      updateWorkout({
        wodRevealed: true,
        wodRevealedAt:
          result?.wod_revealed_at ??
          workout.wodRevealedAt ??
          null,
        formatChangeCount: nextCount,
        formatChangeLimit: nextLimit,
        remainingFormatChanges:
          Math.max(
            0,
            nextLimit - nextCount
          ),
        formatLocked: nextLocked,
      });
    } catch (error) {
      setSwapError(
        error?.message ??
          'Impossible de révéler le WOD.'
      );
    }
  }

  const handleWodStartRequest =
    useCallback(async () => {
      if (!workout.sessionId) {
        setFormatLocked(true);
        ensureSessionStarted();
        return;
      }

      const result =
        await markWorkoutWodStarted({
          sessionId:
            workout.sessionId,
        });

      if (
        result?.status &&
        result.status !== 'WOD_STARTED'
      ) {
        throw new Error(
          'Le WOD ne peut pas être démarré dans cet état.'
        );
      }

      wodRuntimeStartedRef.current = true;
      setFormatLocked(true);
      ensureSessionStarted();
      updateWorkout({
        wodStarted: true,
        wodStartedAt:
          result?.wod_started_at ??
          new Date().toISOString(),
        wodRevealed: true,
        wodRevealedAt:
          result?.wod_revealed_at ??
          workout.wodRevealedAt ??
          null,
        formatChangeCount:
          Number(
            result?.format_change_count ??
              formatChangeCount
          ),
        formatChangeLimit:
          Number(
            result?.format_change_limit ??
              formatChangeLimit
          ),
        remainingFormatChanges: 0,
        formatLocked: true,
      });
    }, [
      ensureSessionStarted,
      formatChangeCount,
      formatChangeLimit,
      updateWorkout,
      workout.sessionId,
      workout.wodRevealedAt,
    ]);

  const handleWodRuntimeChange =`,
  'session reveal and WOD start marker'
);

session = replaceOnce(
  session,
`        if (
          runtime?.started &&
          !wodRuntimeStartedRef.current
        ) {
          wodRuntimeStartedRef.current = true;
          ensureSessionStarted();
        }

        updateWorkout({`,
`        if (
          runtime?.started &&
          !wodRuntimeStartedRef.current
        ) {
          wodRuntimeStartedRef.current = true;
          setFormatLocked(true);
          ensureSessionStarted();

          if (workout.sessionId) {
            markWorkoutWodStarted({
              sessionId:
                workout.sessionId,
            })
              .then((result) => {
                updateWorkout({
                  wodStarted: true,
                  wodStartedAt:
                    result?.wod_started_at ??
                    null,
                  formatLocked: true,
                  remainingFormatChanges: 0,
                });
              })
              .catch((error) => {
                console.warn(
                  'WOD start marker fallback',
                  error
                );
              });
          }
        }

        updateWorkout({`,
  'session WOD start fallback'
);

session = replaceOnce(
  session,
`        ensureSessionStarted,
        updateWorkout,
      ]
    );`,
`        ensureSessionStarted,
        updateWorkout,
        workout.sessionId,
      ]
    );`,
  'session runtime callback deps'
);

session = replaceOnce(
  session,
`  async function openFormatModal() {
    if (
      wodRevealed ||
      !workout.sessionId
    ) {
      return;
    }

    setFormatModalVisible(true);`,
`  async function openFormatModal() {
    if (
      !workout.sessionId ||
      formatLocked ||
      workout.wodRuntime?.started
    ) {
      return;
    }

    setFormatModalVisible(true);`,
  'session allow format modal after reveal'
);

session = replaceOnce(
  session,
`      setSubscriptionTier(
        result.subscriptionTier
      );

      setFormatOptions(`,
`      setSubscriptionTier(
        result.subscriptionTier
      );
      setFormatChangeCount(
        Number(
          result.formatChangeCount ?? 0
        )
      );
      setFormatChangeLimit(
        Number(
          result.formatChangeLimit ?? 3
        )
      );
      setFormatLocked(
        Boolean(result.formatLocked)
      );

      if (result.formatLocked) {
        setFormatModalVisible(false);
        return;
      }

      setFormatOptions(`,
  'session authoritative format modal state'
);

session = replaceOnce(
  session,
`  async function handleFormatSelect(
    option
  ) {
    if (
      !option?.selectable ||
      option.current ||
      formatChanging ||
      wodRevealed
    ) {
      return;
    }

    setFormatChanging(
      option.option_id
    );
    setFormatError('');

    try {
      await changeWorkoutFormat({
        sessionId:
          workout.sessionId,
        mechanic:
          option.mechanic,
        variantKey:
          option.variant_key ??
          null,
      });

      const refreshed =
        await reloadWorkoutSession({
          sessionId:
            workout.sessionId,
          preparationSnapshot:
            workout.preparationSnapshot,
        });

      const previousByInstance =
        new Map(
          (workout.exercises ?? [])
            .filter(
              (exercise) =>
                exercise.sessionExerciseId
            )
            .map((exercise) => [
              exercise.sessionExerciseId,
              exercise,
            ])
        );

      updateWorkout({
        ...refreshed,
        exercises:
          refreshed.exercises.map(
            (exercise) => {
              const previous =
                previousByInstance.get(
                  exercise.sessionExerciseId
                );

              const blockId =
                normalizeBlockId(
                  exercise.blockKey ??
                    exercise.block
                );

              if (
                previous &&
                blockId !== 'wod'
              ) {
                return {
                  ...exercise,
                  status:
                    previous.status,
                  adaptationSource:
                    previous.adaptationSource ??
                    null,
                };
              }

              return exercise;
            }
          ),
        validatedBlocks,
        wodRevealed: false,
        wodRuntime: null,
      });
      setWodRevealed(false);

      setFormatModalVisible(false);
      setFormatOptions([]);
    } catch (error) {
      setFormatError(
        error?.message ??
          'Impossible de changer le format.'
      );
    } finally {
      setFormatChanging(null);
    }
  }`,
`  async function handleFormatSelect(
    option
  ) {
    if (
      !option?.selectable ||
      option.current ||
      formatChanging ||
      formatLocked ||
      workout.wodRuntime?.started
    ) {
      return;
    }

    setFormatChanging(
      option.option_id
    );
    setFormatError('');

    try {
      const wasRevealed =
        wodRevealed;
      const changeResult =
        await changeWorkoutFormat({
          sessionId:
            workout.sessionId,
          mechanic:
            option.mechanic,
          variantKey:
            option.variant_key ??
            null,
        });

      const refreshed =
        await reloadWorkoutSession({
          sessionId:
            workout.sessionId,
          preparationSnapshot:
            workout.preparationSnapshot,
        });

      const previousByInstance =
        new Map(
          (workout.exercises ?? [])
            .filter(
              (exercise) =>
                exercise.sessionExerciseId
            )
            .map((exercise) => [
              exercise.sessionExerciseId,
              exercise,
            ])
        );
      const nextCount =
        Number(
          changeResult?.format_change_count ??
            refreshed.formatChangeCount ??
            formatChangeCount
        );
      const nextLimit =
        Number(
          changeResult?.format_change_limit ??
            refreshed.formatChangeLimit ??
            formatChangeLimit
        );
      const nextLocked =
        Boolean(
          changeResult?.format_locked ??
            refreshed.formatLocked ??
            nextCount >= nextLimit
        );

      updateWorkout({
        ...refreshed,
        exercises:
          refreshed.exercises.map(
            (exercise) => {
              const previous =
                previousByInstance.get(
                  exercise.sessionExerciseId
                );
              const blockId =
                normalizeBlockId(
                  exercise.blockKey ??
                    exercise.block
                );

              if (
                previous &&
                blockId !== 'wod'
              ) {
                return {
                  ...exercise,
                  status:
                    previous.status,
                  adaptationSource:
                    previous.adaptationSource ??
                    null,
                };
              }

              if (
                previous &&
                blockId === 'wod' &&
                previous.id === exercise.id &&
                previous.status === 'adapted'
              ) {
                return {
                  ...exercise,
                  status: 'adapted',
                  adaptationSource:
                    previous.adaptationSource ??
                    'swap',
                };
              }

              return exercise;
            }
          ),
        validatedBlocks,
        wodRevealed: wasRevealed,
        wodRuntime: null,
        formatChangeCount: nextCount,
        formatChangeLimit: nextLimit,
        remainingFormatChanges:
          Math.max(
            0,
            nextLimit - nextCount
          ),
        formatLocked: nextLocked,
      });

      setWodRevealed(wasRevealed);
      setFormatChangeCount(nextCount);
      setFormatChangeLimit(nextLimit);
      setFormatLocked(nextLocked);

      if (wasRevealed) {
        setExpandedBlocks(
          (current) => ({
            ...current,
            wod: true,
          })
        );
      }

      await refreshSwapAvailability();
      setFormatModalVisible(false);
      setFormatOptions([]);
    } catch (error) {
      setFormatError(
        error?.message ??
          'Impossible de changer le format.'
      );
    } finally {
      setFormatChanging(null);
    }
  }`,
  'session keep reveal and swap status after format change'
);

session = replaceOnce(
  session,
`                        {block.id === 'wod' ? (
                          <WodProtocolPlayer`,
`                        {block.id === 'wod' ? (
                          <>
                            <View
                              style={[
                                styles.formatPreview,
                                {
                                  marginTop: 12,
                                  marginBottom: 12,
                                },
                              ]}
                            >
                              <View
                                style={styles.formatPreviewMain}
                              >
                                <Text
                                  style={styles.formatPreviewLabel}
                                >
                                  FORMAT DU WOD
                                </Text>
                                <Text
                                  style={styles.formatPreviewValue}
                                >
                                  {String(
                                    workoutFormat
                                  ).toUpperCase()}
                                </Text>
                                <Text
                                  style={styles.formatPreviewHint}
                                >
                                  {workout.wodRuntime?.started ||
                                  workout.wodStarted ||
                                  workout.wodStartedAt
                                    ? 'Format verrouillé après démarrage'
                                    : remainingFormatChanges <= 0
                                      ? 'Limite de ' + formatChangeLimit + ' changements atteinte'
                                      : remainingFormatChanges + ' changement' + (remainingFormatChanges > 1 ? 's' : '') + ' restant' + (remainingFormatChanges > 1 ? 's' : '')}
                                </Text>
                              </View>

                              {workout.sessionId ? (
                                <Pressable
                                  onPress={openFormatModal}
                                  disabled={
                                    formatLocked ||
                                    workout.wodRuntime?.started ||
                                    remainingFormatChanges <= 0
                                  }
                                  style={({ pressed }) => [
                                    styles.modifyFormatButton,
                                    (formatLocked ||
                                      workout.wodRuntime?.started ||
                                      remainingFormatChanges <= 0) &&
                                      { opacity: 0.38 },
                                    pressed &&
                                      !formatLocked &&
                                      !workout.wodRuntime?.started &&
                                      remainingFormatChanges > 0 &&
                                      styles.pressed,
                                  ]}
                                >
                                  <Ionicons
                                    name={
                                      formatLocked ||
                                      workout.wodRuntime?.started ||
                                      remainingFormatChanges <= 0
                                        ? 'lock-closed-outline'
                                        : 'options-outline'
                                    }
                                    size={16}
                                    color={
                                      formatLocked ||
                                      workout.wodRuntime?.started ||
                                      remainingFormatChanges <= 0
                                        ? colors.textMuted
                                        : colors.primaryLight
                                    }
                                  />
                                  <Text
                                    style={styles.modifyFormatText}
                                  >
                                    {formatLocked ||
                                    workout.wodRuntime?.started ||
                                    remainingFormatChanges <= 0
                                      ? 'VERROUILLÉ'
                                      : 'MODIFIER'}
                                  </Text>
                                </Pressable>
                              ) : null}
                            </View>

                            <WodProtocolPlayer`,
  'session revealed format control open'
);

session = replaceOnce(
  session,
`                            initialRuntime={
                              workout.wodRuntime ?? null
                            }
                            onRuntimeChange={`,
`                            initialRuntime={
                              workout.wodRuntime ?? null
                            }
                            onBeforeStart={
                              handleWodStartRequest
                            }
                            onRuntimeChange={`,
  'session WOD player before start prop'
);

session = replaceOnce(
  session,
`                            onRuntimeChange={
                              handleWodRuntimeChange
                            }
                          />
                        ) : null}`, 
`                            onRuntimeChange={
                              handleWodRuntimeChange
                            }
                          />
                          </>
                        ) : null}`,
  'session revealed format control close'
);

// ---------------------------------------------------------------------------
// src/components/workout/WodProtocolPlayer.js
// ---------------------------------------------------------------------------
player = replaceOnce(
  player,
`import {
  Pressable,
  StyleSheet,`,
`import {
  ActivityIndicator,
  Pressable,
  StyleSheet,`,
  'player ActivityIndicator import'
);

player = replaceOnce(
  player,
`export default function WodProtocolPlayer({
  block,
  initialRuntime = null,
  onRuntimeChange,
}) {`,
`export default function WodProtocolPlayer({
  block,
  initialRuntime = null,
  onBeforeStart,
  onRuntimeChange,
}) {`,
  'player before start prop'
);

player = replaceOnce(
  player,
`  const [paused, setPaused] =
    useState(false);
  const [finished, setFinished] =`,
`  const [paused, setPaused] =
    useState(false);
  const [starting, setStarting] =
    useState(false);
  const [startError, setStartError] =
    useState('');
  const [finished, setFinished] =`,
  'player start state'
);

player = replaceOnce(
  player,
`  function start() {
    if (finished) {
      return;
    }

    setStarted(true);
    setPaused(false);
    setFinishReason(null);
    playBeep();
    Vibration.vibrate(60);
  }`,
`  async function start() {
    if (finished || starting) {
      return;
    }

    setStarting(true);
    setStartError('');

    try {
      await onBeforeStart?.();
      setStarted(true);
      setPaused(false);
      setFinishReason(null);
      playBeep();
      Vibration.vibrate(60);
    } catch (error) {
      setStartError(
        error?.message ??
          'Impossible de démarrer le WOD. Réessaie.'
      );
    } finally {
      setStarting(false);
    }
  }`,
  'player atomic start'
);

player = replaceOnce(
  player,
`        <StartPanel
          mechanic={mechanic}
          exercises={exercises}
          onStart={start}
        />`,
`        <StartPanel
          mechanic={mechanic}
          exercises={exercises}
          loading={starting}
          error={startError}
          onStart={start}
        />`,
  'player start panel props'
);

player = replaceOnce(
  player,
`function StartPanel({
  mechanic,
  exercises,
  onStart,
}) {`,
`function StartPanel({
  mechanic,
  exercises,
  loading,
  error,
  onStart,
}) {`,
  'player start panel signature'
);

player = replaceOnce(
  player,
`      <Pressable
        onPress={onStart}
        style={styles.primaryButton}
      >
        <Ionicons
          name="play"
          size={18}
          color={colors.brandWhite}
        />
        <Text style={styles.primaryButtonText}>
          DÉMARRER LE WOD
        </Text>
      </Pressable>`,
`      {error ? (
        <Text style={styles.startError}>
          {error}
        </Text>
      ) : null}

      <Pressable
        onPress={onStart}
        disabled={loading}
        style={[
          styles.primaryButton,
          loading && styles.buttonDisabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator
            size="small"
            color={colors.brandWhite}
          />
        ) : (
          <Ionicons
            name="play"
            size={18}
            color={colors.brandWhite}
          />
        )}
        <Text style={styles.primaryButtonText}>
          {loading
            ? 'VERROUILLAGE DU FORMAT…'
            : 'DÉMARRER LE WOD'}
        </Text>
      </Pressable>`,
  'player start loading UI'
);

player = replaceOnce(
  player,
`  startText: {
    maxWidth: 320,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 3,
  },
  primaryButton: {`,
`  startText: {
    maxWidth: 320,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 3,
  },
  startError: {
    maxWidth: 320,
    marginTop: 10,
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 15,
    color: colors.brandRed,
    textAlign: 'center',
  },
  primaryButton: {`,
  'player start error style'
);

// Nothing is written until every expected block above has matched exactly.
fs.writeFileSync(files.service, service, 'utf8');
fs.writeFileSync(files.session, session, 'utf8');
fs.writeFileSync(files.player, player, 'utf8');

console.log('✅ Patch UGEROD pre-start WOD appliqué.');
console.log('Fichiers modifiés:');
console.log(' - src/services/workoutService.js');
console.log(' - app/workout/session.js');
console.log(' - src/components/workout/WodProtocolPlayer.js');
console.log('Vérification: git diff --check && git diff --stat');
