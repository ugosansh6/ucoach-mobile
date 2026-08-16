import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

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
  notes: '',
  exerciseFeedback: {},
  protocolFeedback: {},
};

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
      setWorkout((current) => ({
        ...current,
        ...values,
      }));
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
      setCompletion((current) => ({
        ...current,
        loads: {
          ...current.loads,
          [exerciseId]: value,
        },
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