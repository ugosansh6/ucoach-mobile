const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sessionPath = path.join(root, 'app', 'workout', 'session.js');

const raw = fs.readFileSync(sessionPath, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const current = `  function handleBack() {\n    if (router.canGoBack()) {\n      router.back();\n      return;\n    }\n\n    router.replace('/workout/preparation');\n  }`;

const replacement = `  function handleBack() {\n    // Session -> paramètres de séance, quel que soit l'historique de navigation.\n    // On évite router.back(), qui peut renvoyer directement au dashboard\n    // après un replace/deep-link Expo Go.\n    router.replace('/workout/preparation');\n  }`;

if (!text.includes(current)) {
  if (text.includes(replacement)) {
    console.log('SESSION BACK TO PREPARATION PATCH ALREADY APPLIED');
    process.exit(0);
  }

  throw new Error('Bloc handleBack attendu introuvable dans app/workout/session.js');
}

text = text.replace(current, replacement);
fs.writeFileSync(sessionPath, text.replace(/\n/g, eol), 'utf8');

console.log('SESSION BACK TO PREPARATION PATCH APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/session.js');
console.log('Navigation: session back arrow now always returns to /workout/preparation.');
console.log('No workout/session data is reset by this navigation change.');
