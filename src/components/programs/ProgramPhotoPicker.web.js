import {createElement,useEffect,useRef,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {fontFamilies} from '../../constants/typography';
import {validProgramCover} from '../../utils/programCovers';

// Copy pixels into a bounded JPEG, stripping metadata and avoiding temporary blob URLs in storage.
export async function compressProgramPhoto(file){
 if(!file||file.size>20*1024*1024||!/^image\/(jpeg|png|webp|heic|heif|avif)$/i.test(file.type||''))throw new Error('Choisis une photo JPEG, PNG, WebP, HEIC ou AVIF de 20 Mo maximum.');
 const url=URL.createObjectURL(file);
 try{
  const image=new window.Image();
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Cette photo ne peut pas être ouverte par le navigateur. Essaie une image JPEG ou PNG.'));image.src=url;});
  const w=image.naturalWidth,h=image.naturalHeight;
  if(!w||!h||w*h>50000000)throw new Error('Cette image est trop grande ou illisible.');
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Impossible de traiter la photo.');
  const cropWidth=Math.min(w,h*16/9),cropHeight=cropWidth*9/16;
  for(const width of [960,768,576,384]){
   canvas.width=width;canvas.height=Math.round(width*9/16);
   ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.drawImage(image,(w-cropWidth)/2,(h-cropHeight)/2,cropWidth,cropHeight,0,0,canvas.width,canvas.height);
   for(const quality of [0.82,0.65,0.48]){
    const cover={type:'photo',uri:canvas.toDataURL('image/jpeg',quality)};
    if(validProgramCover(cover))return cover;
   }
  }
  throw new Error('Impossible de compresser cette image. Essaie une autre photo.');
 }finally{URL.revokeObjectURL(url);}
}
export default function ProgramPhotoPicker({colors:c,disabled,onPhoto,onBusyChange}){
 const input=useRef(null),processing=useRef(false),mounted=useRef(true);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
 async function onFile(e){
  const file=e.currentTarget.files?.[0];e.currentTarget.value='';
  if(!file||disabled||processing.current)return;
  processing.current=true;setBusy(true);onBusyChange?.(true);setError('');
  try{const cover=await compressProgramPhoto(file);if(mounted.current)onPhoto(cover);}
  catch(e){if(mounted.current)setError(e.message??'Impossible de charger cette photo.');}
  finally{processing.current=false;if(mounted.current){setBusy(false);onBusyChange?.(false);}}
 }
 return <View style={{gap:6}}>
 {createElement('input',{ref:input,type:'file',accept:'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif',onChange:onFile,style:{display:'none'},disabled:disabled||busy})}
 <Pressable accessibilityRole="button" disabled={disabled||busy} onPress={()=>{if(!processing.current)input.current?.click();}} style={{minHeight:44,padding:10,borderRadius:10,backgroundColor:c.surfacePressed,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,opacity:disabled||busy?0.5:1}}><Ionicons name="images-outline" size={20} color={c.accent}/><Text style={{color:c.text,fontSize:14,fontFamily:fontFamilies.semiBold}}>{busy?'Préparation de la photo…':'Choisir une photo'}</Text></Pressable>
 {error?<Text accessibilityRole="alert" style={{color:c.text,fontSize:12,fontFamily:fontFamilies.regular}}>{error}</Text>:null}
 </View>;
}
