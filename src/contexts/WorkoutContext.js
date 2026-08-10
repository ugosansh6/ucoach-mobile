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
  plannedDuration: null,
  blocks: {},
  rawBlocks: [],
  exercises: [],
  meta: {},
  preparationSnapshot: null,
};

const INITIAL_COMPLETION = {
  formAfter: null,
  rpe: null,
  loads: {},
  notes: '',
};

export function WorkoutProvider({
  children,
}) {
  const [
    preparation,
    setPreparation,
  ] = useState(
    INITIAL_PREPARATION
  );

  const [
    workout,
    setWorkout,
  ] = useState(
    INITIAL_WORKOUT
  );

  const [
    completion,
    setCompletion,
  ] = useState(
    INITIAL_COMPLETION
  );

  const updatePreparation =
    useCallback((values) => {
      setPreparation(
        (current) => ({
          ...current,
          ...values,
        })
      );
    }, []);

  const setGeneratedWorkout =
    useCallback(
      (generatedWorkout) => {
        setWorkout({
          ...INITIAL_WORKOUT,
          ...generatedWorkout,
          status: 'generated',
        });
      },
      []
    );

  const updateWorkout =
    useCallback((values) => {
      setWorkout(
        (current) => ({
          ...current,
          ...values,
        })
      );
    }, []);

  const updateExercise =
    useCallback(
      (
        exerciseId,
        values
      ) => {
        setWorkout(
          (current) => ({
            ...current,

            exercises:
              current.exercises.map(
                (exercise) =>
                  exercise.id ===
                  exerciseId
                    ? {
                        ...exercise,
                        ...values,
                      }
                    : exercise
              ),
          })
        );
      },
      []
    );

  const updateCompletion =
    useCallback((values) => {
      setCompletion(
        (current) => ({
          ...current,
          ...values,
        })
      );
    }, []);

  const setExerciseLoad =
    useCallback(
      (
        exerciseId,
        value
      ) => {
        setCompletion(
          (current) => ({
            ...current,

            loads: {
              ...current.loads,
              [exerciseId]:
                value,
            },
          })
        );
      },
      []
    );

  const resetWorkout =
    useCallback(() => {
      setPreparation(
        INITIAL_PREPARATION
      );

      setWorkout(
        INITIAL_WORKOUT
      );

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
      updateWorkout,
      updateExercise,
      updateCompletion,
      setExerciseLoad,
      resetWorkout,
    ]
  );

  return (
    <WorkoutContext.Provider
      value={value}
    >
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