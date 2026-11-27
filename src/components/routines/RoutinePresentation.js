import {Ionicons} from '@expo/vector-icons';
import {useEffect,useRef,useState} from 'react';
import {DurationControl,PhotoChoiceGrid} from '../creation/CreationFrameControls';
import ExerciseDetail from '../exercises/ExerciseDetail';
import MechanicCarousel from '../creation/MechanicCarousel';
import {getExerciseById} from '../../services/exerciseService';
import {ActivityIndicator,Animated,Keyboard,Pressable,ScrollView,Text,TextInput,View} from 'react-native';
import Svg,{Circle} from 'react-native-svg';
import {useUgerodTheme} from '../../contexts/UgerodThemeContext';
import {fontFamilies} from '../../constants/typography';
import ExerciseArtwork from '../exercises/ExerciseArtwork';
import {ROUTINE_CATEGORIES,ROUTINE_DAYS,ROUTINE_MECHANICS,isIntervalRoutine,advanceRoutinePhase,isBlockTabata,availableTabataBlocks,tabataCycleExerciseIndices,routineTimeLimit} from '../../services/routineContract';

import {initialRoutineEditorState,openRoutineEditorSection,advanceRoutineEditor,routineEditorIssue,ROUTINE_EDITOR_SECTIONS} from './routineEditorNavigation';

// Provisional category illustrations from existing local assets; dedicated photos can replace these.
const ROUTINE_PHOTOS={
 MOBILITY:require('../../../assets/composer-environments/home.webp'),
 CORE:require('../../../assets/branding/nexa-black-gu4bdVTq0CU-unsplash.jpg'),
 PHYSIO:require('../../../assets/composer-environments/equipment.webp'),
 CONDITIONING:require('../../../assets/branding/victor-freitas-WvDYdXDzkhs-unsplash.jpg'),
};
const ROUTINE_DURATION_VALUES=Array.from({length:30},(_,i)=>i+1);
const routineCategories=Object.entries(ROUTINE_CATEGORIES).map(([code,label])=>({code,label}));
const categoryIcons={MOBILITY:'body-outline',CORE:'shield-checkmark-outline',PHYSIO:'heart-outline',CONDITIONING:'flame-outline'};
const order=[1,2,3,4,5,6,0];
const clock=n=>Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
function theme(c){
 const text={color:c.text,fontFamily:fontFamilies.regular,fontSize:14,lineHeight:20};
 return {text,muted:{...text,color:c.textSecondary,fontSize:12,lineHeight:17},label:{...text,fontFamily:fontFamilies.semiBold},heading:{color:c.text,fontFamily:fontFamilies.display,fontSize:30,lineHeight:33,letterSpacing:0.6},eyebrow:{color:c.textMuted,fontFamily:fontFamilies.bold,fontSize:10,letterSpacing:1.2},panel:{backgroundColor:c.surface,borderRadius:16,borderWidth:1,borderColor:c.border,padding:15,gap:12},row:{flexDirection:'row',alignItems:'center',gap:10},field:{...text,backgroundColor:c.surfacePressed,borderRadius:10,borderWidth:1,borderColor:c.border,minHeight:48,paddingHorizontal:12,paddingVertical:9},action:{minHeight:48,borderRadius:12,paddingHorizontal:15,paddingVertical:10,flexDirection:'row',justifyContent:'center',alignItems:'center',gap:8}};
}
function Button({title,onPress,primary=false,icon,disabled=false,compact=false}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({pressed})=>[s.action,{minHeight:compact?44:52,backgroundColor:primary?c.accent:c.surface,borderWidth:1,borderColor:primary?c.accent:c.border,opacity:disabled?0.45:pressed?0.78:1}]}>{icon?<Ionicons name={icon} size={20} color={primary?c.textOnAccent:c.text}/>:null}<Text style={{...s.label,color:primary?c.textOnAccent:c.text}}>{title}</Text></Pressable>;
}
function IconButton({icon,label,onPress,disabled=false,danger=false}){
 const {colors:c}=useUgerodTheme();
 return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({pressed})=>({width:44,height:44,borderRadius:11,alignItems:'center',justifyContent:'center',backgroundColor:c.surfacePressed,opacity:disabled?0.35:pressed?0.7:1})}><Ionicons name={icon} size={21} color={danger?c.error:c.text}/></Pressable>;
}
function CategoryMark({category,size=50}){
 const {colors:c}=useUgerodTheme();
 return <View style={{width:size,height:size,borderRadius:15,backgroundColor:category==='CONDITIONING'?c.secondaryAccentSoft:c.accentSoft,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:c.border}}><Ionicons name={categoryIcons[category]??'repeat-outline'} size={size>=60?34:25} color={category==='CONDITIONING'?c.secondaryAccent:c.text}/></View>;
}
function DayStrip({days=[],onChange}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 return <View style={{flexDirection:'row',gap:5}}>{order.map(day=>{
 const active=days.includes(day);
 const style={flex:1,minWidth:0,minHeight:onChange?44:31,borderRadius:9,alignItems:'center',justifyContent:'center',backgroundColor:active?c.accent:c.surfacePressed,borderWidth:1,borderColor:active?c.accent:c.border};
 const content=<Text style={{...s.label,fontSize:11,color:active?c.textOnAccent:c.textMuted}}>{ROUTINE_DAYS[day].slice(0,1)}</Text>;
 return onChange?<Pressable key={day} accessibilityRole="checkbox" accessibilityLabel={ROUTINE_DAYS[day]} accessibilityState={{checked:active}} onPress={()=>onChange(day)} style={style}>{content}</Pressable>:<View key={day} style={style}>{content}</View>;
 })}</View>;
}
function doseText(e,routine){
 if(isBlockTabata(routine))return 'Tabata '+(e.tabata_block??1)+' · 20 s effort';
 if(isIntervalRoutine(routine.mechanic))return (routine.mechanic==='TABATA'?20:routine.parameters?.work_seconds||'—')+' s effort';
 const dose=e.doseMode==='TIME'||(e.doseMode==null&&e.duration_seconds!=null)?(e.duration_seconds||'—')+' s':(e.reps||'—')+' reps';
 return routine.mechanic==='CIRCUIT'?dose:(e.sets||'—')+' × '+dose;
}
function NumberField({title,value,onChange,unit}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 return <View style={{flex:1,minWidth:70,gap:6}}><Text style={s.muted}>{title}</Text><View style={{...s.field,flexDirection:'row',alignItems:'center',gap:4}}><TextInput accessibilityLabel={title} value={String(value??'')} onChangeText={onChange} keyboardType="number-pad" placeholder="—" placeholderTextColor={c.textMuted} style={{...s.text,fontFamily:fontFamilies.bold,flex:1,fontSize:19,minWidth:0,paddingVertical:0}}/>{unit?<Text style={s.muted}>{unit}</Text>:null}</View></View>;
}
function Choice({title,icon,selected,onPress}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 return <Pressable accessibilityRole="radio" accessibilityState={{selected}} onPress={onPress} style={({pressed})=>({flex:1,minWidth:0,minHeight:58,borderWidth:1,borderColor:selected?c.accent:c.border,borderRadius:12,backgroundColor:selected?c.accentSoft:c.surface,flexDirection:'row',alignItems:'center',gap:8,padding:10,opacity:pressed?0.75:1})}>{icon?<Ionicons name={icon} size={22} color={selected?c.text:c.textMuted}/>:null}<Text style={{...s.label,flex:1,fontSize:13}}>{title}</Text>{selected?<Ionicons name="checkmark-circle" size={17} color={c.secondaryAccent}/>:null}</Pressable>;
}
export function RoutineList({rows,loading,checkpoint,busy,onOpen,onStart,onCreate,onEdit,onCopy,onArchive}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 const [category,setCategory]=useState(''),[menuId,setMenuId]=useState(null);
 const filters=[{code:'',label:'Toutes'},{code:'MOBILITY',label:'Mobilité'},{code:'CORE',label:'Gainage'},{code:'PHYSIO',label:'Kiné'},{code:'CONDITIONING',label:'Conditioning'}];
 const visible=rows.filter(row=>!category||row.category===category);
 if(loading)return <ActivityIndicator color={c.accent}/>;
 function action(fn,row){setMenuId(null);fn(row);}
 return <View style={{gap:14}}>
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:7,paddingBottom:2}}>
   {filters.map(item=><Pressable key={item.code} accessibilityRole="radio" accessibilityState={{selected:category===item.code}} disabled={busy} onPress={()=>{setCategory(item.code);setMenuId(null);}} style={({pressed})=>({minHeight:44,paddingHorizontal:13,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:category===item.code?c.accent:c.surface,borderWidth:1,borderColor:category===item.code?c.accent:c.border,opacity:pressed?0.75:1})}><Text style={{...s.label,fontSize:12,color:category===item.code?c.textOnAccent:c.text}}>{item.label}</Text></Pressable>)}
  </ScrollView>
  {visible.length===0?<View style={{...s.panel,alignItems:'center',paddingVertical:24}}><CategoryMark category={category||undefined} size={52}/><Text style={s.label}>{rows.length?'Aucune routine dans cette catégorie':'Aucune routine pour l’instant'}</Text>{rows.length?<Button title="Voir toutes les routines" compact onPress={()=>{setCategory('');setMenuId(null);}}/>:<Text style={{...s.muted,textAlign:'center'}}>Crée ta première routine pour la retrouver ici.</Text>}</View>:visible.map(row=>{
   const resume=checkpoint?.routine?.id===row.id,menuOpen=menuId===row.id;
   const mechanic=isBlockTabata(row)?'Tabata '+row.parameters.blocks:row.mechanic==='SETS_REPS'?'Séries & maintien':row.mechanic==='HIIT'?'Intervalles':ROUTINE_MECHANICS[row.mechanic];
   return <View key={row.id} style={s.panel}>
    <View style={s.row}>
     <Pressable accessibilityRole="button" accessibilityLabel={'Voir '+row.name} disabled={busy} onPress={()=>action(onOpen,row)} style={{...s.row,flex:1,minWidth:0}}><CategoryMark category={row.category}/><View style={{flex:1,minWidth:0,gap:3}}><Text style={s.eyebrow}>{ROUTINE_CATEGORIES[row.category]?.toUpperCase()}</Text><Text style={{...s.label,fontSize:17,lineHeight:23}}>{row.name}</Text><Text style={s.muted}>{row.planned_minutes} min · {row.exercises.length} exercice{row.exercises.length===1?'':'s'}{mechanic?' · '+mechanic:''}</Text></View></Pressable>
     <Pressable accessibilityRole="button" accessibilityLabel={'Gérer '+row.name} accessibilityState={{expanded:menuOpen}} disabled={busy} onPress={()=>setMenuId(menuOpen?null:row.id)} style={{width:44,height:44,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:menuOpen?c.surfacePressed:c.surface}}><Ionicons name="ellipsis-vertical" size={22} color={c.text}/></Pressable>
    </View>
    {menuOpen?<View style={{borderRadius:12,borderWidth:1,borderColor:c.border,backgroundColor:c.surfacePressed,overflow:'hidden'}}>{[{label:'Modifier',icon:'create-outline',fn:onEdit},{label:'Dupliquer',icon:'copy-outline',fn:onCopy},{label:'Supprimer',icon:'trash-outline',fn:onArchive,danger:true}].map((item,i)=><Pressable key={item.label} accessibilityRole="button" disabled={busy} onPress={()=>action(item.fn,row)} style={({pressed})=>({minHeight:46,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:13,borderTopWidth:i?1:0,borderTopColor:c.border,opacity:pressed?0.65:1})}><Ionicons name={item.icon} size={19} color={item.danger?c.error:c.text}/><Text style={{...s.label,color:item.danger?c.error:c.text}}>{item.label}</Text></Pressable>)}</View>:null}
    {row.recurrence_days?.length?<DayStrip days={row.recurrence_days}/>:<Text style={s.muted}>À la demande</Text>}
    <Button title={resume?'Reprendre':'Lancer'} icon="play-outline" primary disabled={busy} onPress={()=>onStart(row)}/>
   </View>;
  })}
  <Button title="Créer une routine" icon="add-outline" disabled={busy} onPress={onCreate}/>
 </View>;
}

export function RoutineDetail({routine,checkpoint,busy,onStart,onEdit,onCopy,onArchive}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 return <View style={{gap:15}}>
  <View style={{...s.panel,backgroundColor:c.accentSoft}}><CategoryMark category={routine.category} size={62}/><Text style={s.eyebrow}>{ROUTINE_CATEGORIES[routine.category]?.toUpperCase()}</Text><Text style={{...s.heading,fontSize:39,lineHeight:42}}>{routine.name}</Text><Text style={s.muted}>{routine.planned_minutes} min prévues · {routine.exercises.length} exercices · {ROUTINE_MECHANICS[routine.mechanic]}</Text>{routine.recurrence_days?.length?<View style={{gap:6}}><Text style={s.muted}>Jours prévus</Text><DayStrip days={routine.recurrence_days}/></View>:<Text style={s.muted}>À la demande</Text>}<Button title={checkpoint?.routine?.id===routine.id?'Reprendre':'Lancer la routine'} primary icon="play-outline" disabled={busy} onPress={onStart}/></View>
  <Text style={s.heading}>LES EXERCICES</Text>
  <View style={s.panel}>{routine.exercises.map((e,i)=><View key={i} style={{...s.row,paddingVertical:9,borderBottomWidth:i===routine.exercises.length-1?0:1,borderBottomColor:c.border}}><View style={{width:32,height:32,borderRadius:9,backgroundColor:c.surfacePressed,alignItems:'center',justifyContent:'center'}}><Text style={s.label}>{i+1}</Text></View><View style={{flex:1,gap:3}}><Text style={s.label}>{e.name}</Text><Text style={s.muted}>{doseText(e,routine)}</Text></View><Ionicons name={e.exercise_id?'fitness-outline':'create-outline'} size={19} color={c.textMuted}/></View>)}</View>
  <View style={s.row}><View style={{flex:1}}><Button title="Modifier" icon="create-outline" onPress={onEdit} disabled={busy}/></View><View style={{flex:1}}><Button title="Dupliquer" icon="copy-outline" onPress={onCopy} disabled={busy}/></View><IconButton icon="trash-outline" label="Supprimer la routine" danger onPress={onArchive} disabled={busy}/></View>
 </View>;
}

function ProgressiveSection({index,title,summary,active,completed,onOpen,onLayout,children}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 const entrance=useRef(new Animated.Value(0)).current;
 useEffect(()=>{const animation=Animated.timing(entrance,{toValue:1,duration:180,useNativeDriver:true});animation.start();return()=>animation.stop();},[entrance]);
 return <Animated.View onLayout={onLayout} style={{opacity:entrance,transform:[{translateY:entrance.interpolate({inputRange:[0,1],outputRange:[5,0]})}],gap:12}}>
  <Pressable accessibilityRole="button" accessibilityState={{expanded:active}} accessibilityLabel={title+(active?'':', modifier')} onPress={onOpen} style={{...s.panel,flexDirection:'row',alignItems:'center',padding:13,gap:12,borderColor:active?c.accent:c.border}}>
   <View style={{width:36,height:36,borderRadius:11,backgroundColor:completed&&!active?c.accent:c.accentSoft,alignItems:'center',justifyContent:'center'}}>{completed&&!active?<Ionicons name="checkmark" size={20} color={c.textOnAccent}/>:<Text style={s.label}>{String(index+1).padStart(2,'0')}</Text>}</View>
   <View style={{flex:1,minWidth:0,gap:3}}><Text style={{...s.heading,fontSize:23,lineHeight:26}}>{title}</Text>{!active&&summary?<Text style={s.muted}>{summary}</Text>:null}</View>
   <Ionicons name={active?'chevron-down':'create-outline'} size={20} color={c.textMuted}/>
  </Pressable>
  {active?<View style={{gap:12}}>{children}</View>:null}
 </Animated.View>;
}
export function RoutineEditor({draft,busy,patch,changeExercise,move,addPersonal,openCatalogue,closeCatalogue,save,catalogue,onReveal,editing=false,editorBackRef}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 const [nav,setNav]=useState(()=>initialRoutineEditorState(editing));
 const [expanded,setExpanded]=useState(null),[issue,setIssue]=useState('');
 const [detail,setDetail]=useState(null),[detailLoading,setDetailLoading]=useState(null);
 const detailRequest=useRef(0);
 const {isDark}=useUgerodTheme();
 const layouts=useRef({}),pending=useRef(null),activeRef=useRef(nav.active);
 const interval=isIntervalRoutine(draft.mechanic),count=draft.exercises.length,p=draft.parameters??{};
 const previousCount=useRef(count);
 useEffect(()=>{if(count>previousCount.current){setExpanded(count-1);setIssue('');}previousCount.current=count;},[count]);
 const shownMechanic=draft.mechanic||'SETS_REPS',fixed=isBlockTabata(draft),allowedTabatas=availableTabataBlocks(draft.planned_minutes);
 const duration=fixed?Number(p.blocks)*240:interval?Number(p.rounds)*count*(draft.mechanic==='TABATA'?30:Number(p.work_seconds)+Number(p.rest_seconds)):0;
 activeRef.current=nav.active;
 function scrollTo(index){if(pending.current!==index||activeRef.current!==index||layouts.current[index]==null)return;pending.current=null;onReveal?.(layouts.current[index]);}
 useEffect(()=>{if(pending.current!==nav.active)return;const frame=requestAnimationFrame(()=>scrollTo(nav.active));return()=>cancelAnimationFrame(frame);},[nav.active,nav.revealed]);
 function layout(index,event){layouts.current[index]=event.nativeEvent.layout.y;if(pending.current===index&&activeRef.current===index)scrollTo(index);}
 function open(index){if(busy||index===nav.active)return;detailRequest.current+=1;setDetailLoading(null);setDetail(null);Keyboard.dismiss();setIssue('');setExpanded(null);closeCatalogue();pending.current=index;setNav(old=>openRoutineEditorSection(old,index));}
 function proceed(candidate=draft){if(busy)return;const message=routineEditorIssue(candidate,nav.active);if(message){setIssue(message);return;}Keyboard.dismiss();setIssue('');setExpanded(null);closeCatalogue();pending.current=Math.min(4,nav.active+1);setNav(advanceRoutineEditor);}
 function selectCategory(category){if(busy)return;patch({category,...(!draft.planned_minutes?{planned_minutes:'15'}:{})});proceed({...draft,category});}
 function selectMechanic(mechanic){if(busy)return;patch({mechanic});setIssue('');}
 function confirmMechanic(){const next={...draft,mechanic:shownMechanic};if(shownMechanic==='TABATA'&&!allowedTabatas.includes(Number(p.blocks))){setIssue('Choisis un nombre de Tabata disponible.');return;}patch({mechanic:shownMechanic});proceed(next);}
 useEffect(()=>{if(!editorBackRef)return;editorBackRef.current=()=>{if(nav.active===0)return false;open(nav.active-1);return true;};return()=>{editorBackRef.current=null;};},[nav.active,nav.revealed,busy]);
 useEffect(()=>()=>{detailRequest.current+=1;},[]);
 async function openDetail(e){if(!e.exercise_id)return;const request=++detailRequest.current;setDetailLoading(e.exercise_id);setIssue('');try{const exercise=(catalogue??[]).find(x=>x.id===e.exercise_id)??await getExerciseById(e.exercise_id);if(request!==detailRequest.current)return;if(!exercise)throw new Error('Fiche exercice indisponible.');setDetail(exercise);}catch(error){if(request===detailRequest.current)setIssue(error.message||'Fiche exercice indisponible.');}finally{if(request===detailRequest.current)setDetailLoading(null);}}
 function addFree(){setExpanded(count);setIssue('');addPersonal();}
 function remove(i){patch({exercises:draft.exercises.filter((_,j)=>i!==j)});setExpanded(null);setIssue('');}
 function reorder(i,delta){move(i,delta);setExpanded(i+delta);}
 function complete(){const message=routineEditorIssue(draft,4);if(message){setIssue(message);return;}Keyboard.dismiss();setIssue('');save();}
 const titles=['QUEL TYPE DE ROUTINE ?','COMBIEN DE TEMPS ?','CHOISIS TON FORMAT','COMPOSE TA ROUTINE','FINALISE TA ROUTINE'];
 const summaries=[ROUTINE_CATEGORIES[draft.category]??'À choisir',draft.planned_minutes?draft.planned_minutes+' min':'À définir',fixed?'Tabata '+p.blocks:ROUTINE_MECHANICS[draft.mechanic]??'À choisir',count+' exercice'+(count===1?'':'s'),draft.name||'À nommer'];
 const finalIssue=nav.active===4?routineEditorIssue(draft,4):'';
 const sections=[
 <View key="category" style={{gap:12}}><PhotoChoiceGrid items={routineCategories} photos={ROUTINE_PHOTOS} value={draft.category} onChange={selectCategory} colors={c} disabled={busy} reselect/></View>,
 <View key="duration" style={{gap:12}}><DurationControl value={Number(draft.planned_minutes)||15} durations={ROUTINE_DURATION_VALUES} onChange={value=>{patch({planned_minutes:String(value)});setIssue('');}} colors={c} showTitle={false} accessibilityLabel="Durée de la routine" colorForValue={(_,colors)=>colors.text}/><Text style={s.muted}>30 minutes maximum.</Text><Button title="Continuer" icon="arrow-down-outline" primary disabled={busy} onPress={()=>proceed()}/></View>,
 <View key="format" style={{gap:12}}>
 <MechanicCarousel value={shownMechanic} onChange={selectMechanic} colors={c} disabled={busy}/>
 {shownMechanic==='TABATA'?<View style={s.panel}><Text style={s.label}>{draft.planned_minutes} minutes disponibles</Text>{allowedTabatas.length?<View style={s.row}>{allowedTabatas.map(blocks=><Pressable key={blocks} accessibilityRole="radio" accessibilityState={{selected:Number(p.blocks)===blocks}} onPress={()=>{patch({mechanic:'TABATA',parameters:{...p,blocks}});setIssue('');}} style={{flex:1,borderRadius:12,borderWidth:1,borderColor:Number(p.blocks)===blocks?c.accent:c.border,backgroundColor:Number(p.blocks)===blocks?c.accentSoft:c.surfacePressed,padding:10,alignItems:'center',gap:6}}><Text style={s.eyebrow}>TABATA {blocks}</Text><Text style={s.heading}>{blocks*4} min</Text><Text style={s.muted}>{blocks*8} cycles</Text></Pressable>)}</View>:<Text style={s.muted}>Un Tabata nécessite au moins 4 minutes. Modifie la durée pour le choisir.</Text>}{allowedTabatas.includes(Number(p.blocks))?<Text style={s.muted}>{Number(draft.planned_minutes)-Number(p.blocks)*4} min disponibles pour la préparation ou la récupération, sans ajout automatique.</Text>:null}</View>:shownMechanic!=='SETS_REPS'?<View style={s.panel}><View style={s.row}>{(shownMechanic==='HIIT'?[['rounds','Tours',''],['work_seconds','Effort','s'],['rest_seconds','Repos','s']]:[['rounds','Tours',''],['rest_seconds','Repos entre tours','s']]).map(([key,title,unit])=><NumberField key={key} title={title} unit={unit} value={p[key]} onChange={v=>patch({parameters:{...p,[key]:v}})}/>)}</View></View>:<Text style={s.muted}>Séries, répétitions et temps de maintien à définir pour chaque exercice.</Text>}
 <Button title="Choisir ce format" icon="arrow-down-outline" primary disabled={busy||(shownMechanic==='TABATA'&&!allowedTabatas.includes(Number(p.blocks)))} onPress={confirmMechanic}/>
 </View>,
 <View key="exercises" style={{gap:12}}><Text style={s.muted}>{count} mouvement{count===1?'':'s'} · {fixed?'Tabata '+p.blocks:ROUTINE_MECHANICS[draft.mechanic]}</Text>{fixed?<Text style={s.muted}>Choisis le bloc de chaque mouvement. Les 8 cycles de chaque bloc alternent les mouvements dans l’ordre affiché.</Text>:null}
   {draft.exercises.map((e,i)=>{
    const image=(catalogue??[]).find(x=>x.id===e.exercise_id)?.imagePath;
    return <View key={i} style={s.panel}><Pressable accessibilityRole="button" accessibilityState={{expanded:expanded===i}} onPress={()=>setExpanded(expanded===i?null:i)} style={s.row}>{e.exercise_id?<ExerciseArtwork imagePath={image} colors={c} size={46}/>:<View style={{width:46,height:46,borderRadius:12,backgroundColor:c.surfacePressed,alignItems:'center',justifyContent:'center'}}><Ionicons name="create-outline" size={23} color={c.textSecondary}/></View>}<View style={{flex:1,gap:3}}><Text style={s.label}>{e.name||'Nouvel exercice personnel'}</Text><Text style={s.muted}>{i+1}. {doseText(e,draft)} · {e.exercise_id?'Catalogue':'Personnel'}</Text></View><Ionicons name={expanded===i?'chevron-up':'chevron-down'} size={20} color={c.textSecondary}/></Pressable>{e.exercise_id?<Pressable accessibilityRole="button" accessibilityLabel={'Fiche de '+e.name} disabled={detailLoading===e.exercise_id} onPress={()=>openDetail(e)} style={{...s.row,minHeight:44}}>{detailLoading===e.exercise_id?<ActivityIndicator color={c.accent}/>:<Ionicons name="information-circle-outline" size={20} color={c.accent}/>}<Text style={s.muted}>Voir la fiche exercice</Text></Pressable>:null}
     {expanded===i?<View style={{gap:12}}>{!e.exercise_id?<TextInput accessibilityLabel="Nom de l’exercice" value={e.name} onChangeText={name=>changeExercise(i,{name})} placeholder="Nom de l’exercice" placeholderTextColor={c.textMuted} style={s.field} maxLength={200}/>:null}
      {!interval?<><View style={s.row}><Choice title="Répétitions" selected={e.doseMode!=='TIME'} onPress={()=>changeExercise(i,{doseMode:'REPS'})}/><Choice title="Maintien" selected={e.doseMode==='TIME'} onPress={()=>changeExercise(i,{doseMode:'TIME'})}/></View><View style={s.row}>{draft.mechanic==='SETS_REPS'?<NumberField title="Séries" value={e.sets} onChange={sets=>changeExercise(i,{sets})}/>:null}{e.doseMode==='TIME'?<NumberField title="Maintien" unit="s" value={e.duration_seconds} onChange={duration_seconds=>changeExercise(i,{duration_seconds})}/>:<NumberField title="Répétitions" value={e.reps} onChange={reps=>changeExercise(i,{reps})}/>}</View></>:<Text style={s.muted}>Les temps et tours sont définis par le format.</Text>}{fixed?<View style={{gap:6}}><Text style={s.label}>Bloc Tabata</Text><View style={s.row}>{Array.from({length:Number(p.blocks)},(_,j)=>j+1).map(block=><Choice key={block} title={'Tabata '+block} selected={Number(e.tabata_block??1)===block} onPress={()=>changeExercise(i,{tabata_block:block})}/>)}</View></View>:null}
      <View style={s.row}><Text style={{...s.muted,flex:1}}>Position</Text><IconButton icon="arrow-up" label="Monter" disabled={busy||i===0} onPress={()=>reorder(i,-1)}/><IconButton icon="arrow-down" label="Descendre" disabled={busy||i===count-1} onPress={()=>reorder(i,1)}/><IconButton icon="trash-outline" label="Retirer l’exercice" danger disabled={busy} onPress={()=>remove(i)}/></View>
     </View>:null}
    </View>;
   })}
   <View style={s.row}><View style={{flex:1}}><Button title="Catalogue" icon="search-outline" onPress={openCatalogue} disabled={busy}/></View><View style={{flex:1}}><Button title="Texte libre" icon="add-outline" onPress={addFree} disabled={busy}/></View></View>
 {fixed?<View style={s.panel}>{Array.from({length:Number(p.blocks)},(_,i)=>i+1).map(block=>{const indices=tabataCycleExerciseIndices(draft,block);return <View key={block} style={{gap:5}}><Text style={s.label}>TABATA {block} · 4 min</Text>{indices.length?<View style={{flexDirection:'row',gap:3,flexWrap:'wrap'}}>{indices.map((id,j)=><View key={j} style={{backgroundColor:c.accentSoft,borderRadius:6,padding:6}}><Text style={s.muted}>{j+1}. {draft.exercises[id]?.name||'À nommer'}</Text></View>)}</View>:<Text style={{...s.muted,color:c.error}}>Ajoute au moins un mouvement à ce bloc.</Text>}</View>;})}</View>:null}
 {interval&&Number.isFinite(duration)&&duration>0?<Text style={{...s.label,color:duration>(fixed?Number(draft.planned_minutes)*60:routineTimeLimit(draft.planned_minutes))?c.error:c.text}}>Durée calculée : {Math.floor(duration/60)} min {duration%60} s</Text>:null}
 <Button title="Continuer" icon="arrow-down-outline" primary disabled={busy||count===0} onPress={()=>proceed()}/><Button title="Retour au format" icon="arrow-back-outline" disabled={busy} onPress={()=>open(2)}/>
 </View>,
 <View key="final" style={{gap:14}}>
 <View style={s.panel}><Text style={s.label}>Nom de la routine</Text><TextInput accessibilityLabel="Nom de la routine" value={draft.name} onChangeText={name=>{patch({name});setIssue('');}} placeholder="Ex. Mobilité du matin" maxLength={120} placeholderTextColor={c.textMuted} style={s.field}/><Text style={s.label}>Quand souhaites-tu la réaliser ?</Text><DayStrip days={draft.recurrence_days} onChange={day=>patch({recurrence_days:draft.recurrence_days.includes(day)?draft.recurrence_days.filter(d=>d!==day):[...draft.recurrence_days,day]})}/><Text style={s.muted}>{draft.recurrence_days.length===0?'À la demande':draft.recurrence_days.length===7?'Tous les jours':'Les jours sélectionnés apparaissent dans ton programme du jour.'}</Text></View>
 <View style={{...s.panel,backgroundColor:c.accentSoft}}><Text style={s.eyebrow}>TA ROUTINE</Text><Text style={s.heading}>{draft.name.trim()||'Ma routine'}</Text><View style={{...s.row,justifyContent:'space-between'}}><Text style={s.label}>{draft.planned_minutes||'—'} min</Text><Text style={s.label}>{count} exercice{count===1?'':'s'}</Text></View><Text style={s.muted}>{summaries[0]} · {summaries[2]}</Text>{draft.exercises.map((e,i)=><View key={i} style={{...s.row,borderTopWidth:1,borderTopColor:c.border,paddingTop:9}}><Text style={{...s.label,flex:1}}>{e.name||'Exercice à nommer'}</Text><Text style={s.muted}>{doseText(e,draft)}</Text></View>)}</View>
 {finalIssue&&draft.name.trim()&&finalIssue!==issue?<Text accessibilityRole="alert" style={{...s.muted,color:c.error}}>{finalIssue}</Text>:null}
 <Button title={editing?'Enregistrer la routine':'Créer ma routine'} icon="checkmark-outline" primary onPress={complete} disabled={busy||!draft.name.trim()}/>
 </View>];
 return <View style={{gap:16}}>
  <View style={{...s.row,justifyContent:'space-between'}}><Text style={s.eyebrow}>{editing?'MODIFIER TA ROUTINE':'CRÉATION LIBRE'}</Text><Text style={s.muted}>{nav.active+1} / 5</Text></View>
  <View style={{flexDirection:'row',gap:5}}>{ROUTINE_EDITOR_SECTIONS.map((key,i)=><View key={key} style={{flex:1,height:4,borderRadius:3,backgroundColor:i===nav.active?c.secondaryAccent:i<=nav.revealed?c.accent:c.border}}/>)}</View>
  {ROUTINE_EDITOR_SECTIONS.slice(0,nav.revealed+1).map((key,i)=><ProgressiveSection key={key} index={i} title={titles[i]} summary={summaries[i]} active={nav.active===i} completed={i<nav.revealed&&!routineEditorIssue(draft,Math.min(i,3))} onOpen={()=>open(i)} onLayout={event=>layout(i,event)}>{sections[i]}{nav.active===i&&issue?<Text accessibilityRole="alert" style={{...s.label,color:c.error}}>{issue}</Text>:null}</ProgressiveSection>)}
 {detail?<ExerciseDetail key={detail.id} exercise={detail} colors={c} isDark={isDark} onClose={()=>setDetail(null)} closeLabel="Retour à ma routine"/>:null}
 </View>;
}
export function RoutinePlayer({routine,step,running,busy,onToggle,onNext,onFinish,onAside,onAbandon}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 if(step.phase==='done')return <View style={{...s.panel,alignItems:'stretch',gap:20,paddingVertical:28}}><View style={{alignItems:'center',gap:10}}><Ionicons name="checkmark-circle-outline" size={70} color={c.accent}/><Text style={{...s.heading,fontSize:40,lineHeight:44}}>ROUTINE TERMINÉE</Text><Text style={{...s.muted,textAlign:'center'}}>Seule ta réalisation du jour sera enregistrée.</Text></View><Button title="Valider ma routine" icon="checkmark-outline" primary onPress={onFinish} disabled={busy}/><Button title="Mettre de côté" onPress={onAside} disabled={busy}/><Button title="Abandonner" onPress={onAbandon} disabled={busy}/></View>;
 const current=routine.exercises[step.index],interval=isIntervalRoutine(routine.mechanic),rest=step.phase==='rest';
 const total=rest?routine.parameters?.rest_seconds:interval?routine.parameters?.work_seconds:current.duration_seconds;
 const fraction=total>0&&step.remaining!=null?Math.max(0,Math.min(1,step.remaining/total)):0;
 const nextStep=advanceRoutinePhase(routine,step);
 const nextTitle=nextStep.phase==='done'?'Fin de la routine':nextStep.phase==='rest'?'Récupération · '+nextStep.remaining+' s':routine.exercises[nextStep.index]?.name;
 const afterRest=nextStep.phase==='rest'?advanceRoutinePhase(routine,nextStep):null;
 const phaseLabel=rest?'RÉCUPÉRATION':interval?'EFFORT':step.remaining!=null?'MAINTIEN':'RÉPÉTITIONS';
 const ringColor=rest?c.accent:c.secondaryAccent;
 const fixed=isBlockTabata(routine);
 const progressLabel=fixed?'TABATA '+(Math.floor((step.round-1)/8)+1)+' / '+routine.parameters.blocks:routine.mechanic==='SETS_REPS'?'SÉRIE '+step.setNumber+' / '+current.sets:'TOUR '+step.round+' / '+routine.parameters.rounds;
 return <View style={{gap:17}}>
  <Text style={s.eyebrow}>{routine.name.toUpperCase()}</Text>
  <View style={{...s.row,justifyContent:'space-between'}}><Text style={s.label}>{progressLabel}</Text><Text style={s.muted}>{fixed?'CYCLE '+((step.round-1)%8+1)+' / 8':'EXERCICE '+(step.index+1)+' / '+routine.exercises.length}</Text></View>
  <View style={{flexDirection:'row',gap:4}}>{fixed?Array.from({length:8},(_,i)=><View key={i} style={{flex:1,height:5,borderRadius:3,backgroundColor:i<(step.round-1)%8?c.accent:i===(step.round-1)%8?c.secondaryAccent:c.border}}/>):routine.exercises.length<=16?routine.exercises.map((_,i)=><View key={i} style={{flex:1,height:5,borderRadius:3,backgroundColor:i<step.index?c.accent:i===step.index?c.secondaryAccent:c.border}}/>):<View style={{flex:1,height:5,borderRadius:3,backgroundColor:c.border,overflow:'hidden'}}><View style={{width:((step.index+1)/routine.exercises.length*100)+'%',height:5,backgroundColor:c.secondaryAccent}}/></View>}</View>
  <View style={{...s.panel,gap:18,paddingVertical:24,alignItems:'stretch'}}>
   <View style={{alignItems:'center',gap:8}}><CategoryMark category={routine.category} size={62}/><Text style={s.eyebrow}>{phaseLabel}</Text><Text style={{...s.heading,fontSize:36,lineHeight:39,textAlign:'center'}}>{rest?'RÉCUPÉRATION':current.name.toUpperCase()}</Text></View>
   {step.remaining!=null?<><View style={{width:220,height:220,alignSelf:'center',alignItems:'center',justifyContent:'center'}}><Svg width={220} height={220} viewBox="0 0 220 220" style={{position:'absolute'}}><Circle cx={110} cy={110} r={96} fill="none" stroke={c.borderStrong} strokeWidth={8}/><Circle cx={110} cy={110} r={96} fill="none" stroke={ringColor} strokeWidth={8} strokeLinecap="round" strokeDasharray={2*Math.PI*96} strokeDashoffset={2*Math.PI*96*(1-fraction)} rotation="-90" origin="110,110"/></Svg><Text style={{...s.eyebrow,color:c.textSecondary}}>{running?phaseLabel:'EN PAUSE'}</Text><Text style={{color:c.text,fontFamily:fontFamilies.display,fontSize:72,lineHeight:78,fontVariant:['tabular-nums']}}>{clock(step.remaining)}</Text><Text style={s.muted}>SUR {total} S</Text></View><Button title={running?'Pause':'Démarrer le chrono'} icon={running?'pause':'play'} primary onPress={onToggle} disabled={busy}/></>:<><View style={{alignItems:'center',paddingVertical:20}}><Text style={{color:c.text,fontFamily:fontFamilies.display,fontSize:96,lineHeight:100}}>{current.reps}</Text><Text style={s.eyebrow}>RÉPÉTITIONS</Text></View><Button title={routine.mechanic==='SETS_REPS'?'Valider la série':'Valider l’exercice'} primary icon="checkmark-outline" onPress={onNext} disabled={busy}/></>}
  </View>
  <View style={{...s.panel,flexDirection:'row',alignItems:'center'}}><Ionicons name="arrow-forward-outline" size={24} color={c.accent}/><View style={{flex:1,gap:3}}><Text style={s.eyebrow}>À SUIVRE</Text><Text style={s.label}>{nextTitle}</Text>{afterRest&&afterRest.phase!=='done'?<Text style={s.muted}>Puis {routine.exercises[afterRest.index]?.name}</Text>:null}</View></View>
  <View style={s.row}><View style={{flex:1}}><Button title="Mettre de côté" onPress={onAside} disabled={busy}/></View><View style={{flex:1}}><Button title="Abandonner" onPress={onAbandon} disabled={busy}/></View></View>
 </View>;
}
