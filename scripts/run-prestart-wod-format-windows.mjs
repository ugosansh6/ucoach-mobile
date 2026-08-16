import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const sourcePath = path.join(
  root,
  'scripts/apply-prestart-wod-format-v2.mjs'
);
const tempPath = path.join(
  root,
  'scripts/.apply-prestart-wod-format-v2-windows.tmp.mjs'
);

if (!fs.existsSync(sourcePath)) {
  throw new Error(
    'Script source introuvable: scripts/apply-prestart-wod-format-v2.mjs'
  );
}

const source = fs.readFileSync(sourcePath, 'utf8');
const before = "  return fs.readFileSync(file, 'utf8');";
const after =
  "  return fs.readFileSync(file, 'utf8').replace(/\\r\\n/g, '\\n');";

if (!source.includes(before)) {
  throw new Error(
    'Le script source a changé: adaptation Windows impossible sans nouvelle inspection.'
  );
}

const patchedSource = source.replace(before, after);

try {
  fs.writeFileSync(tempPath, patchedSource, 'utf8');
  await import(`${pathToFileURL(tempPath).href}?t=${Date.now()}`);
} finally {
  if (fs.existsSync(tempPath)) {
    fs.unlinkSync(tempPath);
  }
}
