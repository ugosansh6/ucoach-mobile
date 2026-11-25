import { router,useFocusEffect } from 'expo-router';
import {useCallback,useState} from 'react';
import {ActivityIndicator,Pressable,SafeAreaView,ScrollView,Text,TextInput,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useUgerodTheme} from '../contexts/UgerodThemeContext';
import {fontFamilies} from '../constants/typography';
import {listPersonalWorkoutModels,renamePersonalWorkoutModel,duplicatePersonalWorkoutModel,deletePersonalWorkoutModel} from '../services/personalWorkoutModelService';
import {modelDateKey,validModelDate,canReusePersonalModel,personalModelMeta,sortPersonalModels} from '../utils/personalWorkoutModels';
import {formatComposerDose,composerWodProtocol} from '../utils/composerPresentation';

export default function PersonalModelsPage({importDate,showExercises}){
 const {colors:c}=useUgerodTheme();
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [selectedId,setSelectedId]=useState(null),[busy,setBusy]=useState(false),[name,setName]=useState(null),[confirm,setConfirm]=useState(false);
 const [date,setDate]=useState(validModelDate(importDate)?importDate:modelDateKey());
 useFocusEffect(useCallback(()=>{let alive=true;setLoading(true);setError('');
  listPersonalWorkoutModels().then(items=>{if(alive)setRows(sortPersonalModels(items));}).catch(()=>{if(alive)setError('Impossible de charger tes modèles. Réessaie.');}).finally(()=>{if(alive)setLoading(false);});
  return ()=>{alive=false;};
 },[retry]));
 const selected=rows.find(x=>x.id===selectedId);
 const txt={fontFamily:fontFamilies.regular,fontSize:14,color:c.text},muted={...txt,fontSize:12,color:c.textSecondary},bold={...txt,fontFamily:fontFamilies.semiBold};
 const card={padding:13,borderRadius:12,borderWidth:1,borderColor:c.border,backgroundColor:c.surface,gap:8};
 const input={...txt,borderWidth:1,borderColor:c.border,padding:11,borderRadius:9,backgroundColor:c.surface};
 function close(){setSelectedId(null);setName(null);setConfirm(false);setError('');}
 async function action(fn){if(busy)return;setBusy(true);setError('');try{await fn();setRetry(n=>n+1);}catch(e){setError(e?.message??'Impossible de modifier le modèle.');}finally{setBusy(false);}}
 function button(label,icon,onPress,{primary=false,disabled=false}={}){return <Pressable accessibilityRole="button" accessibilityState={{disabled:disabled||busy}} disabled={disabled||busy} onPress={onPress} style={{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,padding:10,borderRadius:9,borderWidth:1,borderColor:primary?c.accent:c.border,backgroundColor:primary?c.accent:c.surface,opacity:(disabled||busy)?0.5:1}}><Ionicons name={icon} size={18} color={primary?c.textOnAccent:c.accent}/><Text style={{...bold,color:primary?c.textOnAccent:c.text}}>{label}</Text></Pressable>;}
 function modelRow(model){const meta=personalModelMeta(model);return <Pressable key={model.id} accessibilityRole="button" onPress={()=>{setSelectedId(model.id);setError('');}} style={{...card,flexDirection:'row',alignItems:'center',gap:11}}>
   <View style={{width:43,height:43,borderRadius:10,backgroundColor:c.accentSoft??c.background,alignItems:'center',justifyContent:'center'}}><Ionicons name={model.origin==='PROGRAM'?'calendar-outline':'bookmark-outline'} size={22} color={c.accent}/></View>
   <View style={{flex:1,gap:4}}><Text style={bold}>{model.name}</Text><Text style={muted}>{meta.environment} · {meta.count} mouvements{meta.duration?' · '+meta.duration+' min':''}{meta.frequency?' · '+meta.frequency+' séances/sem.':''}</Text><Text style={{...muted,color:model.origin==='PROGRAM'?c.secondaryAccent:c.accent}}>{canReusePersonalModel(model)?'À réutiliser':'À compléter'}</Text></View>
   <Ionicons name="chevron-forward" size={18} color={c.textSecondary}/>
 </Pressable>;}
 return <SafeAreaView style={{flex:1,backgroundColor:c.background}}>
 <ScrollView contentContainerStyle={{padding:18,paddingBottom:40,gap:12}} keyboardShouldPersistTaps="handled">
 <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
   {selected?<Pressable accessibilityLabel="Retour aux modèles" onPress={close}><Ionicons name="arrow-back" size={24} color={c.text}/></Pressable>:null}
   <Text style={{fontFamily:fontFamilies.display,fontSize:30,color:c.text,flex:1}}>{selected?'TON MODÈLE.':'MES MODÈLES.'}</Text>
   {!selected?<Pressable accessibilityLabel="Voir les exercices" onPress={showExercises}><Ionicons name="list-outline" size={24} color={c.text}/></Pressable>:null}
 </View>
 {!selected?<View style={{flexDirection:'row',gap:8}}><View style={{...card,flex:1,padding:9,borderColor:c.accent}}><Text style={{...bold,textAlign:'center',color:c.accent}}>Mes modèles</Text></View><Pressable onPress={showExercises} style={{...card,flex:1,padding:9}}><Text style={{...bold,textAlign:'center'}}>Exercices</Text></Pressable></View>:null}
 {error?<View accessibilityRole="alert" style={card}><Text style={txt}>{error}</Text>{button('Réessayer','refresh-outline',()=>setRetry(x=>x+1))}</View>:null}
 {loading?<ActivityIndicator color={c.accent}/>:selected?<><Text style={{...bold,fontSize:20}}>{selected.name}</Text>
 <Text style={muted}>{personalModelMeta(selected).environment} · {personalModelMeta(selected).count} mouvements{personalModelMeta(selected).duration?' · '+personalModelMeta(selected).duration+' min':''}</Text>
 {selected.origin==='PROGRAM'?<>
   <View style={card}><Text style={{...bold,color:c.secondaryAccent}}>Programme à compléter</Text><Text style={txt}>Les prescriptions d'origine sont conservées. Le modèle sera utilisable une fois les exercices et paramètres manquants validés.</Text>{selected.source_payload.frequency_per_week?<Text style={muted}>{selected.source_payload.frequency_per_week} séances par semaine</Text>:<Text style={muted}>Fréquence à préciser</Text>}</View>
   <View style={card}>{(selected.source_payload.exercises??[]).map((e,i)=><View key={i} style={{gap:4,paddingVertical:7,borderBottomWidth:i===selected.source_payload.exercises.length-1?0:1,borderBottomColor:c.border}}><Text style={bold}>{e.name}</Text><Text style={txt}>{e.dose}</Text>{e.note?<Text style={muted}>{e.note}</Text>:null}{!e.candidate_ids?.length?<Text style={{...muted,color:c.secondaryAccent}}>Référence catalogue à compléter</Text>:null}</View>)}</View>
   <View style={card}><Text style={bold}>Points à valider</Text>{(selected.source_payload.blockers??[]).map((b,i)=><Text key={i} style={muted}>• {b}</Text>)}</View>
 </>:<>
   {(selected.draft.architecture?.blocks??[]).map((b,i)=>{const preview=selected.draft.prescription_preview?.blocks?.find(x=>x.type===b.type);return <View key={i} style={card}>
     <Text style={bold}>{b.label??b.type} · {b.minutes} min</Text>
     {b.type==='WOD'&&preview?<Text style={muted}>{composerWodProtocol(preview)}</Text>:null}
     {(b.exercises??[]).map((e,j)=>{const dose=preview?.exercises?.find(x=>x.id===e.id);return <View key={j} style={{gap:4,paddingVertical:6,borderTopWidth:1,borderTopColor:c.border}}><Text style={bold}>{e.name??e.id}</Text><Text style={muted}>{dose?formatComposerDose(dose,b.type,preview):'Prescription à recalculer'}</Text></View>})}
   </View>})}
   <View style={card}><Text style={bold}>Planifier une occurrence</Text><Text style={muted}>Choisis un jour libre. Tu retrouveras le récapitulatif pour vérifier et adapter la séance avant validation.</Text><TextInput accessibilityLabel="Date de la séance" placeholder="AAAA-MM-JJ" placeholderTextColor={c.textSecondary} value={date} onChangeText={setDate} style={input}/>{button('Réutiliser ce modèle','calendar-outline',()=>router.push({pathname:'/workout/preparation',params:{entry:'week_assisted',date,modelId:selected.id}}),{primary:true,disabled:!canReusePersonalModel(selected)||!validModelDate(date)})}</View>
 </>}
 {name!==null?<View style={card}><Text style={bold}>Renommer</Text><TextInput value={name} onChangeText={setName} maxLength={120} accessibilityLabel="Nom du modèle" style={input}/>{button('Enregistrer','checkmark',()=>action(async()=>{await renamePersonalWorkoutModel(selected.id,name);setName(null);}),{disabled:!name.trim()})}{button('Annuler','close',()=>setName(null))}</View>:button('Renommer','pencil-outline',()=>setName(selected.name))}
 {button('Dupliquer','copy-outline',()=>action(async()=>{const copy=await duplicatePersonalWorkoutModel(selected.id);setSelectedId(copy.id);setName(null);setConfirm(false);}))}
 {confirm?<View style={card}><Text style={txt}>Supprimer ce modèle ? Les séances déjà planifiées et l’historique ne seront pas modifiés.</Text>{button('Confirmer la suppression','trash-outline',()=>action(async()=>{await deletePersonalWorkoutModel(selected.id);close();}))}{button('Annuler','close',()=>setConfirm(false))}</View>:button('Supprimer','trash-outline',()=>setConfirm(true))}
 </>:<>
 <Text style={muted}>Retrouve tes séances enregistrées et réutilise-les quand tu veux.</Text>
 {!rows.length?<View style={card}><Text style={bold}>Aucun modèle pour le moment</Text><Text style={muted}>Tes prochaines séances validées dans le Composer seront sauvegardées ici.</Text>{button('Ma semaine','calendar-outline',()=>router.push('/(tabs)/planning'))}</View>:null}
 {rows.some(x=>x.origin==='PROGRAM')?<Text style={bold}>Mes programmes</Text>:null}
 {rows.filter(x=>x.origin==='PROGRAM').map(modelRow)}
 {rows.some(x=>x.origin==='COMPOSER')?<Text style={bold}>Mes séances enregistrées</Text>:null}
 {rows.filter(x=>x.origin==='COMPOSER').map(modelRow)}
 </>}
 </ScrollView>
 </SafeAreaView>;
}
