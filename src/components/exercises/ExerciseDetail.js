import ExerciseName from './ExerciseName';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { fontFamilies } from '../../constants/typography';
import AthleticMuscleMap from '../body/AthleticMuscleMap';
import { getExerciseMuscles } from '../../services/exerciseService';
import { exerciseRegionLabel, exerciseMovementLabel } from '../../utils/exerciseCatalogue';

const MUSCLE_NAMES={M01:'Pectoraux',M02:'Grands dorsaux',M03:'Épaules',M04:'Biceps',M05:'Triceps',M06:'Quadriceps',M07:'Ischio-jambiers',M08:'Fessiers',M09:'Mollets',M10:'Grands droits',M11:'Obliques',M12:'Lombaires',M13:'Trapèzes'};

// The same presentation can be reused in another context by supplying its
// own actions. This component never saves, prescribes or starts a workout.
export default function ExerciseDetail({ visible=true, exercise, dose, doseLabel, index, count, colors, isDark, brandIcon,
  editable=false, onClose, onReplace, onRemove, onPrevious, onNext,
  closeLabel='Retour à la séance', onSelect, selectLabel='Ajouter à la séance', selectDisabled=false, selectHint=null }) {
  const styles=makeStyles(colors);
  const [muscles,setMuscles]=useState([]),[muscleState,setMuscleState]=useState('loading'),[retry,setRetry]=useState(0);
  const [imageFailed,setImageFailed]=useState(false);
  const id=exercise?.id;
  const imageUri=/^https?:\/\//i.test(String(exercise?.imagePath??''))?exercise.imagePath:null;
  useEffect(()=>{setImageFailed(false);},[imageUri]);
  useEffect(()=>{
    let active=true;
    setMuscles([]);setMuscleState('loading');
    if(!id){setMuscleState('ready');return ()=>{active=false;};}
    getExerciseMuscles(id).then(rows=>{if(active){setMuscles(rows);setMuscleState('ready');}})
      .catch(()=>{if(active)setMuscleState('error');});
    return ()=>{active=false;};
  },[id,retry]);
  if(!exercise)return null;
  const known=muscles.filter(m=>MUSCLE_NAMES[m.id]);
  const primary=known.filter(m=>m.priority==='primary');
  const secondary=known.filter(m=>m.priority==='secondary');
  const colorsByMuscle={};
  secondary.forEach(m=>{colorsByMuscle[m.id]='#A7B19F';});
  primary.forEach(m=>{colorsByMuscle[m.id]=colors.accent;});
  const steps=String(exercise.instructions??'').split(/\r?\n/).map(v=>v.trim().replace(/^\d+[.)]\s*|^[-•]\s*/, '')).filter(Boolean);
  const prescription=dose?.prescription_json??dose??{};
  const kg=prescription.load_kg??dose?.load_kg;
  const load=kg!=null?`${kg} kg${prescription.load_scope==='per_implement'?' par élément':''}`:prescription.band_resistance_label?`Élastique ${prescription.band_resistance_label}`:null;
  const meta=[exerciseRegionLabel(exercise.bodyRegion),exerciseMovementLabel(exercise.movementPattern)].filter(Boolean).join(' · ');
  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark?'light':'dark'}/>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Retour aux mouvements" onPress={onClose} style={styles.iconButton}><Ionicons name="arrow-back" size={22} color={colors.text}/></Pressable>
        <View style={styles.headerCenter}>{brandIcon?<Image source={brandIcon} style={styles.logo} resizeMode="contain"/>:null}<Text style={styles.headerTitle}>Fiche exercice</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer la fiche" onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={22} color={colors.text}/></Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          {imageUri&&!imageFailed?<Image source={{uri:imageUri}} resizeMode="contain" style={styles.heroImage} onError={()=>setImageFailed(true)} accessibilityLabel={'Démonstration de '+exercise.name}/>:<View style={styles.placeholder}><Ionicons name="image-outline" size={34} color={colors.textMuted}/><Text style={styles.muted}>Visuel non disponible</Text></View>}
        </View>
        <View style={{gap:5}}>
          {Number.isInteger(index)&&count>0?<Text style={styles.kicker}>EXERCICE {index+1}/{count}</Text>:null}
          <ExerciseName exercise={exercise} detail accessibilityRole="header" style={styles.title}/>
          {doseLabel?<Text style={styles.dose}>{doseLabel}</Text>:null}
          {meta?<Text style={styles.muted}>{meta}</Text>:null}
        </View>
        {exercise.warning?<View style={styles.warning}><Ionicons name="alert-circle-outline" size={18} color={colors.secondaryAccent}/><Text style={[styles.body,{flex:1}]}>{exercise.recommendationReason||'Mouvement similaire déjà sélectionné'}</Text></View>:null}
        <View style={styles.panel}>
          {exercise.description?<View style={styles.section}><Text style={styles.sectionTitle}>Objectif du mouvement</Text><Text style={styles.body}>{exercise.description}</Text></View>:null}
          {steps.length?<View style={styles.section}><Text style={styles.sectionTitle}>Consignes</Text>{steps.map((step,i)=><View key={i} style={styles.step}><Text style={styles.number}>{i+1}.</Text><Text style={[styles.body,{flex:1}]}>{step}</Text></View>)}</View>:null}
          {exercise.tips?<View style={styles.section}><Text style={styles.sectionTitle}>Point d’attention</Text><Text style={styles.body}>{exercise.tips}</Text></View>:null}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Zones ciblées</Text>
            {muscleState==='loading'?<ActivityIndicator color={colors.accent}/>:muscleState==='error'?<Pressable onPress={()=>setRetry(v=>v+1)}><Text style={styles.link}>Zones indisponibles · Réessayer</Text></Pressable>:null}
            {muscleState==='ready'&&!primary.length&&!secondary.length?<Text style={styles.muted}>Muscles ciblés non renseignés.</Text>:null}
            {primary.length||secondary.length?<><View style={styles.maps} pointerEvents="none">
              <View style={styles.mapColumn}><View style={styles.map}><AthleticMuscleMap side="front" colorsByMuscle={colorsByMuscle}/></View><Text style={styles.muted}>Face</Text></View>
              <View style={styles.mapColumn}><View style={styles.map}><AthleticMuscleMap side="back" colorsByMuscle={colorsByMuscle}/></View><Text style={styles.muted}>Dos</Text></View>
            </View>
            {primary.length?<Text style={styles.body}><Text style={styles.strong}>Principaux · </Text>{primary.map(m=>MUSCLE_NAMES[m.id]).join(' · ')}</Text>:null}
            {secondary.length?<Text style={styles.body}><Text style={styles.strong}>Secondaires · </Text>{secondary.map(m=>MUSCLE_NAMES[m.id]).join(' · ')}</Text>:null}</>:null}
          </View>
          <View style={styles.section}><Text style={styles.sectionTitle}>Matériel</Text><Text style={styles.body}>{(exercise.equipmentNames??[]).join(' · ')||'Poids du corps'}</Text>
            {load?<Text style={styles.body}><Text style={styles.strong}>Charge conseillée · </Text>{load}</Text>:null}
            {exercise.missingEquipment?.length?<Text style={styles.muted}>Matériel manquant : {exercise.missingEquipment.join(' · ')}</Text>:null}
          </View>
        </View>
        {(onPrevious||onNext)?<View style={styles.navigation}>
          {onPrevious?<Pressable accessibilityRole="button" onPress={onPrevious} style={styles.navButton}><Ionicons name="chevron-back" size={17} color={colors.accent}/><Text style={styles.link}>Précédent</Text></Pressable>:<View/>}
          {onNext?<Pressable accessibilityRole="button" onPress={onNext} style={styles.navButton}><Text style={styles.link}>Suivant</Text><Ionicons name="chevron-forward" size={17} color={colors.accent}/></Pressable>:null}
        </View>:null}
      </ScrollView>
      <View style={styles.footer}>
        {editable?<View style={styles.actions}>
          {onReplace?<Pressable accessibilityRole="button" accessibilityLabel={'Remplacer '+exercise.name} onPress={onReplace} style={styles.secondary}><Ionicons name="swap-horizontal-outline" size={18} color={colors.accent}/><Text style={styles.link}>Remplacer</Text></Pressable>:null}
          {onRemove?<Pressable accessibilityRole="button" accessibilityLabel={'Retirer '+exercise.name} onPress={onRemove} style={styles.secondary}><Ionicons name="trash-outline" size={17} color={colors.textSecondary}/><Text style={styles.muted}>Retirer</Text></Pressable>:null}
        </View>:null}
        {onSelect?<>
          {selectHint?<Text style={styles.muted}>{selectHint}</Text>:null}
          <Pressable accessibilityRole="button" accessibilityState={{disabled:selectDisabled}} disabled={selectDisabled} onPress={onSelect} style={[styles.done,selectDisabled&&{opacity:.45}]}><Text style={styles.doneText}>{selectLabel}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondaryClose}><Text style={styles.link}>{closeLabel}</Text></Pressable>
        </>:<Pressable accessibilityRole="button" onPress={onClose} style={styles.done}><Text style={styles.doneText}>{closeLabel}</Text></Pressable>}
      </View>
    </SafeAreaView>
  </Modal>;
}
function makeStyles(c){return StyleSheet.create({
  screen:{flex:1,backgroundColor:c.background},
  header:{width:'100%',maxWidth:820,alignSelf:'center',paddingHorizontal:16,paddingVertical:8,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:c.border},
  iconButton:{width:44,height:44,justifyContent:'center',alignItems:'center'},
  headerCenter:{flexDirection:'row',alignItems:'center',gap:8},logo:{width:26,height:26},
  headerTitle:{fontFamily:fontFamilies.semiBold,fontSize:14,color:c.text},
  scroll:{width:'100%',maxWidth:820,alignSelf:'center',padding:16,gap:16,paddingBottom:24},
  hero:{width:'100%',aspectRatio:16/9,maxHeight:340,borderRadius:12,overflow:'hidden',backgroundColor:c.surfaceElevated??c.surface},
  heroImage:{width:'100%',height:'100%'},placeholder:{flex:1,alignItems:'center',justifyContent:'center',gap:9},
  kicker:{fontFamily:fontFamilies.bold,fontSize:10,letterSpacing:1,color:c.accent},
  title:{fontFamily:fontFamilies.bold,fontSize:24,lineHeight:30,color:c.text},
  dose:{fontFamily:fontFamilies.semiBold,fontSize:14,lineHeight:20,color:c.text},
  muted:{fontFamily:fontFamilies.medium,fontSize:12,lineHeight:17,color:c.textSecondary},
  body:{fontFamily:fontFamilies.regular,fontSize:14,lineHeight:21,color:c.textSecondary},
  strong:{fontFamily:fontFamilies.semiBold,color:c.text},
  panel:{borderRadius:14,borderWidth:1,borderColor:c.border,backgroundColor:c.surface,paddingHorizontal:14},
  section:{paddingVertical:13,gap:7,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:c.border},
  sectionTitle:{fontFamily:fontFamilies.bold,fontSize:15,lineHeight:21,color:c.text},
  step:{flexDirection:'row',alignItems:'flex-start',gap:8},number:{fontFamily:fontFamilies.bold,fontSize:13,lineHeight:21,color:c.accent},
  maps:{flexDirection:'row',justifyContent:'center',gap:18},mapColumn:{alignItems:'center',width:'43%',maxWidth:150,gap:4},map:{width:'100%',aspectRatio:220/432,maxHeight:220},
  warning:{flexDirection:'row',alignItems:'flex-start',gap:8},
  navigation:{flexDirection:'row',justifyContent:'space-between'},navButton:{minHeight:44,flexDirection:'row',alignItems:'center',gap:4},
  link:{fontFamily:fontFamilies.semiBold,fontSize:13,lineHeight:18,color:c.accent},
  footer:{width:'100%',maxWidth:820,alignSelf:'center',paddingHorizontal:16,paddingVertical:10,gap:8,borderTopWidth:1,borderTopColor:c.border,backgroundColor:c.background},
  actions:{flexDirection:'row',gap:8},secondary:{flex:1,minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,borderWidth:1,borderColor:c.border,borderRadius:10},
  secondaryClose:{minHeight:44,alignItems:'center',justifyContent:'center'},
  done:{minHeight:44,borderRadius:12,backgroundColor:c.accent,alignItems:'center',justifyContent:'center'},doneText:{fontFamily:fontFamilies.bold,fontSize:14,color:c.textOnAccent},
});}
