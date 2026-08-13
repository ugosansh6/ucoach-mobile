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
  const formatter = [
    'function formatExerciseDetailText(value) {',
    "  if (typeof value !== 'string') {",
    "    return value ?? '';",
    '  }',
    '',
    '  return value',
    '    // Certaines descriptions viennent de la base avec des "\\\\n" littéraux.',
    '    // On les transforme en vrais retours à la ligne pour React Native.',
    "    .replace(/\\\\r\\\\n|\\\\n|\\\\r/g, '\\n')",
    "    .replace(/\\r\\n?/g, '\\n')",
    '    // Normalise les étapes : "2 texte", "2) texte", "2- texte" -> "2. texte".',
    "    .replace(/(^|\\n)\\s*(\\d+)[.)-]?\\s+/g, (_, prefix, number) =>",
    "      prefix + number + '. '",
    '    )',
    "    .replace(/\\n{3,}/g, '\\n\\n')",
    '    .trim();',
    '}',
    '',
    'function normalizeBlockId(value) {',
    '',
  ].join('\n');

  session = replaceOnce(
    session,
    'function normalizeBlockId(value) {\n',
    formatter,
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
console.log('Formatting: literal \\n -> real line breaks, numbered steps -> "1. / 2. / 3."');
