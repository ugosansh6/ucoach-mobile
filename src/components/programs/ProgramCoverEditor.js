import {useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {fontFamilies} from '../../constants/typography';
import {PROGRAM_COVER_PRESETS} from '../../utils/programCovers';
import ProgramCover from './ProgramCover';
import ProgramPhotoPicker from './ProgramPhotoPicker';

export default function ProgramCoverEditor({cover,onChange,onBusyChange,colors:c,disabled=false,fallback='strength'}){
 const [processing,setProcessing]=useState(false),[showPresets,setShowPresets]=useState(false);
 const txt={fontFamily:fontFamilies.regular,fontSize:13,color:c.text},bold={...txt,fontFamily:fontFamilies.semiBold};
 const locked=disabled||processing;
 const setBusy=value=>{setProcessing(value);onBusyChange?.(value);};
 return <View style={{gap:9}}>
 <Text style={bold}>Image de couverture <Text style={{...txt,color:c.textSecondary}}>(facultatif)</Text></Text>
 <ProgramCover cover={cover} fallback={fallback} height={148}/>
 <ProgramPhotoPicker colors={c} disabled={locked} onPhoto={onChange} onBusyChange={setBusy}/>
 <View style={{flexDirection:'row',alignItems:'center',gap:12,justifyContent:'space-between'}}>
 <Pressable accessibilityRole="button" accessibilityState={{expanded:showPresets}} disabled={locked} onPress={()=>setShowPresets(v=>!v)} style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:5,flex:1}}><Ionicons name="color-palette-outline" size={18} color={c.accent}/><Text style={txt}>Visuels UGEROD</Text></Pressable>
 {cover?<Pressable accessibilityRole="button" disabled={locked} onPress={()=>onChange(null)} style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:5}}><Ionicons name="trash-outline" size={17} color={c.textSecondary}/><Text style={txt}>Retirer</Text></Pressable>:null}
 </View>
 {showPresets?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{PROGRAM_COVER_PRESETS.map(p=><Pressable key={p.id} accessibilityRole="button" accessibilityState={{selected:cover?.type==='preset'&&cover.id===p.id}} disabled={locked} onPress={()=>onChange({type:'preset',id:p.id})} style={{width:'47%',gap:5,padding:4,borderRadius:9,borderWidth:cover?.type==='preset'&&cover.id===p.id?2:1,borderColor:cover?.type==='preset'&&cover.id===p.id?c.accent:c.border}}><ProgramCover cover={{type:'preset',id:p.id}} height={65} radius={7}/><Text style={{...txt,textAlign:'center'}}>{p.label}</Text></Pressable>)}</View>:null}
 <Text style={{...txt,fontSize:12,color:c.textSecondary}}>Recadrage horizontal automatique. La photo reste sur cet appareil.</Text>
 </View>;
}
