import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext,useContext,useEffect,useState,useCallback,useRef } from 'react';
import { supabase } from '../lib/supabase';
import { normalizeExerciseNameMode } from '../utils/exerciseNames';

const Context=createContext({mode:'bilingual',setMode:()=>{}});
export function ExerciseNameProvider({children}) {
  const [userId,setUserId]=useState(null);
  const [selection,setSelection]=useState({key:null,mode:'bilingual'});
  const editVersion=useRef(0);
  useEffect(()=>{
    let live=true,changed=false;
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
      changed=true;if(live)setUserId(session?.user?.id??null);
    });
    supabase.auth.getSession().then(({data})=>{
      if(live&&!changed)setUserId(data?.session?.user?.id??null);
    }).catch(()=>{});
    return ()=>{live=false;subscription.unsubscribe();};
  },[]);
  const key=userId?'ugerod.ui.exerciseNames.v1.'+userId:null;
  useEffect(()=>{
    if(!key)return;
    let live=true;const version=editVersion.current;
    AsyncStorage.getItem(key).then(mode=>{
      if(live&&editVersion.current===version)setSelection({key,mode:normalizeExerciseNameMode(mode)});
    }).catch(error=>console.warn('Exercise name preference load',error));
    return ()=>{live=false;};
  },[key]);
  const setMode=useCallback(value=>{
    if(!key)return;
    editVersion.current++;
    const mode=normalizeExerciseNameMode(value);
    setSelection({key,mode});
    AsyncStorage.setItem(key,mode).catch(error=>console.warn('Exercise name preference save',error));
  },[key]);
  return <Context.Provider value={{mode:key&&selection.key===key?selection.mode:'bilingual',setMode,ready:!!key}}>{children}</Context.Provider>;
}
export const useExerciseNamePreference=()=>useContext(Context);
