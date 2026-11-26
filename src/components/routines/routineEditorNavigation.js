import {ROUTINE_CATEGORIES,ROUTINE_MECHANICS,normalizeRoutineDraft,availableTabataBlocks,isBlockTabata} from '../../services/routineContract';
export const ROUTINE_EDITOR_SECTIONS=['category','duration','format','exercises','final'];
const editorPositive=v=>/^[1-9][0-9]{0,3}$/.test(String(v));
const editorNonnegative=v=>String(v)==='0'||editorPositive(v);
export function initialRoutineEditorState(editing=false){return {active:editing?4:0,revealed:editing?4:0};}
export function openRoutineEditorSection(state,index){return Number.isInteger(index)&&index>=0&&index<=state.revealed?{...state,active:index}:state;}
export function advanceRoutineEditor(state){const active=Math.min(4,state.active+1);return {active,revealed:Math.max(state.revealed,active)};}
export function routineEditorIssue(draft,section){
 if(!Object.prototype.hasOwnProperty.call(ROUTINE_CATEGORIES,draft.category))return 'Choisis une catégorie.';
 if(section===0)return '';
 if(!editorPositive(draft.planned_minutes)||Number(draft.planned_minutes)>30)return 'Choisis une durée de 1 à 30 minutes.';
 if(section===1)return '';
 if(!Object.prototype.hasOwnProperty.call(ROUTINE_MECHANICS,draft.mechanic))return 'Choisis un format.';
 const p=draft.parameters??{};
 if(draft.mechanic==='TABATA'&&!availableTabataBlocks(draft.planned_minutes).includes(Number(p.blocks)))return 'Choisis un Tabata compatible avec la durée prévue.';
 if(draft.mechanic!=='SETS_REPS'&&!isBlockTabata(draft)&&!editorPositive(p.rounds))return 'Renseigne le nombre de tours.';
 if(['CIRCUIT','HIIT'].includes(draft.mechanic)&&!editorNonnegative(p.rest_seconds))return 'Renseigne la récupération (0 seconde est possible).';
 if(draft.mechanic==='HIIT'&&!editorPositive(p.work_seconds))return 'Renseigne le temps d’effort.';
 if(section===2)return '';
 try{normalizeRoutineDraft(section===3?{...draft,name:'Brouillon'}:draft);return '';}catch(error){return error.message;}
}
