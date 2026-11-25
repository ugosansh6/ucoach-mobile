// Presentation taxonomy only. Every catalogue row belongs to a visible type;
// categories never affect the engine's candidate ranking or eligibility.
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const pickerZones = [
  { key:'Upper', label:'Haut du corps', icon:'body-outline' },
  { key:'Lower', label:'Bas du corps', icon:'walk-outline' },
  { key:'Back', label:'Dos', icon:'body-outline' },
  { key:'Core', label:'Abdos et gainage', icon:'fitness-outline' },
  { key:'Full Body', label:'Corps entier', icon:'accessibility-outline' },
];
export const pickerTypes = [
  { key:'strength', label:'Musculation', icon:'barbell-outline' },
  { key:'skill', label:'Gymnastique / technique', icon:'body-outline' },
  { key:'conditioning', label:'Cardio / conditionnement', icon:'heart-outline' },
  { key:'stability', label:'Gainage / stabilité', icon:'fitness-outline' },
  { key:'mobility', label:'Mobilité', icon:'accessibility-outline' },
  { key:'warmup', label:'Échauffement / activation', icon:'flame-outline' },
  { key:'bodyweight', label:'Poids du corps', icon:'person-outline' },
  { key:'general', label:'Autres exercices', icon:'grid-outline' },
];
export function pickerType(row) {
  const type=norm(row.exerciseType);
  if (['skill','gymnastique','technique'].includes(type)) return 'skill';
  if (['cardio','conditioning'].includes(type)) return 'conditioning';
  if (['activation','warmup'].includes(type)) return 'warmup';
  if (['strength','stability','mobility','bodyweight'].includes(type)) return type;
  return 'general';
}
export function pickerZoneMatches(row,zone) {
  if (!zone) return true;
  if (zone==='Back') return row.isBack===true;
  return norm(row.bodyRegion)===norm(zone);
}
export function filterPickerRows(rows,{zone='',type='',search='',favoritesOnly=false}={},favoriteIds=[]) {
  const fav=new Set(favoriteIds),q=norm(search);
  return rows.filter(row=>pickerZoneMatches(row,zone)&&(!type||pickerType(row)===type)&&
    (!favoritesOnly||fav.has(row.id))&&(!q||norm([row.name,row.originalName,row.bodyRegion,row.movementPattern,
      row.exerciseType,row.trainingFocus,pickerTypes.find(t=>t.key===pickerType(row))?.label,
      ...pickerZones.filter(z=>pickerZoneMatches(row,z.key)).map(z=>z.label),...(row.equipmentNames??[])].join(' ')).includes(q)));
}
