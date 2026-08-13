const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sessionPath = path.join(root, 'app', 'workout', 'session.js');

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

let session = readNormalized(sessionPath);

if (!session.includes('function formatExerciseDetailText(value) {')) {
  session = replaceOnce(
    session,
    'function normalizeBlockId(value) {\n',
    `function formatExerciseDetailText(value) {\n  if (typeof value !== 'string') {\n    return value ?? '';\n  }\n\n  return value\n    // Certaines descriptions viennent de la base avec des "\\\\n" littéraux.\n    // On les transforme en vrais retours à la ligne pour React Native.\n    .replace(/\\\\r\\\\n|\\\\n|\\\\r/g, '\\n')\n    .replace(/\\r\\n?/g, '\\n')\n    // Normalise les étapes : "2 texte", "2) texte", "2- texte" -> "2. texte".\n    .replace(/(^|\\n)\\s*(\\d+)[.)-]?\\s+/g, (_, prefix, number) =>\n      \\`\\${prefix}\\${number}. \\`\n    )\n    .replace(/\\n{3,}/g, '\\n\\n')\n    .trim();\n}\n\nfunction normalizeBlockId(value) {\n`,
    'session / detail text formatter'
  );
}

const replacements = [
  ['{exercise.description}', '{formatExerciseDetailText(exercise.description)}', 'description'],
  ['{exercise.instructions}', '{formatExerciseDetailText(exercise.instructions)}', 'instructions'],
  ['{exercise.tips}', '{formatExerciseDetailText(exercise.tips)}', 'tips'],
];

for (const [search, replacement, label] of replacements) {
  if (!session.includes(replacement)) {
    session = replaceOnce(
      session,
      search,
      replacement,
      `session / ${label} formatting`
    );
  }
}

writePreservingWindows(sessionPath, session);

console.log('SESSION DETAIL FORMAT PATCH APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/session.js');
console.log('Formatting: \\n -> real line breaks, numbered steps -> "1. / 2. / 3."');
