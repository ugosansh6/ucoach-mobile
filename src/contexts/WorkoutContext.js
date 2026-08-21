import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import {
  recordSessionExecutionEventQuietly,
} from '../services/observationService';

const WorkoutContext = createContext(null);

const INITIAL_PREPARATION = {
  duration: null,
  equipment: [],
  readiness: null,
  painZones: [],
  region: null,
};

const INITIAL_WORKOUT = {
  sessionId: null,
  status: 'idle',
  generatedAt: null,
  backendVersion: null,
  title: null,
  format: null,
  mechanic: null,
  formatVariant: null,
  plannedDuration: null,
  blocks: {},
  rawBlocks: [],
  exercises: [],
  meta: {},
  preparationSnapshot: null,
  validatedBlocks: [],
  wodRevealed: false,
  wodRuntime: null,
  executionEvents: [],
  sessionStarted: false,
  startedAt: null,
  startedLocalDate: null,
  contextRecalculationCount: 0,
  contextRecalculationLimit: 3,
  remainingContextRecalculations: 3,
  generationControlStatus: null,
  safetyAdaptation: null,
};

const INITIAL_COMPLETION = {
  formAfter: null,
  rpe: null,
  loads: {},
  loadMeta: {},
  notes: '',
  exerciseFeedback: {},
  protocolFeedback: {},
};

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function appendUniqueEvent(
  events,
  event,
  {
    sessionId = null,
    blockKey = null,
    sessionExerciseId = null,
    source = 'user_action',
  } = {}
) {
  const list = Array.isArray(events) ? events : [];
  const key = event?.idempotency_key;

  if (
    key &&
    list.some(
      (item) =>
        item?.idempotency_key === key
    )
  ) {
    return list;
  }

  if (sessionId && event?.event_type) {
    recordSessionExecutionEventQuietly({
      sessionId,
      eventType: event.event_type,
      payload: event.payload ?? {},
      source,
      sessionExerciseId,
      blockKey,
      occurredAt: event.occurred_at ?? null,
      idempotencyKey: key ?? null,
    });
  }

  return [...list, event].slice(-200);
}

function runtimeEvent(
  eventType,
  idempotencyKey,
  payload = {}
) {
  return {
    event_type: eventType,
    idempotency_key: idempotencyKey,
    occurred_at: new Date().toISOString(),
    payload,
  };
}

function enrichControlledWodRuntime(
  previousRuntime,
  incomingRuntime,
  sessionId
) {
  if (!incomingRuntime) {
    return incomingRuntime;
  }

  const previous = previousRuntime ?? {};
  const next = {
    ...incomingRuntime,
    executionEvents:
      Array.isArray(previous.executionEvents)
        ? previous.executionEvents
        : [],
    roundSplits:
      Array.isArray(previous.roundSplits)
        ? previous.roundSplits
        : [],
  };

  const traceOptions = {
    sessionId,
    blockKey: 'wod',
    source: 'ugerod_player',
  };

  if (next.started) {
    next.controlledWindow = true;
    next.timeQuality = 'CONTROLLED_WINDOW';
  }

  if (!previous.started && next.started) {
    next.executionEvents = appendUniqueEvent(
      next.executionEvents,
      runtimeEvent(
        'WOD_PLAYER_START',
        'wod_player_start',
        {
          elapsed_seconds: numeric(
            next.elapsedSeconds,
            0
          ),
          mechanic: next.mechanic ?? null,
          variant: next.variant ?? null,
        }
      ),
      traceOptions
    );
  }

  if (
    previous.started &&
    !previous.paused &&
    next.paused
  ) {
    const elapsed = numeric(
      next.elapsedSeconds,
      0
    );
    next.executionEvents = appendUniqueEvent(
      next.executionEvents,
      runtimeEvent(
        'WOD_PLAYER_PAUSE',
        `wod_pause:${elapsed}`,
        { elapsed_seconds: elapsed }
      ),
      traceOptions
    );
  }

  if (
    previous.started &&
    previous.paused &&
    next.started &&
    !next.paused
  ) {
    const elapsed = numeric(
      next.elapsedSeconds,
      0
    );
    next.executionEvents = appendUniqueEvent(
      next.executionEvents,
      runtimeEvent(
        'WOD_PLAYER_RESUME',
        `wod_resume:${elapsed}`,
        { elapsed_seconds: elapsed }
      ),
      traceOptions
    );
  }

  const previousRounds = Math.max(
    0,
    numeric(previous.completedRounds, 0)
  );
  const nextRounds = Math.max(
    0,
    numeric(next.completedRounds, 0)
  );

  if (
    previous.started &&
    next.started &&
    nextRounds === previousRounds + 1
  ) {
    const cumulative = Math.max(
      0,
      numeric(next.elapsedSeconds, 0)
    );
    const lastSplit =
      next.roundSplits[
        next.roundSplits.length - 1
      ];
    const previousCumulative = Math.max(
      0,
      numeric(
        lastSplit?.cumulative_seconds,
        0
      )
    );
    const splitSeconds = Math.max(
      0,
      cumulative - previousCumulative
    );

    const split = {
      round: nextRounds,
      split_seconds: splitSeconds,
      cumulative_seconds: cumulative,
      source: 'USER_ROUND_COMPLETE',
      controlled_window: true,
    };

    next.roundSplits = [
      ...next.roundSplits,
      split,
    ].slice(-100);

    next.executionEvents = appendUniqueEvent(
      next.executionEvents,
      runtimeEvent(
        'ROUND_COMPLETE',
        `round_complete:${nextRounds}`,
        split
      ),
      traceOptions
    );
  }

  if (
    previous.started &&
    !previous.finished &&
    next.finished
  ) {
    const elapsed = Math.max(
      0,
      numeric(next.elapsedSeconds, 0)
    );
    next.executionEvents = appendUniqueEvent(
      next.executionEvents,
      runtimeEvent(
        'WOD_PLAYER_COMPLETE',
        'wod_player_complete',
        {
          elapsed_seconds: elapsed,
          finish_reason:
            next.finishReason ?? null,
          completed_rounds: nextRounds,
        }
      ),
      traceOptions
    );
  }

  const recordedRounds =
    next.roundSplits.length;
  next.splitCoverage = {
    recorded_rounds: recordedRounds,
    completed_rounds: nextRounds,
    complete:
      nextRounds > 0 &&
      recordedRounds === nextRounds,
    source: 'CONTROLLED_ROUND_INTERACTION',
  };

  return next;
}

function appendSkillCompletionEvents(
  currentWorkout,
  nextExercises,
  existingEvents
) {
  if (!Array.isArray(nextExercises)) {
    return existingEvents;
  }

  const previousByInstance = new Map(
    (currentWorkout?.exercises ?? [])
      .filter(
        (exercise) =>
          exercise.sessionExerciseId
      )
      .map((exercise) => [
        exercise.sessionExerciseId,
        exercise,
      ])
  );

  let events = existingEvents;

  for (const exercise of nextExercises) {
    const instanceId =
      exercise.sessionExerciseId;
    const blockKey = String(
      exercise.blockKey ??
        exercise.block ??
        ''
    ).toLowerCase();
    const previous =
      previousByInstance.get(instanceId);

    if (
      instanceId &&
      blockKey === 'skill' &&
      previous?.status !== 'completed' &&
      exercise.status === 'completed'
    ) {
      events = appendUniqueEvent(
        events,
        runtimeEvent(
          'SKILL_COMPLETE',
          `skill_complete:${instanceId}`,
          {
            session_exercise_id: instanceId,
            exercise_id: exercise.id ?? null,
            source: 'USER_COMPLETION_ACTION',
          }
        ),
        {
          sessionId: currentWorkout?.sessionId,
          blockKey: 'skill',
          sessionExerciseId: instanceId,
          source: 'user_action',
        }
      );
    }
  }

  return events;
}

export function WorkoutProvider({ children }) {
  const [preparation, setPreparation] =
    useState(INITIAL_PREPARATION);
  const [workout, setWorkout] =
    useState(INITIAL_WORKOUT);
  const [completion, setCompletion] =
    useState(INITIAL_COMPLETION);

  const updatePreparation =
    useCallback((values) => {
      setPreparation((current) => ({
        ...current,
        ...values,
      }));
    }, []);

  const setGeneratedWorkout =
    useCallback((generatedWorkout) => {
      setWorkout({
        ...INITIAL_WORKOUT,
        ...generatedWorkout,
        status: 'generated',
      });

      setCompletion(
        INITIAL_COMPLETION
      );
    }, []);

  const setGeneratedWorkoutPreservingProgress =
    useCallback((generatedWorkout) => {
      setWorkout((current) => {
        const sameSession =
          Boolean(current.sessionId) &&
          current.sessionId ===
            generatedWorkout?.sessionId;

        if (!sameSession) {
          return {
            ...INITIAL_WORKOUT,
            ...generatedWorkout,
            status: 'generated',
          };
        }

        const previousByInstance =
          new Map(
            (current.exercises ?? [])
              .filter(
                (exercise) =>
                  exercise.sessionExerciseId
              )
              .map((exercise) => [
                exercise.sessionExerciseId,
                exercise,
              ])
          );

        const nextExercises =
          (generatedWorkout?.exercises ?? [])
            .map((exercise) => {
              const previous =
                previousByInstance.get(
                  exercise.sessionExerciseId
                );

              if (
                !previous ||
                previous.status === 'pending'
              ) {
                return exercise;
              }

              return {
                ...exercise,
                status: previous.status,
                adaptationSource:
                  previous.adaptationSource ??
                  exercise.adaptationSource ??
                  null,
                performanceActualJson:
                  previous.performanceActualJson ??
                  exercise.performanceActualJson ??
                  null,
                repsCompleted:
                  previous.repsCompleted ??
                  exercise.repsCompleted ??
                  null,
                durationSeconds:
                  previous.durationSeconds ??
                  exercise.durationSeconds ??
                  null,
                distanceMeters:
                  previous.distanceMeters ??
                  exercise.distanceMeters ??
                  null,
                rpe:
                  previous.rpe ??
                  exercise.rpe ??
                  null,
                notes:
                  previous.notes ??
                  exercise.notes ??
                  null,
              };
            });

        return {
          ...current,
          ...generatedWorkout,
          status:
            current.sessionStarted
              ? 'in_progress'
              : generatedWorkout?.status ??
                current.status,
          exercises: nextExercises,
          validatedBlocks:
            current.validatedBlocks,
          wodRevealed:
            current.wodRevealed ||
            Boolean(
              generatedWorkout?.wodRevealed
            ),
          wodRuntime:
            current.wodRuntime,
          executionEvents:
            current.executionEvents,
          sessionStarted:
            current.sessionStarted ||
            Boolean(
              generatedWorkout?.sessionStarted
            ),
          startedAt:
            current.startedAt ??
            generatedWorkout?.startedAt ??
            null,
          startedLocalDate:
            current.startedLocalDate ??
            generatedWorkout?.startedLocalDate ??
            null,
        };
      });
    }, []);

  const updateWorkout =
    useCallback((values) => {
      setWorkout((current) => {
        const nextValues = { ...values };
        let executionEvents =
          Array.isArray(current.executionEvents)
            ? current.executionEvents
            : [];

        if (
          Object.prototype.hasOwnProperty.call(
            values,
            'wodRuntime'
          )
        ) {
          nextValues.wodRuntime =
            enrichControlledWodRuntime(
              current.wodRuntime,
              values.wodRuntime,
              current.sessionId
            );
        }

        if (
          Array.isArray(values.exercises)
        ) {
          executionEvents =
            appendSkillCompletionEvents(
              current,
              values.exercises,
              executionEvents
            );
        }

        return {
          ...current,
          ...nextValues,
          executionEvents,
        };
      });
    }, []);

  const updateExercise =
    useCallback((exerciseId, values) => {
      setWorkout((current) => ({
        ...current,
        exercises:
          current.exercises.map(
            (exercise) =>
              exercise.id === exerciseId
                ? {
                    ...exercise,
                    ...values,
                  }
                : exercise
          ),
      }));
    }, []);

  const updateCompletion =
    useCallback((values) => {
      setCompletion((current) => ({
        ...current,
        ...values,
      }));
    }, []);

  const setExerciseLoad =
    useCallback((exerciseId, value) => {
      const changedAt =
        new Date().toISOString();

      setCompletion((current) => ({
        ...current,
        loads: {
          ...current.loads,
          [exerciseId]: value,
        },
        loadMeta: {
          ...current.loadMeta,
          [exerciseId]: {
            source: 'USER_EXPLICIT',
            changedAt,
          },
        },
      }));

      setWorkout((current) => ({
        ...current,
        executionEvents: appendUniqueEvent(
          current.executionEvents,
          {
            event_type: 'LOAD_CHANGE',
            idempotency_key:
              `load_change:${exerciseId}:${changedAt}`,
            occurred_at: changedAt,
            payload: {
              session_exercise_id:
                exerciseId,
              value,
              provenance_class:
                'USER_EXPLICIT',
            },
          },
          {
            sessionId: current.sessionId,
            sessionExerciseId:
              exerciseId,
            source: 'user_action',
          }
        ),
      }));
    }, []);

  const resetWorkout =
    useCallback(() => {
      setPreparation(
        INITIAL_PREPARATION
      );
      setWorkout(INITIAL_WORKOUT);
      setCompletion(
        INITIAL_COMPLETION
      );
    }, []);

  const value = useMemo(
    () => ({
      preparation,
      workout,
      completion,
      updatePreparation,
      setGeneratedWorkout,
      setGeneratedWorkoutPreservingProgress,
      updateWorkout,
      updateExercise,
      updateCompletion,
      setExerciseLoad,
      resetWorkout,
    }),
    [
      preparation,
      workout,
      completion,
      updatePreparation,
      setGeneratedWorkout,
      setGeneratedWorkoutPreservingProgress,
      updateWorkout,
      updateExercise,
      updateCompletion,
      setExerciseLoad,
      resetWorkout,
    ]
  );

  return (
    <WorkoutContext.Provider value={value}>
      {children}
    </WorkoutContext.Provider>
  );
}

export function useWorkout() {
  const context = useContext(
    WorkoutContext
  );

  if (!context) {
    throw new Error(
      'useWorkout must be used inside WorkoutProvider'
    );
  }

  return context;
}
