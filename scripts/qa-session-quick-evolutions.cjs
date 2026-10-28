const assert = require('node:assert/strict');
const fs = require('node:fs');
const shell = fs.readFileSync('app/workout/session.js', 'utf8');
const normalize = shell.slice(shell.indexOf('function normalizeBlock('), shell.indexOf('function exerciseHasRecordedResult('));
const route = new Function('environmentCode', 'workout', normalize + '\nreturn (' + shell.match(/const usesSpecializedEnvironmentRuntime\s*=([\s\S]*?);/)[1] + ');');
assert.equal(route('HOME', { rawBlocks: [{ block_key: 'strength' }] }), true);
assert.equal(route('BOX', { exercises: [{ blockKey: 'strength' }] }), true);
assert.equal(route('HOME', { rawBlocks: [{ block_key: 'skill' }, { block_key: 'wod' }] }), false);
const player = fs.readFileSync('app/workout/session-focused-core.js', 'utf8');
const body = player.slice(player.indexOf('  async function completeCurrentExercise()'), player.indexOf('  function saveSkillScore()'));
const make = new Function('scope', `with(scope) { ${body}; return completeCurrentExercise; }`);
let finished = 0;
const scope = {
  activeBlock: { id: 'warmup', exercises: [{}, {}] },
  activeExercise: { prescriptionJson: { warmup_rounds: 3 } },
  activeExerciseIndex: 0, workout: { sessionId: 'test' },
  ensureSessionStarted: async () => {},
  prescriptionObject: (e) => e.prescriptionJson,
  updateWorkout: (patch) => Object.assign(scope.workout, patch),
  setExerciseIndexes: () => { scope.activeExerciseIndex = 0; },
  moveExercise: () => { scope.activeExerciseIndex++; },
  patchExercise: () => {},
  completeBlock: async () => { finished++; },
};
(async () => {
  const complete = make(scope);
  for (let step = 0; step < 5; step++) { await complete(); assert.equal(finished, 0); }
  await complete(); assert.equal(finished, 1);
  assert.equal(scope.workout.warmupRuntime.round, 3);
  console.log('PASS native Strength routing and all three warm-up rounds');
})().catch((error) => { console.error(error); process.exit(1); });
