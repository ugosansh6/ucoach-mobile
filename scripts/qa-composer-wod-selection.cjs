#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const selection=new Function(fs.readFileSync('src/utils/composerWodSelection.js','utf8').replaceAll('export function ','function ')
  +'\nreturn {composerWodSelectionLimit,toggleComposerExercise};')();
// Existing live C4 contracts, checked under authenticated in rollback SQL.
const contracts=[['AMRAP',2,5],['EMOM',2,4],['FOR_TIME',2,5],['CIRCUIT',3,6],['HIIT',2,5]]
  .map(([mechanic_key,min_exercises,max_exercises])=>({found:true,mechanic_key,min_exercises,max_exercises}));
assert.equal(selection.composerWodSelectionLimit(contracts),6);
assert.equal(selection.composerWodSelectionLimit(contracts.filter(c=>c.mechanic_key!=='CIRCUIT')),5);
assert.equal(selection.composerWodSelectionLimit([contracts[1]]),4);
for(const invalid of [null,[],[{found:false}],[{found:true,min_exercises:3,max_exercises:99}],[{found:true,min_exercises:6,max_exercises:4}]]) {
  assert.equal(selection.composerWodSelectionLimit(invalid),3);
}
let ids=['a','b','c'];
for(const id of ['d','e','f']) ids=selection.toggleComposerExercise(ids,id,6);
assert.deepEqual(ids,['a','b','c','d','e','f']);
assert.deepEqual(selection.toggleComposerExercise(ids,'g',6),['a','b','c','d','e','g']);
assert.deepEqual(selection.toggleComposerExercise(ids,'g',3),['a','b','c','d','e','g'],'Fallback never drops legacy selections');
assert.deepEqual(selection.toggleComposerExercise(ids,'b',3),['a','c','d','e','f']);
assert.deepEqual(ids,['a','b','c','d','e','f'],'Input selection stays immutable');
const outcomes=new Function(fs.readFileSync('src/services/wodProtocolOutcome.js','utf8').replaceAll('export function ','function ')
  +'\nreturn {buildWodProtocolCompletion};')();
const exercises=ids.map((id,i)=>({id,sessionExerciseId:id,blockKey:'wod',prescriptionJson:{reps_min:6,reps_max:6,reps_semantics:i===0?'per_side':'total'}}));
const result=outcomes.buildWodProtocolCompletion({workout:{wodRuntime:{started:true,mechanic:'CIRCUIT',parameters:{rounds:4},completedRounds:2,elapsedSeconds:600,finishReason:'manual_stop',controlledWindow:true}},exercises});
assert.equal(result.outcome.planned_rounds,4);
assert.equal(result.outcome.rounds_completed,2);
assert.equal(result.outcome.protocol_completed,false);
assert.equal(result.exercises.length,6);
assert.equal(result.outcome.completion_ratio,.5);
console.log('PASS: C4 manual capacities 4/5/6, invalid-contract fallback, immutable legacy replacements and six-exercise partial Circuit outcome');

(async()=>{
  const source=fs.readFileSync('src/services/composerService.js','utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm,'')
    .replaceAll('export async function ','async function ').replaceAll('export function ','function ');
  const calls=[];
  const supabase={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='week_composer_mechanic_recommendations_v1') return {options:[],unavailable:contracts.map(c=>({key:c.mechanic_key,available:false}))};
    assert.equal(name,'c4_mechanic_composition_contract');
    return contracts.find(c=>c.mechanic_key===args.p_mechanic);
  }};
  const get=new Function('supabase','getAuthenticatedUserWithRetry','runSupabaseRequestWithAuthRetry',source+'\nreturn getComposerWodSelectionContracts;')
    (supabase,async()=>({id:'synthetic'}),fn=>fn());
  const result=await get({wodMinutes:20,exerciseIds:['EX001'],environmentCode:'HOME',focus:'General Fitness'});
  assert.equal(calls.length,6);
  assert.equal(calls[0].name,'week_composer_mechanic_recommendations_v1');
  assert.deepEqual(result.map(c=>c.mechanic_key).sort(),contracts.map(c=>c.mechanic_key).sort());
  assert.equal(selection.composerWodSelectionLimit(result),6);
  console.log('PASS: actual service reads only the server-exposed Composer formats then their C4 contracts, including currently unavailable count alternatives');
})().catch(error=>{console.error(error);process.exitCode=1;});
