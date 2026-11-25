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
export function filterPickerRows(rows,{zone='',type='',equipment='',search='',favoritesOnly=false}={},favoriteIds=[]) {
  const fav=new Set(favoriteIds),q=norm(search);
  return rows.filter(row=>pickerZoneMatches(row,zone)&&(!type||pickerType(row)===type)&&pickerEquipmentFacetMatches(row,equipment)&&
    (!favoritesOnly||fav.has(row.id))&&(!q||norm([row.name,row.originalName,row.bodyRegion,row.movementPattern,
      row.exerciseType,row.trainingFocus,pickerTypes.find(t=>t.key===pickerType(row))?.label,
      ...pickerZones.filter(z=>pickerZoneMatches(row,z.key)).map(z=>z.label),...(row.equipmentNames??[])].join(' ')).includes(q)));
}

// The session's explicit equipment selection is the only mandatory picker filter.
// All required items must be present; E00 (bodyweight) is always available.
export function pickerEquipmentMatches(row, equipmentIds=[]) {
  const available = new Set(['E00', ...equipmentIds.map(String)]);
  return Array.isArray(row.equipmentIds) && row.equipmentIds.every(id=>available.has(String(id)));
}

// Optional navigation facet: never changes the session equipment scope.
export function pickerEquipmentFacetMatches(row, equipment='') {
  if (!equipment) return true;
  if (!Array.isArray(row.equipmentIds)) return false;
  const required=row.equipmentIds.map(String).filter(id=>id!=='E00');
  return equipment==='E00' ? required.length===0 : required.includes(String(equipment));
}
export function pickerEquipmentOptions(equipmentIds=[], referenceEquipment=[]) {
  const names=new Map(referenceEquipment.map(item=>[String(item.id),item.name]));
  return [{key:'E00',label:'Poids du corps',icon:'person-outline'},
    ...[...new Set(equipmentIds.map(String))].filter(id=>id!=='E00').map(id=>({
      key:id,label:names.get(id)||id,icon:'barbell-outline',
    }))];
}
