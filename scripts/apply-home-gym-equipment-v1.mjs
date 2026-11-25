import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, 'utf8');
}

function ensureSetEntry(source, setName, id, comment) {
  const startMarker = `const ${setName} = new Set([`;
  const start = source.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`Bloc ${setName} introuvable`);
  }

  const end = source.indexOf(']);', start);
  if (end < 0) {
    throw new Error(`Fin du bloc ${setName} introuvable`);
  }

  const block = source.slice(start, end);
  if (block.includes(`'${id}'`)) {
    return source;
  }

  const insertion = `  '${id}', // ${comment}\n`;
  return source.slice(0, end) + insertion + source.slice(end);
}

const files = [
  'app/profile/equipment.js',
  'app/workout/preparation.js',
];

for (const rel of files) {
  if (!fs.existsSync(path.join(root, rel))) {
    throw new Error(`Fichier introuvable: ${rel}`);
  }
}

let equipment = read('app/profile/equipment.js');
equipment = ensureSetEntry(
  equipment,
  'FIXED_LOAD_CAPABLE_IDS',
  'E14',
  'Barre olympique + disques'
);
equipment = ensureSetEntry(
  equipment,
  'ADJUSTABLE_LOAD_CAPABLE_IDS',
  'E14',
  'Barre olympique + disques'
);
write('app/profile/equipment.js', equipment);

let preparation = read('app/workout/preparation.js');
preparation = ensureSetEntry(
  preparation,
  'LOAD_CAPABLE_EQUIPMENT_IDS',
  'E14',
  'Barre olympique + disques'
);
write('app/workout/preparation.js', preparation);

console.log('✅ Patch matériel home-gym appliqué.');
console.log('Fichiers modifiés:');
console.log(' - app/profile/equipment.js');
console.log(' - app/workout/preparation.js');
console.log('');
console.log('Nouveaux matériels du catalogue Supabase:');
console.log(' - Barres parallèles / station dips');
console.log(' - Barre olympique + disques');
console.log(' - Rameur');
console.log(' - Vélo / Bike');
console.log(' - Air Bike / Assault Bike');
console.log(' - Espalier');
