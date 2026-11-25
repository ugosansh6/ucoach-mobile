import {useState} from 'react';
import {Pressable,Text,TextInput,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {router} from 'expo-router';
import {fontFamilies} from '../constants/typography';
import {newProgramPhase,duplicateProgramPhase,programDraftWeeks,programDraftIssues} from '../utils/personalProgramDrafts';
import ProgramCoverEditor from '../components/programs/ProgramCoverEditor';
import {personalModelMeta,canReusePersonalModel} from '../utils/personalWorkoutModels';

export const localDraftId=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);

export default function PersonalProgramDraftEditor({draft,onChange,onSave,onBack,models,colors:c,busy}){
 const [picker,setPicker]=useState(null);
 const [coverBusy,setCoverBusy]=useState(false);
 const [exitConfirm,setExitConfirm]=useState(false);
 const txt={fontFamily:fontFamilies.regular,fontSize:14,color:c.text},bold={...txt,fontFamily:fontFamilies.semiBold},muted={...txt,fontSize:12,color:c.textSecondary};
 const input={...txt,minHeight:44,paddingHorizontal:12,paddingVertical:10,borderRadius:10,borderWidth:1,borderColor:c.border,backgroundColor:c.surface};
 const updatePhase=(id,fn)=>onChange({...draft,phases:draft.phases.map(p=>p.id===id?fn(p):p)});
 const action=(label,icon,fn,primary=false,disabled=false)=><Pressable accessibilityRole="button" disabled={busy||coverBusy||disabled} onPress={fn} style={{minHeight:44,padding:12,borderRadius:10,backgroundColor:primary?c.accent:c.surfacePressed,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,opacity:busy||coverBusy||disabled?0.5:1}}><Ionicons name={icon} size={19} color={primary?c.textOnAccent:c.accent}/><Text style={{...bold,color:primary?c.textOnAccent:c.text}}>{label}</Text></Pressable>;
 const issues=programDraftIssues(draft,models.filter(canReusePersonalModel));
 let cursor=1;
 return <View style={{gap:16}}>
 <Pressable accessibilityRole="button" onPress={()=>setExitConfirm(true)} disabled={busy||coverBusy} style={{flexDirection:'row',alignItems:'center',gap:8,minHeight:44}}><Ionicons name="arrow-back" size={20} color={c.text}/><Text style={bold}>Mes programmes</Text></Pressable>
 {exitConfirm?<View accessibilityRole="alert" style={{padding:12,backgroundColor:c.surfacePressed,borderRadius:10,gap:8}}><Text style={txt}>Quitter sans enregistrer les dernières modifications ?</Text>{action('Continuer l’édition','pencil-outline',()=>setExitConfirm(false))}{action('Quitter sans enregistrer','exit-outline',onBack)}</View>:null}
 <Text style={{fontFamily:fontFamilies.display,fontSize:30,color:c.text}}>MON PROGRAMME.</Text>
 <Text style={muted}>Brouillon privé sur cet appareil. Les séances et leur planification restent inchangées.</Text>
 <ProgramCoverEditor cover={draft.cover} onChange={cover=>onChange(current=>current?{...current,cover}:current)} onBusyChange={setCoverBusy} colors={c} disabled={busy}/>
 <Text style={bold}>Nom du programme</Text><TextInput accessibilityLabel="Nom du programme" style={input} editable={!busy} value={draft.title} maxLength={120} placeholder="Ex. Préparation Spartan" placeholderTextColor={c.textMuted} onChangeText={title=>onChange({...draft,title})}/>
 <Text style={bold}>Objectif</Text><TextInput accessibilityLabel="Objectif" style={{...input,minHeight:70,textAlignVertical:'top'}} editable={!busy} multiline value={draft.objective} maxLength={600} placeholder="Ex. Développer ma force et mon grip" placeholderTextColor={c.textMuted} onChangeText={objective=>onChange({...draft,objective})}/>
 <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={bold}>Mes phases</Text><Text style={muted}>{programDraftWeeks(draft)} semaines</Text></View>
 {draft.phases.map((p,i)=>{const valid=Number.isInteger(Number(p.weeks))&&Number(p.weeks)>0;const first=cursor;const last=first+(valid?Number(p.weeks):0)-1;if(valid)cursor=last+1;return <View key={p.id} style={{gap:10,padding:13,borderRadius:14,backgroundColor:c.surface,borderWidth:1,borderColor:c.border}}>
 <View style={{flexDirection:'row',alignItems:'center',gap:8}}><View style={{flex:1}}><Text style={bold}>Phase {i+1}</Text><Text style={muted}>{valid?'Semaines '+first+'–'+last:'Durée à préciser'}</Text></View><Pressable accessibilityLabel={'Dupliquer phase '+(i+1)} disabled={busy} onPress={()=>onChange({...draft,phases:[...draft.phases.slice(0,i+1),duplicateProgramPhase(p,localDraftId()),...draft.phases.slice(i+1)]})} style={{padding:10}}><Ionicons name="copy-outline" size={20} color={c.accent}/></Pressable><Pressable accessibilityLabel={'Retirer phase '+(i+1)} disabled={busy} onPress={()=>{setPicker(null);onChange({...draft,phases:draft.phases.filter(x=>x.id!==p.id)})}} style={{padding:10}}><Ionicons name="trash-outline" size={20} color={c.textSecondary}/></Pressable></View>
 <TextInput accessibilityLabel={'Nom phase '+(i+1)} placeholder="Nom de la phase" placeholderTextColor={c.textMuted} style={input} editable={!busy} value={p.title} maxLength={100} onChangeText={title=>updatePhase(p.id,x=>({...x,title}))}/>
 <View style={{flexDirection:'row',alignItems:'center',gap:10}}><Text style={txt}>Durée (semaines)</Text><TextInput accessibilityLabel={'Durée phase '+(i+1)} style={{...input,width:78}} editable={!busy} keyboardType="number-pad" maxLength={3} value={p.weeks} onChangeText={weeks=>updatePhase(p.id,x=>({...x,weeks}))}/></View>
 <Text style={bold}>Séances réutilisées</Text>
 {p.sessions.map((s,j)=>{const m=models.find(x=>x.id===s.modelId);return <View key={s.modelId+'-'+j} style={{borderTopWidth:1,borderTopColor:c.border,paddingTop:9,gap:6}}>
 <View style={{flexDirection:'row',alignItems:'center',gap:8}}><View style={{flex:1}}><Text style={bold}>{m?.name??'Modèle indisponible'}</Text><Text style={muted}>{m?personalModelMeta(m).environment:'Sélectionne un autre modèle'}</Text></View><Pressable accessibilityLabel="Retirer cette séance de la phase" disabled={busy} onPress={()=>updatePhase(p.id,x=>({...x,sessions:x.sessions.filter((_,k)=>k!==j)}))} style={{padding:10}}><Ionicons name="close-circle-outline" size={22} color={c.textSecondary}/></Pressable></View>
 <View style={{flexDirection:'row',alignItems:'center',gap:8}}><TextInput accessibilityLabel="Fréquence de cette séance" style={{...input,width:66}} editable={!busy} keyboardType="number-pad" maxLength={2} value={s.frequency} onChangeText={frequency=>updatePhase(p.id,x=>({...x,sessions:x.sessions.map((v,k)=>k===j?{...v,frequency}:v)}))}/><Text style={muted}>fois par semaine</Text></View>
 </View>})}
 {action(picker===p.id?'Fermer les modèles':'Ajouter une séance','add-circle-outline',()=>setPicker(picker===p.id?null:p.id))}
 {picker===p.id?<View style={{gap:6}}>{models.filter(m=>canReusePersonalModel(m)&&!p.sessions.some(s=>s.modelId===m.id)).map(m=><Pressable key={m.id} disabled={busy} accessibilityRole="button" onPress={()=>{updatePhase(p.id,x=>({...x,sessions:[...x.sessions,{modelId:m.id,frequency:'1'}]}));setPicker(null)}} style={{minHeight:44,padding:9,borderBottomWidth:1,borderBottomColor:c.border}}><Text style={bold}>{m.name}</Text><Text style={muted}>{personalModelMeta(m).environment}</Text></Pressable>)}<Text style={muted}>Pour créer un nouveau modèle, utilise le Composer dans Ma semaine.</Text>{action('Ma semaine','calendar-outline',()=>router.push('/(tabs)/planning'))}</View>:null}
 </View>})}
 {action('Ajouter une phase','add-outline',()=>onChange({...draft,phases:[...draft.phases,newProgramPhase(localDraftId())]}))}
 {issues.length?<View style={{gap:4}}><Text style={bold}>À compléter avant activation</Text>{issues.map((message,i)=><Text key={i} style={muted}>{message}</Text>)}</View>:<Text style={muted}>Structure complète. L’activation et la synchronisation avec Ma semaine seront raccordées dans le prochain lot.</Text>}
 {action('Enregistrer le brouillon','checkmark-outline',onSave,true,!draft.title.trim())}
 </View>;
}
