#!/usr/bin/env node
'use strict';
// #3: user-authored WOD is visible without mutating the backend lifecycle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/utils/sessionWodVisibility.js'), 'utf8');
const { isUserComposedSession, shouldShowWodContent } =
  new Function(source.replaceAll('export function ', 'function ') +
    '\nreturn {isUserComposedSession,shouldShowWodContent};')();
const composer = { meta: { source: 'w11_composer' }, wodRevealed: false };
const coach = { meta: { source: 'c4_auto' }, wodRevealed: false };
assert.equal(isUserComposedSession(composer), true);
assert.equal(shouldShowWodContent(composer, { lifecycleReady: false }), true);
assert.equal(shouldShowWodContent(composer, { lifecycleReady: true }), true);
assert.equal(isUserComposedSession(coach), false);
assert.equal(shouldShowWodContent(coach, { lifecycleReady: false }), false);
assert.equal(shouldShowWodContent(coach, { lifecycleReady: true }), false);
assert.equal(shouldShowWodContent({ ...coach, wodRevealed: true }, { lifecycleReady: false }), false);
assert.equal(shouldShowWodContent({ ...coach, wodRevealed: true }, { lifecycleReady: true }), true);
assert.equal(shouldShowWodContent({}, { lifecycleReady: true }), false);
const overview = fs.readFileSync(path.join(__dirname, '../src/components/workout/SessionOverviewSheet.js'), 'utf8');
const player = fs.readFileSync(path.join(__dirname, '../app/workout/environment-session-core.js'), 'utf8');
assert.match(overview, /const wodContentVisible = shouldShowWodContent\(workout, \{ lifecycleReady \}\)/);
assert.match(overview, /const maskedWod = block.key === 'wod' && !wodContentVisible/);
assert.match(player, /const userComposedWod = isUserComposedSession\(workout\)/);
assert.match(player, /wodBlock && !wodContentVisible/);
const lifecycle = player.slice(player.indexOf('const ensureWodStarted = useCallback('),
  player.indexOf('const handleWodRuntimeChange = useCallback('));
assert.match(lifecycle, /if \(!wodRevealed && !userComposedWod\)/);
assert.match(lifecycle, /if \(!wodRevealed && userComposedWod\)/);
assert.ok(lifecycle.indexOf('markWorkoutWodRevealed(') < lifecycle.indexOf('markWorkoutWodStarted('));
assert.match(lifecycle, /wodStartPromise.current = request/);
console.log('PASS: composed WOD visible; automatic WOD protected; backend start sequence intact');
