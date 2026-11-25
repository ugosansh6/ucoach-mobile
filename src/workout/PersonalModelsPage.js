import { router,useFocusEffect } from 'expo-router';
import {useCallback,useRef,useState} from 'react';
import {ActivityIndicator,Pressable,SafeAreaView,ScrollView,Text,TextInput,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useUgerodTheme} from '../contexts/UgerodThemeContext';
import {fontFamilies} from '../constants/typography';
import {listPersonalWorkoutModels,renamePersonalWorkoutModel,duplicatePersonalWorkoutModel,deletePersonalWorkoutModel,planPersonalProgram} from '../services/personalWorkoutModelService';
import ProgramCover from '../components/programs/ProgramCover';
import {listLocalProgramGroupCovers} from '../services/localProgramDraftService';
import {getComposerPrescriptionPreview} from '../services/composerService';
import {modelDateKey,validModelDate,canReusePersonalModel,personalModelMeta,sortPersonalModels,groupPersonalModels,personalProgramRows,buildPersonalProgramDraft,PROGRAM_GEAR,programDoseLabel} from '../utils/personalWorkoutModels';
import {formatComposerDose,composerWodProtocol} from '../utils/composerPresentation';

export default function PersonalModelsPage({importDate,showExercises,initialGroup}){
 const {colors:c}=useUgerodTheme();
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [selectedId,setSelectedId]=useState(null),[busy,setBusy]=useState(false),[name,setName]=useState(null),[confirm,setConfirm]=useState(false);
 const [groupId,setGroupId]=useState(initialGroup||null);
 const [groupCovers,setGroupCovers]=useState({});
 const grouping=groupPersonalModels(rows);
 const group=grouping.groups.find(g=>g.id===groupId);
 const operation=useRef(false);
 function beginOperation(){if(operation.current)return false;operation.current=true;setBusy(true);return true;}
 function endOperation(){operation.current=false;setBusy(false);}
 const [date,setDate]=useState(validModelDate(importDate)?importDate:modelDateKey());
 const [programRows,setProgramRows]=useState(null),[gearConfirmed,setGearConfirmed]=useState(false),[surface,setSurface]=useState(null),[preview,setPreview]=useState(null);
 useFocusEffect(useCallback(()=>{let alive=true;setLoading(true);setError('');setGroupCovers({});
  listLocalProgramGroupCovers().then(({covers})=>{if(alive)setGroupCovers(covers);}).catch(()=>{});
  listPersonalWorkoutModels().then(items=>{if(alive)setRows(sortPersonalModels(items));}).catch(()=>{if(alive)setError('Impossible de charger tes modèles. Réessaie.');}).finally(()=>{if(alive)setLoading(false);});
  return ()=>{alive=false;};
 },[retry]));
 const selected=rows.find(x=>x.id===selectedId);
 const authored=selected?.origin==='PROGRAM'&&programRows?buildPersonalProgramDraft(selected,programRows):null;
 const outdoor=authored?.environment_code==='OUTDOOR';
 const ready=Boolean(authored&&gearConfirmed&&(!outdoor||surface));
 function changeDose(i,key,value){if(operation.current)return;setProgramRows(old=>old.map((r,j)=>j===i?{...r,authored_dose:{...r.authored_dose,[key]:value===''?null:Number(value)}}:r));setPreview(null);}
 function chooseVariant(i,id){if(operation.current)return;setProgramRows(old=>old.map((r,j)=>j===i?{...r,id}:r));setGearConfirmed(false);setPreview(null);}
 async function calculateProgram(){if(!authored||!beginOperation())return;setError('');setPreview(null);try{const result=await getComposerPrescriptionPreview({draft:authored,equipmentNames:authored.equipment_ids});if(result?.status!=='PREVIEW')throw new Error('Estimation indisponible.');setPreview(result);}catch(e){setError('Vérifie le matériel et les prescriptions : '+(e.message??''));}finally{endOperation();}}
 async function submitProgram(launch=false){if(!ready)return;const day=launch?modelDateKey():date;if(!validModelDate(day)||!beginOperation())return;setError('');try{const result=await planPersonalProgram(selected.id,day,authored,surface);if(result?.status!=='SAVED')throw new Error('La séance n’a pas été enregistrée.');router.push(launch?'/workout/preparation':'/(tabs)/planning');}catch(e){setError(/already planned|already.*day/i.test(String(e.message))?'Une séance est déjà prévue ce jour. Choisis un autre jour dans Ma semaine.':e.message??'Impossible de planifier cette séance.');}finally{endOperation();}}
 const txt={fontFamily:fontFamilies.regular,fontSize:14,color:c.text},muted={...txt,fontSize:12,color:c.textSecondary},bold={...txt,fontFamily:fontFamilies.semiBold};
 const card={padding:13,borderRadius:12,borderWidth:1,borderColor:c.border,backgroundColor:c.surface,gap:8};
 const input={...txt,borderWidth:1,borderColor:c.border,padding:11,borderRadius:9,backgroundColor:c.surface};
 function close(){setSelectedId(null);setName(null);setConfirm(false);setError('');setProgramRows(null);setPreview(null);setGearConfirmed(false);setSurface(null);}
 function selectModel(model){setSelectedId(model.id);setError('');setPreview(null);setGearConfirmed(false);setSurface(null);setProgramRows(model.origin==='PROGRAM'?personalProgramRows(model.source_payload):null);}
 async function action(fn){if(!beginOperation())return;setError('');try{await fn();setRetry(n=>n+1);}catch(e){setError(e?.message??'Impossible de modifier le modèle.');}finally{endOperation();}}
 function button(label,icon,onPress,{primary=false,disabled=false}={}){return <Pressable accessibilityRole="button" accessibilityState={{disabled:disabled||busy}} disabled={disabled||busy} onPress={()=>{if(!operation.current)onPress();}} style={{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,padding:10,borderRadius:9,borderWidth:1,borderColor:primary?c.accent:c.border,backgroundColor:primary?c.accent:c.surface,opacity:(disabled||busy)?0.5:1}}><Ionicons name={icon} size={18} color={primary?c.textOnAccent:c.accent}/><Text style={{...bold,color:primary?c.textOnAccent:c.text}}>{label}</Text></Pressable>;}
 function modelRow(model,inGroup=false){const meta=personalModelMeta(model);return <Pressable key={model.id} accessibilityRole="button" disabled={busy} onPress={()=>{if(!operation.current)selectModel(model);}} style={{minHeight:72,borderBottomWidth:1,borderBottomColor:c.border,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:11}}>
   <View style={{width:44,height:44,borderRadius:10,backgroundColor:c.accentSoft,alignItems:'center',justifyContent:'center'}}>{inGroup?<Text style={bold}>{String(model.source_payload?.week_start??'').padStart(2,'0')}</Text>:<Ionicons name={model.origin==='PROGRAM'?'calendar-outline':'bookmark-outline'} size={21} color={c.accent}/>}</View>
   <View style={{flex:1,gap:4}}><Text style={{...bold,fontSize:15}}>{inGroup?`Semaines ${model.source_payload.week_start}–${model.source_payload.week_end}`:model.name}</Text><Text style={muted}>{meta.environment} · {meta.count} mouvements{meta.duration?' · '+meta.duration+' min':''}{meta.frequency?' · '+meta.frequency+' séances/sem.':''}</Text>{!canReusePersonalModel(model)?<Text style={{...muted,color:c.secondaryAccent}}>À compléter</Text>:null}</View>
   <Ionicons name="chevron-forward" size={18} color={c.textSecondary}/>
 </Pressable>;}
 return <SafeAreaView style={{flex:1,backgroundColor:c.background}}>
 <ScrollView contentContainerStyle={{padding:18,paddingBottom:40,gap:12}} keyboardShouldPersistTaps="handled">
 <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
   {selected||group?<Pressable accessibilityLabel="Retour aux modèles" disabled={busy} onPress={()=>{if(!operation.current){if(selected)close();else {setGroupId(null);if(initialGroup)router.setParams({group:''});}}}}><Ionicons name="arrow-back" size={24} color={c.text}/></Pressable>:null}
   <Text style={{fontFamily:fontFamilies.display,fontSize:32,color:c.text,flex:1}}>{selected?'TON MODÈLE.':group?group.title.toUpperCase()+'.':'BIBLIOTHÈQUE.'}</Text>
   {!selected&&!group?<Pressable accessibilityLabel="Mon profil" onPress={()=>router.push('/profile')}><Ionicons name="person-circle-outline" size={30} color={c.text}/></Pressable>:null}
 </View>
 {!selected&&!group?<View style={{flexDirection:'row',borderBottomWidth:1,borderBottomColor:c.border}}><View accessibilityRole="tab" accessibilityState={{selected:true}} style={{flex:1,minHeight:44,justifyContent:'center',borderBottomWidth:3,borderBottomColor:c.accent}}><Text style={{...bold,textAlign:'center'}}>Mes modèles</Text></View><Pressable accessibilityRole="tab" accessibilityState={{selected:false}} onPress={showExercises} style={{flex:1,minHeight:44,justifyContent:'center'}}><Text style={{...txt,textAlign:'center',color:c.textSecondary}}>Exercices</Text></Pressable></View>:null}
 {error?<View accessibilityRole="alert" style={card}><Text style={txt}>{error}</Text>{button('Réessayer','refresh-outline',()=>setRetry(x=>x+1))}</View>:null}
 {loading?<ActivityIndicator color={c.accent}/>:selected?<><Text style={{...bold,fontSize:20}}>{selected.name}</Text>
 <Text style={muted}>{personalModelMeta(selected).environment} · {personalModelMeta(selected).count} mouvements{personalModelMeta(selected).duration?' · '+personalModelMeta(selected).duration+' min':''}</Text>
 {selected.origin==='PROGRAM'?<>
   {authored?<><View style={card}><Text style={bold}>Échauffement 5 min · Renforcement</Text><Text style={muted}>2 séances par semaine · Sans Tabata · {preview?.duration_minutes?preview.duration_minutes+' min estimées':'Durée calculée selon tes choix'}</Text><Text style={muted}>Confirme le matériel et la date en bas de la séance pour l’ajouter à Ma semaine.</Text>{button('Estimer la durée','timer-outline',calculateProgram,{disabled:!gearConfirmed})}</View>
   {programRows.map((e,i)=><View key={i} style={card}>
      <Text style={bold}>{e.name}</Text><Text style={muted}>{programDoseLabel(e.authored_dose)}</Text>
      {e.candidates.length>1?<View style={{flexDirection:'row',gap:8}}>{e.candidates.map(id=><Pressable key={id} disabled={busy} onPress={()=>chooseVariant(i,id)} style={{...card,flex:1,borderColor:e.id===id?c.accent:c.border}}><Text style={txt}>{({EX009:'Strictes',EX003:'Inclinées',EX071:'Strictes',EX067:'Assistées (élastique)'})[id]??id}</Text></Pressable>)}</View>:null}
      <View style={{flexDirection:'row',gap:8}}>{[['sets','Séries'],['target',e.authored_dose.mode==='time'?'Secondes':e.authored_dose.mode==='count'?e.authored_dose.count_unit:'Reps'],['rest_seconds','Repos (s)']].map(([k,label])=><View key={k} style={{flex:1,gap:4}}><Text style={muted}>{label}</Text><TextInput accessibilityLabel={e.name+' '+label} editable={!busy} keyboardType="number-pad" value={String(e.authored_dose[k]??'')} onChangeText={v=>changeDose(i,k,v)} style={input}/></View>)}</View>
      {e.authored_dose.range_min!=null?<Text style={muted}>Fourchette d’origine : {e.authored_dose.range_min}–{e.authored_dose.range_max}</Text>:null}
      {e.authored_dose.tempo_eccentric_seconds?<Text style={muted}>Descente : {e.authored_dose.tempo_eccentric_seconds} s</Text>:null}
      {e.authored_dose.tempo_pause_seconds?<Text style={muted}>Pause en bas : {e.authored_dose.tempo_pause_seconds} s</Text>:null}
   </View>)}
   <View style={card}><Text style={bold}>Matériel de la séance</Text>{authored.equipment_ids.map(id=><Text key={id} style={txt}>• {PROGRAM_GEAR[id]??id}</Text>)}{button(gearConfirmed?'Matériel confirmé':'Je dispose de ce matériel',gearConfirmed?'checkmark-circle':'checkbox-outline',()=>{setGearConfirmed(x=>!x);setPreview(null);})}</View>
   {outdoor?<View style={card}><Text style={bold}>Surface du lieu</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{[['RUBBER','Dalles'],['GRASS','Herbe'],['ROAD','Bitume'],['SAND','Sable'],['MIXED','Mixte']].map(([v,l])=><Pressable key={v} disabled={busy} onPress={()=>{if(!operation.current)setSurface(v);}} style={{...card,borderColor:surface===v?c.accent:c.border}}><Text style={txt}>{l}</Text></Pressable>)}</View></View>:null}
   <View style={card}><Text style={bold}>Ajouter à Ma semaine</Text><Text style={muted}>Choisis un jour libre. Tes modifications s’appliquent à cette séance uniquement.</Text><TextInput accessibilityLabel="Date de la séance" placeholder="AAAA-MM-JJ" placeholderTextColor={c.textSecondary} editable={!busy} value={date} onChangeText={v=>{if(!operation.current)setDate(v);}} style={input}/>{button('Ajouter à Ma semaine','calendar-outline',()=>submitProgram(),{primary:true,disabled:!ready||!validModelDate(date)})}{button('Lancer aujourd’hui','play-outline',()=>submitProgram(true),{disabled:!ready})}</View>
   </>:<View style={card}><Text style={bold}>Prescription à vérifier</Text><Text style={muted}>Renseigne des séries, répétitions ou durées et repos valides.</Text>{button('Rétablir les prescriptions','refresh-outline',()=>setProgramRows(personalProgramRows(selected.source_payload)))}</View>}
 </>:<>
   {(selected.draft.architecture?.blocks??[]).map((b,i)=>{const preview=selected.draft.prescription_preview?.blocks?.find(x=>x.type===b.type);return <View key={i} style={card}>
     <Text style={bold}>{b.label??b.type} · {b.minutes} min</Text>
     {b.type==='WOD'&&preview?<Text style={muted}>{composerWodProtocol(preview)}</Text>:null}
     {(b.exercises??[]).map((e,j)=>{const dose=preview?.exercises?.find(x=>x.id===e.id);return <View key={j} style={{gap:4,paddingVertical:6,borderTopWidth:1,borderTopColor:c.border}}><Text style={bold}>{e.name??e.id}</Text><Text style={muted}>{dose?formatComposerDose(dose,b.type,preview):'Prescription à recalculer'}</Text></View>})}
   </View>})}
   <View style={card}><Text style={bold}>Planifier une occurrence</Text><Text style={muted}>Choisis un jour libre. Tu retrouveras le récapitulatif pour vérifier et adapter la séance avant validation.</Text><TextInput accessibilityLabel="Date de la séance" placeholder="AAAA-MM-JJ" placeholderTextColor={c.textSecondary} editable={!busy} value={date} onChangeText={v=>{if(!operation.current)setDate(v);}} style={input}/>{button('Réutiliser ce modèle','calendar-outline',()=>router.push({pathname:'/workout/preparation',params:{entry:'week_assisted',date,modelId:selected.id}}),{primary:true,disabled:!canReusePersonalModel(selected)||!validModelDate(date)})}</View>
 </>}
 {name!==null?<View style={card}><Text style={bold}>Renommer</Text><TextInput editable={!busy} value={name} onChangeText={v=>{if(!operation.current)setName(v);}} maxLength={120} accessibilityLabel="Nom du modèle" style={input}/>{button('Enregistrer','checkmark',()=>action(async()=>{await renamePersonalWorkoutModel(selected.id,name);setName(null);}),{disabled:!name.trim()})}{button('Annuler','close',()=>setName(null))}</View>:button('Renommer','pencil-outline',()=>setName(selected.name))}
 {button('Dupliquer','copy-outline',()=>action(async()=>{const copy=await duplicatePersonalWorkoutModel(selected.id);selectModel(copy);setName(null);setConfirm(false);}))}
 {confirm?<View style={card}><Text style={txt}>Supprimer ce modèle ? Les séances déjà planifiées et l’historique ne seront pas modifiés.</Text>{button('Confirmer la suppression','trash-outline',()=>action(async()=>{await deletePersonalWorkoutModel(selected.id);close();}))}{button('Annuler','close',()=>setConfirm(false))}</View>:button('Supprimer','trash-outline',()=>setConfirm(true))}
 </>:<>
 {group?<><ProgramCover cover={groupCovers[group.id]} fallback={group.id==='street'?'outdoor':'bodyweight'} height={148}/><Text style={muted}>{group.subtitle} · {group.models.length} phases</Text>{group.models.map(m=>modelRow(m,true))}</>:<>
 <Text style={muted}>Retrouve tes séances enregistrées et réutilise-les.</Text>
 {grouping.groups.length?<Text style={{...bold,marginTop:6}}>Mes programmes</Text>:null}
 {grouping.groups.map((g,i)=><Pressable key={g.id} accessibilityRole="button" onPress={()=>setGroupId(g.id)} style={{borderRadius:16,backgroundColor:i===0?c.accent:c.surfacePressed,padding:16,gap:14}}>
   <View style={{flexDirection:'row',alignItems:'center',gap:12}}><View style={{flex:1,gap:5}}><Text style={{...muted,color:i===0?c.textOnAccent:c.textSecondary}}>{g.subtitle}</Text><Text style={{fontFamily:fontFamilies.display,fontSize:27,color:i===0?c.textOnAccent:c.text}}>{g.title.toUpperCase()}</Text><Text style={{...txt,color:i===0?c.textOnAccent:c.text}}>{g.models.length} modèles</Text></View><ProgramCover cover={groupCovers[g.id]} fallback={g.id==='street'?'outdoor':'bodyweight'} width={108} height={76} radius={10}/></View>
   <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderTopWidth:1,borderTopColor:i===0?'rgba(255,255,255,0.26)':c.border,paddingTop:10}}><Text style={{...bold,color:i===0?c.textOnAccent:c.text}}>Voir les modèles</Text><Ionicons name="arrow-forward" size={20} color={i===0?c.textOnAccent:c.accent}/></View>
 </Pressable>)}
 <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:8}}><Text style={bold}>Mes séances enregistrées</Text><Pressable accessibilityRole="button" onPress={()=>router.push('/(tabs)/planning')} style={{minHeight:44,justifyContent:'center'}}><Ionicons name="add" size={23} color={c.accent}/></Pressable></View>
 {grouping.standalone.length?grouping.standalone.map(m=>modelRow(m)):<Text style={muted}>Les séances enregistrées dans le Composer apparaîtront ici.</Text>}
 {button('Créer un programme','add-circle-outline',()=>router.push({pathname:'/(tabs)/programmes',params:{section:'mine',create:'1'}}))}
 </>}

 </>}
 </ScrollView>
 </SafeAreaView>;
}
