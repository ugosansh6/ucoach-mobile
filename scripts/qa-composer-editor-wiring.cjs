#!/usr/bin/env node
'use strict';
// Static contract assertions: the W11 UI must preserve choices and not allow
// edits to skip C2 preview / day-J compilation.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ui = fs.readFileSync('src/workout/WeekComposerV7.js', 'utf8');
const service = fs.readFileSync('src/services/composerService.js', 'utf8');
assert.match(ui,/editComposerArchitecture\(architecture, action\)/);
assert.match(ui,/setArchitecture\(result\.architecture\)/);
assert.match(ui,/composerMainBlocks\(architecture\)\.map/);
assert.match(ui,/composerAddableBlocks\(architecture\)\.map/);
assert.match(ui,/kind: 'move', blockType: block\.type/);
assert.match(ui,/kind: 'remove', blockType: block\.type/);
assert.match(ui,/kind: 'minutes', blockType: block\.type/);
assert.match(ui,/kind: 'tabata'/);
assert.match(ui,/intent\.focus === 'Conditioning'/);
assert.match(ui,/COACH_TECHNIQUE/);
assert.match(ui,/planningIntentKey/);
assert.match(ui,/Ajouter Tabata abdos/);
assert.match(ui,/setStep\(2\)/);
assert.match(ui,/preservedIds/);
assert.match(ui,/defaults\[block\.type\] = \[\.\.\.previousChoice\]/);
assert.match(ui,/prescriptionPreview/);
assert.match(ui,/saveComposerDraft/);
assert.match(service,/if \(type === 'SKILL'\) return 'Technique';/);
assert.ok(!ui.includes("'Skill', subtitle:"),'customer-facing Skill label removed');
console.log('PASS: W11 Composer editor wired to existing preview/save and selections');
