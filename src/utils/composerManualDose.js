// Edits are scoped to the block and, for WOD, the exact mechanic variant.
export function composerManualKey(type,mechanic) {
  return type==='WOD'?type+':'+(mechanic?.key??'')+':'+(mechanic?.variant_key??''):type;
}
export function restoreComposerManualEdits(draft) {
  const result={};
  for(const block of draft?.architecture?.blocks??[]){
    const exercises=Object.fromEntries((block.exercises??[]).filter(x=>x.manual_dose&&Object.keys(x.manual_dose).length).map(x=>[x.id,x.manual_dose]));
    if(Object.keys(exercises).length||Object.keys(block.manual_parameters??{}).length)
      result[composerManualKey(block.type,draft.mechanic)]={exercises,parameters:block.manual_parameters??{}};
  }
  return result;
}
export function attachComposerManualEdits(block,mechanic,edits,{skillTarget=null,wodEngineVersion=null}={}) {
  if(!['SKILL','STRENGTH','WOD'].includes(block.type)||(block.type==='SKILL'&&skillTarget)||(block.type==='WOD'&&wodEngineVersion!=='C4_COMPOSER_V2'))return block;
  const entry=edits[composerManualKey(block.type,mechanic)];
  if(!entry)return block;
  const result={...block,exercises:block.exercises.map(x=>{
    const dose=entry.exercises?.[x.id];
    return dose&&Object.keys(dose).length?{...x,manual_dose:dose}:x;
  })};
  if(block.type==='WOD'&&Object.keys(entry.parameters??{}).length)result.manual_parameters=entry.parameters;
  return result;
}
const field=(key,label,value,min,max,step=1)=>({key,label,value:Number(value),min,max,step});
const has=v=>v!=null&&Number.isFinite(Number(v));
export function composerManualExerciseFields(type,dose,mechanic,{skillTarget=null,wodEngineVersion=null}={}) {
  if(!dose)return [];
  const p=dose.prescription_json??{},ov=p.mechanic_overlay??{};
  if(p.test_score_required||p.test_attempts!=null)return [];
  if(type==='SKILL'&&skillTarget)return [];
  const m=mechanic?.key;
  if(type==='WOD'){
    if(wodEngineVersion!=='C4_COMPOSER_V2'||['DECK','HIIT'].includes(m))return [];
    const progression=['LADDER','COUPLET','PROGRESSIVE_INTERVAL','PYRAMID'].includes(m);
    const reps=progression?(ov.base_reps??ov.start_reps):dose.reps;
    return has(reps)?[field('reps',progression?'Répétitions de départ':dose.reps_semantics==='per_side'?'Répétitions / côté':'Répétitions',reps,1,500)]:[];
  }
  if(!['SKILL','STRENGTH'].includes(type))return [];
  const out=[];
  if(has(dose.sets))out.push(field('sets','Séries',dose.sets,1,50));
  if(has(dose.reps))out.push(field('reps',dose.reps_semantics==='per_side'?'Répétitions / côté':'Répétitions',dose.reps,1,500));
  else if(has(dose.duration_seconds))out.push(field('duration_seconds',dose.duration_semantics==='per_side'?'Maintien / côté (s)':'Maintien (s)',dose.duration_seconds,1,1800,5));
  if(has(dose.sets))out.push(field('rest_seconds','Repos (s)',dose.rest_seconds??0,0,1800,15));
  return out;
}
export function composerManualParameterFields(block,wodEngineVersion) {
  if(block?.type!=='WOD'||wodEngineVersion!=='C4_COMPOSER_V2')return [];
  const p=block.parameters??{},m=block.mechanic,out=[];
  const add=(k,l,lo,hi,step=1)=>{if(has(p[k]))out.push(field(k,l,p[k],lo,hi,step));};
  if(['CIRCUIT','FOR_TIME','HIIT'].includes(m))add('rounds','Tours',1,100);
  if(['EMOM','PYRAMID','ODD_EVEN','EVERY_X_MINUTES'].includes(m))add('cycles','Cycles',1,100);
  if(m==='SETS_REPS')add('sets','Séries',1,100);
  if(['LADDER','COUPLET'].includes(m))add('rungs','Étapes',1,100);
  if(m==='AMRAP')add('duration_minutes','Durée (min)',1,180);
  if(m==='FOR_TIME')add('cap_seconds','Time cap (s)',60,10800,60);
  if(m==='PROGRESSIVE_INTERVAL')add('time_limit_seconds','Time cap (s)',60,10800,60);
  if(m==='CIRCUIT')add('rest_between_rounds_seconds','Repos entre tours (s)',0,1800,15);
  if(m==='SETS_REPS')add('rest_between_exercises_seconds','Repos (s)',0,1800,15);
  return out;
}
export function validComposerManualValues(fields,values) {
  return fields.every(f=>String(values[f.key]??'').trim()!==''&&Number.isInteger(Number(values[f.key]))&&Number(values[f.key])>=f.min&&Number(values[f.key])<=f.max);
}
export function composerManualTimeSummary(preview,duration) {
  if(!Array.isArray(preview?.blocks))return null;
  let planned=0,elapsed=0,manual=false;
  for(const b of preview.blocks){
    const budget=Number(b.minutes??0)*60;
    planned+=budget;
    const estimate=b.time?.prescribed_seconds;
    let seconds=estimate!=null&&Number.isFinite(Number(estimate))?Number(estimate):budget;
    // For a capped protocol use the estimated time needed for the requested work,
    // not a truncated estimate; the cap itself stays explicit.
    elapsed+=seconds;
    manual=manual||b.time?.manual_estimate===true;
  }
  elapsed+=Math.max(0,Number(duration)*60-planned);
  return {seconds:Math.ceil(elapsed),minutes:Math.ceil(elapsed/60),overMinutes:Math.max(0,Math.ceil((elapsed-Number(duration)*60)/60)),manual};
}
export function composerManualError(reason) {
  const code=String(reason?.message??reason?.reason??reason??'');
  if(code.includes('COMPOSER_MANUAL_INTERVAL_TOO_SHORT'))return 'La prescription ne tient pas dans un intervalle de cette mécanique. Réduis les répétitions ou annule cette modification.';
  if(code.includes('COMPOSER_MANUAL_INVALID_NUMBER'))return 'Saisis une valeur entière dans la plage indiquée.';
  if(code.includes('COMPOSER_MANUAL_'))return 'Ce paramètre ne peut pas être exécuté dans cette mécanique. Annule cette modification ou rétablis les recommandations.';
  return null;
}
