#!/usr/bin/env node
'use strict';
// #37: real runtime helpers and outcome builders on synthetic protocols.
// This is NOT an interactive Player, DB persistence or entitlement E2E test.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const player=fs.readFileSync('src/components/workout/WodProtocolPlayerV3.js','utf8');
const start=player.indexOf('function totalSecondsForMechanic(');
const end=player.indexOf('\nfunction protocolSummary(',start);
assert.ok(start>=0&&end>start);
const duration=new Function('numberOr',player.slice(start,end)+'\nreturn totalSecondsForMechanic;')((n,f=0)=>Number.isFinite(Number(n))?Number(n):f);
const api=new Function(fs.readFileSync('src/services/wodProtocolOutcome.js','utf8').replaceAll('export function ','function ')
  +'\nreturn {buildWodProtocolCompletion};')();
const statuses=new Function(fs.readFileSync('src/services/wodRuntimeStatus.js','utf8').replaceAll('export function ','function ')
  +'\nreturn {deriveWodExerciseStatuses};')();
const specs=[
 ['AMRAP',{duration_minutes:20},3,'timer_complete',1200],
 ['EMOM',{cycles:6,station_seconds:60},3,'timer_complete',1080],
 ['FOR_TIME',{rounds:4,cap_seconds:1200},3,'rounds_complete',1200],
 ['CIRCUIT',{rounds:4,rest_between_rounds_seconds:45},6,'rounds_complete',null],
 ['HIIT',{rounds:4,exercise_count:3,work_seconds:40,rest_seconds:20},3,'timer_complete',720],
 ['LADDER',{rungs:4},3,'steps_complete',null],
 ['PYRAMID',{cycles:1,multipliers:[1,2,3,2,1]},3,'steps_complete',null],
 ['EVERY_X_MINUTES',{cycles:10,interval_seconds:120},3,'timer_complete',1200],
 ['ODD_EVEN',{cycles:10,station_seconds:60,odd_position:1,even_position:2},2,'timer_complete',1200],
 ['REP_TARGET',{total_rep_target:60},4,'sequence_complete',null],
 ['CHIPPER',{},4,'sequence_complete',null],
 ['COUPLET',{rungs:4},2,'steps_complete',null],
 ['PROGRESSIVE_INTERVAL',{interval_seconds:60,time_limit_seconds:1200},2,'time_cap',1200],
 ['SETS_REPS',{sets:3},3,'sets_complete',null],
 ['DECK',{cards:4,deck_order:[1,2,3,4].map(suit_index=>({suit_index,reps:5,rank:'5'}))},4,'deck_complete',null],
];
for(const [mechanic,parameters,count,finishReason,seconds] of specs) {
 assert.equal(duration({mechanic,params:parameters,durationMinutes:20,exerciseCount:count}),seconds,mechanic+' timer');
 const exercises=Array.from({length:count},(_,i)=>({id:'x'+i,sessionExerciseId:'instance-'+i,blockKey:'wod',prescriptionJson:{reps_min:15,reps_max:15,execution_target_reps:15}}));
 for(const full of [false,true]) {
  const runtime={started:true,finished:true,mechanic,parameters,controlledWindow:true,
   finishReason:full?finishReason:'manual_stop',elapsedSeconds:full?(seconds??600):90,
   completedRounds:full?4:1,manualStep:full?(mechanic==='PYRAMID'?5:4):2,
   currentItemIndex:full?count-1:1,currentStage:full?20:2};
  const result=api.buildWodProtocolCompletion({workout:{wodRuntime:runtime,durationMinutes:20},exercises});
  assert.equal(result.outcome.mechanic_key,mechanic);
  assert.equal(result.outcome.protocol_completed,full,mechanic+' completion');
  assert.equal(result.exercises.length,count);
  assert.ok(result.outcome.completion_ratio>=0&&result.outcome.completion_ratio<=1,mechanic+' ratio');
  const state=statuses.deriveWodExerciseStatuses({mechanic,exercises},runtime);
  assert.equal(state.size,count,mechanic+' statuses');
 }
}
console.log('PASS: 15 existing families, timer semantics + partial/full outcomes and exercise statuses (30 synthetic cases; no device/history E2E)');
