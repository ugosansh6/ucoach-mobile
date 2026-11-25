const fs=require('node:fs'),assert=require('node:assert/strict');
const h=fs.readFileSync('src/utils/personalWorkoutModels.js','utf8').replaceAll('export function ','function ');
const a=new Function(h.replaceAll('export const ','const ')+';return {validModelDate,canReusePersonalModel,personalModelMeta,sortPersonalModels,personalProgramRows,buildPersonalProgramDraft};')();
assert.equal(a.validModelDate('2026-11-30','2026-11-25'),true);
assert.equal(a.validModelDate('2026-11-31','2026-11-25'),false);
assert.equal(a.validModelDate('2026-11-24','2026-11-25'),false);
const source={origin:'PROGRAM',source_payload:{week_start:1,environment_code:'HOME',frequency_per_week:2,exercises:[{}]}};
const model={origin:'COMPOSER',draft:{duration_minutes:60,architecture:{blocks:[{exercises:[{},{}]}]},prescription_preview:{status:'PREVIEW'}}};
assert.equal(a.canReusePersonalModel(source),false);assert.equal(a.canReusePersonalModel(model),true);
assert.deepEqual(a.personalModelMeta(source),{environment:'Maison',count:1,duration:null,frequency:2});
assert.equal(a.sortPersonalModels([model,source])[0],source);
const ui=fs.readFileSync('src/workout/WeekComposerV7.js','utf8');assert.match(ui,/requestedModelId\?null:requestedPlanItemId/);assert.match(ui,/imported\?\.draft\?\?saved.draft/);
assert.match(fs.readFileSync('src/services/composerService.js','utf8'),/week_save_composer_with_model_v1/);
assert.match(fs.readFileSync('app/(tabs)/library.js','utf8'),/section==='models'\?<PersonalModelsPage/);
console.log('PASS personal models routing, date validation, source completeness and ownership-scoped service wiring');
const street={origin:'PROGRAM',name:'Test',source_payload:{week_start:21,environment_code:'OUTDOOR',exercises:[{name:'Monkey Bars',dose:'3 traversées maîtrisées',candidate_ids:['EX583']}]}};assert.equal(a.canReusePersonalModel(street),true);const draft=a.buildPersonalProgramDraft(street,a.personalProgramRows(street.source_payload));assert.equal(draft.architecture.blocks[1].exercises[0].authored_dose.count_unit,'traversées');assert.equal(draft.architecture.blocks[1].exercises[0].authored_dose.sets,3);
const k=fs.readFileSync('src/utils/composerSkillExecution.js','utf8').replaceAll('export function ','function ');const x=new Function(k+';return {skillExecutionUnits,skillExecutionUpdates};')();const ex=[{sessionExerciseId:'a',name:'Monkey Bars',prescriptionJson:{sets:3,execution_target_count:1,count_unit:'traversées'}}];const units=x.skillExecutionUnits(ex);assert.equal(units.length,3);assert.equal(units[0].countUnit,'traversées');assert.equal(x.skillExecutionUpdates(ex,units,{[units[0].key]:{count_actual:1,count_unit:'traversées'}},false,'strength').a.performanceActualJson.gym_sets[0].count_actual,1);
assert.match(fs.readFileSync('src/workout/PersonalModelsPage.js','utf8'),/Ajouter à Ma semaine/);


 // Exercise the actual page handlers with isolated state and deferred requests.
 async function checkPersonalModelOperations(){
 const page=fs.readFileSync('src/workout/PersonalModelsPage.js','utf8');
 const cut=(start,end)=>page.slice(page.indexOf(start),page.indexOf(end));
 const handlers=cut('function beginOperation()', ' const [date,setDate]')+
   cut(' function changeDose(', ' const txt=')+
   cut(' function close()', ' function button(');
 const create=new Function(`
 let operation={current:false},busy=false,preview=null,error='',programRows=[{id:'old',authored_dose:{target:8}}],gearConfirmed=true,surface='ROAD',selectedId='old',name='old',confirm=true;
 let authored={equipment_ids:['E05']},ready=true,date='2026-11-25',selected={id:'old'},calls=0,resolve,reject,nav=0;
 const setBusy=v=>busy=v,setPreview=v=>preview=v,setError=v=>error=v,setProgramRows=v=>programRows=typeof v==='function'?v(programRows):v,setGearConfirmed=v=>gearConfirmed=v,setSurface=v=>surface=v,setSelectedId=v=>selectedId=v,setName=v=>name=v,setConfirm=v=>confirm=v,setRetry=()=>{};
 const personalProgramRows=source=>source.rows,modelDateKey=()=>date,validModelDate=()=>true,router={push:()=>nav++};
 const getComposerPrescriptionPreview=()=>{calls++;return new Promise((a,b)=>{resolve=a;reject=b;});};
 const planPersonalProgram=getComposerPrescriptionPreview;
 `+handlers+`
 return {calculateProgram,submitProgram,changeDose,chooseVariant,selectModel,action,resolve:v=>resolve(v),reject:e=>reject(e),state:()=>({busy,preview,error,programRows,gearConfirmed,surface,selectedId,calls,nav})};
 `) ;
 const x=create();
 const p=x.calculateProgram();await x.calculateProgram();
 x.changeDose(0,'target','20');x.chooseVariant(0,'new');
 assert.equal(x.state().calls,1);assert.equal(x.state().programRows[0].authored_dose.target,8);assert.equal(x.state().programRows[0].id,'old');
 x.resolve({status:'PREVIEW',duration_minutes:30});await p;
 assert.equal(x.state().preview.duration_minutes,30);assert.equal(x.state().busy,false);
 x.changeDose(0,'target','20');assert.equal(x.state().preview,null);assert.equal(x.state().programRows[0].authored_dose.target,20);
 const invalid=x.calculateProgram();x.resolve({status:'UNAVAILABLE'});await invalid;assert.equal(x.state().preview,null);assert.ok(x.state().error);assert.equal(x.state().busy,false);
 const first=x.submitProgram();await x.submitProgram();assert.equal(x.state().calls,3);x.resolve({status:'SAVED'});await first;assert.equal(x.state().nav,1);assert.equal(x.state().busy,false);
 const failure=x.calculateProgram();x.reject(new Error('network'));await failure;assert.equal(x.state().busy,false);
 const copy={id:'copy',origin:'PROGRAM',source_payload:{rows:[{id:'copy-ex',authored_dose:{target:8}}]}};
 await x.action(async()=>x.selectModel(copy));assert.equal(x.state().selectedId,'copy');assert.equal(x.state().programRows[0].id,'copy-ex');assert.equal(x.state().gearConfirmed,false);assert.equal(x.state().surface,null);assert.equal(x.state().preview,null);
 assert.match(page,/duplicatePersonalWorkoutModel\(selected.id\);selectModel\(copy\)/);
 console.log('PASS personal model concurrent requests, stale preview, failure unlock and duplicate state');
 }
 checkPersonalModelOperations().catch(e=>{console.error(e);process.exitCode=1;});
