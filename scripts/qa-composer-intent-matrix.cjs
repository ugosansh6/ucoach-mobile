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
    assert.ok(option.blocks.filter(b=>!['WARMUP','TABATA'].includes(b.type)).every(b=>b.minutes>=8));
    assert.equal(option.blocks[1].type,'TABATA','Tabata included in new proposals');
    assert.equal(option.blocks[1].minutes,4);
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
    assert.deepEqual(option.blocks.slice(0,2).map(b=>b.type),['WARMUP','TABATA']);
    assert.equal(option.blocks[1].minutes,4);
    const denied = editor.editComposerArchitecture(option,{kind:'tabata'});
    assert.equal(denied.ok,false,'Protected Tabata may not be removed');
    assert.equal(option.blocks.reduce((s,b)=>s+b.minutes,0)
      +option.transitionReserveMinutes,duration);
    assert.equal(JSON.stringify(option),snapshot,'Original choice was mutated');
    edited++;
   }
  }
 }
}
assert.ok(edited>300,'All C4-target options preserve Tabata and budgets');
for(const env of ['HOME','BOX','GYM','OUTDOOR']) {
 assert.equal(functions.composerBlockDisplayLabel('WOD',env),'WOD');
 assert.equal(functions.composerBlockDisplayLabel('SKILL',env),env==='GYM'?'Musculation':env==='OUTDOOR'?'Gym':'Skill');
}
const tech20=build({durationMinutes:20,intentKey:'TECHNIQUE',environmentCode:'HOME'})[0];
assert.deepEqual(tech20.blocks.map(b=>b.type),['WARMUP','TABATA','SKILL']);
const endurance90=build({durationMinutes:90,intentKey:'CONDITIONING',environmentCode:'HOME'})[0];
assert.equal(endurance90.key,'conditioning');
assert.ok(endurance90.blocks.find(b=>b.type==='WOD').minutes>30);
const coachGeneral=build({durationMinutes:45,intentKey:'GENERAL_FITNESS',environmentCode:'HOME'})[0];
assert.notEqual(coachGeneral.key,'conditioning','Unknown Coach intent should be neutral');
const forceBox=build({durationMinutes:60,intentKey:'STRENGTH',environmentCode:'BOX'})[0];
assert.equal(forceBox.key,'strength');
console.log('PASS: 72-intent matrix plus ' + edited + ' C4-target protected Tabata checks');
