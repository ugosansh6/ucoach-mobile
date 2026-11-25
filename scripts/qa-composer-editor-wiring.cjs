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
assert.match(ui,/composerAddableBlocks\(architecture, environmentCode, skillTargetPath, outdoorEngine && outdoorContext.running_allowed\)\.map/);
assert.match(ui,/kind: 'move', blockType: block\.type/);
assert.match(ui,/kind: 'remove', blockType: block\.type/);
assert.match(ui,/kind: 'minutes', blockType: block\.type/);
assert.ok(!ui.includes("changeArchitecture({ kind: 'tabata' })"),'No Tabata toggle in UI');
assert.match(ui,/intent\.focus === 'Conditioning'/);
assert.match(ui,/COACH_TECHNIQUE/);
assert.match(ui,/planningIntentKey/);
assert.match(ui,/Tabata abdos · 4 min/);
assert.match(ui,/Personnaliser la structure/);
assert.match(ui,/accessibilityState=\{\{ disabled: true \}\} style=\{styles.structureProtected\}/);
assert.match(service,/blocks: \[warmupBlock, tabataBlock, \.\.\.main\]/);
assert.match(ui,/showAllMechanics \|\| composerMechanicIdentity\(option\) === composerMechanicIdentity\(mechanic\) \|\| option.recommended/);
assert.match(ui,/Modifier les mouvements du WOD/);assert.match(ui,/getComposerExerciseCompatibility\(\{exerciseIds:selectionMap.WOD/);
assert.match(ui,/setMechanicOptions\(options\)/);
// Format ranking belongs to the RPC. Duration alone must not claim that a
// circuit was chosen when the server may recommend another format.
assert.match(ui,/composerMechanicDescription\(option\)/);
assert.doesNotMatch(ui,/UGEROD privilégie un circuit avec récupération/);
assert.match(ui,/b.type === 'TABATA'/);
assert.match(ui,/setStep\(2\)/);
assert.match(ui,/preservedIds/);
assert.match(ui,/defaults\[block\.type\] = \[\.\.\.previousChoice\]/);
assert.match(ui,/prescriptionPreview/);
assert.match(ui,/saveComposerDraft/);
assert.match(service,/if \(type === 'SKILL'\) return env === 'GYM' \? 'Musculation'/);
assert.ok(!ui.includes("'Skill', subtitle:"),'customer-facing Skill label removed');
console.log('PASS: W11 Composer editor wired to existing preview/save and selections');

assert.match(ui,/composerStrengthOnlyOption\(architecture\)/);
assert.match(ui,/chooseStrengthOnly\(strengthOnlyOption\)/);
assert.doesNotMatch(ui,/Travail en séries · jusqu’à 8 mouvements/);
assert.match(ui,/return <ComposerExercisePickerPage/);
assert.doesNotMatch(ui,/visible=\{sheet === 'exercise-picker'\}/);

assert.match(ui,/composerSkillWodOption\(architecture, architectures, duration\)/);
assert.match(ui,/chooseSkillWod\(skillWodOption\)/);
assert.match(ui,/previousSkillWodChoices.current/);
assert.match(ui,/restore\?\.selectionMap\.SKILL/);
assert.match(ui,/restore\?\.selectionMap\.WOD/);

const mechanicPage=ui.slice(ui.indexOf('{step === 4 ? ('),ui.indexOf('{step === 5 ? ('));
assert.match(mechanicPage,/MÉCANIQUE DU WOD/);assert.match(mechanicPage,/La mécanique de ton WOD/);assert.match(mechanicPage,/MÉCANIQUE CHOISIE/);
assert.doesNotMatch(mechanicPage,/FORMAT DU WOD|FORMAT CHOISI|Voir d’autres formats|Un seul format/);
assert.match(mechanicPage,/composerMechanicDescription\(option\)/);assert.match(mechanicPage,/ComposerWodPreview/);assert.match(mechanicPage,/composerMechanicIdentity\(mechanic\)/);
console.log('PASS mechanic wording and dedicated compact styling; existing selection and preview retained');

assert.match(ui,/editWodForMechanic\(option\)/);assert.match(ui,/requestedMechanic\?\.reason_code==='EXERCISE_COUNT'/);assert.match(ui,/premium \? 'lock-closed-outline' : adjustable \? 'options-outline'/);
console.log('PASS actionable mechanic adjustment and exact material preflight');
