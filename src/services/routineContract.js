// Pure configuration and daily adherence rules. No training-engine dependency.
export const ROUTINE_CATEGORIES={MOBILITY:'Mobilité',CORE:'Abdos & gainage',PHYSIO:'Kiné',CONDITIONING:'Conditioning'};
export const ROUTINE_MECHANICS={SETS_REPS:'Séries / répétitions ou maintien',CIRCUIT:'Circuit',HIIT:'Intervalles personnalisés',TABATA:'Tabata 20/10'};
export const ROUTINE_DAYS=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const integer=(value,max,label)=>{
  if(!/^[1-9][0-9]*$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)>max)throw new Error(label+' : nombre entier positif attendu.');
  return Number(value);
};
export const isIntervalRoutine=mechanic=>['HIIT','TABATA'].includes(mechanic);
export const TABATA_CYCLES=8;
export function availableTabataBlocks(minutes){const m=Number(minutes);return Number.isInteger(m)&&m>=4&&m<=30?[1,2,3].filter(b=>m>=[0,4,10,14][b]):[];}
export const isBlockTabata=r=>r?.mechanic==='TABATA'&&r.parameters?.blocks!=null&&r.parameters.blocks!=='';
export function tabataBlockExerciseIndices(r,block){return (r.exercises??[]).map((e,i)=>({e,i})).filter(({e})=>Number(e.tabata_block??1)===block).map(({i})=>i);}
export function tabataCycleExerciseIndices(r,block){const indices=tabataBlockExerciseIndices(r,block);return indices.length?Array.from({length:8},(_,i)=>indices[i%indices.length]):[];}
export function tabataIndexForCycle(r,cycle){return tabataCycleExerciseIndices(r,Math.floor((cycle-1)/8)+1)[(cycle-1)%8];}
export function routineTimeLimit(minutes){return Math.min(30,Number(minutes)+2)*60;}
const nonnegative=(v,max,label)=>String(v)==='0'?0:integer(v,max,label);
export function routineKnownSeconds(routine){
  const p=routine.parameters??{},es=routine.exercises??[];
  if(isBlockTabata(routine))return Number(p.blocks)*240;
  if(isIntervalRoutine(routine.mechanic))return Number(p.rounds)*es.length*(Number(p.work_seconds)+Number(p.rest_seconds));
  const holds=es.reduce((sum,e)=>sum+(Number(e.duration_seconds)||0)*(Number(e.sets)||1),0);
  return routine.mechanic==='CIRCUIT'?holds*p.rounds+(p.rounds-1)*p.rest_seconds:holds;
}
export function normalizeRoutineDraft(draft){
  const name=String(draft.name??'').trim();
  if(!name||name.length>120)throw new Error('Renseigne un nom de routine.');
  if(!Object.prototype.hasOwnProperty.call(ROUTINE_CATEGORIES,draft.category))throw new Error('Choisis une catégorie.');
  const planned_minutes=integer(draft.planned_minutes,30,'Durée prévue (30 min maximum)');
  const recurrence_days=[...new Set(draft.recurrence_days??[])].sort((a,b)=>a-b);
  if(recurrence_days.some(n=>!Number.isInteger(n)||n<0||n>6))throw new Error('Jours de récurrence invalides.');
  if(!Array.isArray(draft.exercises)||!draft.exercises.length)throw new Error('Ajoute au moins un exercice.');
  const mechanic=draft.mechanic??'SETS_REPS';
  if(!Object.prototype.hasOwnProperty.call(ROUTINE_MECHANICS,mechanic))throw new Error('Choisis une mécanique disponible.');
  const raw=draft.parameters??{};
  const fixedTabata=isBlockTabata(draft);
  if(fixedTabata&&!availableTabataBlocks(planned_minutes).includes(Number(raw.blocks)))throw new Error('Choisis un nombre de Tabata compatible avec la durée prévue.');
  const parameters=fixedTabata?{blocks:integer(raw.blocks,3,'Nombre de Tabata'),work_seconds:20,rest_seconds:10}:mechanic==='SETS_REPS'?{}:{rounds:integer(raw.rounds,9999,'Tours'),rest_seconds:mechanic==='TABATA'?10:nonnegative(raw.rest_seconds,9999,'Récupération'),...(isIntervalRoutine(mechanic)?{work_seconds:mechanic==='TABATA'?20:integer(raw.work_seconds,9999,'Effort')}: {})};
  const exercises=draft.exercises.map((e,i)=>{
    const label=String(e.name??'').trim();
    if(!label||label.length>200)throw new Error('Renseigne le nom de l’exercice '+(i+1)+'.');
    const base={name:label,exercise_id:e.exercise_id??null};
    if(fixedTabata)return {...base,tabata_block:integer(e.tabata_block??1,parameters.blocks,'Bloc — '+label)};
    if(isIntervalRoutine(mechanic))return base;
    const sets=mechanic==='CIRCUIT'?1:integer(e.sets,9999,'Séries — '+label);
    const timed=e.doseMode==='TIME'||(e.doseMode==null&&e.duration_seconds!=null);
    return {...base,sets,...(timed?{duration_seconds:integer(e.duration_seconds,9999,'Maintien — '+label)}:{reps:integer(e.reps,9999,'Répétitions — '+label)})};
  });
  const routine={name,category:draft.category,mechanic,parameters,planned_minutes,recurrence_days,exercises};
  if(fixedTabata){for(let b=1;b<=parameters.blocks;b++){const count=tabataBlockExerciseIndices(routine,b).length;if(count<1||count>8)throw new Error('Tabata '+b+' : choisis entre 1 et 8 mouvements.');}}
  const limit=mechanic==='TABATA'?planned_minutes*60:routineTimeLimit(planned_minutes);
  if(routineKnownSeconds(routine)>limit)throw new Error('Les temps prescrits dépassent la durée prévue. Ajuste la durée (30 min maximum) ou les prescriptions.');
  return routine;
}
export function localRoutineDate(date=new Date()){
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
export function buildRoutineDayRows(routines,realizations,date=new Date(),checkpoint=null){
  const done=new Set((realizations??[]).filter(r=>r.local_date===localRoutineDate(date)).map(r=>r.routine_id));
  const active=checkpoint?.routine?.id;
  return (routines??[]).filter(r=>done.has(r.id)||(!r.archived_at&&(r.id===active||(r.recurrence_days??[]).includes(date.getDay()))))
    .map(r=>({id:r.id,name:r.name,plannedMinutes:r.planned_minutes,completed:done.has(r.id),active:!r.archived_at&&r.id===active,archived:Boolean(r.archived_at)}));
}
export function advanceRoutineSet(exercises,index,setNumber){
  if(!exercises[index])throw new Error('Exercice indisponible.');
  if(setNumber<exercises[index].sets)return {index,setNumber:setNumber+1,finished:false};
  if(index+1<exercises.length)return {index:index+1,setNumber:1,finished:false};
  return {index,setNumber,finished:true};
}

function workStep(routine,index=0,setNumber=1,round=1){
 const e=routine.exercises[index];
 return {index,setNumber,round,phase:'work',remaining:isIntervalRoutine(routine.mechanic)?routine.parameters.work_seconds:e.duration_seconds??null};
}
export function initialRoutineStep(routine){return workStep(routine,isBlockTabata(routine)?tabataIndexForCycle(routine,1):0);}
function doneStep(s){return {...s,phase:'done',remaining:null};}
function nextStation(r,s){
 if(s.index+1<r.exercises.length)return workStep(r,s.index+1,1,s.round);
 if(s.round<r.parameters.rounds)return workStep(r,0,1,s.round+1);
 return doneStep(s);
}
export function advanceRoutinePhase(r,s){
 if(s.phase==='done')return s;
 const p=r.parameters??{};
 if(isIntervalRoutine(r.mechanic)){
   if(s.phase==='work'&&p.rest_seconds>0)return {...s,phase:'rest',remaining:p.rest_seconds};
   if(isBlockTabata(r)){const cycle=s.round+1;return cycle>p.blocks*8?doneStep(s):workStep(r,tabataIndexForCycle(r,cycle),1,cycle);}
   return nextStation(r,s);
 }
 if(r.mechanic==='CIRCUIT'){
   if(s.phase==='rest')return workStep(r,0,1,s.round+1);
   if(s.index+1<r.exercises.length)return workStep(r,s.index+1,1,s.round);
   if(s.round>=p.rounds)return doneStep(s);
   return p.rest_seconds>0?{...s,phase:'rest',remaining:p.rest_seconds}:workStep(r,0,1,s.round+1);
 }
 const next=advanceRoutineSet(r.exercises,s.index,s.setNumber);
 return next.finished?doneStep(s):workStep(r,next.index,next.setNumber,1);
}
export function consumeRoutineSeconds(r,s,seconds){
 let remaining=Math.max(0,Math.floor(seconds)),state=s;
 while(remaining>0&&state.phase!=='done'&&state.remaining!=null){
   if(remaining<state.remaining)return {...state,remaining:state.remaining-remaining};
   remaining-=state.remaining;state=advanceRoutinePhase(r,state);
   // Holds are individually initiated; do not silently credit the next hold.
   if(!isIntervalRoutine(r.mechanic)&&state.phase==='work')return state;
 }
 return state;
}
export function validRoutineCheckpoint(value,date=new Date()){
 try{
   if(value?.version!==2||value.local_date!==localRoutineDate(date)||typeof value.routine?.id!=='string')return null;
   const r={...value.routine,...normalizeRoutineDraft(value.routine)},s=value.step;
   const fixed=isBlockTabata(r),totalRounds=fixed?r.parameters.blocks*8:(r.parameters.rounds??1);
   if(!s||!['work','rest','done'].includes(s.phase)||!Number.isInteger(s.index)||s.index<0||s.index>=r.exercises.length||
      !Number.isInteger(s.round)||s.round<1||s.round>totalRounds||!Number.isInteger(s.setNumber)||s.setNumber<1||s.setNumber>(r.exercises[s.index].sets??1))return null;
   if(fixed&&(s.index!==tabataIndexForCycle(r,s.round)||s.setNumber!==1))return null;
   if(s.phase==='done'){if(s.remaining!==null||s.index!==(fixed?tabataIndexForCycle(r,totalRounds):r.exercises.length-1)||s.round!==totalRounds||s.setNumber!==(r.exercises[s.index].sets??1))return null;}
   else if(s.phase==='rest'){
     if(!r.parameters.rest_seconds||!Number.isInteger(s.remaining)||s.remaining<1||s.remaining>r.parameters.rest_seconds||
       (!isIntervalRoutine(r.mechanic)&&(r.mechanic!=='CIRCUIT'||s.index!==r.exercises.length-1||s.round>=r.parameters.rounds)))return null;
   }else{
     const expected=isIntervalRoutine(r.mechanic)?r.parameters.work_seconds:r.exercises[s.index].duration_seconds??null;
     if(expected===null?s.remaining!==null:(!Number.isInteger(s.remaining)||s.remaining<1||s.remaining>expected))return null;
   }
   return {version:2,local_date:value.local_date,routine:r,step:s};
 }catch{return null;}
}
