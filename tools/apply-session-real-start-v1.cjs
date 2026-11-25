const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'workout', 'session.js');

if (!fs.existsSync(filePath)) {
  console.error('ERROR: app/workout/session.js introuvable.');
  process.exit(1);
}

let source = fs.readFileSync(filePath, 'utf8');

const oldEffect = `useEffect(() => {
  if (!workout.sessionId) {
    return undefined;
  }

  let cancelled = false;

  async function markStarted() {
    try {
      const result =
        await markWorkoutSessionStarted({
          sessionId: workout.sessionId,
        });

      if (
        !cancelled &&
        result?.status ===
          'STALE_SESSION_REQUIRES_RECHECKIN'
      ) {
        router.replace(
          '/workout/preparation'
        );
      }
    } catch (error) {
      console.warn(
        'Session start marker',
        error
      );
    }
  }

  markStarted();

  return () => {
    cancelled = true;
  };
}, [workout.sessionId]);`;

const newStartLogic = `const sessionStartedRef = useRef(false);

  const ensureSessionStarted =
    useCallback(() => {
      if (
        sessionStartedRef.current ||
        !workout.sessionId
      ) {
        return;
      }

      sessionStartedRef.current = true;

      markWorkoutSessionStarted({
        sessionId: workout.sessionId,
      })
        .then((result) => {
          if (
            result?.status ===
            'STALE_SESSION_REQUIRES_RECHECKIN'
          ) {
            router.replace(
              '/workout/preparation'
            );
          }
        })
        .catch((error) => {
          sessionStartedRef.current = false;
          console.warn(
            'Session start marker',
            error
          );
        });
    }, [workout.sessionId]);`;

if (!source.includes(oldEffect)) {
  console.error('ERROR: ancien marquage automatique de debut de seance introuvable. Aucun fichier modifie.');
  process.exit(1);
}

source = source.replace(oldEffect, newStartLogic);

const selectNeedle = `  function selectExerciseStatus(status) {
    const exercise =
      statusModalExercise?.exercise;

    if (!exercise) {
      return;
    }

    replaceExercise(exercise, {
      status,
    });`;

const selectReplacement = `  function selectExerciseStatus(status) {
    const exercise =
      statusModalExercise?.exercise;

    if (!exercise) {
      return;
    }

    ensureSessionStarted();

    replaceExercise(exercise, {
      status,
    });`;

if (!source.includes(selectNeedle)) {
  console.error('ERROR: selectExerciseStatus exact introuvable. Aucun fichier modifie.');
  process.exit(1);
}
source = source.replace(selectNeedle, selectReplacement);

const blockNeedle = `    if (blockExercises.length === 0) {
      return;
    }

    const hasPending =`;
const blockReplacement = `    if (blockExercises.length === 0) {
      return;
    }

    ensureSessionStarted();

    const hasPending =`;

if (!source.includes(blockNeedle)) {
  console.error('ERROR: toggleBlockExerciseSelection exact introuvable. Aucun fichier modifie.');
  process.exit(1);
}
source = source.replace(blockNeedle, blockReplacement);

const validateNeedle = `    if (!block) {
      return;
    }

    const finalizedExercises =`;
const validateReplacement = `    if (!block) {
      return;
    }

    ensureSessionStarted();

    const finalizedExercises =`;

if (!source.includes(validateNeedle)) {
  console.error('ERROR: validateBlock exact introuvable. Aucun fichier modifie.');
  process.exit(1);
}
source = source.replace(validateNeedle, validateReplacement);

fs.writeFileSync(filePath, source, 'utf8');

console.log('SESSION REAL START V1 APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/session.js');
console.log('Behavior: opening/reviewing a generated session no longer marks it in_progress.');
console.log('Session starts only when the user records execution: exercise status, block selection, or TERMINER.');
console.log('Result: before real execution, returning to Preparation and regenerating with changed parameters rebuilds the session.');
console.log('Safety: once real execution starts, backend freeze semantics remain unchanged to protect workout progress.');