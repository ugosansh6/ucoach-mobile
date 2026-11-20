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
function query(table){
  const result = table==='exercises' ? rows : [];
  return {select(){return this;},order(){return this;},limit(){return this;},
    eq(){return this;},contains(){return this;},in(){return this;},
    then(resolve){resolve({data:result,error:null});}};
}
const supabase={from:query,async rpc(name,args){calls.push({name,args});return {data:{status:'READY',exercises:[]}};}};
const api = new Function('supabase','getAuthenticatedUserWithRetry','runSupabaseRequestWithAuthRetry','readComposerPreferences',
  service+'\nreturn {getComposerExerciseCandidates,getComposerSkillProposal,composerExerciseSlotLimit,composerBlockDisplayLabel,selectComposerDefaultExercises};')
  (supabase,async()=>({id:'synthetic'}),async fn=>{const r=await fn();if(r.error)throw r.error;return r.data;},readComposerPreferences);
async function main(){
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
  console.log('PASS: multi-zone eligibility/scores, order independence, automatic reset, target RPC transport, Skill ceiling and label');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
