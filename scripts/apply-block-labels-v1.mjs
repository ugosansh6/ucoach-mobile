import fs from 'node:fs';
import path from 'node:path';

const file = path.join(
  process.cwd(),
  'src/services/workoutService.js'
);

if (!fs.existsSync(file)) {
  throw new Error(
    'Fichier introuvable: src/services/workoutService.js'
  );
}

const source = fs.readFileSync(file, 'utf8');

const pattern = /      title:\r?\n        block\.block_name \?\?\r?\n        block\.block_key,/g;
const matches = [...source.matchAll(pattern)];

if (matches.length !== 1) {
  throw new Error(
    `Patch impossible: bloc title attendu ${matches.length} fois au lieu de 1. Aucun fichier modifié.`
  );
}

const newline = source.includes('\r\n') ? '\r\n' : '\n';
const replacement = [
  '      title:',
  "        block.block_key === 'tabata'",
  "          ? 'Tabata'",
  "          : block.block_key === 'warmup' ||",
  "              block.block_key === 'warm_up'",
  "            ? 'Warm-up'",
  '            : block.block_name ??',
  '              block.block_key,',
].join(newline);

const next = source.replace(pattern, replacement);

fs.writeFileSync(file, next, 'utf8');

console.log('✅ Libellés blocs mis à jour.');
console.log(' - TABATA CORE → TABATA');
console.log(' - WARM-UP SPÉCIFIQUE → WARM-UP');
console.log('Moteur et block_key inchangés.');
