// Local cover contract. No remote image or executable URI is accepted.
export const PROGRAM_COVER_PRESETS=[
 {id:'strength',label:'Force',icon:'barbell-outline',background:'#354139',foreground:'#DCE5D5'},
 {id:'bodyweight',label:'Callisthénie',icon:'body-outline',background:'#56644D',foreground:'#F0F3EA'},
 {id:'outdoor',label:'Extérieur',icon:'leaf-outline',background:'#354E49',foreground:'#DFEDE4'},
 {id:'conditioning',label:'Conditionnement',icon:'pulse-outline',background:'#493B32',foreground:'#F6DFCB'},
 {id:'mobility',label:'Mobilité',icon:'accessibility-outline',background:'#424D63',foreground:'#E4E9F4'}
];
export const MAX_PROGRAM_COVER_CHARS=240000;
export function validProgramCover(cover){
 if(cover==null)return true;
 if(cover.type==='preset')return PROGRAM_COVER_PRESETS.some(p=>p.id===cover.id);
 if(cover.type!=='photo'||typeof cover.uri!=='string'||cover.uri.length>MAX_PROGRAM_COVER_CHARS)return false;
 return /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(cover.uri);
}
export function programCoverPreset(cover,fallback='strength'){
 return PROGRAM_COVER_PRESETS.find(p=>p.id===(cover?.type==='preset'?cover.id:fallback))??PROGRAM_COVER_PRESETS[0];
}
