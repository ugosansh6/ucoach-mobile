// Program authoring is deliberately separate from exercise prescription and scheduling.
// References point at existing personal models. No solver, dates or progression is inferred.
export const PROGRAM_DRAFT_VERSION='PERSONAL_PROGRAM_DRAFT_V1';
export const PROGRAM_ACCESS_TYPES=['PRIVATE','FREE','PREMIUM'];
export function newProgramDraft(id){
 return {version:PROGRAM_DRAFT_VERSION,id,title:'',objective:'',author_type:'USER',access:'PRIVATE',status:'DRAFT',phases:[]};
}
export function newProgramPhase(id){
 return {id,title:'',weeks:'4',sessions:[]};
}
export function duplicateProgramPhase(phase,id){
 return {...phase,id,sessions:phase.sessions.map(s=>({...s}))};
}
export function programDraftWeeks(draft){
 return (draft?.phases??[]).reduce((total,p)=>total+(Number.isInteger(Number(p.weeks))&&Number(p.weeks)>0?Number(p.weeks):0),0);
}
export function programDraftIssues(draft,models=[]){
 const issues=[];
 if(!String(draft?.title??'').trim())issues.push('Indique un nom de programme.');
 if(!draft?.phases?.length)issues.push('Ajoute au moins une phase.');
 const ids=new Set(models.map(m=>m.id));
 for(const [i,p] of (draft?.phases??[]).entries()){
  const label='Phase '+(i+1),w=Number(p.weeks);
  if(!Number.isInteger(w)||w<1||w>104)issues.push(label+' : durée invalide.');
  if(!p.sessions.length)issues.push(label+' : ajoute une séance.');
  for(const s of p.sessions){
   if(!ids.has(s.modelId))issues.push(label+' : un modèle n’est plus disponible.');
   if(!Number.isInteger(Number(s.frequency))||Number(s.frequency)<1||Number(s.frequency)>14)issues.push(label+' : fréquence invalide.');
  }
 }
 if(programDraftWeeks(draft)>104)issues.push('La durée totale dépasse 104 semaines.');
 return issues;
}
export function validateStoredProgramDraft(d){
 if(!d||d.version!==PROGRAM_DRAFT_VERSION||d.author_type!=='USER'||d.access!=='PRIVATE'||d.status!=='DRAFT'||typeof d.id!=='string'||typeof d.title!=='string'||typeof d.objective!=='string'||!Array.isArray(d.phases))return false;
 return d.phases.every(p=>p&&typeof p.id==='string'&&typeof p.title==='string'&&typeof p.weeks==='string'&&Array.isArray(p.sessions)&&p.sessions.every(s=>s&&typeof s.modelId==='string'&&typeof s.frequency==='string'));
}
export function upsertProgramDraft(rows,draft){
 if(!validateStoredProgramDraft(draft))throw new Error('Brouillon de programme invalide.');
 return [draft,...rows.filter(r=>r.id!==draft.id)];
}
