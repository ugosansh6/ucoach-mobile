export function modelDateKey(date=new Date()){
 return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
export function validModelDate(value,today=modelDateKey()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value))||value<today)return false;
 const [y,m,d]=value.split('-').map(Number),parsed=new Date(y,m-1,d);
 return modelDateKey(parsed)===value;
}
export function canReusePersonalModel(model){
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
