const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'workout', 'session.js');

if (!fs.existsSync(filePath)) {
  console.error('ERROR: app/workout/session.js introuvable.');
  process.exit(1);
}

let source = fs.readFileSync(filePath, 'utf8');
let changed = false;

function fail(message) {
  console.error(`ERROR: ${message} Aucun fichier modifie.`);
  process.exit(1);
}

// 1) Remplacer le marquage automatique au montage par un demarrage explicite.
if (!source.includes('const ensureSessionStarted =')) {
  const callIndex = source.indexOf('await markWorkoutSessionStarted({');

  if (callIndex === -1) {
    fail("appel automatique markWorkoutSessionStarted introuvable et ensureSessionStarted absent.");
  }

  const effectStart = source.lastIndexOf('useEffect(() => {', callIndex);
  const dependencyMarker = '}, [workout.sessionId]);';
  const effectEndMarker = source.indexOf(dependencyMarker, callIndex);

  if (effectStart === -1 || effectEndMarker === -1) {
    fail("bloc useEffect de demarrage de session introuvable autour de markWorkoutSessionStarted.");
  }

  const effectEnd = effectEndMarker + dependencyMarker.length;
  const oldEffect = source.slice(effectStart, effectEnd);

  if (!oldEffect.includes('markWorkoutSessionStarted')) {
    fail("le bloc useEffect detecte ne contient pas le marquage de debut attendu.");
  }

  const newStartLogic = `const sessionStartedRef = useRef(false);\n\n  useEffect(() => {\n    sessionStartedRef.current = false;\n  }, [workout.sessionId]);\n\n  const ensureSessionStarted =\n    useCallback(() => {\n      if (\n        sessionStartedRef.current ||\n        !workout.sessionId\n      ) {\n        return;\n      }\n\n      sessionStartedRef.current = true;\n\n      markWorkoutSessionStarted({\n        sessionId: workout.sessionId,\n      })\n        .then((result) => {\n          if (\n            result?.status ===\n              'STALE_SESSION_REQUIRES_RECHECKIN'\n          ) {\n            router.replace(\n              '/workout/preparation'\n            );\n          }\n        })\n        .catch((error) => {\n          sessionStartedRef.current = false;\n          console.warn(\n            'Session start marker',\n            error\n          );\n        });\n    }, [workout.sessionId]);`;

  source =
    source.slice(0, effectStart) +
    newStartLogic +
    source.slice(effectEnd);
  changed = true;
}

function functionSlice(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) {
    fail(`fonction ${name} introuvable.`);
  }

  const nextFunction = source.indexOf('\n  function ', start + 1);
  const returnIndex = source.indexOf('\n  return (', start + 1);
  const candidates = [nextFunction, returnIndex]
    .filter((value) => value !== -1 && value > start);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;

  return { start, end, text: source.slice(start, end) };
}

function insertBeforeInFunction(name, needle, insertion) {
  const part = functionSlice(name);

  if (part.text.includes('ensureSessionStarted();')) {
    return;
  }

  const localIndex = part.text.indexOf(needle);
  if (localIndex === -1) {
    fail(`point d'insertion ${name} introuvable.`);
  }

  const absoluteIndex = part.start + localIndex;
  source =
    source.slice(0, absoluteIndex) +
    insertion +
    source.slice(absoluteIndex);
  changed = true;
}

// 2) Une action d'execution = vrai debut de seance.
insertBeforeInFunction(
  'selectExerciseStatus',
  '    replaceExercise(exercise, {',
  '    ensureSessionStarted();\n\n'
);

insertBeforeInFunction(
  'toggleBlockExerciseSelection',
  '    const hasPending =',
  '    ensureSessionStarted();\n\n'
);

insertBeforeInFunction(
  'validateBlock',
  '    const finalizedExercises =',
  '    ensureSessionStarted();\n\n'
);

if (!changed) {
  console.log('SESSION REAL START V2 ALREADY APPLIED');
  console.log('No file changed.');
  process.exit(0);
}

fs.writeFileSync(filePath, source, 'utf8');

console.log('SESSION REAL START V2 APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/session.js');
console.log('Opening/reviewing a generated session no longer marks it in_progress.');
console.log('Real start occurs only on execution input: exercise status, block selection, or TERMINER.');
console.log('Before real start, changed Preparation parameters can rebuild the workout.');