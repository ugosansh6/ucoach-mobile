#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),parser=require('@babel/parser');
const constants=fs.readFileSync('src/constants/outdoorContext.js','utf8');
const places=new Function(constants.replaceAll('export ','')+';return {OUTDOOR_PLACES,selectableOutdoorPlaces,terrainOptionsForPlace};')();
const outdoor=new Function('OUTDOOR_PLACES',fs.readFileSync('src/utils/composerOutdoor.js','utf8').replace(/^import .*;\n/m,'').replaceAll('export ','')+';return {composerOutdoorContext,composerUsesOutdoorEngine};')(places.OUTDOOR_PLACES);
assert.deepEqual(outdoor.composerOutdoorContext(),{place_code:null,surface_code:null,running_allowed:true,reliable_distance:false});
const saved={place_code:'PARK',surface_code:'GRASS',running_allowed:false,reliable_distance:true};
assert.deepEqual(outdoor.composerOutdoorContext({},saved),saved);
const actual=outdoor.composerOutdoorContext({outdoorPlaceCode:'ATHLETICS_TRACK',surfaceCode:'TRACK',runningAllowed:true},saved);
assert.equal(actual.surface_code,'TRACK');assert.equal(actual.running_allowed,true);assert.equal(saved.surface_code,'GRASS');
assert.equal(outdoor.composerUsesOutdoorEngine({environment_code:'OUTDOOR'}),false,'No silent migration of old drafts');
assert.equal(outdoor.composerUsesOutdoorEngine({environment_code:'OUTDOOR',outdoor_engine_version:'COMPOSER_OUTDOOR_V1'}),true);
assert.equal(places.selectableOutdoorPlaces().some(p=>p.code==='GRASS_FIELD'),false);
assert.deepEqual(places.terrainOptionsForPlace(places.OUTDOOR_PLACES.find(p=>p.code==='BEACH')),[]);
const editor=new Function(fs.readFileSync('src/utils/composerArchitectureEditor.js','utf8').replaceAll('export ','')+';return {composerAddableBlocks,editComposerArchitecture};')();
let architecture={estimatedMinutes:60,transitionReserveMinutes:5,blocks:[{type:'WARMUP',minutes:6},{type:'TABATA',minutes:4},{type:'CARDIO',minutes:45}]};
assert.deepEqual(editor.composerAddableBlocks(architecture,'OUTDOOR'),['SKILL','WOD']);
assert.equal(editor.composerAddableBlocks({blocks:[{type:'STRENGTH',minutes:45}]},'OUTDOOR',null,false).includes('CARDIO'),false,'An old draft must explicitly recompose before receiving a new producer contract');
for(const action of [{kind:'add',blockType:'SKILL'},{kind:'add',blockType:'WOD'},{kind:'move',blockType:'WOD',direction:-1},{kind:'minutes',blockType:'CARDIO',delta:-2}]){
 const r=editor.editComposerArchitecture(architecture,action);assert.equal(r.ok,true);architecture=r.architecture;
 assert.equal(architecture.blocks.reduce((s,b)=>s+b.minutes,5),60);
}
assert.deepEqual(architecture.blocks.map(b=>b.type),['WARMUP','TABATA','CARDIO','WOD','SKILL']);
assert.deepEqual(editor.composerAddableBlocks(architecture,'OUTDOOR'),[]);
assert.equal(editor.editComposerArchitecture(architecture,{kind:'remove',blockType:'CARDIO'}).ok,true);
// Execute the actual timed Player before its JSX return: interval boundaries,
// pause/start gates, partial result, final recovery and exact total.
const source=fs.readFileSync('app/workout/environment-session-core.js','utf8');
const nodes=parser.parse(source,{sourceType:'module',plugins:['jsx']}).program.body;
function declaration(name){const node=nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,name);return source.slice(node.start,node.end);}
const helpers=['normalize','numberOr','positiveInt','blockMechanic','blockParameters','isRunMechanic','runFamilyLabel','runIntensityCueLabel','runRecoveryCueLabel','formatRunDuration','blockTitle'].map(declaration).join('\n');
const timed=declaration('TimedBlock');
const logic=timed.slice(0,timed.indexOf('  if (!isRun) {'))+'return {prescribedSeconds,phase,repeats,finish,startTimedBlock};\n}';
function render({elapsed=0,started=true,paused=false,enabled=true,mechanic='RUN_INTERVALS'}={}){
 const state=[started,paused,elapsed,'',''],effects=[],results=[],updates=[],timers=[];let index=0;
 const deps={useRef:v=>({current:v}),restoreRunningClock:v=>v,useUgerodTheme:()=>({colors:{},isDark:false}),useMemo:f=>f(),
 createOutdoorRunStyles:()=>({}),createTimedBlockStyles:()=>({}),useState:v=>{const i=index++;return [state[i],n=>updates.push([i,typeof n==='function'?n(state[i]):n])];},
 useEffect:f=>effects.push(f),Alert:{alert(){}},setInterval:f=>{timers.push(f);return 1;},clearInterval:()=>{}};
 const factory=new Function(...Object.keys(deps),helpers+'\n'+logic+';return TimedBlock;')(...Object.values(deps));
 const params={duration_seconds:mechanic==='RUN_CONTINUOUS'?1020:900,repeats:5,work_seconds:120,recovery_seconds:60};
 const player=factory({block:{block_key:'cardio',mechanic,mechanic_json:{parameters:params},duration_minutes:45},exercise:{},environmentCode:'OUTDOOR',executionEnabled:enabled,onComplete:r=>results.push(r)});
 return {player,results,effects,timers,updates};
}
for(const [elapsed,label,count] of [[0,'EFFORT',0],[119,'EFFORT',0],[120,'RÉCUPÉRATION',1],[179,'RÉCUPÉRATION',1],[180,'EFFORT',1],[899,'RÉCUPÉRATION',5],[900,'TERMINÉ',5]]){
 const r=render({elapsed});assert.equal(r.player.prescribedSeconds,900,'Use exact protocol, never the reserved 45-min budget');
 assert.equal(r.player.phase.label,label);assert.equal(r.player.phase.completedIntervals,count);
 r.player.finish();assert.equal(r.results[0].protocolCompleted,elapsed===900);assert.equal(r.results[0].intervalsCompleted,count);
}
for(const args of [{started:false},{enabled:false}]){const r=render(args);r.player.finish();assert.equal(r.results.length,0);}
for(const args of [{paused:true},{started:false},{enabled:false},{elapsed:900}]){const r=render(args);r.effects[1]();assert.equal(r.timers.length,0);}
assert.equal(render({mechanic:'RUN_CONTINUOUS'}).player.prescribedSeconds,1020);
const ui=fs.readFileSync('src/workout/WeekComposerV7.js','utf8');
assert.match(ui,/outdoor_context: outdoorContext/);assert.match(ui,/outdoorGym: outdoorEngine/);
assert.match(ui,/automatic_selection: outdoorEngine && !skillTargetPath/);
assert.match(ui,/surface_code: outdoorContext.surface_code, outdoor_place_code: outdoorContext.place_code/);
assert.match(fs.readFileSync('src/services/workoutGenerationService.js','utf8'),/composerUsesOutdoorEngine\(planned.draft\) \? 'week_compile_composer_outdoor_day_j_v1' : 'week_compile_composer_day_j_v1'/);
assert.match(fs.readFileSync('src/workout/PreparationCheckinV4.js','utf8'),/outdoorPlaceCode: draft.outdoor_context\?\.place_code/);
console.log('PASS Outdoor context/reopen/actual terrain, legacy routing, block composition and exact existing Player course/interval timing, pause and outcomes');
// Render the actual compact preview in both themes, including a shorter
// protocol than the user's reserved duration; no fabricated filling dose.
const babel=require('@babel/core'),React=require('react'),RN=require('react-native-web'),{renderToStaticMarkup}=require('react-dom/server');
const preview=fs.readFileSync('src/components/workout/ComposerOutdoorCardioPreview.js','utf8');
const code=babel.transformSync(preview,{babelrc:false,configFile:false,presets:[['@babel/preset-react',{runtime:'automatic'}]],plugins:['@babel/plugin-transform-modules-commonjs']}).code;
const previewModule={exports:{}};
new Function('require','module','exports',code)(name=>name==='react-native'?RN:require(name),previewModule,previewModule.exports);
for(const dark of [false,true]){
 const html=renderToStaticMarkup(React.createElement(previewModule.exports.default,{minutes:45,styles:{},block:{mechanic:'RUN_INTERVALS',time:{prescribed_seconds:1800},exercises:[{prescription_json:{text:'10 × 120 s effort · 60 s récupération'}}]}}));
 assert.match(html,/45 min réservées/);assert.match(html,/30 min de protocole/);assert.match(html,/60 s récupération/);assert.doesNotMatch(html,/Renforcement|Musculation/);
}
console.log('PASS actual Outdoor preview SSR in both themes, reserved budget vs prescribed cycles and recovery');

async function testDayJTransport(){
 const service=fs.readFileSync('src/services/workoutGenerationService.js','utf8');
 const ast=parser.parse(service,{sourceType:'module'}).program.body;
 const get=name=>{const node=ast.map(n=>n.declaration??n).find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return service.slice(node.start,node.end);};
 const calls=[],saved={planItemId:'item',draft:{duration_minutes:60,environment_code:'OUTDOOR',outdoor_engine_version:'COMPOSER_OUTDOOR_V1',outdoor_context:savedContext()}};
 function savedContext(){return {place_code:'PARK',surface_code:'GRASS',running_allowed:false,reliable_distance:false};}
 const deps={composerOutdoorContext:outdoor.composerOutdoorContext,composerUsesOutdoorEngine:outdoor.composerUsesOutdoorEngine,
 getComposerForLocalDate:async()=>saved,getAuthenticatedUserWithRetry:async()=>({id:'user'}),runSupabaseRequestWithAuthRetry:async fn=>fn(),
 reloadWorkoutSession:async({sessionId})=>({sessionId}),composerPreviewIssue:()=>'',supabase:{rpc:async(name,args)=>{calls.push({name,args});return {status:'READY',session_id:'session'};}}};
 const finalize=new Function(...Object.keys(deps),['localDateKey','normalizeEnvironment','selectedEquipmentNames','finalizeComposerWorkoutSession'].map(get).join('\n')+';return {finalizeComposerWorkoutSession,localDateKey};')(...Object.values(deps));
 const preparation={duration:60,environmentCode:'OUTDOOR',outdoorPlaceCode:'FOREST_PATH',surfaceCode:'TRAIL',runningAllowed:true,readiness:6,painZones:['Aucune'],equipment:['Poids du corps']};
 await finalize.finalizeComposerWorkoutSession({planItemId:'item',localDate:finalize.localDateKey(),preparation});
 assert.equal(calls[0].name,'week_compile_composer_outdoor_day_j_v1');assert.equal(calls[0].args.p_outdoor_context.surface_code,'TRAIL');assert.equal(calls[0].args.p_outdoor_context.running_allowed,true);
 assert.equal(saved.draft.outdoor_context.surface_code,'GRASS','Actual check-in must not overwrite the saved draft');
 delete saved.draft.outdoor_engine_version;
 await finalize.finalizeComposerWorkoutSession({planItemId:'item',localDate:finalize.localDateKey(),preparation});
 assert.equal(calls[1].name,'week_compile_composer_day_j_v1');assert.equal('p_outdoor_context' in calls[1].args,false,'Preserve old RPC contracts');
 console.log('PASS actual Day-J service RPC, current terrain/running preference, saved draft isolation and old draft route');
}
testDayJTransport().catch(error=>{console.error(error);process.exitCode=1;});

async function testArchitectureTransport(){
 const service=fs.readFileSync('src/services/composerService.js','utf8');
 const start=service.indexOf('export async function getComposerArchitectureProposal('),end=service.indexOf('\nexport async function getComposerCardioProposal',start);
 const calls=[];
 const api=new Function('getAuthenticatedUserWithRetry','runSupabaseRequestWithAuthRetry','supabase',service.slice(start,end).replace('export ','')+';return getComposerArchitectureProposal;')(
 async()=>({id:'user'}),async fn=>fn(),{rpc:async(name,args)=>{calls.push({name,args});return {status:'READY',options:[]};}});
 const context={place_code:'PARK',surface_code:'ROAD',running_allowed:false};
 await api({durationMinutes:60,environmentCode:'OUTDOOR',outdoorContext:context,skillTargetPath:'HANDSTAND_HSPU'});
 assert.deepEqual(calls[0],{name:'week_composer_outdoor_architectures_v1',args:{p_duration:60,p_context:context,p_skill_target:'HANDSTAND_HSPU'}});
 await api({durationMinutes:60,environmentCode:'GYM'});
 assert.deepEqual(calls[1],{name:'week_composer_architectures_v1',args:{p_duration:60,p_environment:'GYM'}});
 console.log('PASS actual architecture service forwards target/terrain/course to existing module adapter, Salle route unchanged');
}
testArchitectureTransport().catch(error=>{console.error(error);process.exitCode=1;});

async function testSavedHydration(){
 const screen=fs.readFileSync('src/workout/WeekComposerV7.js','utf8'),tree=parser.parse(screen,{sourceType:'module',plugins:['jsx']});
 function find(node){if(!node||typeof node!=='object')return null;if(node.type==='FunctionDeclaration'&&node.id?.name==='load')return node;for(const v of Object.values(node)){if(Array.isArray(v)){for(const child of v){const r=find(child);if(r)return r;}}else{const r=find(v);if(r)return r;}}return null;}
 const node=find(tree);assert.ok(node,'Saved draft loader');const logic=screen.slice(node.start,node.end);
 const preferences=new Function(fs.readFileSync('src/utils/composerPreferences.js','utf8').replaceAll('export ','')+';return readComposerPreferences;')();
 for(const modern of [true,false]){
  const state={},cardioCalls=[],formatCalls=[];
  const blocks=modern?[{type:'WARMUP',minutes:6,exercises:[{id:'EX158'}]},{type:'TABATA',minutes:4,exercises:[{id:'EX087'}]},
   {type:'CARDIO',minutes:12,exercises:[{id:'EX313',name:'Course'}]},{type:'SKILL',minutes:16,exercises:[{id:'EX411'}]},
   {type:'WOD',minutes:17,exercises:[{id:'EX006'},{id:'EX033'}]}]:[{type:'STRENGTH',minutes:45,exercises:[{id:'EX033'}]}];
  const draft={environment_code:'OUTDOOR',duration_minutes:60,equipment_ids:[],intent:{focus:'Conditioning'},architecture:{blocks},
   ...(modern?{outdoor_engine_version:'COMPOSER_OUTDOOR_V1',outdoor_context:{place_code:'PARK',surface_code:'GRASS',running_allowed:true},skill_engine_version:'C4_COMPOSER_SKILL_V1',mechanic:{key:'AMRAP'},wod_engine_version:'C4_COMPOSER_V2'}:{})};
  const original=JSON.stringify(draft),protocol={mechanic:'RUN_INTERVALS',duration_minutes:12};
  const restoreManual=new Function(fs.readFileSync('src/utils/composerManualDose.js','utf8').replaceAll('export function ','function ')+';return restoreComposerManualEdits;')();
  const deps={active:true,dateKey:'2026-11-21',requestedPlanItemId:'item',requestedModelId:null,explicitAdditional:false,params:{},getWeekViewDate:date=>({anchorDate:date}),DURATIONS:[60],COMPOSER_OUTDOOR_VERSION:'COMPOSER_OUTDOOR_V1',
   getWeekReadContract:async()=>({visibleItems:[{planItemId:'item',recommendedDate:'2026-11-21',plannedContext:{environmentCode:'OUTDOOR'}}]}),
   getEquipmentCatalog:async()=>[],getComposerForLocalDate:async()=>({planItemId:'item',date:'2026-11-21',draft}),getUserEnvironmentEquipmentPreset:async()=>[],buildReferenceEquipment:()=>[],
   coachIntentFromItem:()=>null,readComposerPreferences:preferences,restoreComposerManualEdits:restoreManual,composerOutdoorContext:outdoor.composerOutdoorContext,firstParam:v=>v,
   getComposerCardioProposal:async context=>{cardioCalls.push(context);return [{id:'EX313',name:'Course',cardioProtocol:protocol}];},
   getComposerExerciseCandidates:async({blockType})=>{assert.notEqual(blockType,'CARDIO','Never hydrate a saved Cardio from the WOD exercise catalogue');return blocks.find(b=>b.type===blockType)?.exercises??[];},
   getComposerCandidateEvidence:async()=>({}),getComposerMechanicOptions:async args=>{formatCalls.push(args);return [{key:'AMRAP'},{key:'EMOM'}];}};
  for(const setter of new Set(logic.match(/\bset[A-Z]\w*/g)))deps[setter]=value=>{state[setter]=typeof value==='function'?value(state[setter]):value;};
  await new Function(...Object.keys(deps),logic+';return load();')(...Object.values(deps));
  assert.equal(state.setError,'');assert.equal(state.setStep,5);assert.equal(JSON.stringify(draft),original,'Reopening must not rewrite saved preferences or exercises');
  assert.deepEqual(state.setSelectionMap,Object.fromEntries(blocks.map(b=>[b.type,b.exercises.map(e=>e.id)])));
  if(modern){assert.equal(cardioCalls.length,1);assert.equal(cardioCalls[0].outdoor_context.surface_code,'GRASS');assert.equal(cardioCalls[0].block_minutes,12);
   assert.deepEqual(state.setCandidateMap.CARDIO.map(e=>e.id),['EX313']);assert.equal(state.setCandidateMap.CARDIO[0].cardioProtocol,protocol);
   assert.equal(formatCalls.length,1,'All WOD formats must be refreshed on reopen, not hidden by an undefined block variable');assert.equal(state.setMechanicOptions.length,2);
  }else{assert.equal(cardioCalls.length,0);assert.equal(state.setOutdoorEngineVersion,null);assert.equal(state.setArchitecture,draft.architecture);}
 }
 console.log('PASS actual saved-screen loader: course protocol only, all WOD alternatives reloaded, exact selected exercise order and no old-draft migration');
}
testSavedHydration().catch(error=>{console.error(error);process.exitCode=1;});
