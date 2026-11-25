import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { fontFamilies } from '../../src/constants/typography';
import { getExerciseById, getExerciseFavorites, setExerciseFavorite } from '../../src/services/exerciseService';
import ExerciseArtwork from '../../src/components/exercises/ExerciseArtwork';
import { exerciseRegionLabel, exerciseMovementLabel } from '../../src/utils/exerciseCatalogue';
const clean=value=>String(value??'').replace(/\\r\\n|\\n|\\r/g,'\n').trim();
export default function ExerciseDetailScreen() {
  const {exerciseId}=useLocalSearchParams(),{colors}=useUgerodTheme();
  const [exercise,setExercise]=useState(null),[favorite,setFavorite]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0),[open,setOpen]=useState(null),[busy,setBusy]=useState(false);
  useFocusEffect(useCallback(()=>{let active=true;setLoading(true);setError('');
    Promise.all([getExerciseById(String(exerciseId??'')),getExerciseFavorites()]).then(([row,ids])=>{if(active){setExercise(row);setFavorite(ids.includes(row?.id));}}).catch(()=>{if(active)setError('Impossible de charger cette fiche. Réessaie.');}).finally(()=>{if(active)setLoading(false)});
    return ()=>{active=false};
  },[exerciseId,retry]));
  async function toggle(){setBusy(true);setError('');try{setFavorite(await setExerciseFavorite(exercise.id,!favorite));}catch{setError('Le favori n’a pas pu être enregistré.');}finally{setBusy(false)}}
  const text={color:colors.text,fontFamily:fontFamilies.regular,fontSize:14,lineHeight:22};
  const card={padding:14,borderRadius:12,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,gap:10};
  return <SafeAreaView style={{flex:1,backgroundColor:colors.background}}><ScrollView contentContainerStyle={{padding:18,gap:15}}>
    <Pressable accessibilityLabel="Retour aux exercices" onPress={()=>router.back()} style={{alignSelf:'flex-start',paddingVertical:8}}><Ionicons name="arrow-back" size={26} color={colors.text}/></Pressable>
    {loading?<ActivityIndicator color={colors.accent}/>:exercise?<>
      <Text style={{...text,fontFamily:fontFamilies.display,fontSize:32,lineHeight:36}}>{exercise.name}</Text>
      <ExerciseArtwork imagePath={exercise.imagePath} colors={colors} hero/>
      <Text style={{...text,color:colors.textSecondary}}>{[exerciseRegionLabel(exercise.bodyRegion),exerciseMovementLabel(exercise.movementPattern),exercise.difficulty].filter(Boolean).join(' · ')}</Text>
      <View style={card}><Text style={{...text,fontFamily:fontFamilies.semiBold}}>Matériel</Text><Text style={text}>{exercise.equipmentNames.join(' · ')||'Poids du corps'}</Text></View>
      {exercise.description?<Text style={text}>{clean(exercise.description).split(/(?<=[.!?])\s+/)[0]}</Text>:null}
      {[['Exécution',exercise.instructions],['Conseils',exercise.tips],['Description complète',exercise.description]].filter(([,value])=>Boolean(clean(value))).map(([title,value])=><View key={title} style={card}>
        <Pressable accessibilityRole="button" accessibilityState={{expanded:open===title}} onPress={()=>setOpen(open===title?null:title)} style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><Text style={{...text,fontFamily:fontFamilies.semiBold}}>{title}</Text><Ionicons name={open===title?'chevron-up':'chevron-down'} size={20} color={colors.accent}/></Pressable>
        {open===title?<Text style={text}>{clean(value)}</Text>:null}
      </View>)}
      <Text style={{...text,color:colors.textSecondary,fontSize:13}}>Séries, répétitions et récupération sont adaptées dans ta séance.</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{checked:favorite,disabled:busy}} disabled={busy} onPress={toggle} style={{...card,flexDirection:'row',alignItems:'center',justifyContent:'center'}}><Ionicons name={favorite?'heart':'heart-outline'} size={22} color={colors.accent}/><Text style={text}>{favorite?'Retirer des favoris':'Ajouter aux favoris'}</Text></Pressable>
    </>:!error?<Text style={text}>Cet exercice n’est pas disponible. Reviens au catalogue pour choisir un mouvement.</Text>:null}
    {error?<View accessibilityRole="alert" style={card}><Text style={text}>{error}</Text><Pressable onPress={()=>setRetry(n=>n+1)}><Text style={{...text,color:colors.accent}}>Réessayer</Text></Pressable></View>:null}
  </ScrollView></SafeAreaView>;
}
