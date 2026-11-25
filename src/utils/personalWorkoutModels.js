export function modelDateKey(date=new Date()){
 return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
export function validModelDate(value,today=modelDateKey()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value))||value<today)return false;
 const [y,m,d]=value.split('-').map(Number),parsed=new Date(y,m-1,d);
 return modelDateKey(parsed)===value;
}
export function canReusePersonalModel(model){
 if(model?.origin==='PROGRAM')return Boolean(personalProgramRows(model.source_payload));
 return model?.origin==='COMPOSER'&&Array.isArray(model.draft?.architecture?.blocks)&&model.draft.architecture.blocks.length>0&&model.draft?.prescription_preview?.status==='PREVIEW';
}
export function personalModelMeta(model){
 const source=model?.source_payload,draft=model?.draft;
 const environment=source?.environment_code??draft?.environment_code;
 const count=source?.exercises?.length??(draft?.architecture?.blocks??[]).reduce((sum,b)=>sum+(b.exercises??[]).length,0);
 return {environment:({HOME:'Maison',BOX:'Box',GYM:'Salle',OUTDOOR:'Extérieur'})[environment]??'Lieu à préciser',count,duration:draft?.duration_minutes??null,frequency:source?.frequency_per_week??null};
}
export function sortPersonalModels(rows){
 return [...rows].sort((a,b)=>{
  if(a.origin!==b.origin)return a.origin==='PROGRAM'?-1:1;
  if(a.origin==='PROGRAM')return Number(a.source_payload?.week_start??999)-Number(b.source_payload?.week_start??999);
  return String(b.updated_at??'').localeCompare(String(a.updated_at??''));
 });
}

// Personal program source prescriptions are authored, not recommendations.
export const PROGRAM_GEAR={E05:'Élastiques',E07:'Barre de traction',E10:'Box',E50:'Échelle suspendue / Monkey Bars',E51:'Serviette de suspension',E52:'Ancrage haut pour élastique'};
export function personalProgramRows(source){
 if(!source||!['HOME','OUTDOOR'].includes(source.environment_code))return null;
 const rows=(source.exercises??[]).map(e=>{
  const id=e.candidate_ids?.[0], a=String(e.dose??'').match(/^(\d+) × (\d+)(?:–(\d+))?/);
  if(!id||(!a&&!(id==='EX583'&&source.week_start===21)))return null;
  const mode=id==='EX583'?'count':/ × \d+ s/.test(e.dose)?'time':'reps';
  const dose={sets:a?Number(a[1]):3,target:a?Number(a[2]):1,mode,rest_seconds:source.environment_code==='HOME'?String(e.dose).includes('45 s')?45:90:['EX071','EX583'].includes(id)?120:90,instruction:[e.name,e.note].filter(Boolean).join(' · ')};
  if(a?.[3])Object.assign(dose,{range_min:Number(a[2]),range_max:Number(a[3])});
  if(mode==='count')dose.count_unit=a?'barreaux':'traversées';
  if(id==='EX009'&&source.week_start===9)dose.tempo_eccentric_seconds=3;
  if(id==='EX009'&&source.week_start===13)dose.tempo_pause_seconds=1;
  return {id,name:e.name,candidates:e.candidate_ids,authored_dose:dose};
 });
 return rows.length&&rows.every(Boolean)?rows:null;
}
export function programEquipment(source,rows){
 const ids=source.environment_code==='HOME'?['E05','E52']:['E07','E50','E51'];
 if(rows.some(x=>x.id==='EX067'))ids.push('E05');
 if(rows.some(x=>x.id==='EX003'))ids.push('E10');
 return [...new Set(ids)];
}
export function buildPersonalProgramDraft(model,rows){
 const source=model.source_payload;
 if(!rows?.length||rows.some(x=>!x.candidates.includes(x.id)||!Number.isInteger(x.authored_dose.sets)||x.authored_dose.sets<1||x.authored_dose.sets>50||!Number.isInteger(x.authored_dose.target)||x.authored_dose.target<1||x.authored_dose.target>(x.authored_dose.mode==='time'?1800:x.authored_dose.mode==='count'?100:500)||!Number.isInteger(x.authored_dose.rest_seconds)||x.authored_dose.rest_seconds<0||x.authored_dose.rest_seconds>1800))return null;
 const warm=[['EX444','Cercles de bras',10],['EXW012','Mobilisation poignets',10],['EX455','Pompes scapulaires genoux',8]].map(([id,name,target])=>({id,name,authored_dose:{sets:2,target,mode:'reps',rest_seconds:0}}));
 return {personal_program_version:'PERSONAL_PROGRAM_V1',environment_code:source.environment_code,target_region:'Upper',intent:{focus:'Strength',label:model.name},equipment_ids:programEquipment(source,rows),architecture:{title:model.name,blocks:[{type:'WARMUP',label:'Échauffement',minutes:5,exercises:warm},{type:'STRENGTH',label:'Renforcement',minutes:85,exercises:rows.map(({candidates,...row})=>row)}]}};
}
export function programDoseLabel(d){
 const work=d.mode==='time'?'s':d.mode==='count'?d.count_unit:'reps';
 return d.sets+' × '+d.target+' '+work+' · repos '+d.rest_seconds+' s';
}

// Presentation grouping of the six known imported phases only. No inference from
// editable display names, no mutation, and no automatic progression.
export function groupPersonalModels(rows){
 const groups=[{id:'calisthenie',title:'Callisthénie',subtitle:'Maison · Force au poids du corps',icon:'body-outline',models:[]},{id:'street',title:'Street Workout',subtitle:'Extérieur · Suspension et grip',icon:'fitness-outline',models:[]}];
 const standalone=[];
 for(const model of sortPersonalModels(rows??[])){
  const key=String(model.source_key??'');
  const group=model.origin==='PROGRAM'&&groups.find(g=>new RegExp('^'+g.id+'-\\d+-\\d+$').test(key));
  if(group)group.models.push(model);else standalone.push(model);
 }
 return {groups:groups.filter(g=>g.models.length),standalone};
}
