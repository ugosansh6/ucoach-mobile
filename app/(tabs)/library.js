import { router, useFocusEffect,useLocalSearchParams } from 'expo-router';
import PersonalModelsPage from '../../src/workout/PersonalModelsPage';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { fontFamilies } from '../../src/constants/typography';
import { getExercises, getExerciseFavorites, setExerciseFavorite } from '../../src/services/exerciseService';
import { exerciseRegionLabel, exerciseMovementLabel, filterExerciseCatalogue } from '../../src/utils/exerciseCatalogue';
import ExerciseArtwork from '../../src/components/exercises/ExerciseArtwork';
import ExerciseCatalogueControls from '../../src/components/exercises/ExerciseCatalogueControls';

export default function LibraryScreen(){
 const params=useLocalSearchParams();const section=Array.isArray(params.section)?params.section[0]:params.section;const importDate=Array.isArray(params.importDate)?params.importDate[0]:params.importDate;
 return section==='models'?<PersonalModelsPage importDate={importDate} showExercises={()=>router.setParams({section:'exercises',importDate:''})}/>:<ExerciseLibraryScreen/>;
}
function ExerciseLibraryScreen() {
  const { colors }=useUgerodTheme();
  const [rows,setRows]=useState([]),[favorites,setFavorites]=useState([]),[filters,setFilters]=useState({search:'',favoritesOnly:false});
  const [expanded,setExpanded]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0),[busy,setBusy]=useState(null);
  useFocusEffect(useCallback(()=>{let active=true;setLoading(true);setError('');
    Promise.all([getExercises(),getExerciseFavorites()]).then(([catalogue,ids])=>{if(active){setRows(catalogue);setFavorites(ids)}}).catch(()=>{if(active)setError('Impossible de charger les exercices. Réessaie.');}).finally(()=>{if(active)setLoading(false)});
    return ()=>{active=false};
  },[retry]));
  const visible=useMemo(()=>filterExerciseCatalogue(rows,filters,favorites),[rows,filters,favorites]);
  async function toggle(id){if(busy)return;setBusy(id);setError('');try{const selected=await setExerciseFavorite(id,!favorites.includes(id));setFavorites(ids=>selected?[...new Set([...ids,id])]:ids.filter(x=>x!==id));}catch{setError('Le favori n’a pas été enregistré. Réessaie.');}finally{setBusy(null)}}
  const text={color:colors.text,fontFamily:fontFamilies.regular,fontSize:14};
  return <SafeAreaView style={{flex:1,backgroundColor:colors.background}}>
    <View style={{paddingHorizontal:18,paddingTop:12,paddingBottom:10,gap:11}}>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{...text,fontFamily:fontFamilies.display,fontSize:32}}>BIBLIOTHÈQUE.</Text><Pressable accessibilityLabel="Mon profil" onPress={()=>router.push('/profile')}><Ionicons name="person-circle-outline" size={30} color={colors.text}/></Pressable></View>
      <View style={{flexDirection:'row',borderBottomWidth:1,borderBottomColor:colors.border}}>{[['models','Mes modèles'],['exercises','Exercices']].map(([key,label])=><Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:key==='exercises'}} onPress={()=>router.setParams({section:key,importDate:''})} style={{flex:1,minHeight:44,justifyContent:'center',borderBottomWidth:key==='exercises'?3:0,borderBottomColor:colors.accent}}><Text style={{...text,textAlign:'center',fontFamily:key==='exercises'?fontFamilies.semiBold:fontFamilies.regular,color:key==='exercises'?colors.text:colors.textSecondary}}>{label}</Text></Pressable>)}</View>
      <View style={{flexDirection:'row',gap:8,alignItems:'center'}}><View style={{flex:1,flexDirection:'row',alignItems:'center',gap:9,paddingHorizontal:12,minHeight:44,borderRadius:11,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface}}><Ionicons name="search-outline" size={18} color={colors.textSecondary}/><TextInput accessibilityLabel="Rechercher un exercice" placeholder="Mouvement, zone ou matériel…" placeholderTextColor={colors.textSecondary} value={filters.search} onChangeText={search=>setFilters(old=>({...old,search}))} style={{...text,flex:1,paddingVertical:10}}/></View><Pressable accessibilityLabel="Filtres détaillés" accessibilityRole="button" accessibilityState={{expanded}} onPress={()=>setExpanded(v=>!v)} style={{width:44,height:44,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:expanded?colors.accent:colors.border,borderRadius:11}}><Ionicons name="options-outline" size={21} color={colors.accent}/></Pressable></View>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:7}}>{[['','Tous'],['FAVORITES','Favoris'],['Upper','Haut du corps'],['Lower','Jambes'],['Core','Gainage'],['Back','Dos']].map(([key,label])=>{const active=key==='FAVORITES'?filters.favoritesOnly:!filters.favoritesOnly&&(filters.region??'')===key;return <Pressable key={key} accessibilityRole="button" accessibilityState={{selected:active}} onPress={()=>setFilters(old=>({...old,region:key==='FAVORITES'?'':key,favoritesOnly:key==='FAVORITES'}))} style={{paddingHorizontal:11,minHeight:34,justifyContent:'center',borderRadius:18,backgroundColor:active?colors.accent:colors.surfacePressed}}><Text style={{...text,fontSize:12,color:active?colors.textOnAccent:colors.textSecondary}}>{label}</Text></Pressable>})}</View>
      {expanded?<ExerciseCatalogueControls rows={rows} filters={filters} onChange={setFilters} colors={colors}/>:null}
      {error?<View accessibilityRole="alert"><Text style={text}>{error}</Text><Pressable onPress={()=>setRetry(n=>n+1)}><Text style={{...text,color:colors.accent}}>Réessayer</Text></Pressable></View>:null}
      <Text style={{...text,color:colors.textSecondary,fontSize:12}}>{loading?'Chargement…':`${visible.length} mouvement${visible.length>1?'s':''}`}</Text>
    </View>
    {loading?<ActivityIndicator color={colors.accent}/>:<FlatList data={visible} keyExtractor={e=>e.id} contentContainerStyle={{paddingHorizontal:18,paddingBottom:24}}
      ListEmptyComponent={<Text style={text}>Aucun exercice pour ces filtres.</Text>}
      renderItem={({item})=><View style={{flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:colors.border,minHeight:76}}>
        <Pressable onPress={()=>router.push(`/exercise/${encodeURIComponent(item.id)}`)} accessibilityRole="button" accessibilityLabel={`Voir ${item.name}`} style={{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',paddingVertical:9,gap:12}}><ExerciseArtwork imagePath={item.imagePath} colors={colors}/><View style={{flex:1,gap:4}}><Text style={{...text,fontFamily:fontFamilies.semiBold,fontSize:15,lineHeight:20}}>{item.name}</Text><Text style={{...text,color:colors.textSecondary,fontSize:12,lineHeight:17}}>{[exerciseRegionLabel(item.bodyRegion),exerciseMovementLabel(item.movementPattern)].filter(Boolean).join(' · ')}</Text></View></Pressable>
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked:favorites.includes(item.id),disabled:busy!=null}} accessibilityLabel={`Favori : ${item.name}`} disabled={busy!=null} onPress={()=>toggle(item.id)} style={{width:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Ionicons name={favorites.includes(item.id)?'heart':'heart-outline'} size={21} color={colors.accent}/></Pressable>
      </View>}/>}
  </SafeAreaView>;
}
