#!/usr/bin/env node
'use strict';

// #3: deterministic tests for player bootstrap after Composer Day-J finalization.
// No backend, user account or persistent session mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repoRoot = path.resolve(__dirname, '..');
const helper = fs.readFileSync(path.join(repoRoot, 'src/utils/playerSessionHydration.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(
  helper.replaceAll('export function ', 'function ') +
  '\nthis.tested = { hasPlayableSessionBlocks, playerSessionNeedsReload };',
  context
);
const { hasPlayableSessionBlocks, playerSessionNeedsReload } = context.tested;

const strength = {
  sessionId: 'composer-1',
  meta: { source: 'w11_composer', environment_code: 'HOME' },
  rawBlocks: [{ block_key: 'strength', exercises: [{ exercise_id: 'EX006' }] }],
  exercises: [{ id: 'EX006', blockKey: 'strength' }],
};
const mixed = {
  ...strength,
  rawBlocks: [
    { block_key: 'strength', exercises: [{ exercise_id: 'EX006' }] },
    { block_key: 'wod', exercises: [{ exercise_id: 'EX033' }] },
  ],
};
assert.equal(hasPlayableSessionBlocks(strength), true, 'Strength-only HOME is playable');
assert.equal(hasPlayableSessionBlocks(mixed), true, 'Composer chosen Strength+WOD is playable');
assert.equal(hasPlayableSessionBlocks({ ...mixed, rawBlocks: [], blocks: {}, exercises: [] }), false,
  'A bare session id is not playable');
assert.equal(hasPlayableSessionBlocks({ ...mixed, rawBlocks: [], blocks: {}, exercises: [{ id: 'EX006' }] }), false,
  'Persisted exercises without blocks do not fake a player');
assert.equal(playerSessionNeedsReload(strength, 'composer-1'), false, 'Loaded session is reused');
assert.equal(playerSessionNeedsReload(strength, 'composer-2'), true, 'A different session must reload');
assert.equal(playerSessionNeedsReload({ ...strength, rawBlocks: [], blocks: {} }, 'composer-1'), true,
  'Missing runtime blocks cause rehydration');
assert.equal(playerSessionNeedsReload({}, 'composer-1'), true, 'Browser refresh needs server rehydration');

const session = fs.readFileSync(path.join(repoRoot, 'app/workout/session.js'), 'utf8');
const generation = fs.readFileSync(path.join(repoRoot, 'app/workout/generating-themed.js'), 'utf8');
const preparation = fs.readFileSync(path.join(repoRoot, 'src/workout/PreparationCheckinV4.js'), 'utf8');
assert.match(session, /useLocalSearchParams/, 'Player receives sessionId from route');
assert.match(session, /reloadWorkoutSession\(/, 'Player reloads exact persisted workout');
assert.match(session, /playerDataReady/, 'Player waits for hydrated blocks');
assert.match(generation, /params: \{ sessionId: nextWorkout.sessionId \}/,
  'Generating route carries canonical sessionId');
assert.match(generation, /composerPlanItemId && !hasPlayableSessionBlocks\(nextWorkout\)/,
  'Composer fails closed rather than navigate to empty player');
assert.match(preparation, /params: \{ sessionId: workout.sessionId \}/,
  'Resume route carries canonical sessionId');
console.log('PASS: Composer Player bootstrap, preserved structures and rehydration');
