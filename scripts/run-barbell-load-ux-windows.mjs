import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const target = path.join(root, 'app/profile/equipment.js');
const patch = path.join(root, 'scripts/apply-barbell-load-ux-v1.mjs');

if (!fs.existsSync(target)) {
  throw new Error('Fichier introuvable: app/profile/equipment.js');
}

if (!fs.existsSync(patch)) {
  throw new Error('Fichier introuvable: scripts/apply-barbell-load-ux-v1.mjs');
}

const original = fs.readFileSync(target, 'utf8');
const usesCrLf = original.includes('\r\n');

try {
  // Le patch V1 travaille sur une représentation LF stable.
  const normalized = original.replace(/\r\n/g, '\n');
  fs.writeFileSync(target, normalized, 'utf8');

  const patchUrl = `${pathToFileURL(patch).href}?run=${Date.now()}`;
  await import(patchUrl);

  // On restitue le style Windows du fichier si nécessaire.
  if (usesCrLf) {
    const patched = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(target, patched.replace(/\n/g, '\r\n'), 'utf8');
  }

  console.log('✅ Lanceur Windows terminé sans erreur.');
} catch (error) {
  fs.writeFileSync(target, original, 'utf8');
  console.error('❌ Patch annulé : le fichier original a été restauré.');
  throw error;
}
