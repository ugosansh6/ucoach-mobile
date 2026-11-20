#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/utils/composerPreferences.js', 'utf8');
const api = new Function(source.replaceAll('export const ', 'const ').replaceAll('export function ', 'function ')
  + '\nreturn {readComposerPreferences,legacyComposerTargetRegion,toggleComposerRegion,composerRegionsLabel,composerShowsSkillTarget,withComposerPreferences,composerSessionPreferences};')();
const { readComposerPreferences: read, legacyComposerTargetRegion: scalar,
  toggleComposerRegion: toggle, composerShowsSkillTarget: show, withComposerPreferences: attach } = api;

const legacy = {version:'w11-composer-draft-v1',target_region:'Back',
  architecture:{blocks:[{type:'SKILL',minutes:8,exercises:[{id:'EX087'}]}]},
  wod_engine_version:null,mechanic:null};
const original = JSON.stringify(legacy);
assert.deepEqual(read(legacy).preferred_regions,['Back']);
assert.equal(JSON.stringify(legacy),original,'Reading an old draft must not migrate it');
assert.deepEqual(read({}).preferred_regions,[]);
assert.deepEqual(toggle(['Back'],'Lower'),['Back','Lower']);
assert.deepEqual(toggle(['Back','Lower'],'Back'),['Lower']);
assert.deepEqual(toggle(['Back'],'Full Body'),['Full Body']);
assert.deepEqual(toggle(['Full Body'],'Lower'),['Lower']);
assert.deepEqual(toggle(['Back','Lower'],null),[]);
assert.deepEqual(read({preferred_regions:['Back','Back','Lower']}).preferred_regions,['Back','Lower']);
const preferences=read({preferred_regions:['Back','Lower'],skill_target_path_key:'HANDSTAND_HSPU'});
assert.equal(scalar(preferences),null,'A multi-zone preference must not select the first zone');
assert.equal(scalar(read(legacy)),'Back');
assert.equal(scalar(read({preferred_regions:['Full Body']})),'Full Body');
assert.deepEqual(read({target_region:'Back',preferences:{preferred_regions:[]}}).preferred_regions,[],
  'Explicit automatic selection must not revive the old target');
assert.throws(()=>read({preferred_regions:['unknown']}),/inconnue/);
assert.throws(()=>read({preferred_regions:[],skill_target_path_key:{id:'x'}}),/invalide/);
assert.throws(()=>read({preferences:{version:'future-version',preferred_regions:['Back']}}),/Version/);
for(const key of ['TECHNIQUE','COACH_TECHNIQUE'])assert.equal(show({key}),true);
assert.equal(show({key:'STRENGTH'}),false);
assert.equal(show({key:'CONDITIONING'},true),true);
assert.equal(show({key:'STRENGTH'},false,'HANDSTAND_HSPU'),true);
const draft=attach(legacy,preferences);
assert.equal(draft.architecture,legacy.architecture,'Preferences must not rebuild blocks');
assert.equal(draft.wod_engine_version,null,'No silent WOD migration');
assert.equal(draft.target_region,null);
assert.deepEqual(read(JSON.parse(JSON.stringify(draft))),preferences);
assert.equal(JSON.stringify(legacy),original,'An edit must not mutate the source draft');
assert.notEqual(JSON.stringify(draft),JSON.stringify(attach(legacy,{...preferences,preferred_regions:['Lower']})),
  'A changed zone must change the preview request signature');
assert.notEqual(JSON.stringify(draft),JSON.stringify(attach(legacy,{...preferences,skill_target_path_key:null})),
  'A changed target must change the preview request signature');
assert.equal(api.composerRegionsLabel(preferences),'Dos · Jambes');
assert.deepEqual(api.composerSessionPreferences({composer_draft:draft}),preferences);
assert.equal(api.composerSessionPreferences({}),null);
const futurePreferences={version:'future-version',preferred_regions:['Back','Lower'],extra:'keep'};
assert.equal(api.composerSessionPreferences({composer_draft:{preferences:futurePreferences}}),futurePreferences,
  'Resuming a generated session must not rewrite or reject its future preference snapshot');

async function transport() {
  const calls=[];let stored;
  const catalogue={
    select(columns){calls.push(['select',columns]);return this;},
    eq(column,value){calls.push(['filter',column,value]);return this;},
    order(column){calls.push(['order',column]);return this;},
    then(resolve){resolve({data:[{path_key:'HANDSTAND_HSPU',display_name:'Handstand / HSPU',body_region:'Upper'}],error:null});},
  };
  const supabase={
    from(table){assert.equal(table,'skill_paths');return catalogue;},
    async rpc(name,args){
      calls.push([name,args]);
      if(name==='week_save_composer_revision_v1'){stored=JSON.parse(JSON.stringify(args.p_draft));return {data:{composer_draft:stored}};}
      if(name==='week_read_composer_for_day_v1')return {data:{found:true,plan_item_id:'plan',composer_draft:stored}};
      if(name==='week_composer_prescription_preview_v1')return {data:{status:'PREVIEW'}};
      throw Error('Unexpected RPC '+name);
    },
  };
  const service=fs.readFileSync('src/services/composerService.js','utf8')
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g,'')
    .replaceAll('export async function ','async function ').replaceAll('export function ','function ');
  const tested=new Function('supabase','getAuthenticatedUserWithRetry','runSupabaseRequestWithAuthRetry','readComposerPreferences',
    service+'\nreturn {getComposerSkillTargets,getComposerPrescriptionPreview,saveComposerDraft,getComposerForLocalDate};')
    (supabase,async()=>({id:'synthetic'}),async fn=>{const r=await fn();if(r.error)throw r.error;return r.data;},read);
  const targets=await tested.getComposerSkillTargets();
  assert.deepEqual(targets.map(x=>x.key),['HANDSTAND_HSPU']);
  assert.ok(calls.some(x=>x[0]==='filter'&&x[1]==='active'&&x[2]===true));
  await tested.getComposerPrescriptionPreview({draft});
  assert.deepEqual(calls.find(x=>x[0]==='week_composer_prescription_preview_v1')[1].p_draft.preferences,preferences);
  await tested.saveComposerDraft({planItemId:'plan',draft,context:{duration_minutes:45},confirmReplacement:true});
  const saveCall=calls.find(x=>x[0]==='week_save_composer_revision_v1')[1];
  assert.equal(saveCall.p_confirm_replacement,true);assert.deepEqual(saveCall.p_context,{duration_minutes:45});
  const loaded=await tested.getComposerForLocalDate('2026-11-20');
  assert.deepEqual(loaded.preferences,preferences);
  assert.deepEqual(loaded.draft,JSON.parse(JSON.stringify(draft)));
  assert.deepEqual(loaded.draft.architecture,legacy.architecture);
  console.log('PASS: legacy/multi-zone preferences, conditional target, immutable blocks, fresh signatures and actual service transport');
}
transport().catch(error=>{console.error(error);process.exitCode=1;});
