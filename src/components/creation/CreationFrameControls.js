import {useMemo,useRef} from 'react';
import {View,Text,Pressable,PanResponder,StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {Image as ExpoImage} from 'expo-image';
import {fontFamilies} from '../../constants/typography';
import {frameDurationStep,frameDurationDrag} from '../../utils/composerFrame';
export function composerDurationColor(value,colors){return [20, 30].includes(value) ? colors.accent : [75, 90].includes(value) ? colors.secondaryAccent : colors.text;}
export function DurationControl({value,onChange,colors,durations,accessibilityLabel='Durée de la séance',showTitle=true,colorForValue}) {
  const styles=frameStyles(colors);
  const currentRef = useRef(value);
  const originRef = useRef(value);
  const onChangeRef = useRef(onChange);
  currentRef.current = value;
  onChangeRef.current = onChange;
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: () => { originRef.current = currentRef.current; },
    onPanResponderMove: (_, gesture) => onChangeRef.current(frameDurationDrag(durations, originRef.current, gesture.dx)),
    onPanResponderRelease: (_, gesture) => onChangeRef.current(frameDurationDrag(durations, originRef.current, gesture.dx)),
    onPanResponderTerminationRequest: () => true,
  }), []);
  const previous = frameDurationStep(durations, value, -1);
  const next = frameDurationStep(durations, value, 1);
  const durationColor = colorForValue ? colorForValue(value,colors) : composerDurationColor(value,colors);
  return <View style={styles.frameDuration}>
    {showTitle?<Text style={styles.frameSectionTitle}>Durée</Text>:null}
    <View {...pan.panHandlers} style={styles.frameDial}
      accessibilityRole="adjustable" accessible accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: durations[0], max: durations[durations.length-1], now: value, text: value + ' minutes' }}
      accessibilityActions={[{name:'increment',label:'Augmenter'},{name:'decrement',label:'Diminuer'}]}
      onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'increment') onChange(next); else if (event.nativeEvent.actionName === 'decrement') onChange(previous); }}>
      <View style={styles.frameDialNumbers} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={styles.frameDialSide}>{previous === value ? ' ' : previous}</Text>
        <Text style={[styles.frameDialValue, { color: durationColor }]}>{value}</Text>
        <Text style={styles.frameDialSide}>{next === value ? ' ' : next}</Text>
      </View>
      <View style={styles.frameDialTicks} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {Array.from({length:33}, (_,index) => <View key={index} style={[styles.frameDialTick, index % 4 === 0 && styles.frameDialTickLong, index === 16 && styles.frameDialTickCurrent]} />)}
      </View>
    </View>
    <View style={styles.frameDialControls}>
      <Pressable accessibilityRole="button" accessibilityLabel="Diminuer la durée" accessibilityState={{disabled:previous===value}} disabled={previous===value}
        onPress={() => onChange(previous)} style={[styles.frameDialButton, previous===value && styles.disabled]}>
        <Ionicons name="remove" size={21} color={colors.text}/>
      </Pressable>
      <Text style={styles.frameDialUnit}>Minutes</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Augmenter la durée" accessibilityState={{disabled:next===value}} disabled={next===value}
        onPress={() => onChange(next)} style={[styles.frameDialButton, next===value && styles.disabled]}>
        <Ionicons name="add" size={21} color={colors.text}/>
      </Pressable>
    </View>
  </View>;
}

export function PhotoChoiceGrid({items,photos,value,onChange,colors,disabled=false,reselect=false}){
 const styles=frameStyles(colors);
 return <View style={styles.environmentGrid}>{items.map(item=>{
  const selected=value===item.code;
  return <Pressable key={item.code} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{selected,disabled}} disabled={disabled}
   onPress={()=>{if(!selected||reselect)onChange(item.code);}} style={({pressed})=>[styles.frameEnvironment,selected&&styles.frameEnvironmentSelected,pressed&&!disabled&&styles.pressed]}>
    <View style={styles.framePhoto}><ExpoImage source={photos[item.code]} style={styles.framePhotoImage} contentFit="cover" accessible={false}/></View>
    <View style={[styles.frameEnvironmentLabelRow,selected&&styles.frameEnvironmentLabelRowSelected]}><Text style={[styles.frameEnvironmentLabel,selected&&styles.frameEnvironmentLabelSelected]}>{item.label}</Text>{selected?<View style={styles.frameSelectedDot}/>:null}</View>
  </Pressable>;
 })}</View>;
}
function frameStyles(colors){return StyleSheet.create({
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.42 },
    frameSectionTitle:{fontFamily:fontFamilies.display,fontSize:23,lineHeight:26,color:colors.text},
    frameDuration:{gap:2},
    frameDial:{alignSelf:'center',width:'100%',maxWidth:390,paddingHorizontal:6},
    frameDialNumbers:{minHeight:76,flexDirection:'row',alignItems:'center',justifyContent:'center'},
    frameDialValue:{fontFamily:fontFamilies.display,fontSize:76,lineHeight:81,color:colors.text,textAlign:'center',minWidth:100},
    frameDialSide:{flex:1,fontFamily:fontFamilies.display,fontSize:34,lineHeight:39,color:colors.textMuted,textAlign:'center'},
    frameDialTicks:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',height:24,paddingHorizontal:7},
    frameDialTick:{width:1,height:8,backgroundColor:colors.borderStrong},
    frameDialTickLong:{height:15},
    frameDialTickCurrent:{height:22,width:3,backgroundColor:colors.secondaryAccent,borderRadius:2},
    frameDialControls:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:18,marginTop:3},
    frameDialButton:{width:44,height:44,borderRadius:22,borderWidth:1,borderColor:colors.border,alignItems:'center',justifyContent:'center'},
    frameDialUnit:{fontFamily:fontFamilies.medium,fontSize:12,color:colors.textSecondary,minWidth:66,textAlign:'center'},
    frameEnvironment:{width:'48%',flexGrow:1,overflow:'hidden',borderRadius:12,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
    frameEnvironmentSelected:{borderColor:colors.accent},
    framePhoto:{width:'100%',aspectRatio:16/9,backgroundColor:colors.surfaceElevated??colors.surface},
    framePhotoImage:{width:'100%',height:'100%'},
    frameEnvironmentLabelRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:40,paddingHorizontal:12},
    frameEnvironmentLabelRowSelected:{backgroundColor:colors.accent},
    frameEnvironmentLabel:{fontFamily:fontFamilies.semiBold,fontSize:15,lineHeight:20,color:colors.text},
    frameEnvironmentLabelSelected:{color:colors.textOnAccent},
    frameSelectedDot:{width:8,height:8,borderRadius:4,backgroundColor:colors.secondaryAccent},
    environmentGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 10 },
});}
