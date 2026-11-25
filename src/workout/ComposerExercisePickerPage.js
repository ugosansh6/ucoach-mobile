import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { fontFamilies } from '../constants/typography';
import { exerciseRegionLabel, exerciseMovementLabel } from '../utils/exerciseCatalogue';
import { pickerZones, pickerTypes, filterPickerRows, pickerEquipmentMatches, pickerEquipmentOptions } from '../utils/composerPickerPresentation';

export default function ComposerExercisePickerPage({colors,isDark,blockLabel,rows,equipmentIds=[],referenceEquipment=[],equipmentSummary,selectedRows,selectedIds,favoriteIds,capacity,replacementId,onReplacement,loading,error,onRetry,onSelect,onClose}) {
  const [zone,setZone]=useState(''),[type,setType]=useState(''),[equipment,setEquipment]=useState(''),[search,setSearch]=useState('');
  const [favoritesOnly,setFavoritesOnly]=useState(false),[view,setView]=useState('hub'),[limit,setLimit]=useState(40);
  const styles=createStyles(colors);
  const available=rows.filter(row=>pickerEquipmentMatches(row,equipmentIds)&&!selectedIds.includes(row.id));
  const equipmentOptions=pickerEquipmentOptions(equipmentIds,referenceEquipment);
  const filters={zone,type,equipment,search,favoritesOnly};
  const filtered=filterPickerRows(available,filters,favoriteIds);
  const selectedZone=pickerZones.find(z=>z.key===zone),selectedType=pickerTypes.find(t=>t.key===type),selectedEquipment=equipmentOptions.find(e=>e.key===equipment);
  const atCapacity=selectedIds.length>=capacity;
  const listVisible=view==='results'||Boolean(search.trim())||favoritesOnly;
  function results(){setView('results');setLimit(40);}
  function back(){if(view==='zone'||view==='type'||view==='equipment'||listVisible){setView('hub');setSearch('');setFavoritesOnly(false);}else onClose();}
  function categoryCard(item,count,onPress,active=false){return <Pressable key={item.key} accessibilityRole="button" onPress={onPress}
      style={[styles.tile,active&&styles.activeTile]}>
      <View style={styles.tileIcon}><Ionicons name={item.icon} size={24} color={colors.accent}/></View>
      <Text style={styles.tileTitle}>{item.label}</Text><View style={styles.tileFooter}><Text style={styles.muted}>{count} exercice{count!==1?'s':''}</Text>
      <Ionicons name={active?'checkmark-circle':'chevron-forward'} color={colors.accent} size={18}/></View>
    </Pressable>;}
  const choosingCategory=['zone','type','equipment'].includes(view);
  const facetOptions=view==='zone'?pickerZones:view==='type'?pickerTypes:equipmentOptions;
  const activeFacet=view==='zone'?zone:view==='type'?type:equipment;
  const facetCount=key=>filterPickerRows(available,{...filters,[view]:key},favoriteIds).length;
  function chooseFacet(key){if(view==='zone')setZone(key);else if(view==='type')setType(key);else setEquipment(key);results();}
  function clearFilters(){setZone('');setType('');setEquipment('');setFavoritesOnly(false);setSearch('');setLimit(40);}
  return <SafeAreaView style={styles.screen}>
    <StatusBar style={isDark?'light':'dark'}/>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={back} style={styles.iconButton}><Ionicons name="arrow-back" size={21} color={colors.text}/></Pressable>
        <View style={{flex:1}}><Text style={styles.kicker}>{blockLabel.toUpperCase()}</Text><Text style={styles.title}>Choisir les exercices.</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={22} color={colors.text}/></Pressable>
      </View>
      <View style={styles.equipmentScope}><Ionicons name="checkmark-circle-outline" size={17} color={colors.accent}/><Text style={[styles.muted,{flex:1}]}>Matériel de la séance : {equipmentSummary && equipmentSummary !== 'Poids du corps' ? 'Poids du corps · '+equipmentSummary : 'Poids du corps'}</Text></View>
      {replacementId?<Text style={styles.muted}>Remplacer : {selectedRows.find(row=>row.id===replacementId)?.name??'mouvement sélectionné'}</Text>:null}
      {atCapacity&&!replacementId?<View style={styles.notice}><Text style={styles.tileTitle}>Bloc complet</Text><Text style={styles.muted}>Choisis le mouvement à remplacer.</Text>
        {selectedRows.map(row=><Pressable key={row.id} onPress={()=>onReplacement(row.id)} style={styles.row}><Text style={styles.rowTitle}>{row.name}</Text><Ionicons name="swap-horizontal-outline" size={20} color={colors.accent}/></Pressable>)}</View>:null}
      {!choosingCategory?<><View style={styles.search}><Ionicons name="search-outline" size={20} color={colors.textSecondary}/><TextInput value={search} onChangeText={v=>{setSearch(v);setLimit(40);if(v.trim())setView('results');}} placeholder="Rechercher un exercice" placeholderTextColor={colors.textMuted} accessibilityLabel="Rechercher un exercice" autoCorrect={false} style={styles.searchInput}/>{search?<Pressable accessibilityLabel="Effacer la recherche" onPress={()=>setSearch('')}><Ionicons name="close-circle" color={colors.textSecondary} size={20}/></Pressable>:null}</View>
      <View style={styles.filterRow}>
        <Pressable accessibilityRole="button" onPress={()=>setView('zone')} style={styles.filterTile}><Ionicons name="body-outline" size={20} color={colors.accent}/><Text style={styles.filterLabel}>Zone du corps</Text><Text style={styles.muted}>{selectedZone?.label??'Toutes'}</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted}/></Pressable>
        <Pressable accessibilityRole="button" onPress={()=>setView('type')} style={styles.filterTile}><Ionicons name="fitness-outline" size={20} color={colors.accent}/><Text style={styles.filterLabel}>Type d’entraînement</Text><Text style={styles.muted}>{selectedType?.label??'Tous'}</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted}/></Pressable>
        <Pressable accessibilityRole="button" onPress={()=>setView('equipment')} style={styles.filterTile}><Ionicons name="barbell-outline" size={20} color={colors.accent}/><Text style={styles.filterLabel}>Matériel</Text><Text style={styles.muted}>{selectedEquipment?.label??'Tous'}</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted}/></Pressable>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={()=>{setFavoritesOnly(!favoritesOnly);results();}} style={[styles.pill,favoritesOnly&&styles.activeTile]}><Ionicons name={favoritesOnly?'heart':'heart-outline'} size={17} color={colors.accent}/><Text style={styles.filterLabel}>Mes favoris</Text></Pressable>
        {(zone||type||equipment||favoritesOnly||search)?<Pressable accessibilityRole="button" onPress={()=>{clearFilters();setView('hub');}} style={styles.pill}><Text style={styles.filterLabel}>Réinitialiser</Text></Pressable>:null}
      </View></>:null}
      {loading?<View style={styles.notice}><ActivityIndicator color={colors.accent}/><Text style={styles.muted}>Chargement du catalogue…</Text></View>:null}
      {error?<Pressable onPress={onRetry} style={styles.notice}><Text style={styles.tileTitle}>Catalogue indisponible · Réessayer</Text></Pressable>:null}
      {choosingCategory?<><Text style={styles.section}>{view==='zone'?'Zones du corps':view==='type'?'Types d’entraînement':'Matériel'}</Text><View style={styles.grid}>
        {categoryCard({key:'',label:view==='equipment'?'Tout mon matériel':'Tous les exercices',icon:'grid-outline'},facetCount(''),()=>chooseFacet(''),!activeFacet)}
        {facetOptions.map(item=>categoryCard(item,facetCount(item.key),()=>chooseFacet(item.key),activeFacet===item.key))}
      </View></>:!listVisible?<Pressable accessibilityRole="button" style={styles.browse} onPress={()=>{clearFilters();results();}}><View style={styles.tileIcon}><Ionicons name="grid-outline" size={24} color={colors.accent}/></View><View style={{flex:1}}><Text style={styles.tileTitle}>Tous les exercices</Text><Text style={styles.muted}>{available.length} exercices compatibles avec ton matériel</Text></View><Ionicons name="chevron-forward" color={colors.accent} size={20}/></Pressable>:<>
        <Text style={styles.section}>{filtered.length} exercice{filtered.length!==1?'s':''}</Text>
        {!filtered.length&&!loading?<Text style={styles.muted}>Aucun exercice compatible. Modifie tes filtres, ta recherche ou le matériel de la séance.</Text>:null}
        {filtered.slice(0,limit).map(row=><Pressable key={row.id} accessibilityRole="button" accessibilityLabel={'Ajouter '+row.name} disabled={atCapacity&&!replacementId} onPress={()=>onSelect(row)} style={[styles.row,atCapacity&&!replacementId&&{opacity:0.5}]}>
          <View style={styles.thumb}>{/^https?:\/\//i.test(String(row.imagePath??''))?<Image source={{uri:row.imagePath}} style={{width:'100%',height:'100%'}} resizeMode="cover"/>:<Ionicons name="barbell-outline" size={23} color={colors.textSecondary}/>}</View>
          <View style={{flex:1,gap:3}}><Text style={styles.rowTitle}>{row.name}</Text><Text style={styles.muted}>{[exerciseRegionLabel(row.bodyRegion),exerciseMovementLabel(row.movementPattern)].filter(Boolean).join(' · ')}</Text>
          <Text style={styles.muted}>{(row.equipmentNames??[]).join(' · ')||'Poids du corps'}</Text>
          {row.missingEquipment?.length?<Text style={styles.warning}>Matériel manquant : {row.missingEquipment.join(' · ')}</Text>:null}
          {row.recommended?<Text style={styles.recommended}>Recommandé</Text>:null}</View><Ionicons name="add-circle-outline" size={27} color={colors.accent}/></Pressable>)}
        {filtered.length>limit?<Pressable style={styles.browse} onPress={()=>setLimit(v=>v+40)}><Text style={styles.filterLabel}>Afficher plus d’exercices</Text><Ionicons name="chevron-down" size={18} color={colors.accent}/></Pressable>:null}
      </>}
    </ScrollView>
    <View style={styles.footer}><Text style={styles.muted}>{selectedIds.length} mouvement{selectedIds.length!==1?'s':''} retenu{selectedIds.length!==1?'s':''}</Text><Pressable accessibilityRole="button" onPress={onClose} style={styles.done}><Text style={styles.doneText}>Terminé</Text></Pressable></View>
  </SafeAreaView>;
}
function createStyles(c){return StyleSheet.create({
  screen:{flex:1,backgroundColor:c.background},scroll:{width:'100%',maxWidth:820,alignSelf:'center',padding:20,gap:16,paddingBottom:28},
  header:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:10},
  iconButton:{width:42,height:42,borderRadius:21,alignItems:'center',justifyContent:'center',backgroundColor:c.surface,borderWidth:1,borderColor:c.border},
  kicker:{fontFamily:fontFamilies.bold,fontSize:10,letterSpacing:1,color:c.accent},title:{fontFamily:fontFamilies.display,fontSize:30,lineHeight:35,color:c.text},
  search:{flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:c.border,borderRadius:14,backgroundColor:c.surface,padding:13},
  searchInput:{flex:1,fontFamily:fontFamilies.medium,fontSize:15,color:c.text,padding:0,minHeight:28},
  filterRow:{flexDirection:'row',gap:7},filterTile:{flex:1,minWidth:0,borderWidth:1,borderColor:c.border,borderRadius:12,padding:10,gap:5,backgroundColor:c.surface},
  filterLabel:{fontFamily:fontFamilies.semiBold,color:c.text,fontSize:13},actions:{flexDirection:'row',gap:8,flexWrap:'wrap'},pill:{flexDirection:'row',alignItems:'center',gap:6,borderWidth:1,borderColor:c.border,borderRadius:20,paddingHorizontal:12,paddingVertical:9,backgroundColor:c.surface},
  section:{fontFamily:fontFamilies.bold,fontSize:19,color:c.text},grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',rowGap:12},
  tile:{width:'48%',borderWidth:1,borderColor:c.border,borderRadius:16,padding:14,gap:10,backgroundColor:c.surface,minHeight:132},activeTile:{borderColor:c.accent,backgroundColor:c.accentSoft??c.surface},
  tileIcon:{width:42,height:42,borderRadius:12,backgroundColor:c.surfaceElevated??c.background,alignItems:'center',justifyContent:'center'},
  tileTitle:{fontFamily:fontFamilies.bold,fontSize:16,color:c.text},tileFooter:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:4,marginTop:'auto'},
  muted:{fontFamily:fontFamilies.medium,fontSize:12,lineHeight:17,color:c.textSecondary},browse:{flexDirection:'row',alignItems:'center',gap:12,padding:14,borderWidth:1,borderColor:c.border,borderRadius:16,backgroundColor:c.surface},
  equipmentScope:{flexDirection:'row',alignItems:'center',gap:7},
  notice:{gap:8,padding:12,borderWidth:1,borderColor:c.border,borderRadius:12},
  row:{flexDirection:'row',alignItems:'center',gap:10,padding:12,borderWidth:1,borderColor:c.border,borderRadius:14,backgroundColor:c.surface},
  rowTitle:{fontFamily:fontFamilies.semiBold,fontSize:16,color:c.text,flexShrink:1},thumb:{width:56,height:56,borderRadius:10,overflow:'hidden',backgroundColor:c.surfaceElevated??c.background,alignItems:'center',justifyContent:'center'},
  warning:{fontFamily:fontFamilies.medium,fontSize:12,color:c.error},recommended:{fontFamily:fontFamilies.semiBold,fontSize:12,color:c.accent},
  footer:{width:'100%',maxWidth:820,alignSelf:'center',paddingHorizontal:20,paddingTop:10,paddingBottom:14,gap:8,borderTopWidth:1,borderColor:c.border,backgroundColor:c.background},
  done:{borderRadius:14,padding:15,alignItems:'center',backgroundColor:c.accent},doneText:{fontFamily:fontFamilies.bold,color:c.textOnAccent,fontSize:15},
});}
