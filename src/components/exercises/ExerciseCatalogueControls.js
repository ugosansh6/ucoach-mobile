import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { fontFamilies } from '../../constants/typography';
import { exerciseRegionLabel, exerciseMovementLabel, exerciseFocusLabel } from '../../utils/exerciseCatalogue';
export default function ExerciseCatalogueControls({ rows, filters, onChange, colors }) {
  return <View style={{ gap:12 }}>{[
    ['Zone','region','bodyRegion',exerciseRegionLabel],['Famille','family','movementPattern',exerciseMovementLabel],['Objectif','focus','trainingFocus',exerciseFocusLabel],
  ].map(([label,key,field,display])=><View key={key} style={{gap:6}}><Text style={{color:colors.textSecondary,fontFamily:fontFamilies.medium}}>{label}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>
      {['',...new Set(rows.map(e=>e[field]).filter(Boolean))].map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:(filters[key]??'')===value}} onPress={()=>onChange({...filters,[key]:value})} style={{borderRadius:18,paddingVertical:9,paddingHorizontal:13,backgroundColor:filters[key]===value?colors.accent:colors.surface,borderWidth:1,borderColor:colors.border}}><Text style={{color:filters[key]===value?colors.textOnAccent:colors.text,fontFamily:fontFamilies.medium}}>{value?display(value):'Tous'}</Text></Pressable>)}
    </ScrollView></View>)}</View>;
}
