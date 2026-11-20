import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { fontFamilies } from '../../src/constants/typography';
import { getExercises, getExerciseFavorites, setExerciseFavorite } from '../../src/services/exerciseService';
import { exerciseRegionLabel, exerciseMovementLabel, filterExerciseCatalogue } from '../../src/utils/exerciseCatalogue';
import ExerciseCatalogueControls from '../../src/components/exercises/ExerciseCatalogueControls';

export default function LibraryScreen() {
  const { colors }=useUgerodTheme();
  const [rows,setRows]=useState([]),[favorites,setFavorites]=useState([]),[filters,setFilters]=useState({search:'',favoritesOnly:false});
  const [expanded,setExpanded]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0),[busy,setBusy]=useState(null);
  useFocusEffect(useCallback(()=>{let active=true;setLoading(true);setError('');
    Promise.all([getExercises(),getExerciseFavorites()]).then(([catalogue,ids])=>{if(active){setRows(catalogue);setFavorites(ids)}}).catch(()=>{if(active)setError('Impossible de charger les exercices. Réessaie.');}).finally(()=>{if(active)setLoading(false)});
    return ()=>{active=false};
  },[retry]));
  const visible=useMemo(()=>filterExerciseCatalogue(rows,filters,favorites),[rows,filters,favorites]);
  async function toggle(id){if(busy)return;setBusy(id);setError('');try{const selected=await setExerciseFavorite(id,!favorites.includes(id));setFavorites(ids=>selected?[...new Set([...ids,id])]:ids.filter(x=>x!==id));}catch{setError('Le favori n’a pas été enregistré. Réessaie.');}finally{setBusy(null)}}
  const text={color:colors.text,fontFamily:fontFamilies.regular,fontSize:16};
  return <SafeAreaView style={{flex:1,backgroundColor:colors.background}}>
    <View style={{padding:22,gap:14}}>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{...text,fontFamily:fontFamilies.display,fontSize:40}}>TES EXERCICES.</Text><Pressable accessibilityLabel="Mon profil" onPress={()=>router.push('/profile')}><Ionicons name="person-circle-outline" size={30} color={colors.text}/></Pressable></View>
      <TextInput accessibilityLabel="Rechercher un exercice" placeholder="Mouvement, zone ou matériel…" placeholderTextColor={colors.textSecondary} value={filters.search} onChangeText={search=>setFilters({...filters,search})} style={{...text,padding:14,borderRadius:15,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface}}/>
      <View style={{flexDirection:'row',gap:20,alignItems:'center'}}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked:filters.favoritesOnly}} onPress={()=>setFilters({...filters,favoritesOnly:!filters.favoritesOnly})}><Text style={text}>{filters.favoritesOnly?'♥':'♡'} Mes favoris</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{expanded}} onPress={()=>setExpanded(!expanded)}><Text style={{...text,color:colors.accent}}>Filtrer {expanded?'−':'+'}</Text></Pressable>
      </View>
      {expanded?<ExerciseCatalogueControls rows={rows} filters={filters} onChange={setFilters} colors={colors}/>:null}
      {error?<View accessibilityRole="alert"><Text style={text}>{error}</Text><Pressable onPress={()=>setRetry(n=>n+1)}><Text style={{...text,color:colors.accent}}>Réessayer</Text></Pressable></View>:null}
      <Text style={{...text,color:colors.textSecondary}}>{loading?'Chargement…':`${visible.length} mouvement${visible.length>1?'s':''}`}</Text>
    </View>
    {loading?<ActivityIndicator color={colors.accent}/>:<FlatList data={visible} keyExtractor={e=>e.id} contentContainerStyle={{paddingHorizontal:22,paddingBottom:30,gap:10}}
      ListEmptyComponent={<Text style={text}>Aucun exercice pour ces filtres.</Text>}
      renderItem={({item})=><View style={{flexDirection:'row',alignItems:'center',borderRadius:18,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface}}>
        <Pressable onPress={()=>router.push(`/exercise/${encodeURIComponent(item.id)}`)} accessibilityRole="button" accessibilityLabel={`Voir ${item.name}`} style={{flex:1,padding:17,gap:6}}><Text style={{...text,fontFamily:fontFamilies.semiBold,fontSize:18}}>{item.name}</Text><Text style={{...text,color:colors.textSecondary,fontSize:13}}>{[exerciseRegionLabel(item.bodyRegion),exerciseMovementLabel(item.movementPattern)].filter(Boolean).join(' · ')}</Text></Pressable>
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked:favorites.includes(item.id),disabled:busy!=null}} accessibilityLabel={`Favori : ${item.name}`} disabled={busy!=null} onPress={()=>toggle(item.id)} style={{padding:16}}><Ionicons name={favorites.includes(item.id)?'heart':'heart-outline'} size={24} color={colors.accent}/></Pressable>
      </View>}/>}
  </SafeAreaView>;
}
