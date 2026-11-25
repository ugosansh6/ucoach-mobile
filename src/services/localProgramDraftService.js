import AsyncStorage from '@react-native-async-storage/async-storage';
import {getAuthenticatedUserWithRetry} from '../lib/supabaseAuthRetry';
import {validateStoredProgramDraft,upsertProgramDraft} from '../utils/personalProgramDrafts';

const storageKey=userId=>'ugerod.personal-program-drafts.v1:'+userId;
async function read(userId){
 const raw=await AsyncStorage.getItem(storageKey(userId));
 if(raw===null)return [];
 const rows=JSON.parse(raw);
 if(!Array.isArray(rows)||!rows.every(validateStoredProgramDraft))throw new Error('Impossible de lire tes brouillons. Les données locales sont conservées.');
 return rows;
}
// Local authoring only: not an entitlement, shared catalogue or server programme.
export async function listLocalProgramDrafts(){
 const user=await getAuthenticatedUserWithRetry();
 return {ownerId:user.id,drafts:await read(user.id)};
}
let writeQueue=Promise.resolve();
export function saveLocalProgramDraft(ownerId,draft){
 const task=writeQueue.then(async()=>{
  const user=await getAuthenticatedUserWithRetry();
  if(user.id!==ownerId)throw new Error('Ton compte a changé. Recharge tes programmes.');
  const rows=upsertProgramDraft(await read(user.id),draft);
  await AsyncStorage.setItem(storageKey(user.id),JSON.stringify(rows));
  return rows;
 });
 writeQueue=task.catch(()=>{});
 return task;
}
