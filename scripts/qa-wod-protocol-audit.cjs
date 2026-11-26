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

const feedbackHelpers=new Function(fs.readFileSync('src/services/wodRuntimeStatus.js','utf8').replaceAll('export function ','function ')+'\nreturn {applyWodRuntimeStatuses,executionFeedbackKind,protocolExercisePatch};')();
const movements=[{id:'a',sessionExerciseId:'a',blockKey:'wod',status:'pending'},{id:'b',sessionExerciseId:'b',blockKey:'wod',status:'pending'},{id:'c',sessionExerciseId:'c',blockKey:'wod',status:'pending'}];
const partialRuntime={started:true,finished:true,mechanic:'CIRCUIT',finishReason:'manual_stop',completedRounds:1,parameters:{rounds:6},elapsedSeconds:120};
const partialRows=feedbackHelpers.applyWodRuntimeStatuses(movements,{mechanic:'CIRCUIT',exercises:movements},partialRuntime);
assert.deepEqual(partialRows.map(feedbackHelpers.executionFeedbackKind),['partial','partial','partial']);
assert.deepEqual(partialRows.map(x=>x.userExecutionStatus),['adapted','adapted','adapted']);
assert.equal(partialRows[0].performanceActualJson.execution_status_origin,'PROTOCOL_RESULT');
const deliberate={...movements[0],status:'adapted',userExecutionStatus:'adapted',performanceActualJson:{execution_status_origin:'USER_EXPLICIT'}};
assert.deepEqual(feedbackHelpers.protocolExercisePatch(deliberate,'completed',partialRuntime),{});
assert.equal(feedbackHelpers.executionFeedbackKind(deliberate),'adapted');
assert.equal(feedbackHelpers.executionFeedbackKind({status:'adapted'}),'adapted');
assert.equal(feedbackHelpers.executionFeedbackKind({...movements[0],...feedbackHelpers.protocolExercisePatch(movements[0],'not_completed',partialRuntime)}),'not_reached');
const finished=feedbackHelpers.applyWodRuntimeStatuses(movements,{mechanic:'CIRCUIT',exercises:movements},{...partialRuntime,finishReason:'rounds_complete',completedRounds:6});
assert.deepEqual(finished.map(feedbackHelpers.executionFeedbackKind),['completed','completed','completed']);
const completion=fs.readFileSync('app/workout/completion-v3.js','utf8');
assert.match(completion,/executionFeedbackKind\(exercise\)/);
assert.match(completion,/Arrêt avant la fin/);
for(const path of ['app/workout/session-focused-core.js','app/workout/environment-session-core.js','app/workout/completion-v3.js'])require('@babel/parser').parse(fs.readFileSync(path,'utf8'),{sourceType:'module',plugins:['jsx']});
console.log('PASS distinct protocol results, explicit adaptations and JSX syntax');

const ws=fs.readFileSync('src/services/workoutService.js','utf8');
const mapFailure=new Function(ws.slice(ws.indexOf('export function workoutFormatFailure('),ws.indexOf('export async function changeWorkoutFormat(')).replace('export function ','function ')+'\nreturn workoutFormatFailure;')();
assert.match(mapFailure({classification:'NOT_RECOMMENDED',reasons:['ATHLETE_WORKLOAD_ENVELOPE_EXCEEDED']},'Edge Function returned a non-2xx status code').message,/charge de travail/);
assert.match(mapFailure({classification:'PREMIUM_REQUIRED'}).message,/Premium/);
assert.match(mapFailure(null,'Edge Function returned a non-2xx status code').message,/Impossible de vérifier/);
assert.equal(mapFailure({status:'APPLIED',classification:'COMPATIBLE',mutated:true}),null);
assert.equal(mapFailure({classification:'NOT_RECOMMENDED'}).classification,'NOT_RECOMMENDED');
const formatSheet=fs.readFileSync('src/components/workout/SessionFormatSheet.js','utf8');
assert.match(formatSheet,/changingRef.current \|\| changing/);
assert.match(formatSheet,/selectable:false,compatible:false/);
require('@babel/parser').parse(formatSheet,{sourceType:'module',plugins:['jsx']});
const catalogueCalls=[];
const fakeSupabase={from:()=>({select:()=>({in:async(_,ids)=>{catalogueCalls.push(ids);return {data:ids.map(id=>({id,description:id}))};}})})};
const enrich=new Function('supabase',ws.slice(ws.indexOf('const exerciseMetadataCache='),ws.indexOf('async function resolveFocusForGeneration()'))+';return enrichWorkoutExerciseMetadata;')(fakeSupabase);
(async()=>{
 await enrich({exercises:[{id:'a'},{id:'b'}]});
 const next=await enrich({exercises:[{id:'a'},{id:'c',prescription:'keep'}]});
 assert.deepEqual(catalogueCalls,[['a','b'],['c']]);
 assert.equal(next.exercises[1].prescription,'keep');
 assert.equal(next.exercises[0].description,'a');
 console.log('PASS structured format refusal, double-click guard, catalogue cache only');
})().catch(error=>{console.error(error);process.exitCode=1;});
