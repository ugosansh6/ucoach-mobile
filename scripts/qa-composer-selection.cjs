#!/usr/bin/env node
'use strict';

/**
 * Pure, deterministic Composer default-selection regression tests.
 * Load the actual exported functions from composerService.js without network,
 * authentication or a Supabase test account. Expo Web builds run separately.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const service = fs.readFileSync(path.join(__dirname, '../src/services/composerService.js'), 'utf8');
function section(start, end) {
  const from = service.indexOf(start), to = service.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Missing tested service implementation: ' + start);
  return service.slice(from, to).replaceAll('export function ', 'function ');
}
const tested = [
  section('function wodLabel(minutes)', 'function block(type'),
  section('function block(type', '/**\n * MSW-036'),
  section('export function rankComposerCandidates', 'export async function getComposerStrengthAutoPick'),
].join('\n');
const context = vm.createContext({});
vm.runInContext(tested + '\nglobalThis.tested = { buildComposerArchitectures, composerBlockDisplayLabel, composerArchitectureDisplayTitle, composerArchitecturePurpose, composerExerciseSlotLimit, rankComposerCandidates, selectComposerDefaultExercises };', context);
const {
  buildComposerArchitectures,
  composerBlockDisplayLabel,
  composerArchitectureDisplayTitle,
  composerArchitecturePurpose,
  composerExerciseSlotLimit,
  rankComposerCandidates,
  selectComposerDefaultExercises,
} = context.tested;

const push = { id: 'push', name: 'Push-ups', movementPattern: 'Push Horizontal', score: 100, exerciseFamily: 'push' };
const diamond = { id: 'diamond', name: 'Pompe diamant', movementPattern: 'Push Horizontal', score: 96, exerciseFamily: 'push' };
const row = { id: 'row', name: 'Band Row', movementPattern: 'Pull Horizontal', score: 88, exerciseFamily: 'pull' };
const squat = { id: 'squat', movementPattern: 'Squat', score: 80, exerciseFamily: 'squat' };
const getDefaults = (candidateMap, evidence = {}, maxPerBlock = { STRENGTH: 2 }) =>
  selectComposerDefaultExercises({ candidateMap, evidence, maxPerBlock });

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('PASS', label);
}

check('Full Body defaults cover upper/lower despite three higher-scored leg patterns', () => {
  const legs = ['Squat', 'Hinge', 'Lunge'].map((pattern, i) => ({ id: `leg${i}`, movementPattern: pattern, bodyRegion: 'Lower', score: 100-i }));
  const upper = { id: 'upper', movementPattern: 'Push Horizontal', bodyRegion: 'Upper', score: 5 };
  const selected = selectComposerDefaultExercises({ candidateMap: { STRENGTH: [...legs, upper] }, maxPerBlock: { STRENGTH: 3 }, targetRegion: 'Full Body' });
  assert.ok(selected.STRENGTH.includes('upper'));
  assert.ok(selected.STRENGTH.some((id) => id.startsWith('leg')));
});

check('Push-ups + diamond are never automatically selected together', () => {
  const selected = getDefaults({ STRENGTH: [push, diamond, row, squat] });
  assert.equal(selected.STRENGTH.join(','), 'push,row');
  const ranked = rankComposerCandidates({
    candidates: [push, diamond, row, squat],
    blockType: 'STRENGTH',
    selectionMap: selected,
    candidateMap: { STRENGTH: [push, diamond, row, squat] },
  });
  assert.equal(ranked.filter((item) => selected.STRENGTH.includes(item.id) && item.warning).length, 0);
});

check('Only one movement is automatically chosen when all candidates share a pattern', () => {
  assert.equal(getDefaults({ STRENGTH: [push, diamond] }).STRENGTH.join(','), 'push');
});

check('Explicitly avoided exercises are never auto-selected', () => {
  const selected = getDefaults(
    { STRENGTH: [push, diamond, row] },
    { push: { explicit_preference_state: 'EVITE_VOLONTAIREMENT' } }
  );
  assert.equal(selected.STRENGTH.join(','), 'diamond,row');
});

check('Main blocks retain priority over complements and exercise IDs do not repeat', () => {
  const selected = getDefaults(
    { WARMUP: [push, { id: 'mob', movementPattern: 'Mobility', score: 20 }], STRENGTH: [push, row] },
    {}, { WARMUP: 1, STRENGTH: 2 }
  );
  assert.equal(selected.STRENGTH.join(','), 'push,row');
  assert.equal(selected.WARMUP.join(','), 'mob');
});

check('User-chosen duplicate patterns remain possible and warnings identify them', () => {
  const candidates = [push, diamond, row];
  const ranked = rankComposerCandidates({
    candidates, blockType: 'STRENGTH',
    selectionMap: { STRENGTH: ['push', 'diamond'] },
    candidateMap: { STRENGTH: candidates },
  });
  assert.equal(ranked.filter((item) => item.warning).length, 2);
});

check('Empty or incomplete catalogue does not invent a selection', () => {
  assert.equal(getDefaults({ STRENGTH: [] }).STRENGTH.length, 0);
  assert.equal(getDefaults({ STRENGTH: [row] }).STRENGTH.join(','), 'row');
});

check('Strength capacity is a backend contract safety ceiling, never a duration quota', () => {
  for (const minutes of [14, 21, 30, 45, 60]) {
    assert.equal(composerExerciseSlotLimit('STRENGTH', minutes), 8);
  }
  assert.equal(composerExerciseSlotLimit('SKILL', 45), 2);
  assert.equal(composerExerciseSlotLimit('WOD', 30), 3);
});

check('Four complementary movements can be picked for a 45-minute Strength block', () => {
  const hinge = { id: 'hinge', movementPattern: 'Hinge', score: 79 };
  const candidates = [push, diamond, row, squat, hinge];
  const slots = composerExerciseSlotLimit('STRENGTH', 45);
  const selected = getDefaults({ STRENGTH: candidates }, {}, { STRENGTH: slots });
  assert.equal(selected.STRENGTH.length, 4); // four distinct patterns, not an enforced time-based quota
  assert.equal(new Set(selected.STRENGTH).size, 4);
  assert.equal(selected.STRENGTH.includes('diamond'), false);
  const patterns = candidates.filter((x) => selected.STRENGTH.includes(x.id)).map(x => x.movementPattern);
  assert.equal(new Set(patterns).size, 4);
});

check('Even a 45-minute block never fabricates duplicate exercises to fill capacity', () => {
  const selected = getDefaults({ STRENGTH: [push, diamond, row] }, {}, {
    STRENGTH: composerExerciseSlotLimit('STRENGTH', 45)
  });
  assert.equal(selected.STRENGTH.join(','), 'push,row');
});

check('Structure cards directly explain Skill versus Strength', () => {
  const skill = { blocks: [{ type: 'SKILL' }, { type: 'WOD' }] };
  const strength = { blocks: [{ type: 'STRENGTH' }] };
  const skillCopy = composerArchitecturePurpose(skill);
  const strengthCopy = composerArchitecturePurpose(strength);
  assert.match(skillCopy, /Technique/);
  assert.match(skillCopy, /geste/);
  assert.match(strengthCopy, /Force et muscles/);
  assert.match(strengthCopy, /répétitions/);
});

check('Structure budget always equals requested duration for all supported durations', () => {
  for (const duration of [20, 30, 45, 60, 75, 90]) {
    for (const intentKey of ['STRENGTH', 'TECHNIQUE', 'CONDITIONING']) {
      for (const environmentCode of ['BOX', 'GYM', 'HOME', 'OUTDOOR']) {
        const options = buildComposerArchitectures({ durationMinutes: duration, intentKey, environmentCode });
        assert.ok(options.length);
        for (const option of options) {
          const subtotal = option.blocks.reduce((sum, block) => sum + block.minutes, 0) + option.transitionReserveMinutes;
          assert.equal(subtotal, duration);
          assert.equal(option.estimatedMinutes, duration);
        }
      }
    }
  }
});

check('Display labels vary with environment while canonical block types remain unchanged', () => {
  assert.equal(composerBlockDisplayLabel('STRENGTH', 'GYM'), 'Musculation');
  assert.equal(composerBlockDisplayLabel('STRENGTH', 'HOME'), 'Renforcement');
  assert.equal(composerBlockDisplayLabel('STRENGTH', 'BOX'), 'Force');
  assert.equal(composerBlockDisplayLabel('SKILL', 'BOX'), 'Skill');
  assert.equal(composerArchitectureDisplayTitle(
    buildComposerArchitectures({ durationMinutes: 60, intentKey: 'STRENGTH', environmentCode: 'HOME' })[0], 'HOME'
  ), 'Renforcement seul');
});

console.log('\n' + passed + ' Composer regression tests passed.');
