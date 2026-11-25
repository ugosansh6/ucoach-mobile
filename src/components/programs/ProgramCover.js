import {useEffect,useState} from 'react';
import {Image,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {programCoverPreset,validProgramCover} from '../../utils/programCovers';

export default function ProgramCover({cover,fallback='strength',height=140,width='100%',radius=12}){
 const uri=cover?.type==='photo'&&validProgramCover(cover)?cover.uri:null;
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[uri]);
 const preset=programCoverPreset(cover,fallback);
 return <View style={{width,height,borderRadius:radius,overflow:'hidden',backgroundColor:preset.background,alignItems:'center',justifyContent:'center'}}>
 {uri&&!failed?<Image source={{uri}} resizeMode="cover" style={{width:'100%',height:'100%'}} onError={()=>setFailed(true)} accessible={false}/>:<>
 <View style={{position:'absolute',width:height*1.7,height:height*1.7,borderWidth:1,borderColor:preset.foreground+'35',borderRadius:height,right:-height*0.45,top:-height*0.6}}/>
 <View style={{position:'absolute',width:height,height:height,borderWidth:1,borderColor:preset.foreground+'40',borderRadius:height,bottom:-height*0.5,left:-height*0.2}}/>
 <Ionicons name={preset.icon} size={Math.min(62,height*0.48)} color={preset.foreground} accessible={false}/>
 </>}
 </View>;
}
