const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = (path, names) => new Function(fs.readFileSync(path,'utf8').replaceAll('export const ','const ').replaceAll('export function ','function ') + `\nreturn {${names}};`)();
const api = load('src/utils/composerSkillExecution.js','skillExecutionUnits,skillElapsed,skillExecutionUpdates');
const ex = {sessionExerciseId:'instance-a',exerciseId:'EX1',name:'Hold',prescriptionJson:{sets:2,execution_target_duration_seconds:35,rest_between_sets_seconds:60,duration_semantics:'per_side'}};
const units=api.skillExecutionUnits([ex]);
assert.equal(units.length,4);assert.deepEqual(units.map(u=>u.side),['left','right','left','right']);
assert.deepEqual(units.map(u=>u.restSeconds),[0,60,0,60]);
assert.throws(()=>api.skillExecutionUnits([{...ex,prescriptionJson:{}}]),/Séries manquantes/);
assert.equal(api.skillElapsed({elapsedSeconds:10,runningSince:1000},6000),15);
assert.equal(api.skillElapsed({elapsedSeconds:10,runningSince:null},6000),10);
const results={[units[0].key]:{duration_seconds:35,load_kg:null}};
let out=api.skillExecutionUpdates([ex],units,results,false)['instance-a'];
assert.equal(out.status,'adapted');assert.equal(out.durationSeconds,35);assert.equal(out.performanceActualJson.skill_sets.length,1);
assert.equal(api.skillExecutionUpdates([ex],units,{},false)['instance-a'].status,'not_completed');
for(const u of units) results[u.key]={duration_seconds:35,load_kg:null};
out=api.skillExecutionUpdates([ex],units,results,true)['instance-a'];assert.equal(out.status,'completed');assert.equal(out.durationSeconds,140);
const p=load('src/utils/composerPlayerProgress.js','composerPlayerSnapshot,hydrateComposerPlayerProgress,composerProgressFingerprint,restoreRunningClock,composerRecordedInstanceIds');
const workout={sessionId:'session',meta:{source:'w11_composer'},exercises:[ex],skillRuntime:{index:1,results}};
const snapshot=p.composerPlayerSnapshot(workout,1000);snapshot.exercises[0].status='adapted';
const restored=p.hydrateComposerPlayerProgress(workout,{revision:2,contract_key:'contract',progress:snapshot},6000);
assert.equal(restored.exercises[0].prescriptionJson,ex.prescriptionJson);assert.equal(restored.skillRuntime.index,1);
assert.equal(restored.composerPlayerProgress.loaded,true);assert.equal(restored.exercises[0].status,'adapted');
assert.equal(p.hydrateComposerPlayerProgress(workout,{closed:true,progress:snapshot}).exercises[0].status,undefined,'Closed history must not be overwritten by execution cache');
console.log('PASS Skill units, explicit sides, rests, holds, partial/full, exact identity, protected prescriptions/history');

const running=p.restoreRunningClock({started:true,paused:false,elapsedSeconds:10,totalSeconds:240,completedRounds:2,restRemaining:30},1000,61000);
assert.equal(running.elapsedSeconds,70);assert.equal(running.completedRounds,2);assert.equal(running.restRemaining,0);
assert.equal(p.restoreRunningClock({started:true,paused:true,elapsedSeconds:10},1000,61000).elapsedSeconds,10);
assert.deepEqual(p.composerRecordedInstanceIds({strengthDrafts:{one:{sets:[{done:true}]}},skillRuntime:{results:{'two:1:left':{reps:4}}}}),['one','two']);

const prep = api.skillExecutionUnits([
 {sessionExerciseId:'a',name:'A',prescriptionJson:{execution_target_reps:8}},
 {sessionExerciseId:'b',name:'B',prescriptionJson:{duration_seconds:20}},
], {sets:3,rounds:true});
assert.deepEqual(prep.map(u=>u.sessionExerciseId+u.setIndex),['a1','b1','a2','b2','a3','b3']);
