#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const preferencesSource = fs.readFileSync('src/utils/composerPreferences.js', 'utf8');
const {readComposerPreferences} = new Function(preferencesSource.replaceAll('export const ', 'const ')
  .replaceAll('export function ', 'function ') + '\nreturn {readComposerPreferences};')();
const service = fs.readFileSync('src/services/composerService.js','utf8')
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g,'')
  .replaceAll('export async function ','async function ').replaceAll('export function ','function ');
const rows = [
  {id:'upper',name:'Push',display_name:'Push',body_region:'Upper',training_focus:'Strength',selection_weight:10},
  {id:'lower',name:'Squat',display_name:'Squat',body_region:'Lower',training_focus:'Strength',selection_weight:10},
  {id:'core',name:'Hold',display_name:'Hold',body_region:'Core',training_focus:'Strength',selection_weight:10},
];
const calls=[];
let rpcReply=()=>({status:'READY',exercises:[]});
function query(table){
  const result = table==='exercises' ? rows : [];
  return {select(){return this;},order(){return this;},limit(){return this;},
    eq(){return this;},contains(){return this;},in(){return this;},range(){return this;},
    then(resolve){resolve({data:result,error:null});}};
}
const supabase={from:query,async rpc(name,args){calls.push({name,args});return {data:rpcReply(name,args)};}};
const api = new Function('supabase','getAuthenticatedUserWithRetry','runSupabaseRequestWithAuthRetry','readComposerPreferences',
  service+'\nreturn {getComposerExerciseCandidates,getComposerSkillProposal,getComposerAutomaticSkillProposal,composerExerciseSlotLimit,composerBlockDisplayLabel,selectComposerDefaultExercises};')
  (supabase,async()=>({id:'synthetic'}),async fn=>{const r=await fn();if(r.error)throw r.error;return r.data;},readComposerPreferences);
async function main(){
  const release=fs.readFileSync('src/utils/composerReleasePolicy.js','utf8')
    .replaceAll('export const ','const ').replaceAll('export function ','function ');
  const policy=new Function(release+'\nreturn {composerInitialSkillEngineVersion,composerGuidedPreferencesEnabled};')();
  assert.equal(policy.composerInitialSkillEngineVersion(),'C4_COMPOSER_SKILL_V1','New drafts use the connected execution contract');
  assert.equal(policy.composerGuidedPreferencesEnabled(),true);
  assert.equal(policy.composerInitialSkillEngineVersion(true),'C4_COMPOSER_SKILL_V1');
  assert.equal(policy.composerGuidedPreferencesEnabled({},true),true);
  assert.equal(policy.composerGuidedPreferencesEnabled({skillEngineVersion:'C4_COMPOSER_SKILL_V1'}),true,'Never downgrade an already authored contract');
  assert.equal(policy.composerGuidedPreferencesEnabled({preferredRegions:['Back','Lower']}),true,'Saved multi-zone preferences must remain visible');
  assert.equal(policy.composerGuidedPreferencesEnabled({skillTargetPath:'HANDSTAND_HSPU'}),true);
  const base={blockType:'SKILL',focus:'Strength',environmentCode:'HOME',equipmentIds:[],limit:30};
  const singleUpper=await api.getComposerExerciseCandidates({...base,targetRegion:'Upper'});
  const singleLower=await api.getComposerExerciseCandidates({...base,targetRegion:'Lower'});
  const multi=await api.getComposerExerciseCandidates({...base,preferences:{preferred_regions:['Upper','Lower']}});
  assert.equal(new Set(multi.map(e=>e.id)).size,3,'One instance per exercise, no duplication from the union');
  const scores=Object.fromEntries(multi.map(e=>[e.id,e.score]));
  assert.ok(scores.upper>scores.core);assert.ok(scores.lower>scores.core,'The second zone must affect selection');
  for(const e of multi) assert.equal(e.score,Math.max(singleUpper.find(x=>x.id===e.id).score,singleLower.find(x=>x.id===e.id).score),
    'Reuse existing scores; never sum new sporting weights');
  const reversed=await api.getComposerExerciseCandidates({...base,preferences:{preferred_regions:['Lower','Upper']}});
  assert.deepEqual(multi,reversed,'Preference order must not choose a dominant first zone');
  const automatic=await api.getComposerExerciseCandidates({...base,targetRegion:'Upper',preferences:{preferred_regions:[]}});
  assert.equal(new Set(automatic.map(e=>e.score)).size,1,'Explicit automatic must not revive an old scalar');
  const catalogueRows=Array.from({length:620},(_,i)=>({id:'catalogue-'+i,name:'Exercise '+i,
    selection_weight:1,home_friendly:true,usable_for:i%2?['Skill']:['STRENGTH']}));
  const roleFilters=[];
  const catalogueSupabase={from(table){let from=0,to=999;return {
    select(){return this;},order(){return this;},eq(){return this;},in(){return this;},limit(){return this;},
    contains(column,value){roleFilters.push({column,value});return this;},
    range(a,b){from=a;to=b;return this;},then(resolve){resolve({data:table==='exercises'?catalogueRows.slice(from,to+1):[],error:null});}};}};
  const commonApi=new Function('supabase','getAuthenticatedUserWithRetry','runSupabaseRequestWithAuthRetry','readComposerPreferences',
    service+';return {getComposerExerciseCandidates};')(catalogueSupabase,async()=>({id:'synthetic'}),async fn=>(await fn()).data,readComposerPreferences);
  const skillCatalogue=await commonApi.getComposerExerciseCandidates({...base,limit:3});
  const strengthCatalogue=await commonApi.getComposerExerciseCandidates({...base,blockType:'STRENGTH',limit:3});
  assert.equal(skillCatalogue.length,620,'No shortlist truncation of the selectable training catalogue');
  assert.deepEqual(skillCatalogue,strengthCatalogue,'Same exercises and ranking for both training contracts');
  assert.deepEqual(roleFilters,[],'No Skill/Strength role gate on the common training catalogue');
  console.log('PASS: shared Skill/Strength catalogue, full pagination beyond 500 rows and no type-based restriction');
  // Manual exploration has its own complete read; it must never loosen automatic proposals.
  roleFilters.length=0;
  const manualWod=await commonApi.getComposerExerciseCandidates({...base,blockType:'WOD',targetRegion:'Back',manualCatalogue:true,limit:3});
  assert.equal(manualWod.length,620,'Manual WOD exploration is not restricted by a role, target region or shortlist');
  assert.deepEqual(roleFilters,[],'Manual exploration must not apply a WOD role filter');
  const queryCalls=[];
  const manualDb={from(table){let from=0,to=499;return {
    select(){return this;},order(){return this;},in(){return this;},
    eq(...args){queryCalls.push(['eq',...args]);return this;},
    contains(...args){queryCalls.push(['contains',...args]);return this;},
    limit(...args){queryCalls.push(['limit',...args]);return this;},
    range(a,b){from=a;to=b;return this;},then(resolve){
      const data=table==='exercises'?[{id:'no-bar',name:'Pull-up',home_friendly:false,body_region:'Upper'}]
        :table==='exercise_equipment'?[{exercise_id:'no-bar',equipment_id:'E01'}]
        :table==='equipment_catalog_v2'?[{id:'E01',name:'Barre'}]:[];
      resolve({data:data.slice(from,to+1),error:null});}};}};
  const manualApi=new Function('supabase','getAuthenticatedUserWithRetry','runSupabaseRequestWithAuthRetry','readComposerPreferences',
    service+';return {getComposerExerciseCandidates};')(manualDb,async()=>({id:'synthetic'}),async fn=>(await fn()).data,readComposerPreferences);
  const open=await manualApi.getComposerExerciseCandidates({...base,blockType:'WOD',manualCatalogue:true});
  assert.deepEqual(queryCalls,[],'No hidden location, role or count filters in the manual catalogue');
  assert.deepEqual(open[0].missingEquipment,['Barre'],'Missing gear is visible, not a hidden exclusion');
  const automaticWod=await manualApi.getComposerExerciseCandidates({...base,blockType:'WOD'});
  assert.equal(automaticWod.length,0,'Automatic candidates still enforce equipment');
  assert.ok(queryCalls.some(x=>x[0]==='contains')&&queryCalls.some(x=>x[0]==='eq')&&queryCalls.some(x=>x[0]==='limit'));
  console.log('PASS: manual exploration is complete; existing automatic rules remain active');
  const request={preferences:readComposerPreferences({preferred_regions:['Upper','Core'],skill_target_path_key:'HANDSTAND_HSPU'}),
    session_minutes:45,block_minutes:12,environment_code:'BOX',exercises:[{id:'upper'}]};
  await api.getComposerSkillProposal(request);
  assert.deepEqual(calls[0],{name:'week_composer_skill_authority_v1',args:{p_user_id:'synthetic',p_context:{...request,propose:true}}});
  assert.equal(api.composerExerciseSlotLimit('SKILL'),3);
  assert.equal(api.composerBlockDisplayLabel('SKILL','HOME'),'Skill');
  const lesson=['upper'];
  const candidates={SKILL:[{id:'lower',score:100}],WARMUP:[{id:'upper',score:100},{id:'core',score:10}]};
  const defaults=api.selectComposerDefaultExercises({candidateMap:candidates,fixedSelections:{SKILL:lesson},maxPerBlock:{SKILL:3,WARMUP:1}});
  assert.deepEqual(defaults.SKILL,['upper'],'The curated Skill must not be overwritten by local defaults');
  assert.deepEqual(defaults.WARMUP,['core'],'New complements must not reclaim the actual lesson exercise');
  assert.deepEqual(lesson,['upper'],'Never mutate the source selection');
  // Automatic defaults must adapt to an engine rejection without changing
  // the user's duration, context, explicit complements or engine dose.
  const bad={id:'bad',score:50,movementPattern:'pull'};
  const good={id:'good',score:40,movementPattern:'push'};
  const used={id:'wod',score:100,movementPattern:'squat'};
  const initialContext={session_minutes:60,block_minutes:33,environment_code:'HOME',
    preferences:{preferred_regions:['Upper'],skill_target_path_key:null},
    equipment_names:['Dumbbells'],wod_exercises:[{exercise_id:'wod'}],exercises:[{id:'bad'}]};
  const input={context:initialContext,candidateMap:{SKILL:[bad,used,good],WOD:[used]},
    defaultSelections:{SKILL:['bad'],WOD:['wod']},equipmentIds:['E01']};
  const original=JSON.stringify(input);
  const engineDose={sets:3,reps_min:6,rest_seconds:90};
  for(const reason of ['SKILL_CONTEXT_INCOMPATIBLE','SKILL_TIME_MISMATCH']){
    const start=calls.length;
    rpcReply=(_name,args)=>args.p_context.exercises.some(e=>e.id==='bad')
      ? {status:'NEEDS_RECOMPOSITION',block_type:'SKILL',reason,exercise_id:'bad'}
      : {status:'READY',minutes:args.p_context.block_minutes,exercises:[{id:'good',prescription:engineDose}]};
    const proposal=await api.getComposerAutomaticSkillProposal(input);
    assert.equal(proposal.status,'READY');assert.deepEqual(proposal.exercises,[{id:'good',prescription:engineDose}]);
    const sent=calls.slice(start).map(call=>call.args.p_context);
    assert.equal(sent.length,2);assert.deepEqual(sent[1].exercises,[{id:'good'}]);
    for(const request of sent){assert.equal(request.block_minutes,33);assert.equal(request.session_minutes,60);
      assert.deepEqual(request.wod_exercises,initialContext.wod_exercises);
      assert.deepEqual(request.preferences,initialContext.preferences);assert.deepEqual(request.equipment_names,initialContext.equipment_names);}
    assert.equal(JSON.stringify(input),original,'No mutation of authored context or selections');
  }
  for(const reason of ['SKILL_LESSON_CHANGED','SKILL_TEST_CONFIRMATION_REQUIRED']){
    const start=calls.length;rpcReply=()=>({status:'NEEDS_RECOMPOSITION',block_type:'SKILL',reason,exercise_id:'bad'});
    const result=await api.getComposerAutomaticSkillProposal(input);assert.equal(result.reason,reason);assert.equal(calls.length-start,1,'Never bypass lesson or test requirements');
  }
  const start=calls.length;
  rpcReply=(_name,args)=>({status:'NEEDS_RECOMPOSITION',block_type:'SKILL',reason:'SKILL_CONTEXT_INCOMPATIBLE',exercise_id:args.p_context.exercises[0].id});
  const exhausted=await api.getComposerAutomaticSkillProposal(input);
  assert.equal(exhausted.status,'NEEDS_RECOMPOSITION');assert.equal(calls.length-start,2,'Finite pool exhausted; never manufacture a valid result');
  const targetStart=calls.length;
  await api.getComposerAutomaticSkillProposal({...input,context:{...initialContext,preferences:{skill_target_path_key:'HANDSTAND_HSPU'}}});
  assert.equal(calls.length-targetStart,1,'A targeted lesson must not be replaced');
  const manualStart=calls.length;await api.getComposerSkillProposal(initialContext);
  assert.equal(calls.length-manualStart,1,'Authored Skill request is not automatically replaced');
  const malformedStart=calls.length;rpcReply=()=>({status:'NEEDS_RECOMPOSITION',reason:'SKILL_CONTEXT_INCOMPATIBLE',exercise_id:'not-in-request'});
  await api.getComposerAutomaticSkillProposal(input);assert.equal(calls.length-malformedStart,1,'Unknown rejection cannot loop');
  rpcReply=()=>{throw new Error('network');};
  await assert.rejects(()=>api.getComposerAutomaticSkillProposal(input),/network/,'Transport failures are not retried as sporting rejections');
  const ui=fs.readFileSync('src/workout/WeekComposerV7.js','utf8');
  assert.match(ui,/if \(skill && skillEngineVersion && !\(selectionMap.SKILL \?\? \[\]\).length\) \{\s*const proposal = await getComposerAutomaticSkillProposal/);
  console.log('PASS: automatic Skill rejection recovery, unchanged 33-minute budget and engine dose, manual/target preservation, finite exhaustion and transport failure');
  const presentation = fs.readFileSync('src/utils/composerPresentation.js','utf8').replaceAll('export function ','function ');
  const {composerPreviewIssue} = new Function(presentation+'\nreturn {composerPreviewIssue};')();
  const generation = fs.readFileSync('src/services/workoutGenerationService.js','utf8')
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g,'')
    .replaceAll('export async function ','async function ').replaceAll('export function ','function ');
  const finalize = new Function('supabase','getAuthenticatedUserWithRetry','runSupabaseRequestWithAuthRetry','getComposerForLocalDate','composerPreviewIssue',
    generation+'\nreturn finalizeComposerWorkoutSession;')({},async()=>({id:'synthetic'}),
      async()=>{throw new Error('COMPOSER_SKILL_RECOMPOSITION_REQUIRED_SKILL_CONTEXT_INCOMPATIBLE');},
      async()=>({planItemId:'plan',draft:{duration_minutes:45,environment_code:'HOME'}}),composerPreviewIssue);
  const today=new Date(); const date=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  await assert.rejects(()=>finalize({planItemId:'plan',localDate:date,preparation:{duration:45,environmentCode:'HOME',painZones:['Aucune']}}),
    error=>error.code==='COMPOSER_NEEDS_RECOMPOSITION' && /Skill/.test(error.message) && !/COMPOSER_SKILL_/.test(error.message),
    'Day-J incompatibility must be actionable and must not expose a raw SQL reason');
  console.log('PASS: multi-zone eligibility/scores, order independence, automatic reset, target RPC transport, Skill ceiling and label');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
