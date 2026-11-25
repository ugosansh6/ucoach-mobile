import AsyncStorage from '@react-native-async-storage/async-storage';
import {getAuthenticatedUserWithRetry} from '../lib/supabaseAuthRetry';
import {validateStoredProgramDraft,upsertProgramDraft} from '../utils/personalProgramDrafts';

import {validProgramCover} from '../utils/programCovers';

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

const groupCoverKey=userId=>'ugerod.personal-program-group-covers.v1:'+userId;
const allowedGroup=id=>['calisthenie','street'].includes(id);
async function readGroupCovers(userId){
 const raw=await AsyncStorage.getItem(groupCoverKey(userId));
 if(raw===null)return {};
 const covers=JSON.parse(raw);
 if(!covers||typeof covers!=='object'||Array.isArray(covers)||!Object.entries(covers).every(([id,cover])=>allowedGroup(id)&&validProgramCover(cover)))throw new Error('Impossible de lire les couvertures. Les données locales sont conservées.');
 return covers;
}
export async function listLocalProgramGroupCovers(){
 const user=await getAuthenticatedUserWithRetry();
 return {ownerId:user.id,covers:await readGroupCovers(user.id)};
}
export function saveLocalProgramGroupCover(ownerId,groupId,cover){
 const task=writeQueue.then(async()=>{
  const user=await getAuthenticatedUserWithRetry();
  if(user.id!==ownerId)throw new Error('Ton compte a changé. Recharge tes programmes.');
  if(!allowedGroup(groupId)||!validProgramCover(cover))throw new Error('Couverture invalide.');
  const covers=await readGroupCovers(user.id);
  if(cover==null)delete covers[groupId];else covers[groupId]=cover;
  await AsyncStorage.setItem(groupCoverKey(user.id),JSON.stringify(covers));
  return covers;
 });
 writeQueue=task.catch(()=>{});
 return task;
}
