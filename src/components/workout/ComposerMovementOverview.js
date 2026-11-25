import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fontFamilies } from '../../constants/typography';

function orientationLabel(intent) {
  if (['TECHNIQUE', 'COACH_TECHNIQUE'].includes(intent?.key)) return 'Technique';
  const focus = String(intent?.focus ?? '').replace(/\s/g, '').toLowerCase();
  return { strength:'Force', conditioning:'Conditionnement', musclegain:'Muscle', fatloss:'Perte de poids', generalfitness:'Forme' }[focus]
    || String(intent?.label ?? 'Séance').split('·')[0].trim();
}
const envIcon = value => ({Maison:'home-outline',Box:'fitness-outline',Salle:'barbell-outline',Extérieur:'leaf-outline'}[value] ?? 'location-outline');

export default function ComposerMovementOverview({ minutes, environment, intent, regions=[], technicalTarget, colors }) {
  const styles=makeStyles(colors);
  const cards=[
    {key:'duration',icon:'time-outline',value:`${minutes} min`,label:`Durée totale : ${minutes} minutes`},
    {key:'environment',icon:envIcon(environment),value:environment,label:`Lieu : ${environment}`},
    {key:'orientation',icon:intent?.focus==='Strength'?'barbell-outline':intent?.focus==='Conditioning'?'pulse-outline':'locate-outline',value:orientationLabel(intent),label:`Orientation : ${orientationLabel(intent)}`},
  ];
  return <View style={styles.overview} testID="movement-overview">
    <View style={styles.summaryRow}>{cards.map(card=><View key={card.key} accessible accessibilityLabel={card.label}
      testID={`movement-summary-${card.key}`} style={styles.summaryCard}>
      <Ionicons name={card.icon} size={16} color={colors.accent} accessible={false}/>
      <Text style={styles.summaryValue}>{card.value}</Text>
    </View>)}</View>
    {regions.length?<Text style={styles.regionsValue} accessibilityLabel={`Zones de travail : ${regions.join(', ')}`} testID="movement-summary-regions">{regions.join(' · ')}</Text>:null}
    {technicalTarget?<Text style={styles.targetText}>{technicalTarget}</Text>:null}
  </View>;
}
export function ComposerMovementTabs({ blocks, selectedIndex, onSelect, colors }) {
  const styles=makeStyles(colors);
  if(blocks.length===1) return <View style={styles.singleBlock} accessibilityLabel={`${blocks[0].label}, ${blocks[0].minutes} minutes`}>
    <Text style={styles.tabName}>{blocks[0].label}</Text><Text style={styles.tabMinutes}>{blocks[0].minutes} min</Text>
  </View>;
  return <View accessibilityRole="tablist" accessibilityLabel="Blocs de la séance" style={styles.tabs}>
    {blocks.map((block,index)=><Pressable key={`${block.type}-${index}`} accessibilityRole="tab" accessibilityState={{selected:index===selectedIndex}}
      aria-selected={index===selectedIndex} accessibilityLabel={`${block.label}, ${block.minutes} minutes`} onPress={()=>onSelect(index)}
      style={({pressed})=>[styles.tab,index===selectedIndex&&styles.tabSelected,pressed&&styles.pressed]}>
      <Text style={[styles.tabName,index===selectedIndex&&styles.tabTextSelected]}>{block.label}</Text>
      <Text style={styles.tabMinutes}>{block.minutes} min</Text>
    </Pressable>)}
  </View>;
}
function makeStyles(c){return StyleSheet.create({
  overview:{marginTop:10,gap:7,paddingBottom:12,borderBottomWidth:1,borderBottomColor:c.border},
  summaryRow:{flexDirection:'row',flexWrap:'wrap',columnGap:16,rowGap:8},
  summaryCard:{flexDirection:'row',alignItems:'center',gap:5,minWidth:0},
  summaryValue:{fontFamily:fontFamilies.semiBold,fontSize:13,lineHeight:18,color:c.text},
  regionsValue:{fontFamily:fontFamilies.medium,fontSize:12,lineHeight:17,color:c.textSecondary},
  targetText:{fontFamily:fontFamilies.medium,fontSize:12,lineHeight:17,color:c.accent},
  singleBlock:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:8},
  tabs:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:10},
  tab:{flexGrow:1,flexBasis:0,minWidth:95,minHeight:46,paddingHorizontal:9,paddingVertical:7,borderBottomWidth:2,borderBottomColor:c.border,gap:2,justifyContent:'center'},
  tabSelected:{borderBottomColor:c.accent,backgroundColor:c.accentSoft??c.surface},
  tabName:{fontFamily:fontFamilies.bold,fontSize:15,lineHeight:19,color:c.text},
  tabMinutes:{fontFamily:fontFamilies.medium,fontSize:12,lineHeight:17,color:c.textSecondary},
  tabTextSelected:{color:c.accent},pressed:{opacity:.75},
});}
