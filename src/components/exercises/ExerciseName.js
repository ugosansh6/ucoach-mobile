import { View,Text,StyleSheet } from 'react-native';
import { useExerciseNamePreference } from '../../contexts/ExerciseNameContext';
import { useUgerodTheme } from '../../contexts/UgerodThemeContext';
import { fontFamilies } from '../../constants/typography';
import { resolveExerciseNames } from '../../utils/exerciseNames';

const layoutKeys=['flex','flexGrow','flexShrink','flexBasis','alignSelf','width','minWidth','maxWidth','margin','marginTop','marginBottom','marginLeft','marginRight','marginHorizontal','marginVertical','marginStart','marginEnd'];
// Standalone name block: two text nodes, no inserted gap or margin.
// No truncation of meaningful exercise variants; free-text names remain untouched.
export default function ExerciseName({exercise,fallback,style,detail=false,prefix='',accessibilityRole,testID}) {
  const {mode}=useExerciseNamePreference();
  const {colors}=useUgerodTheme();
  const {primary,secondary}=resolveExerciseNames(exercise,mode,{fallback,detail});
  const flat=StyleSheet.flatten(style)??{};
  const layout={},title={...flat};
  layoutKeys.forEach(k=>{if(k in title){layout[k]=title[k];delete title[k];}});
  const size=Number(title.fontSize)||15;
  const secondarySize=Math.max(11,Math.min(16,Math.round(size*.76)));
  return <View style={[{minWidth:0,flexShrink:1,gap:0},layout]} testID={testID}>
    <Text accessibilityRole={accessibilityRole} style={[title,{fontFamily:fontFamilies.semiBold,fontWeight:'normal',fontSize:size,lineHeight:Math.ceil(size*1.25),textTransform:'none',margin:0,padding:0,includeFontPadding:false,color:title.color??colors.text}]}>{prefix}{primary}</Text>
    {secondary?<Text style={{fontFamily:fontFamilies.regular,fontSize:secondarySize,lineHeight:Math.ceil(secondarySize*1.2),color:title.color??colors.text,opacity:.76,textAlign:title.textAlign,margin:0,padding:0,includeFontPadding:false}}>{secondary}</Text>:null}
  </View>;
}
