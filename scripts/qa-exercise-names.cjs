const fs=require('node:fs'),assert=require('node:assert/strict'),parser=require('@babel/parser');
const catalogue=require('../src/constants/exerciseNamesV6.json');
assert.equal(Object.keys(catalogue).length,356);
assert.ok(Object.values(catalogue).every(e=>e.fr&&e.en&&['fr','en'].includes(e.priority)));
const source=fs.readFileSync('src/utils/exerciseNames.js','utf8').replace(/^import .*?;\s*/,'').replace(/export /g,'');
const {resolveExerciseNames,exerciseSearchMatches,normalizeExerciseNameMode}=new Function('catalogue',source+';return {resolveExerciseNames,exerciseSearchMatches,normalizeExerciseNameMode};')(catalogue);
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
const files=['app/_layout.js','app/profile/index.js','app/(tabs)/library.js','app/exercise/[exerciseId].js','src/components/exercises/ExerciseName.js','src/components/exercises/ExerciseDetail.js','src/contexts/ExerciseNameContext.js','src/workout/ComposerExercisePickerPage.js','src/components/routines/RoutinePresentation.js','src/components/workout/ComposerSkillPlayer.js','src/components/workout/WodProtocolPlayerV3.js','src/components/workout/WodProtocolPlayer.js','app/workout/session-focused-core.js','app/workout/session-arena-core.js','app/workout/environment-session-core.js','src/components/workout/SessionOverviewSheet.js','src/workout/WeekComposerV7.js','src/workout/PersonalModelsPage.js','app/workout/[sessionId].js','app/workout/completion-core.js','app/progression/detail.js','app/(tabs)/progression.js','app/progression/records.js','app/workout/external.js','app/(tabs)/planning.js','app/workout/debrief.js','src/components/workout/EnvironmentSwapOverlay.js','src/services/performanceRecordService.js','src/services/externalSessionService.js'];
for(const p of files){const body=fs.readFileSync(p,'utf8');parser.parse(body,{sourceType:'module',plugins:['jsx']});}
console.log('PASS 356 bilingual catalogue entries, mode switching, detail, no duplicate identical labels, personal/legacy fallback, accents and aliases, JSX syntax');
