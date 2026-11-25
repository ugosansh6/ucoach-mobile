const fs=require('node:fs'),assert=require('node:assert/strict');
const load=(p,names)=>new Function(fs.readFileSync(p,'utf8').replaceAll('export const ','const ').replaceAll('export function ','function ')+';return {'+names+'};')();
const p=load('src/utils/personalProgramDrafts.js','newProgramDraft,newProgramPhase,duplicateProgramPhase,programDraftWeeks,programDraftIssues,validateStoredProgramDraft,upsertProgramDraft');
const m=load('src/utils/personalWorkoutModels.js','groupPersonalModels');
const rows=[{id:'a',origin:'PROGRAM',source_key:'calisthenie-1-4',name:'Renommé'},{id:'b',origin:'PROGRAM',source_key:'street-21-24'},{id:'c',origin:'PROGRAM',name:'Callisthénie (copie)'},{id:'d',origin:'COMPOSER',source_key:'calisthenie-5-8'}];
const groups=m.groupPersonalModels(rows);
assert.equal(groups.groups.length,2);assert.equal(groups.groups[0].models[0].id,'a');assert.equal(groups.standalone.length,2);
let draft=p.newProgramDraft('p');draft.title='Spartan';draft.phases=[{...p.newProgramPhase('a'),sessions:[{modelId:'a',frequency:'2'}]}];
assert.equal(p.programDraftWeeks(draft),4);assert.deepEqual(p.programDraftIssues(draft,rows),[]);assert.ok(p.programDraftIssues(draft,[]).length);
const copy=p.duplicateProgramPhase(draft.phases[0],'b');copy.sessions[0].frequency='3';assert.equal(draft.phases[0].sessions[0].frequency,'2');
assert.equal(p.validateStoredProgramDraft({...draft,access:'PREMIUM'}),false);
assert.equal(p.validateStoredProgramDraft({...draft,author_type:'COACH'}),false);
assert.equal(p.upsertProgramDraft([draft],{...draft,title:'New'}).length,1);
async function verifyStorage(){
 const source=fs.readFileSync('src/services/localProgramDraftService.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export async function ','async function ').replaceAll('export function ','function ');
 const store=new Map();let current='user-a';
 const service=new Function('AsyncStorage','getAuthenticatedUserWithRetry','validateStoredProgramDraft','upsertProgramDraft',source+';return {listLocalProgramDrafts,saveLocalProgramDraft};')({getItem:async k=>store.get(k)??null,setItem:async(k,v)=>store.set(k,v)},async()=>({id:current}),p.validateStoredProgramDraft,p.upsertProgramDraft);
 await service.saveLocalProgramDraft('user-a',draft);assert.equal((await service.listLocalProgramDrafts()).drafts[0].title,'Spartan');
 current='user-b';assert.equal((await service.listLocalProgramDrafts()).drafts.length,0);
 await assert.rejects(()=>service.saveLocalProgramDraft('user-a',draft),/compte a changé/);
 await service.saveLocalProgramDraft('user-b',{...draft,title:'B'});current='user-a';assert.equal((await service.listLocalProgramDrafts()).drafts[0].title,'Spartan');
 store.set('ugerod.personal-program-drafts.v1:user-a','invalid');await assert.rejects(()=>service.saveLocalProgramDraft('user-a',draft));assert.equal(store.get('ugerod.personal-program-drafts.v1:user-a'),'invalid');
 console.log('PASS grouping, private phase draft, duplicate isolation, account-scoped persistence and corrupt storage protection');
}
verifyStorage().catch(e=>{console.error(e);process.exitCode=1;});
