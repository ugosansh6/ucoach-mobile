#!/usr/bin/env node
'use strict';
// Exercise the real Composer architecture functions, without auth or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const service = fs.readFileSync('src/services/composerService.js', 'utf8');
const from = service.indexOf('function wodLabel(minutes)');
const to = service.indexOf('/**\n * MSW-036', from);
assert.ok(from >= 0 && to > from, 'Could not locate the current implementation');
const source = service.slice(from, to).replaceAll('export function ', 'function ');
const functions = new Function(source +
  '\nreturn {buildComposerArchitectures,composerBlockDisplayLabel,composerArchitectureDisplayTitle,composerArchitecturePurpose};')();
const build = functions.buildComposerArchitectures;
let total = 0;
for (const env of ['HOME','BOX','GYM','OUTDOOR']) {
 for (const intent of ['STRENGTH','CONDITIONING','TECHNIQUE']) {
  for (const duration of [20,30,45,60,75,90]) {
   const cases = build({durationMinutes:duration,intentKey:intent,environmentCode:env});
   assert.ok(cases.length>=3,'No alternatives '+env+'/'+intent+'/'+duration);
   const first = cases[0];
   const main = first.blocks.filter(b=>!['WARMUP','TABATA'].includes(b.type));
   const mainId = intent === 'STRENGTH' ? 'STRENGTH'
     : intent === 'CONDITIONING' ? 'WOD' : 'SKILL';
   const primary = main.find(b=>b.type===mainId);
   assert.ok(primary, 'Intent vanished '+env+'/'+intent+'/'+duration);
   const mainTotal = main.reduce((s,b)=>s+b.minutes,0);
   assert.ok(primary.minutes>=mainTotal/2,'Intent not majority '+env+'/'+intent+'/'+duration);
   for (const option of cases) {
    const minutes=option.blocks.reduce((s,b)=>s+b.minutes,0)+option.transitionReserveMinutes;
    assert.equal(minutes,duration,'Budget mismatch '+env+'/'+intent+'/'+duration);
    assert.equal(option.estimatedMinutes,duration);
    assert.equal(new Set(option.blocks.map(b=>b.type)).size,option.blocks.length);
    assert.equal(option.blocks[0].type,'WARMUP');
    assert.ok(option.blocks.every(b=>b.minutes>=4&&b.minutes<=90));
    assert.ok(option.blocks.filter(b=>b.type!=='WARMUP').every(b=>b.minutes>=8));
    assert.ok(!option.blocks.some(b=>b.type==='TABATA'),'Tabata is optional');
    assert.ok(functions.composerArchitectureDisplayTitle(option,env).length>0);
    assert.ok(functions.composerArchitecturePurpose(option).length>0);
   }
   total++;
  }
 }
}
assert.equal(total,72);
// C4 duration-target fixture read from DEV c4_session_architecture_targets_v2,
// not a separate scheduling engine. Verify proposal and editor together.
const c4Warmups = {20:5,30:5,45:6,60:6,75:7,90:7};
const editorSource = fs.readFileSync('src/utils/composerArchitectureEditor.js','utf8');
const editor = new Function(editorSource
  .replaceAll('export const ','const ')
  .replaceAll('export function ','function ') +
  '\nreturn {editComposerArchitecture};')();
let edited = 0;
for(const env of ['HOME','BOX','GYM','OUTDOOR']) {
 for(const intent of ['STRENGTH','CONDITIONING','TECHNIQUE']) {
  for(const duration of [20,30,45,60,75,90]) {
   const list = build({
     durationMinutes:duration,intentKey:intent,environmentCode:env,
     targets:{warmup_minutes:c4Warmups[duration]},
   });
   for(const option of list) {
    const snapshot = JSON.stringify(option);
    assert.equal(option.blocks[0].minutes,c4Warmups[duration]);
    const added = editor.editComposerArchitecture(option,{kind:'tabata'});
    assert.equal(added.ok,true,added.error);
    assert.ok(added.architecture.blocks.some(b=>b.type==='TABATA'&&b.minutes===4));
    assert.equal(added.architecture.blocks.reduce((s,b)=>s+b.minutes,0)
      +added.architecture.transitionReserveMinutes,duration);
    const removed = editor.editComposerArchitecture(added.architecture,{kind:'tabata'});
    assert.equal(removed.ok,true,removed.error);
    assert.ok(!removed.architecture.blocks.some(b=>b.type==='TABATA'));
    assert.equal(removed.architecture.blocks.reduce((s,b)=>s+b.minutes,0)
      +removed.architecture.transitionReserveMinutes,duration);
    assert.equal(JSON.stringify(option),snapshot,'Original choice was mutated');
    edited++;
   }
  }
 }
}
assert.ok(edited>300,'All C4-target options are editable without silent rewrites');
for(const env of ['HOME','BOX','GYM','OUTDOOR']) {
 assert.equal(functions.composerBlockDisplayLabel('WOD',env),'WOD');
 assert.equal(functions.composerBlockDisplayLabel('SKILL',env),'Technique');
}
const tech20=build({durationMinutes:20,intentKey:'TECHNIQUE',environmentCode:'HOME'})[0];
assert.deepEqual(tech20.blocks.map(b=>b.type),['WARMUP','SKILL']);
const endurance90=build({durationMinutes:90,intentKey:'CONDITIONING',environmentCode:'HOME'})[0];
assert.equal(endurance90.key,'conditioning');
assert.ok(endurance90.blocks.find(b=>b.type==='WOD').minutes>30);
const coachGeneral=build({durationMinutes:45,intentKey:'GENERAL_FITNESS',environmentCode:'HOME'})[0];
assert.notEqual(coachGeneral.key,'conditioning','Unknown Coach intent should be neutral');
const forceBox=build({durationMinutes:60,intentKey:'STRENGTH',environmentCode:'BOX'})[0];
assert.equal(forceBox.key,'strength');
console.log('PASS: 72-intent matrix plus ' + edited + ' C4-target Tabata round-trip checks');
