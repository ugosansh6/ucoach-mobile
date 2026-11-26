import {Ionicons} from '@expo/vector-icons';
import {useState} from 'react';
import {ActivityIndicator,Pressable,Text,TextInput,View} from 'react-native';
import Svg,{Circle} from 'react-native-svg';
import {useUgerodTheme} from '../../contexts/UgerodThemeContext';
import {fontFamilies} from '../../constants/typography';
import ExerciseArtwork from '../exercises/ExerciseArtwork';
import {ROUTINE_CATEGORIES,ROUTINE_DAYS,ROUTINE_MECHANICS,isIntervalRoutine,advanceRoutinePhase} from '../../services/routineContract';

const categoryIcons={MOBILITY:'body-outline',CORE:'shield-checkmark-outline',PHYSIO:'heart-outline',CONDITIONING:'flame-outline'};
const mechanics=[['SETS_REPS','Séries & maintien','list-outline'],['CIRCUIT','Circuit','repeat-outline'],['HIIT','Intervalles','timer-outline'],['TABATA','Tabata 20/10','flash-outline']];
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
 if(isIntervalRoutine(routine.mechanic))return (routine.mechanic==='TABATA'?20:routine.parameters?.work_seconds||'—')+' s effort';
 const dose=e.doseMode==='TIME'||(e.doseMode==null&&e.duration_seconds!=null)?(e.duration_seconds||'—')+' s':(e.reps||'—')+' reps';
 return routine.mechanic==='CIRCUIT'?dose:(e.sets||'—')+' × '+dose;
}
function Section({number,title,subtitle,children}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 return <View style={{gap:12}}><View style={s.row}><View style={{height:32,width:32,borderRadius:10,backgroundColor:c.accentSoft,alignItems:'center',justifyContent:'center'}}><Text style={s.label}>{number}</Text></View><View style={{flex:1}}><Text style={{...s.heading,fontSize:25,lineHeight:28}}>{title}</Text>{subtitle?<Text style={s.muted}>{subtitle}</Text>:null}</View></View>{children}</View>;
}
function NumberField({title,value,onChange,unit}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 return <View style={{flex:1,minWidth:70,gap:6}}><Text style={s.muted}>{title}</Text><View style={{...s.field,flexDirection:'row',alignItems:'center',gap:4}}><TextInput accessibilityLabel={title} value={String(value??'')} onChangeText={onChange} keyboardType="number-pad" placeholder="—" placeholderTextColor={c.textMuted} style={{...s.text,fontFamily:fontFamilies.bold,flex:1,fontSize:19,minWidth:0,paddingVertical:0}}/>{unit?<Text style={s.muted}>{unit}</Text>:null}</View></View>;
}
function Choice({title,icon,selected,onPress}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 return <Pressable accessibilityRole="radio" accessibilityState={{selected}} onPress={onPress} style={({pressed})=>({flex:1,minWidth:0,minHeight:58,borderWidth:1,borderColor:selected?c.accent:c.border,borderRadius:12,backgroundColor:selected?c.accentSoft:c.surface,flexDirection:'row',alignItems:'center',gap:8,padding:10,opacity:pressed?0.75:1})}>{icon?<Ionicons name={icon} size={22} color={selected?c.text:c.textMuted}/>:null}<Text style={{...s.label,flex:1,fontSize:13}}>{title}</Text>{selected?<Ionicons name="checkmark-circle" size={17} color={c.secondaryAccent}/>:null}</Pressable>;
}
export function RoutineList({rows,loading,checkpoint,busy,onOpen,onStart,onCreate}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 if(loading)return <ActivityIndicator color={c.accent}/>;
 return <View style={{gap:14}}>
  <View style={{...s.panel,backgroundColor:c.accentSoft,borderColor:c.borderStrong,gap:9}}>
   <View style={s.row}><View style={{flex:1,gap:4}}><Text style={s.eyebrow}>TES HABITUDES</Text><Text style={{...s.heading,fontSize:36,lineHeight:39}}>UN PEU, SOUVENT.</Text><Text style={s.muted}>Tes routines, à ton rythme, en complément de tes séances.</Text></View><CategoryMark size={65}/></View>
   <Button title="Créer une routine" icon="add-outline" primary disabled={busy} onPress={onCreate}/>
  </View>
  <View style={{...s.row,justifyContent:'space-between'}}><Text style={s.heading}>À TA DISPOSITION</Text><Text style={s.muted}>{rows.length} routine{rows.length===1?'':'s'}</Text></View>
  {rows.length===0?<View style={{...s.panel,alignItems:'center',paddingVertical:28}}><CategoryMark size={60}/><Text style={s.label}>Aucune routine pour l’instant</Text><Text style={{...s.muted,textAlign:'center'}}>Mobilité, gainage, kiné ou conditioning : crée celle qui te convient.</Text></View>:rows.map(row=>{
   const resume=checkpoint?.routine?.id===row.id;
   return <View key={row.id} style={s.panel}>
    <Pressable accessibilityRole="button" accessibilityLabel={'Voir '+row.name} onPress={()=>onOpen(row)} style={s.row}><CategoryMark category={row.category}/><View style={{flex:1,minWidth:0,gap:3}}><Text style={s.eyebrow}>{ROUTINE_CATEGORIES[row.category]?.toUpperCase()}</Text><Text style={{...s.label,fontSize:17,lineHeight:23}}>{row.name}</Text><Text style={s.muted}>{row.planned_minutes} min · {row.exercises.length} exercices</Text></View><Ionicons name="chevron-forward" size={19} color={c.textMuted}/></Pressable>
    {row.recurrence_days?.length?<View style={{gap:6}}><Text style={s.muted}>Jours prévus</Text><DayStrip days={row.recurrence_days}/></View>:<Text style={s.muted}>À la demande</Text>}
    <View style={s.row}><View style={{flex:1}}><Button title={resume?'Reprendre':'Lancer'} icon="play-outline" primary disabled={busy} onPress={()=>onStart(row)}/></View><IconButton icon="options-outline" label={'Gérer '+row.name} onPress={()=>onOpen(row)} disabled={busy}/></View>
   </View>;
  })}
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

export function RoutineEditor({draft,busy,patch,changeExercise,move,addPersonal,openCatalogue,closeCatalogue,showCatalogue,catalogueLoading,filtered,search,setSearch,addCatalogue,save,catalogue}){
 const {colors:c}=useUgerodTheme(),s=theme(c);
 const [expanded,setExpanded]=useState(null);
 const interval=isIntervalRoutine(draft.mechanic);
 const count=draft.exercises.length;
 const p=draft.parameters??{};
 const duration=interval?Number(p.rounds)*count*(draft.mechanic==='TABATA'?30:Number(p.work_seconds)+Number(p.rest_seconds)):0;
 function addFree(){setExpanded(count);addPersonal();}
 function addExisting(e){setExpanded(count);addCatalogue(e);}
 function remove(i){patch({exercises:draft.exercises.filter((_,j)=>i!==j)});setExpanded(null);}
 function reorder(i,delta){move(i,delta);setExpanded(i+delta);}
 return <View style={{gap:22}}>
  <View style={{...s.panel,backgroundColor:c.accentSoft}}><Text style={s.eyebrow}>PERSONNALISE TA ROUTINE</Text><Text style={s.heading}>À TON RYTHME.</Text><Text style={s.muted}>Aucune prescription automatique. Tu choisis les mouvements et leur dosage.</Text></View>
  <Section number="1" title="L’ESSENTIEL">
   <View style={s.panel}><Text style={s.label}>Nom de la routine</Text><TextInput accessibilityLabel="Nom de la routine" value={draft.name} onChangeText={name=>patch({name})} placeholder="Ex. Mobilité du matin" maxLength={120} placeholderTextColor={c.textMuted} style={s.field}/><Text style={s.label}>Catégorie</Text>{[['MOBILITY','CORE'],['PHYSIO','CONDITIONING']].map((pair,i)=><View key={i} style={s.row}>{pair.map(key=><Choice key={key} title={ROUTINE_CATEGORIES[key]} icon={categoryIcons[key]} selected={draft.category===key} onPress={()=>patch({category:key})}/>)}</View>)}<NumberField title="Durée prévue" unit="min" value={draft.planned_minutes} onChange={planned_minutes=>patch({planned_minutes})}/><Text style={s.muted}>30 minutes maximum.</Text></View>
  </Section>
  <Section number="2" title="LE FORMAT">
   {[mechanics.slice(0,2),mechanics.slice(2)].map((pair,i)=><View key={i} style={s.row}>{pair.map(([key,title,icon])=><Choice key={key} title={title} icon={icon} selected={draft.mechanic===key} onPress={()=>patch({mechanic:key})}/>)}</View>)}
   {draft.mechanic!=='SETS_REPS'?<View style={s.panel}><View style={s.row}>{(draft.mechanic==='TABATA'?[['rounds','Tours','']]:draft.mechanic==='HIIT'?[['rounds','Tours',''],['work_seconds','Effort','s'],['rest_seconds','Repos','s']]:[['rounds','Tours',''],['rest_seconds','Repos entre tours','s']]).map(([key,title,unit])=><NumberField key={key} title={title} unit={unit} value={p[key]} onChange={v=>patch({parameters:{...p,[key]:v}})}/>)}</View>{draft.mechanic==='TABATA'?<Text style={s.muted}>20 s effort · 10 s repos par exercice et par tour.</Text>:null}{interval&&Number.isFinite(duration)&&duration>0?<Text style={{...s.label,color:duration>1800?c.error:c.text}}>Durée calculée : {Math.floor(duration/60)} min {duration%60} s</Text>:null}</View>:null}
   <Text style={s.muted}>{interval?'Les intervalles s’appliquent à chaque exercice, repos final inclus.':'Les temps de maintien et de récupération doivent tenir dans la durée prévue.'}</Text>
  </Section>
  <Section number="3" title="MES EXERCICES" subtitle={count+' mouvement'+(count===1?'':'s')}>
   {draft.exercises.map((e,i)=>{
    const image=(catalogue??[]).find(x=>x.id===e.exercise_id)?.imagePath;
    return <View key={i} style={s.panel}><Pressable accessibilityRole="button" accessibilityState={{expanded:expanded===i}} onPress={()=>setExpanded(expanded===i?null:i)} style={s.row}>{e.exercise_id?<ExerciseArtwork imagePath={image} colors={c} size={46}/>:<View style={{width:46,height:46,borderRadius:12,backgroundColor:c.surfacePressed,alignItems:'center',justifyContent:'center'}}><Ionicons name="create-outline" size={23} color={c.textSecondary}/></View>}<View style={{flex:1,gap:3}}><Text style={s.label}>{e.name||'Nouvel exercice personnel'}</Text><Text style={s.muted}>{i+1}. {doseText(e,draft)} · {e.exercise_id?'Catalogue':'Personnel'}</Text></View><Ionicons name={expanded===i?'chevron-up':'chevron-down'} size={20} color={c.textSecondary}/></Pressable>
     {expanded===i?<View style={{gap:12}}>{!e.exercise_id?<TextInput accessibilityLabel="Nom de l’exercice" value={e.name} onChangeText={name=>changeExercise(i,{name})} placeholder="Nom de l’exercice" placeholderTextColor={c.textMuted} style={s.field} maxLength={200}/>:null}
      {!interval?<><View style={s.row}><Choice title="Répétitions" selected={e.doseMode!=='TIME'} onPress={()=>changeExercise(i,{doseMode:'REPS'})}/><Choice title="Maintien" selected={e.doseMode==='TIME'} onPress={()=>changeExercise(i,{doseMode:'TIME'})}/></View><View style={s.row}>{draft.mechanic==='SETS_REPS'?<NumberField title="Séries" value={e.sets} onChange={sets=>changeExercise(i,{sets})}/>:null}{e.doseMode==='TIME'?<NumberField title="Maintien" unit="s" value={e.duration_seconds} onChange={duration_seconds=>changeExercise(i,{duration_seconds})}/>:<NumberField title="Répétitions" value={e.reps} onChange={reps=>changeExercise(i,{reps})}/>}</View></>:<Text style={s.muted}>Les temps et tours sont définis par le format.</Text>}
      <View style={s.row}><Text style={{...s.muted,flex:1}}>Position</Text><IconButton icon="arrow-up" label="Monter" disabled={busy||i===0} onPress={()=>reorder(i,-1)}/><IconButton icon="arrow-down" label="Descendre" disabled={busy||i===count-1} onPress={()=>reorder(i,1)}/><IconButton icon="trash-outline" label="Retirer l’exercice" danger disabled={busy} onPress={()=>remove(i)}/></View>
     </View>:null}
    </View>;
   })}
   <View style={s.row}><View style={{flex:1}}><Button title="Catalogue" icon="search-outline" onPress={openCatalogue} disabled={busy}/></View><View style={{flex:1}}><Button title="Texte libre" icon="add-outline" onPress={addFree} disabled={busy}/></View></View>
   {showCatalogue?<View style={s.panel}><Text style={s.heading}>CHOISIR UN MOUVEMENT</Text><TextInput accessibilityLabel="Rechercher un mouvement" value={search} onChangeText={setSearch} placeholder="Rechercher un mouvement" placeholderTextColor={c.textMuted} style={s.field}/>{catalogueLoading?<ActivityIndicator color={c.accent}/>:filtered.map(e=><Pressable key={e.id} accessibilityRole="button" onPress={()=>addExisting(e)} style={{...s.row,paddingVertical:7,borderBottomWidth:1,borderBottomColor:c.border}}><ExerciseArtwork imagePath={e.imagePath} colors={c} size={44}/><Text style={{...s.label,flex:1}}>{e.name}</Text><Ionicons name="add-circle-outline" size={23} color={c.secondaryAccent}/></Pressable>)}<Text style={s.muted}>{filtered.length?'30 résultats maximum · affine ta recherche.':'Aucun mouvement affiché.'}</Text><Button title="Fermer" onPress={closeCatalogue}/></View>:null}
  </Section>
  <Section number="4" title="MA RÉCURRENCE" subtitle="Facultative">
   <View style={s.panel}><DayStrip days={draft.recurrence_days} onChange={day=>patch({recurrence_days:draft.recurrence_days.includes(day)?draft.recurrence_days.filter(d=>d!==day):[...draft.recurrence_days,day]})}/><Text style={s.muted}>{draft.recurrence_days.length===0?'À la demande':draft.recurrence_days.length===7?'Tous les jours':'Les jours sélectionnés apparaissent dans ton programme du jour.'}</Text></View>
  </Section>
  <Button title="Enregistrer ma routine" icon="checkmark-outline" primary onPress={save} disabled={busy}/>
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
 const progressLabel=routine.mechanic==='SETS_REPS'?'SÉRIE '+step.setNumber+' / '+current.sets:'TOUR '+step.round+' / '+routine.parameters.rounds;
 return <View style={{gap:17}}>
  <Text style={s.eyebrow}>{routine.name.toUpperCase()}</Text>
  <View style={{...s.row,justifyContent:'space-between'}}><Text style={s.label}>{progressLabel}</Text><Text style={s.muted}>EXERCICE {step.index+1} / {routine.exercises.length}</Text></View>
  <View style={{flexDirection:'row',gap:4}}>{routine.exercises.length<=16?routine.exercises.map((_,i)=><View key={i} style={{flex:1,height:5,borderRadius:3,backgroundColor:i<step.index?c.accent:i===step.index?c.secondaryAccent:c.border}}/>):<View style={{flex:1,height:5,borderRadius:3,backgroundColor:c.border,overflow:'hidden'}}><View style={{width:((step.index+1)/routine.exercises.length*100)+'%',height:5,backgroundColor:c.secondaryAccent}}/></View>}</View>
  <View style={{...s.panel,gap:18,paddingVertical:24,alignItems:'stretch'}}>
   <View style={{alignItems:'center',gap:8}}><CategoryMark category={routine.category} size={62}/><Text style={s.eyebrow}>{phaseLabel}</Text><Text style={{...s.heading,fontSize:36,lineHeight:39,textAlign:'center'}}>{rest?'RÉCUPÉRATION':current.name.toUpperCase()}</Text></View>
   {step.remaining!=null?<><View style={{width:220,height:220,alignSelf:'center',alignItems:'center',justifyContent:'center'}}><Svg width={220} height={220} viewBox="0 0 220 220" style={{position:'absolute'}}><Circle cx={110} cy={110} r={96} fill="none" stroke={c.borderStrong} strokeWidth={8}/><Circle cx={110} cy={110} r={96} fill="none" stroke={ringColor} strokeWidth={8} strokeLinecap="round" strokeDasharray={2*Math.PI*96} strokeDashoffset={2*Math.PI*96*(1-fraction)} rotation="-90" origin="110,110"/></Svg><Text style={{...s.eyebrow,color:c.textSecondary}}>{running?phaseLabel:'EN PAUSE'}</Text><Text style={{color:c.text,fontFamily:fontFamilies.display,fontSize:72,lineHeight:78,fontVariant:['tabular-nums']}}>{clock(step.remaining)}</Text><Text style={s.muted}>SUR {total} S</Text></View><Button title={running?'Pause':'Démarrer le chrono'} icon={running?'pause':'play'} primary onPress={onToggle} disabled={busy}/></>:<><View style={{alignItems:'center',paddingVertical:20}}><Text style={{color:c.text,fontFamily:fontFamilies.display,fontSize:96,lineHeight:100}}>{current.reps}</Text><Text style={s.eyebrow}>RÉPÉTITIONS</Text></View><Button title={routine.mechanic==='SETS_REPS'?'Valider la série':'Valider l’exercice'} primary icon="checkmark-outline" onPress={onNext} disabled={busy}/></>}
  </View>
  <View style={{...s.panel,flexDirection:'row',alignItems:'center'}}><Ionicons name="arrow-forward-outline" size={24} color={c.accent}/><View style={{flex:1,gap:3}}><Text style={s.eyebrow}>À SUIVRE</Text><Text style={s.label}>{nextTitle}</Text>{afterRest&&afterRest.phase!=='done'?<Text style={s.muted}>Puis {routine.exercises[afterRest.index]?.name}</Text>:null}</View></View>
  <View style={s.row}><View style={{flex:1}}><Button title="Mettre de côté" onPress={onAside} disabled={busy}/></View><View style={{flex:1}}><Button title="Abandonner" onPress={onAbandon} disabled={busy}/></View></View>
 </View>;
}
