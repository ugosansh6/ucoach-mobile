const fs = require('fs');
const path = require('path');

const root = process.cwd();

function patchFile(relativePath, replacements) {
  const filePath = path.join(root, relativePath);
  let source = fs.readFileSync(filePath, 'utf8');

  for (const { from, to, expected = 1 } of replacements) {
    const count = source.split(from).length - 1;
    if (count !== expected) {
      throw new Error(`${relativePath}: expected ${expected} occurrence(s) of ${JSON.stringify(from)}, found ${count}`);
    }
    source = source.split(from).join(to);
  }

  fs.writeFileSync(filePath, source, 'utf8');
  console.log(`patched ${relativePath}`);
}

patchFile('src/components/workout/WodProtocolPlayer.js', [
  {
    from: "          {mechanic === 'STRENGTH' ? (",
    to: "          {mechanic === 'STRENGTH' || mechanic === 'SETS_REPS' ? (",
  },
  {
    from: "    STRENGTH: 'MUSCULATION',",
    to: "    STRENGTH: 'MUSCULATION',\n    SETS_REPS: 'SÉRIES / REPS',",
  },
]);

patchFile('src/services/workoutService.js', [
  {
    from: "    STRENGTH: 'MUSCULATION',",
    to: "    STRENGTH: 'MUSCULATION',\n    SETS_REPS: 'SÉRIES / REPS',",
  },
  {
    from: "  if (mechanic === 'STRENGTH') {",
    to: "  if (mechanic === 'STRENGTH' || mechanic === 'SETS_REPS') {",
  },
]);

console.log('M1 SETS_REPS front compatibility applied.');
