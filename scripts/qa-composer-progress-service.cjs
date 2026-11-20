const fs=require('node:fs'),assert=require('node:assert/strict');
const utilsSource=fs.readFileSync('src/utils/composerPlayerProgress.js','utf8').replaceAll('export const ','const ').replaceAll('export function ','function ');
const utils=new Function(utilsSource+'\nreturn {composerPlayerSnapshot,composerProgressFingerprint};')();
const service=fs.readFileSync('src/services/composerPlayerProgressService.js','utf8').replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g,'').replaceAll('export async function ','async function ').replaceAll('export function ','function ');
const cache=new Map();let state={status:'READY',contract_key:'canonical',revision:0,progress:null,closed:false};let writes=0,fail=false;
const supabase={rpc:async(name,args)=>{
 if(name==='composer_player_progress_read_v1')return {...state};
 if(name==='composer_player_progress_save_v1'){
  if(fail)throw new Error('offline');
  if(args.p_expected_revision!==state.revision)return {status:'REVISION_CONFLICT'};
  assert.equal(args.p_contract_key,'canonical');state={...state,revision:state.revision+1,progress:args.p_progress};writes++;return {status:'SAVED',revision:state.revision};
 }
 throw Error(name);
}};
const storage={getItem:async k=>cache.get(k)||null,setItem:async(k,v)=>{cache.set(k,v)}};
const api=new Function('AsyncStorage','supabase','getAuthenticatedUserWithRetry','runSupabaseRequestWithAuthRetry','composerPlayerSnapshot','composerProgressFingerprint','setTimeout','clearTimeout',service+'\nreturn {loadComposerPlayerProgress,queueComposerPlayerProgress,flushComposerPlayerProgress};')
 (storage,supabase,async()=>({id:'athlete'}),fn=>fn(),utils.composerPlayerSnapshot,utils.composerProgressFingerprint,()=>1,()=>{});
async function main(){
 let w={sessionId:'session',sessionStarted:true,meta:{source:'w11_composer'},composerPlayerProgress:{loaded:true},exercises:[{sessionExerciseId:'instance',status:'pending'}],skillRuntime:{index:1,results:{one:{duration_seconds:35}}}};
 await api.loadComposerPlayerProgress(w.sessionId);await api.queueComposerPlayerProgress(w);await api.flushComposerPlayerProgress(w.sessionId);
 assert.equal(writes,1);assert.equal(state.progress.skillRuntime.index,1);
 await api.flushComposerPlayerProgress(w.sessionId);assert.equal(writes,1,'Unchanged state must not be re-saved');
 w={...w,skillRuntime:{...w.skillRuntime,index:2}};fail=true;await api.queueComposerPlayerProgress(w);await assert.rejects(api.flushComposerPlayerProgress(w.sessionId),/offline/);
 let resumed=await api.loadComposerPlayerProgress(w.sessionId);assert.equal(resumed.progress.skillRuntime.index,2,'Same-revision unsynced cache survives reload');
 fail=false;await api.flushComposerPlayerProgress(w.sessionId);assert.equal(state.progress.skillRuntime.index,2);
 // A different tab/device advanced the revision; refuse stale overwrite.
 state={...state,revision:state.revision+1};w={...w,skillRuntime:{...w.skillRuntime,index:3}};
 await api.queueComposerPlayerProgress(w);await assert.rejects(api.flushComposerPlayerProgress(w.sessionId),e=>e.code==='COMPOSER_PROGRESS_CONFLICT');
 resumed=await api.loadComposerPlayerProgress(w.sessionId);assert.equal(resumed.progress.skillRuntime.index,2,'A stale local cache must not override a newer server revision');
 state={...state,status:'CONTRACT_CHANGED'};await assert.rejects(api.loadComposerPlayerProgress(w.sessionId),/compatibilité/);
 console.log('PASS durable cache, offline/reload recovery, revision conflict, duplicate saves and changed-contract guard');
}
main().catch(e=>{console.error(e);process.exitCode=1});
