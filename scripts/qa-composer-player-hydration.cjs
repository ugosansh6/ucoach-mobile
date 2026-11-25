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
  '\nthis.tested = { hasPlayableSessionBlocks, playerSessionNeedsReload, resolveControlResumeSessionId };',
  context
);
const { hasPlayableSessionBlocks, playerSessionNeedsReload, resolveControlResumeSessionId } = context.tested;

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

assert.equal(
  resolveControlResumeSessionId({
    controlStatus: 'COMPOSER_OTHER_SESSION_ACTIVE', sessionId: 'other-session',
  }, 'stale-workout'),
  'other-session', 'Use exact backend identity for Composer conflict'
);
assert.equal(
  resolveControlResumeSessionId({ controlStatus: 'COMPOSER_OTHER_SESSION_ACTIVE' }, 'stale-workout'),
  null, 'Never resume stale workout without a conflict session id'
);
assert.equal(
  resolveControlResumeSessionId({ controlStatus: 'STARTED_SESSION_CONFIRM_REQUIRED', sessionId: 'started-session' }, 'stale-workout'),
  'started-session', 'Preserve started session identity'
);
assert.equal(
  resolveControlResumeSessionId({ controlStatus: 'SAFETY_ADAPT_PARTIAL_RECALC_REQUIRED' }, 'current-session'),
  'current-session', 'Ordinary current-session resume remains possible'
);

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
assert.match(generation, /resolveControlResumeSessionId\(control, workout\?\.sessionId\)/,
  'Resume target is resolved from backend status');
assert.match(generation, /params: \{ sessionId: resumeSessionId \}/,
  'Conflict route transports the chosen session identity');
assert.match(generation, /!error && resumeSessionId/,
  'No resume button when conflict session id is missing');
console.log('PASS: Composer Player bootstrap, conflict resume, preserved structures and rehydration');
