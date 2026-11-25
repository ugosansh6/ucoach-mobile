export const exerciseRegionLabel = (value) => ({Upper:'Haut du corps',Lower:'Bas du corps',Core:'Abdos et gainage','Full Body':'Corps entier','Full body':'Corps entier',Back:'Dos'}[value] ?? value ?? '');
const normalized = (value) => String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function filterExerciseCatalogue(rows, { search='', region='', family='', focus='', favoritesOnly=false }={}, favoriteIds=[]) {
  const favorites=new Set(favoriteIds);const query=normalized(search.trim());
  return (rows??[]).filter((e)=>(!region||e.bodyRegion===region)&&(!family||e.movementPattern===family)&&(!focus||e.trainingFocus===focus)
    &&(!favoritesOnly||favorites.has(e.id))&&(!query||normalized([e.name,e.bodyRegion,e.movementPattern,e.trainingFocus,...(e.equipmentNames??[])].join(' ')).includes(query)));
}
export function exerciseMovementLabel(value) {
  const raw=String(value??'').trim();const key=raw.toLowerCase().replace(/[_-]+/g,' ');
  return ({squat:'Squat',lunge:'Fente',hinge:'Charnière',push:'Poussée',pull:'Tirage',carry:'Porté',core:'Gainage',rotation:'Rotation','anti rotation':'Anti-rotation','push horizontal':'Poussée horizontale','pull horizontal':'Tirage horizontal','push vertical':'Poussée verticale','pull vertical':'Tirage vertical',jump:'Saut',mobility:'Mobilité',conditioning:'Conditionnement',locomotion:'Déplacement',step:'Montée sur support','ankle extension':'Extension de cheville','anti extension':'Anti-extension','elbow extension':'Extension du coude','elbow flexion':'Flexion du coude','hip abduction':'Abduction de hanche','hip adduction':'Adduction de hanche','knee extension':'Extension du genou','knee flexion':'Flexion du genou','shoulder abduction':'Abduction de l’épaule'}[key]??raw.replace(/[_-]+/g,' '));
}
export const exerciseFocusLabel=value=>({Strength:'Force',Conditioning:'Conditionnement','General Fitness':'Forme générale',Skill:'Technique'}[value]??value);
