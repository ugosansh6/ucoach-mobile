#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/utils/preparationPrimaryActionLabel.js'), 'utf8');
const fn = new Function(source.replaceAll('export function ', 'function ') + '\nreturn preparationPrimaryActionLabel;')();
assert.equal(fn({ hasComposer: true, canGenerate: true }), 'LANCER LA SÉANCE');
assert.equal(fn({ hasComposer: true, canGenerate: false }), 'FINALISER LA SÉANCE');
assert.equal(fn({ hasComposer: false, canGenerate: true }), 'Voir ma séance');
assert.equal(fn({ hasComposer: false, canGenerate: false }), 'Voir ma séance');
const prep = fs.readFileSync(path.join(__dirname, '../src/workout/PreparationCheckinV4.js'), 'utf8');
assert.match(prep, /preparationPrimaryActionLabel\(\{ hasComposer: Boolean\(todayComposer\), canGenerate \}\)/);
assert.match(prep, /const canGenerate\s*=\s*!equipmentLoading\s*&&\s*!composerLoading\s*&&\s*!composerReadError\s*&&\s*painConfirmedToday\s*&&\s*outdoorContextComplete/);
console.log('PASS: preparation CTA tracks mandatory check-in readiness');
