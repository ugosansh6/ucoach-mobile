const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const filePath = path.join(root, 'app', 'workout', 'preparation.js');

const raw = fs.readFileSync(filePath, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const before = `  function handleBack() {\n    router.back();\n  }`;
const after = `  function handleBack() {\n    if (router.canGoBack()) {\n      router.back();\n      return;\n    }\n\n    router.replace('/(tabs)');\n  }`;

if (!text.includes(after)) {
  if (!text.includes(before)) {
    throw new Error('Bloc attendu introuvable : preparation / handleBack');
  }

  text = text.replace(before, after);
}

fs.writeFileSync(filePath, text.replace(/\n/g, eol), 'utf8');

console.log('PREPARATION BACK PATCH APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/preparation.js');
console.log('Navigation: history when available, dashboard fallback otherwise.');
