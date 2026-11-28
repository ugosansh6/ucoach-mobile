const fs=require('node:fs'),assert=require('node:assert/strict'),parser=require('@babel/parser');
const catalogue=require('../src/constants/exerciseNamesV6.json');
assert.equal(Object.keys(catalogue).length,356);
assert.ok(Object.values(catalogue).every(e=>e.fr&&e.en&&['fr','en'].includes(e.priority)));
const source=fs.readFileSync('src/utils/exerciseNames.js','utf8').replace(/^import .*?;\s*/,'').replace(/export /g,'');
const {resolveExerciseNames,exerciseSearchMatches,normalizeExerciseNameMode,matchingExerciseNameIds}=new Function('catalogue',source+';return {resolveExerciseNames,exerciseSearchMatches,normalizeExerciseNameMode,matchingExerciseNameIds};')(catalogue);
assert.deepEqual(resolveExerciseNames({id:'EX081',name:'Old name'}),{primary:'Dead Bug',secondary:catalogue.EX081.fr});
assert.deepEqual(resolveExerciseNames({id:'EX411'}),{primary:'Tractions scapulaires',secondary:'Scapular Pull-up'});
assert.equal(resolveExerciseNames({id:'EX081'},'fr').secondary,null);
assert.equal(resolveExerciseNames({id:'EX081'},'fr',{detail:true}).secondary,'Dead Bug');
assert.equal(resolveExerciseNames({id:'EX081'},'en').primary,'Dead Bug');
assert.deepEqual(resolveExerciseNames({id:'EX144'}),{primary:'Sprawl',secondary:null});
assert.deepEqual(resolveExerciseNames({exercise_id:null,name:'Dead Bug'}),{primary:'Dead Bug',secondary:null});
assert.deepEqual(resolveExerciseNames({id:'unknown',name:'Historic'}),{primary:'Historic',secondary:null});
assert.ok(exerciseSearchMatches({id:'EX411'},'tractions scapulaires'));
assert.ok(exerciseSearchMatches({id:'EX411'},'scapular pullup'));
assert.ok(exerciseSearchMatches({id:'EX043'},'TRX'));
assert.ok(exerciseSearchMatches({id:'EX416'},'rotation diagonale avec elastique'));
assert.equal(exerciseSearchMatches({id:'EX411'},'zzzz'),false);
assert.equal(normalizeExerciseNameMode('invalid'),'bilingual');
for(const id of Object.keys(catalogue)){assert.ok(resolveExerciseNames({id}).primary,id);assert.ok(exerciseSearchMatches({id},catalogue[id].fr),id);assert.ok(exerciseSearchMatches({id},catalogue[id].en),id);}
assert.deepEqual(matchingExerciseNameIds(''),[]);
assert.deepEqual(matchingExerciseNameIds('zzzz'),[]);
assert.ok(matchingExerciseNameIds('TRX').includes('EX043'));
assert.ok(matchingExerciseNameIds('rotation diagonale avec elastique').includes('EX416'));
for(const id of Object.keys(catalogue)){
  const {primary,secondary}=resolveExerciseNames(id);
  assert.ok(matchingExerciseNameIds(primary).includes(id),id+' primary');
  if(secondary)assert.ok(matchingExerciseNameIds(secondary).includes(id),id+' secondary');
}
const files=['app/_layout.js','app/profile/index.js','app/(tabs)/library.js','app/exercise/[exerciseId].js','src/components/exercises/ExerciseName.js','src/components/exercises/ExerciseDetail.js','src/contexts/ExerciseNameContext.js','src/workout/ComposerExercisePickerPage.js','src/components/routines/RoutinePresentation.js','src/components/workout/ComposerSkillPlayer.js','src/components/workout/WodProtocolPlayerV3.js','src/components/workout/WodProtocolPlayer.js','app/workout/session-focused-core.js','app/workout/session-arena-core.js','app/workout/environment-session-core.js','src/components/workout/SessionOverviewSheet.js','src/workout/WeekComposerV7.js','src/workout/PersonalModelsPage.js','app/workout/[sessionId].js','app/workout/completion-core.js','app/progression/detail.js','app/(tabs)/progression.js','app/progression/records.js','app/workout/external.js','app/(tabs)/planning.js','app/workout/debrief.js','src/components/workout/EnvironmentSwapOverlay.js','src/services/performanceRecordService.js','src/services/externalSessionService.js','src/services/userSessionBuilderService.js','src/utils/exerciseNames.js'];
for(const p of files){const body=fs.readFileSync(p,'utf8');parser.parse(body,{sourceType:'module',plugins:['jsx']});}
console.log('PASS 356 bilingual catalogue entries, mode switching, detail, no duplicate identical labels, personal/legacy fallback, accents and aliases, JSX syntax');

async function testBuilderSearch() {
  const builderSource=fs.readFileSync('src/services/userSessionBuilderService.js','utf8').replace(/^import .*?;\s*/gm,'').replace(/export /g,'');
  const calls=[];
  let responseMode='v3';
  const supabase={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name.endsWith('_v3')) {
      if(responseMode==='missing')return {error:{code:'PGRST202'}};
      if(responseMode==='denied')return {error:{code:'42501',message:'Forbidden'}};
      return {data:{results:[{exercise_id:'EX043',selectable:false}]}};
    }
    return {data:{results:[]}};
  }};
  const getExercises=new Function('supabase','exerciseSearchMatches','matchingExerciseNameIds',builderSource+';return getUserSessionBuilderExercises;')(supabase,exerciseSearchMatches,matchingExerciseNameIds);
  const input={draftId:'test',moduleCode:'STRENGTH',query:'TRX',includeUnavailable:true};
  const result=await getExercises(input);
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'get_user_session_builder_exercises_v3');
  assert.ok(calls[0].args.p_bilingual_match_ids.includes('EX043'));
  assert.equal(calls[0].args.p_include_unavailable,true);
  assert.equal(result.results[0].selectable,false);
  calls.length=0;
  await getExercises({...input,query:null});
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'get_user_session_builder_exercises_v2');
  calls.length=0;responseMode='missing';
  await getExercises(input);
  assert.equal(calls.length,3);
  assert.equal(calls[1].name,'get_user_session_builder_exercises_v2');
  calls.length=0;responseMode='denied';
  await assert.rejects(getExercises(input),/Forbidden/);
  assert.equal(calls.length,1);
  console.log('PASS complete bilingual candidate IDs, server eligibility preserved, no-query legacy path, old-environment fallback and forbidden error');
}
testBuilderSearch().catch(error=>{console.error(error);process.exitCode=1;});
