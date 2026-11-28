import ExerciseName from '../components/exercises/ExerciseName';
import { exerciseSearchMatches } from '../utils/exerciseNames';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import ExerciseArtwork from '../components/exercises/ExerciseArtwork';
import { StatusBar } from 'expo-status-bar';
import { fontFamilies } from '../constants/typography';
import ExerciseDetail from '../components/exercises/ExerciseDetail';
import { exerciseRegionLabel, exerciseMovementLabel } from '../utils/exerciseCatalogue';
import { pickerZones, pickerTypes, filterPickerRows, pickerEquipmentMatches, pickerEquipmentOptions, pickerAddableEquipment } from '../utils/composerPickerPresentation';

// UGEROD category illustrations, not individual exercise demonstrations.
const ZONE_PHOTOS = {
  '':require('../../assets/picker-zones/all.webp'),
  Upper:require('../../assets/picker-zones/upper.webp'),
  Lower:require('../../assets/picker-zones/lower.webp'),
  Back:require('../../assets/picker-zones/back.webp'),
  Core:require('../../assets/picker-zones/core.webp'),
  'Full Body':require('../../assets/picker-zones/full.webp'),
};

export default function ComposerExercisePickerPage({colors,isDark,brandIcon,blockLabel,rows,equipmentIds=[],referenceEquipment=[],equipmentSummary,selectedRows,selectedIds,favoriteIds,capacity,replacementId,onReplacement,loading,error,onRetry,onSelect,onClose,onAddEquipment,unrestricted=false,inlineFilters=false,fixedType='',selectLabel='Ajouter à la séance'}) {
  const [zone,setZone]=useState(''),[type,setType]=useState(''),[equipment,setEquipment]=useState(''),[search,setSearch]=useState('');
  const [favoritesOnly,setFavoritesOnly]=useState(false),[view,setView]=useState('hub'),[limit,setLimit]=useState(40);
  const [pendingEquipment,setPendingEquipment]=useState([]);
  const [detailId,setDetailId]=useState(null);
  const [inlineFacet,setInlineFacet]=useState('');
  const styles=createStyles(colors);
  const available=rows.filter(row=>(unrestricted||pickerEquipmentMatches(row,equipmentIds))&&(unrestricted||!selectedIds.includes(row.id)));
  const equipmentOptions=pickerEquipmentOptions(equipmentIds,referenceEquipment);
  const addableEquipment=pickerAddableEquipment(referenceEquipment,equipmentIds);
  const addingEquipment=view==='add-equipment';
  function openAddEquipment(){setPendingEquipment([]);setView('add-equipment');}
  function confirmEquipment(){onAddEquipment(pendingEquipment);setPendingEquipment([]);setEquipment('');setView('equipment');setLimit(40);}
  const filters={zone,type:fixedType||type,equipment,search,favoritesOnly};
  const filtered=filterPickerRows(available,filters,favoriteIds,exerciseSearchMatches);
  const selectedZone=pickerZones.find(z=>z.key===zone),selectedType=pickerTypes.find(t=>t.key===type),selectedEquipment=equipmentOptions.find(e=>e.key===equipment);
  const atCapacity=selectedIds.length>=capacity;
  const canSelect=!atCapacity||Boolean(replacementId);
  const detailIndex=filtered.findIndex(row=>row.id===detailId);
  const detailExercise=detailIndex>=0?filtered[detailIndex]:null;
  function selectFromDetail(){if(!detailExercise||!canSelect)return;setDetailId(null);onSelect(detailExercise);}
  const listVisible=inlineFilters||view==='results'||Boolean(search.trim())||favoritesOnly;
  function results(){setView('results');setLimit(40);}
  function back(){if(addingEquipment){setPendingEquipment([]);setView('equipment');return;}if(inlineFilters){onClose();return;}if(view==='zone'||view==='type'||view==='equipment'||listVisible){setView('hub');setSearch('');setFavoritesOnly(false);}else onClose();}
  function categoryCard(item,count,onPress,active=false){return <Pressable key={item.key} accessibilityRole="button" onPress={onPress}
      style={[styles.tile,active&&styles.activeTile]}>
      <View style={styles.tileIcon}><Ionicons name={item.icon} size={24} color={colors.accent}/></View>
      <Text style={styles.tileTitle}>{item.label}</Text><View style={styles.tileFooter}><Text style={styles.muted}>{count} exercice{count!==1?'s':''}</Text>
      <Ionicons name={active?'checkmark-circle':'chevron-forward'} color={colors.accent} size={18}/></View>
    </Pressable>;}
  const choosingCategory=['zone','type','equipment'].includes(view);
  const facetOptions=view==='zone'?pickerZones:view==='type'?pickerTypes:equipmentOptions;
  const activeFacet=view==='zone'?zone:view==='type'?type:equipment;
  const facetCount=key=>filterPickerRows(available,{...filters,[view]:key},favoriteIds,exerciseSearchMatches).length;
  function chooseFacet(key){if(view==='zone')setZone(key);else if(view==='type')setType(key);else setEquipment(key);results();}
  function clearFilters(){setZone('');setType('');setEquipment('');setFavoritesOnly(false);setSearch('');setLimit(40);setInlineFacet('');}
  return <SafeAreaView style={styles.screen}>
    <StatusBar style={isDark?'light':'dark'}/>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={back} style={styles.iconButton}><Ionicons name="arrow-back" size={21} color={colors.text}/></Pressable>
        <View style={{flex:1}}><Text style={styles.kicker}>{blockLabel.toUpperCase()}</Text><Text style={styles.title}>{inlineFilters?'Choisir les exercices':'Choisir les exercices.'}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={22} color={colors.text}/></Pressable>
      </View>
      {!unrestricted?<View style={styles.equipmentScope}><Ionicons name="checkmark-circle-outline" size={17} color={colors.accent}/><Text style={[styles.muted,{flex:1}]}>Matériel de la séance : {equipmentSummary && equipmentSummary !== 'Poids du corps' ? 'Poids du corps · '+equipmentSummary : 'Poids du corps'}</Text></View>:null}
      {replacementId?<ExerciseName prefix="Remplacer : " exercise={selectedRows.find(row=>row.id===replacementId)??replacementId} fallback="mouvement sélectionné" style={styles.muted}/>:null}
      {atCapacity&&!replacementId?<View style={styles.notice}><Text style={styles.tileTitle}>Bloc complet</Text><Text style={styles.muted}>Choisis le mouvement à remplacer.</Text>
        {selectedRows.map(row=><Pressable key={row.id} onPress={()=>onReplacement(row.id)} style={styles.row}><ExerciseName exercise={row} style={styles.rowTitle}/><Ionicons name="swap-horizontal-outline" size={20} color={colors.accent}/></Pressable>)}</View>:null}
      {!choosingCategory&&!addingEquipment?<><View style={styles.search}><Ionicons name="search-outline" size={20} color={colors.textSecondary}/><TextInput value={search} onChangeText={v=>{setSearch(v);setLimit(40);if(v.trim())setView('results');}} placeholder="Rechercher un exercice" placeholderTextColor={colors.textMuted} accessibilityLabel="Rechercher un exercice" autoCorrect={false} style={styles.searchInput}/>{search?<Pressable accessibilityLabel="Effacer la recherche" onPress={()=>setSearch('')}><Ionicons name="close-circle" color={colors.textSecondary} size={20}/></Pressable>:null}</View>
      {inlineFilters?<>
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.photoStrip}>
          {[{key:'',label:'Tous'},...pickerZones].map(item=>{
            const active=zone===item.key;
            return <Pressable key={item.key||'all'} accessibilityRole="radio" accessibilityState={{checked:active}} accessibilityLabel={item.label} onPress={()=>{setZone(item.key);setLimit(40);}} style={[styles.photoCard,active&&styles.photoCardActive]}>
              <ExpoImage source={ZONE_PHOTOS[item.key]} contentFit="cover" style={styles.photoImage} accessible={false}/>
              <View style={styles.photoLabel}><Text style={styles.photoText}>{item.label}</Text>{active?<Ionicons name="checkmark" size={14} color={colors.textOnAccent} accessible={false}/>:null}</View>
            </Pressable>;
          })}
        </ScrollView>
        <View style={styles.actions}>
          {!fixedType?<Pressable accessibilityRole="button" accessibilityState={{expanded:inlineFacet==='type'}} onPress={()=>setInlineFacet(v=>v==='type'?'':'type')} style={[styles.pill,type&&styles.activeTile]}><Ionicons name="fitness-outline" size={17} color={colors.accent}/><Text style={styles.filterLabel}>{selectedType?.label??'Type'}</Text><Ionicons name={inlineFacet==='type'?'chevron-up':'chevron-down'} size={14} color={colors.textMuted}/></Pressable>:null}
          <Pressable accessibilityRole="button" accessibilityState={{expanded:inlineFacet==='equipment'}} onPress={()=>setInlineFacet(v=>v==='equipment'?'':'equipment')} style={[styles.pill,equipment&&styles.activeTile]}><Ionicons name="options-outline" size={17} color={colors.accent}/><Text style={styles.filterLabel}>{selectedEquipment?.label??'Matériel'}</Text><Ionicons name={inlineFacet==='equipment'?'chevron-up':'chevron-down'} size={14} color={colors.textMuted}/></Pressable>
          <Pressable accessibilityRole="checkbox" accessibilityState={{checked:favoritesOnly}} onPress={()=>{setFavoritesOnly(v=>!v);setLimit(40);}} style={[styles.pill,favoritesOnly&&styles.activeTile]}><Ionicons name={favoritesOnly?'heart':'heart-outline'} size={17} color={colors.secondaryAccent}/><Text style={styles.filterLabel}>Favoris</Text></Pressable>
          {(zone||type||equipment||favoritesOnly||search)?<Pressable accessibilityRole="button" onPress={clearFilters} style={styles.pill}><Text style={styles.filterLabel}>Réinitialiser</Text></Pressable>:null}
        </View>
        {inlineFacet==='equipment'||(inlineFacet==='type'&&!fixedType)?<ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.photoStrip}>
          {[{key:'',label:'Tous'},...(inlineFacet==='equipment'?equipmentOptions:pickerTypes)].map(item=>{
            const active=(inlineFacet==='equipment'?equipment:type)===item.key;
            return <Pressable key={item.key||'all'} accessibilityRole="radio" accessibilityState={{checked:active}} onPress={()=>{if(inlineFacet==='equipment')setEquipment(item.key);else setType(item.key);setLimit(40);setInlineFacet('');}} style={[styles.pill,active&&styles.inlinePillActive]}><Text style={[styles.filterLabel,active&&styles.inlinePillText]}>{item.label}</Text></Pressable>;
          })}
        </ScrollView>:null}
      </>:<><View style={styles.filterRow}>
        <Pressable accessibilityRole="button" onPress={()=>setView('zone')} style={styles.filterTile}><Ionicons name="body-outline" size={20} color={colors.accent}/><Text style={styles.filterLabel}>Zone du corps</Text><Text style={styles.muted}>{selectedZone?.label??'Toutes'}</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted}/></Pressable>
        <Pressable accessibilityRole="button" onPress={()=>setView('type')} style={styles.filterTile}><Ionicons name="fitness-outline" size={20} color={colors.accent}/><Text style={styles.filterLabel}>Type d’entraînement</Text><Text style={styles.muted}>{selectedType?.label??'Tous'}</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted}/></Pressable>
        <Pressable accessibilityRole="button" onPress={()=>setView('equipment')} style={styles.filterTile}><Ionicons name="barbell-outline" size={20} color={colors.accent}/><Text style={styles.filterLabel}>Matériel</Text><Text style={styles.muted}>{selectedEquipment?.label??'Tous'}</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted}/></Pressable>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={()=>{setFavoritesOnly(!favoritesOnly);results();}} style={[styles.pill,favoritesOnly&&styles.activeTile]}><Ionicons name={favoritesOnly?'heart':'heart-outline'} size={17} color={colors.accent}/><Text style={styles.filterLabel}>Mes favoris</Text></Pressable>
        {(zone||type||equipment||favoritesOnly||search)?<Pressable accessibilityRole="button" onPress={()=>{clearFilters();setView('hub');}} style={styles.pill}><Text style={styles.filterLabel}>Réinitialiser</Text></Pressable>:null}
      </View></>}</>:null}
      {loading?<View style={styles.notice}><ActivityIndicator color={colors.accent}/><Text style={styles.muted}>Chargement du catalogue…</Text></View>:null}
      {error?<Pressable onPress={onRetry} style={styles.notice}><Text style={styles.tileTitle}>Catalogue indisponible · Réessayer</Text></Pressable>:null}
      {addingEquipment?<>
        <Text style={styles.section}>Ajouter du matériel</Text>
        <Text style={styles.muted}>Ajoute à cette séance des équipements disponibles dans ton matériel pour ce lieu. Tes mouvements restent conservés.</Text>
        {!addableEquipment.length?<Text style={styles.muted}>Tout ton matériel enregistré pour ce lieu est déjà sélectionné. Pour ajouter un nouvel équipement à ton inventaire, utilise la rubrique Mon matériel du profil.</Text>:null}
        {addableEquipment.map(item=>{const id=String(item.id),checked=pendingEquipment.includes(id);return <Pressable key={id} accessibilityRole="checkbox" accessibilityState={{checked}} onPress={()=>setPendingEquipment(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id])} style={[styles.row,checked&&styles.activeTile]}>
          <Ionicons name="barbell-outline" size={21} color={colors.accent}/><View style={{flex:1}}><Text style={styles.rowTitle}>{item.name}</Text>{item.detail?<Text style={styles.muted}>{item.detail}</Text>:null}</View><Ionicons name={checked?'checkmark-circle':'ellipse-outline'} size={23} color={colors.accent}/></Pressable>;})}
      </>:choosingCategory?<><Text style={styles.section}>{view==='zone'?'Zones du corps':view==='type'?'Types d’entraînement':'Matériel'}</Text><View style={styles.grid}>
        {categoryCard({key:'',label:view==='equipment'?(unrestricted?'Tout le matériel':'Tout mon matériel'):'Tous les exercices',icon:'grid-outline'},facetCount(''),()=>chooseFacet(''),!activeFacet)}
        {facetOptions.map(item=>categoryCard(item,facetCount(item.key),()=>chooseFacet(item.key),activeFacet===item.key))}
      </View>{view==='equipment'&&onAddEquipment?<Pressable accessibilityRole="button" onPress={openAddEquipment} style={styles.browse}><Ionicons name="add-circle-outline" size={23} color={colors.accent}/><View style={{flex:1}}><Text style={styles.filterLabel}>Ajouter du matériel</Text><Text style={styles.muted}>Modifier le matériel de cette séance</Text></View><Ionicons name="chevron-forward" size={18} color={colors.accent}/></Pressable>:null}</>:!listVisible?<Pressable accessibilityRole="button" style={styles.browse} onPress={()=>{clearFilters();results();}}><View style={styles.tileIcon}><Ionicons name="grid-outline" size={24} color={colors.accent}/></View><View style={{flex:1}}><Text style={styles.tileTitle}>Tous les exercices</Text><Text style={styles.muted}>{available.length} exercices{unrestricted?' disponibles':' compatibles avec ton matériel'}</Text></View><Ionicons name="chevron-forward" color={colors.accent} size={20}/></Pressable>:<>
        <Text style={styles.section}>{inlineFilters&&selectedZone?selectedZone.label+' · ':''}{filtered.length} exercice{filtered.length!==1?'s':''}</Text>
        {!filtered.length&&!loading?<Text style={styles.muted}>{unrestricted?'Aucun exercice trouvé. Modifie tes filtres ou ta recherche.':'Aucun exercice compatible. Modifie tes filtres, ta recherche ou le matériel de la séance.'}</Text>:null}
        {filtered.slice(0,limit).map(row=><View key={row.id} style={inlineFilters?styles.inlineRow:styles.row}>
          <Pressable accessibilityRole="button" accessibilityLabel={'Détails de '+row.name} onPress={()=>setDetailId(row.id)} style={styles.exerciseInfo}>
          {inlineFilters?<ExerciseArtwork imagePath={row.imagePath} colors={colors} size={56}/>:<View style={styles.thumb}>{/^https?:\/\//i.test(String(row.imagePath??''))?<Image source={{uri:row.imagePath}} style={{width:'100%',height:'100%'}} resizeMode="cover"/>:<Ionicons name="barbell-outline" size={23} color={colors.textSecondary}/>}</View>}
          <View style={{flex:1,gap:3}}><ExerciseName exercise={row} style={styles.rowTitle}/><Text style={styles.muted}>{[exerciseRegionLabel(row.bodyRegion),exerciseMovementLabel(row.movementPattern)].filter(Boolean).join(' · ')}</Text>
          <Text style={styles.muted}>{(row.equipmentNames??[]).join(' · ')||'Poids du corps'}</Text>
          {row.missingEquipment?.length?<Text style={styles.warning}>Matériel manquant : {row.missingEquipment.join(' · ')}</Text>:null}
          {row.recommended?<Text style={styles.recommended}>Recommandé</Text>:null}</View><Ionicons name="chevron-forward" size={15} color={colors.textMuted}/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={(replacementId?'Choisir ':'Ajouter ')+row.name} accessibilityState={{disabled:!canSelect}} disabled={!canSelect} onPress={()=>onSelect(row)} style={[styles.quickAdd,inlineFilters&&styles.inlineAdd,!canSelect&&{opacity:.4}]}><Ionicons name={inlineFilters?'add-outline':'add-circle-outline'} size={inlineFilters?24:27} color={inlineFilters?colors.textOnAccent:colors.accent}/></Pressable></View>)}
        {filtered.length>limit?<Pressable style={styles.browse} onPress={()=>setLimit(v=>v+40)}><Text style={styles.filterLabel}>Afficher plus d’exercices</Text><Ionicons name="chevron-down" size={18} color={colors.accent}/></Pressable>:null}
      </>}
    </ScrollView>
    {detailExercise?<ExerciseDetail key={detailExercise.id} exercise={detailExercise} colors={colors} isDark={isDark} brandIcon={brandIcon}
      index={detailIndex} count={filtered.length} onClose={()=>setDetailId(null)} closeLabel="Retour aux exercices"
      onSelect={selectFromDetail} selectLabel={replacementId?'Choisir ce remplacement':selectLabel} selectDisabled={!canSelect}
      selectHint={!canSelect?'Bloc complet : choisis d’abord un mouvement à remplacer.':null}
      onPrevious={detailIndex>0?()=>setDetailId(filtered[detailIndex-1].id):null}
      onNext={detailIndex<filtered.length-1?()=>setDetailId(filtered[detailIndex+1].id):null}/>:null}
    <View style={styles.footer}>{addingEquipment?<Pressable accessibilityRole="button" disabled={!pendingEquipment.length} onPress={confirmEquipment} style={[styles.done,!pendingEquipment.length&&{opacity:.45}]}><Text style={styles.doneText}>Ajouter {pendingEquipment.length||''} équipement{pendingEquipment.length>1?'s':''}</Text></Pressable>:<><Text style={styles.muted}>{selectedIds.length} mouvement{selectedIds.length!==1?'s':''} retenu{selectedIds.length!==1?'s':''}</Text><Pressable accessibilityRole="button" onPress={onClose} style={styles.done}><Text style={styles.doneText}>Terminé</Text></Pressable></>}</View>
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
  photoStrip:{gap:8,paddingVertical:2},photoCard:{width:116,borderRadius:12,borderWidth:2,borderColor:c.border,overflow:'hidden',backgroundColor:c.accent},photoCardActive:{borderColor:c.secondaryAccent},photoImage:{height:72,width:'100%'},photoLabel:{minHeight:36,paddingHorizontal:7,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:3},photoText:{flex:1,fontFamily:fontFamilies.semiBold,fontSize:12,lineHeight:15,color:c.textOnAccent},inlinePillActive:{backgroundColor:c.accent,borderColor:c.accent},inlinePillText:{color:c.textOnAccent},
  inlineRow:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:c.border},inlineAdd:{backgroundColor:c.accent,borderRadius:10},
  section:{fontFamily:fontFamilies.bold,fontSize:19,color:c.text},grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',rowGap:12},
  tile:{width:'48%',borderWidth:1,borderColor:c.border,borderRadius:16,padding:14,gap:10,backgroundColor:c.surface,minHeight:132},activeTile:{borderColor:c.accent,backgroundColor:c.accentSoft??c.surface},
  tileIcon:{width:42,height:42,borderRadius:12,backgroundColor:c.surfaceElevated??c.background,alignItems:'center',justifyContent:'center'},
  tileTitle:{fontFamily:fontFamilies.bold,fontSize:16,color:c.text},tileFooter:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:4,marginTop:'auto'},
  muted:{fontFamily:fontFamilies.medium,fontSize:12,lineHeight:17,color:c.textSecondary},browse:{flexDirection:'row',alignItems:'center',gap:12,padding:14,borderWidth:1,borderColor:c.border,borderRadius:16,backgroundColor:c.surface},
  equipmentScope:{flexDirection:'row',alignItems:'center',gap:7},
  notice:{gap:8,padding:12,borderWidth:1,borderColor:c.border,borderRadius:12},
  row:{flexDirection:'row',alignItems:'center',gap:10,padding:12,borderWidth:1,borderColor:c.border,borderRadius:14,backgroundColor:c.surface},
  exerciseInfo:{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:10},quickAdd:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  rowTitle:{fontFamily:fontFamilies.semiBold,fontSize:16,color:c.text,flexShrink:1},thumb:{width:56,height:56,borderRadius:10,overflow:'hidden',backgroundColor:c.surfaceElevated??c.background,alignItems:'center',justifyContent:'center'},
  warning:{fontFamily:fontFamilies.medium,fontSize:12,color:c.error},recommended:{fontFamily:fontFamilies.semiBold,fontSize:12,color:c.accent},
  footer:{width:'100%',maxWidth:820,alignSelf:'center',paddingHorizontal:20,paddingTop:10,paddingBottom:14,gap:8,borderTopWidth:1,borderColor:c.border,backgroundColor:c.background},
  done:{borderRadius:14,padding:15,alignItems:'center',backgroundColor:c.accent},doneText:{fontFamily:fontFamilies.bold,color:c.textOnAccent,fontSize:15},
});}
