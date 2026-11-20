#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/services/composerService.js', 'utf8');
const api = new Function(source.slice(source.indexOf('function wodLabel(minutes)'), source.indexOf('/**\n * MSW-036'))
  .replaceAll('export function ', 'function ') + '\nreturn {buildComposerArchitectures,composerArchitectureMatchesIntent,composerArchitecturePurpose};')();
const presentation = new Function(fs.readFileSync('src/utils/composerPresentation.js', 'utf8')
  .replaceAll('export function ', 'function ') + '\nreturn {composerDurationSummary,currentComposerAssessment,formatComposerDose,composerMovementAction,composerWodProtocol};')();

// Exact screenshot case: all choices remain available, but only strength-led
// choices appear as alternatives preserving the selected goal.
const options = api.buildComposerArchitectures({durationMinutes:60,intentKey:'STRENGTH',environmentCode:'GYM',targets:{warmup_minutes:6}});
const before = JSON.stringify(options);
const aligned = options.filter(o => api.composerArchitectureMatchesIntent(o, 'STRENGTH'));
assert.deepEqual(aligned.map(o=>o.key), options.map(o=>o.key), 'Orientation must not be inferred from a block-time majority');
assert.deepEqual(options.filter(o => !api.composerArchitectureMatchesIntent(o, 'STRENGTH')), []);
assert.match(api.composerArchitecturePurpose(aligned[1], 'STRENGTH','GYM'), /Renforcement.*WOD/);
assert.match(api.composerArchitecturePurpose(options.find(o=>o.key==='skill'), 'STRENGTH','GYM'), /Skill.*maîtrise.*WOD/);
assert.equal(JSON.stringify(options), before, 'Presentation must not mutate a proposal');
for (const env of ['HOME','BOX','GYM','OUTDOOR']) for (const intent of ['STRENGTH','TECHNIQUE','CONDITIONING']) for(const durationMinutes of [20,30,45,60,75,90]) {
  const list = api.buildComposerArchitectures({durationMinutes,intentKey:intent,environmentCode:env});
  assert.ok(api.composerArchitectureMatchesIntent(list[0], intent));
  for (const o of list) assert.doesNotMatch(api.composerArchitecturePurpose(o,intent,env), /Endurance : effort prolongé|WOD adapté à ton objectif|undefined/);
}
const legacy = {blocks:[{type:'WOD',minutes:45}]};
assert.equal(api.composerArchitectureMatchesIntent(legacy,'GENERAL_FITNESS'),true);
assert.doesNotMatch(api.composerArchitecturePurpose(legacy), /Endurance|undefined/);

const assessment = {status:'NEEDS_RECOMPOSITION',time:{prescribed_seconds:17*60},exercises:[{id:'row',sets:3,reps:8,rest_seconds:90}]};
assert.equal(presentation.composerDurationSummary(assessment,31), '31 min prévues · environ 17 min estimées, récupérations et installation comprises. Le bloc ne remplit pas le temps prévu.');
assert.match(presentation.composerDurationSummary({...assessment,status:'READY'},31), /Durée compatible/);
assert.match(presentation.composerDurationSummary({...assessment,time:{prescribed_seconds:35*60}},31), /dépasse/);
assert.equal(presentation.composerDurationSummary({time:{prescribed_seconds:null}},31), null);
const oldKey = JSON.stringify({ids:['row'],minutes:31,equipment:['bar']});
assert.equal(presentation.currentComposerAssessment(assessment,oldKey,oldKey,false,false), assessment);
for(const changed of [{ids:['press'],minutes:31,equipment:['bar']},{ids:['row'],minutes:24,equipment:['bar']},{ids:['row'],minutes:31,equipment:['band']}]) {
  assert.equal(presentation.currentComposerAssessment(assessment,oldKey,JSON.stringify(changed),false,false),null,'Old dose must disappear immediately');
}
assert.equal(presentation.currentComposerAssessment(assessment,oldKey,oldKey,true,false), null);
assert.equal(presentation.currentComposerAssessment(assessment,oldKey,oldKey,false,true), null);
assert.equal(presentation.formatComposerDose(assessment.exercises[0],'STRENGTH'), '3 × 8 reps · 90 s repos');
assert.equal(presentation.formatComposerDose({sets:3,reps:6,reps_semantics:'per_side'},'STRENGTH'), '3 × 6 reps / côté');
assert.equal(presentation.formatComposerDose({sets:3,duration_seconds:35,rest_seconds:60},'STRENGTH'), '3 × 35 s · 60 s repos');
assert.equal(presentation.composerMovementAction(3,3),'Remplacer un mouvement');
assert.equal(presentation.composerMovementAction(2,3),'Ajouter ou remplacer un mouvement');
assert.equal(presentation.composerWodProtocol({mechanic:'HIIT',rounds:4,work_seconds:40,rest_seconds:20}),'4 cycles · 40 s effort / 20 s repos');
assert.equal(presentation.composerWodProtocol(null),null);
console.log('PASS: objective grouping across 72 contexts, 31/17 duration, stale dosage guards and real prescriptions');
