// Pure configuration and daily adherence rules. No training-engine dependency.
export const ROUTINE_CATEGORIES={MOBILITY:'Mobilité',CORE:'Abdos & gainage',PHYSIO:'Kiné',CONDITIONING:'Conditioning'};
export const ROUTINE_DAYS=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const integer=(value,max,label)=>{
  if(!/^[1-9][0-9]*$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)>max)throw new Error(label+' : nombre entier positif attendu.');
  return Number(value);
};
export function normalizeRoutineDraft(draft){
  const name=String(draft.name??'').trim();
  if(!name||name.length>120)throw new Error('Renseigne un nom de routine.');
  if(!Object.prototype.hasOwnProperty.call(ROUTINE_CATEGORIES,draft.category))throw new Error('Choisis une catégorie.');
  const planned_minutes=integer(draft.planned_minutes,30,'Durée prévue (30 min maximum)');
  const recurrence_days=[...new Set(draft.recurrence_days??[])].sort((a,b)=>a-b);
  if(recurrence_days.some(n=>!Number.isInteger(n)||n<0||n>6))throw new Error('Jours de récurrence invalides.');
  if(!Array.isArray(draft.exercises)||!draft.exercises.length)throw new Error('Ajoute au moins un exercice.');
  const exercises=draft.exercises.map((e,i)=>{
    const label=String(e.name??'').trim();
    if(!label||label.length>200)throw new Error('Renseigne le nom de l’exercice '+(i+1)+'.');
    return {name:label,exercise_id:e.exercise_id??null,sets:integer(e.sets,9999,'Séries — '+label),reps:integer(e.reps,9999,'Répétitions — '+label)};
  });
  return {name,category:draft.category,mechanic:'SETS_REPS',planned_minutes,recurrence_days,exercises};
}
export function localRoutineDate(date=new Date()){
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
export function buildRoutineDayRows(routines,realizations,date=new Date()){
  const done=new Set((realizations??[]).filter(r=>r.local_date===localRoutineDate(date)).map(r=>r.routine_id));
  return (routines??[]).filter(r=>done.has(r.id)||(!r.archived_at&&(r.recurrence_days??[]).includes(date.getDay())))
    .map(r=>({id:r.id,name:r.name,plannedMinutes:r.planned_minutes,completed:done.has(r.id),archived:Boolean(r.archived_at)}));
}
export function advanceRoutineSet(exercises,index,setNumber){
  if(!exercises[index])throw new Error('Exercice indisponible.');
  if(setNumber<exercises[index].sets)return {index,setNumber:setNumber+1,finished:false};
  if(index+1<exercises.length)return {index:index+1,setNumber:1,finished:false};
  return {index,setNumber,finished:true};
}
