import fs from 'node:fs';

const path = 'app/workout/session-focused-core.js';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`PLAY-012 patch target not found: ${label}`);
  }
  source = source.replace(search, replacement);
}

replaceOnce(
`  const imageUri = exerciseImageUri(activeExercise);\n  const cue = shortCue(activeExercise);\n  const swapItem = activeExercise?.sessionExerciseId`,
`  const imageUri = exerciseImageUri(activeExercise);\n  const cue = shortCue(activeExercise);\n  const exercisePrescription =\n    activeBlock?.id === 'skill' && activeBlock?.structure\n      ? activeBlock.structure\n      : activeExercise?.prescription ?? null;\n  const objectiveText =\n    activeBlock?.id === 'skill'\n      ? activeBlock?.skillContract?.success_signal ??\n        prescriptionObject(activeExercise)?.curriculum_success_signal ??\n        activeExercise?.expected_outcome?.success_signal ??\n        null\n      : activeBlock?.objective ?? null;\n  const swapItem = activeExercise?.sessionExerciseId`,
  'derived skill copy'
);

replaceOnce(
`              {activeExercise?.prescription ? (\n                <Text style={styles.exercisePrescription}>{String(activeExercise.prescription)}</Text>\n              ) : null}`,
`              {exercisePrescription ? (\n                <Text style={styles.exercisePrescription}>{String(exercisePrescription)}</Text>\n              ) : null}`,
  'exercise prescription'
);

replaceOnce(
`              {activeBlock.objective ? (\n                <View style={styles.objectiveBox}>\n                  <Text style={styles.objectiveLabel}>Objectif</Text>\n                  <Text style={styles.objectiveText}>{activeBlock.objective}</Text>\n                </View>\n              ) : null}`,
`              {objectiveText ? (\n                <View style={styles.objectiveBox}>\n                  <Text style={styles.objectiveLabel}>Objectif du jour</Text>\n                  <Text style={styles.objectiveText}>{objectiveText}</Text>\n                </View>\n              ) : null}`,
  'skill objective'
);

fs.writeFileSync(path, source);
