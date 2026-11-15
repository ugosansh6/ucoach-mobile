#!/usr/bin/env node
'use strict';
// Verify that the visual rewrite retains the entire Composer interaction contract.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const selector = fs.readFileSync(path.join(__dirname, '../src/workout/ComposerMuscleSelector.js'),'utf8');
const art = fs.readFileSync(path.join(__dirname, '../src/components/body/AthleticMuscleMap.js'),'utf8');
const names = [...selector.matchAll(/\bM(?:0[1-9]|1[0-3]):\s*'/g)].map(x=>x[0].split(':')[0]);
const ids = [...art.matchAll(/\['(M\d{2})',\s*'M/g)].map(x=>x[1]);
assert.equal(new Set(names).size,13);
assert.ok(ids.length >= 28, 'front/back anatomical segments');
for(const id of ids) assert.ok(names.includes(id),'Unknown muscle ID '+id);
for(const id of names) assert.ok(ids.includes(id),'Missing anatomical ID '+id);
assert.match(art,/viewBox="0 0 220 432"/);
assert.match(art,/translate\(220 0\) scale\(-1 1\)/);
assert.match(art,/onPress=\{\(\) => onTouch\(id\)\}/);
assert.match(art,/pointerEvents="none"/);
assert.match(selector,/onChange\(next\)/);
assert.match(selector,/onChange\(category\)/);
assert.match(selector,/const ORANGE = '#FF6B19'/);
assert.match(selector,/const KHAKI = '#A7B19F'/);
assert.match(selector,/const GRAY = '#E4E7E2'/);
assert.match(selector,/AthleticMuscleMap side=\{side\} colorsByMuscle=\{colorsByMuscle\} onTouch=\{selectMuscle\}/);
console.log('PASS: athletic silhouette and the existing M01-M13 Composer contract');
