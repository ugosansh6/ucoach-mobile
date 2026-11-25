import {useEffect,useState} from 'react';
import {Image,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

export default function ExerciseArtwork({imagePath,colors,size=56,hero=false}){
 const uri=/^https:\/\//i.test(String(imagePath??''))?imagePath:null;
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[uri]);
 return <View style={{width:hero?'100%':size,height:hero?180:size,borderRadius:hero?16:10,backgroundColor:colors.surfacePressed,overflow:'hidden',alignItems:'center',justifyContent:'center'}}>
 {uri&&!failed?<Image source={{uri}} resizeMode="contain" style={{width:'100%',height:'100%'}} onError={()=>setFailed(true)} accessible={false}/>:<Ionicons name="image-outline" size={hero?36:21} color={colors.textMuted} accessible={false}/>}
 </View>;
}
