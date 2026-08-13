const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sessionPath = path.join(root, 'app', 'workout', 'session.js');

const raw = fs.readFileSync(sessionPath, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let session = raw.replace(/\r\n/g, '\n');

const oldBlock = `      {exercise.instructions ? (\n        <Text style={styles.currentExerciseInstructions}>\n          {exercise.instructions}\n        </Text>\n      ) : null}`;

const newBlock = `      {exercise.instructions ? (\n        <Text style={styles.currentExerciseInstructions}>\n          {formatExerciseDetailText(\n            exercise.instructions\n          )}\n        </Text>\n      ) : null}`;

if (session.includes(newBlock)) {
  console.log('CURRENT EXERCISE TEXT FORMAT ALREADY APPLIED');
  process.exit(0);
}

if (!session.includes('function formatExerciseDetailText(value) {')) {
  throw new Error('Formatter formatExerciseDetailText introuvable dans session.js');
}

if (!session.includes(oldBlock)) {
  throw new Error('Bloc CurrentExerciseCard attendu introuvable');
}

session = session.replace(oldBlock, newBlock);
fs.writeFileSync(sessionPath, session.replace(/\n/g, eol), 'utf8');

console.log('CURRENT EXERCISE TEXT FORMAT PATCH APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/session.js');
console.log('Current exercise instructions now use real line breaks and numbered steps.');
