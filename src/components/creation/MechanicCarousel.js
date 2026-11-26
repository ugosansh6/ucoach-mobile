import {useMemo,useRef} from 'react';
import {View,Text,Pressable,PanResponder} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {fontFamilies} from '../../constants/typography';

export const routineMechanicCards=[
 {key:'SETS_REPS',title:'SÉRIES & MAINTIEN',icon:'layers-outline',description:'Réalise chaque exercice série après série, en répétitions ou en maintien chronométré.'},
 {key:'CIRCUIT',title:'CIRCUIT',icon:'repeat-outline',description:'Enchaîne plusieurs exercices, puis répète l’ensemble sur plusieurs tours.'},
 {key:'HIIT',title:'INTERVALLES',icon:'timer-outline',description:'Alterne des temps d’effort et de récupération que tu définis.'},
 {key:'TABATA',title:'TABATA',icon:'flash-outline',description:'8 cycles de 20 secondes d’effort et 10 secondes de récupération. Un bloc dure 4 minutes.'},
];
export default function MechanicCarousel({items=routineMechanicCards,value,onChange,colors:c,disabled=false}){
 const index=Math.max(0,items.findIndex(i=>i.key===value)),item=items[index];
 const current=useRef(index),change=useRef(onChange),blocked=useRef(disabled),list=useRef(items);
 current.current=index;change.current=onChange;blocked.current=disabled;list.current=items;
 function move(delta){if(!blocked.current){const n=list.current.length;change.current(list.current[(current.current+delta+n)%n].key);}}
 const pan=useMemo(()=>PanResponder.create({onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)>12&&Math.abs(g.dx)>Math.abs(g.dy),onPanResponderRelease:(_,g)=>{if(Math.abs(g.dx)>=40)move(g.dx<0?1:-1);},onPanResponderTerminationRequest:()=>true}),[]);
 const muted={fontFamily:fontFamilies.medium,fontSize:12,lineHeight:17,color:c.textSecondary};
 const title={fontFamily:fontFamilies.display,fontSize:31,lineHeight:35,color:c.text,textAlign:'center'};
 const arrow={width:44,height:44,borderRadius:22,borderWidth:1,borderColor:c.border,alignItems:'center',justifyContent:'center'};
 const row={flexDirection:'row',alignItems:'center',gap:5};
 return <View style={{gap:12}}>
  <View {...pan.panHandlers} style={{padding:16,gap:16,borderRadius:18,backgroundColor:c.surface,borderWidth:1,borderColor:c.border}}>
   <View style={{...row,justifyContent:'space-between'}}><Text style={muted}>MÉCANIQUE</Text><Text style={muted}>{index+1} / {items.length}</Text></View>
   <View style={row}><Pressable accessibilityRole="button" accessibilityLabel="Format précédent" disabled={disabled} onPress={()=>move(-1)} style={arrow}><Ionicons name="chevron-back" size={23} color={c.text}/></Pressable><View style={{flex:1,minWidth:0,alignItems:'center',gap:12}}><View style={{width:66,height:66,borderRadius:18,backgroundColor:c.accentSoft,alignItems:'center',justifyContent:'center'}}><Ionicons name={item.icon} size={36} color={c.text}/></View><Text style={title}>{item.title}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Format suivant" disabled={disabled} onPress={()=>move(1)} style={arrow}><Ionicons name="chevron-forward" size={23} color={c.text}/></Pressable></View>
   <Text style={{...muted,fontSize:14,lineHeight:21,textAlign:'center'}}>{item.description}</Text>
   <View style={{backgroundColor:c.background,borderRadius:12,padding:12,gap:9}}>
    {item.key==='SETS_REPS'||item.key==='CIRCUIT'?[0,1].map(i=><View key={i} style={row}><Text style={{...muted,width:56}}>{item.key==='CIRCUIT'?'Tour '+(i+1):'Exo '+(i+1)}</Text>{[1,2,3].map(n=><View key={n} style={{flex:1,minHeight:33,borderRadius:6,backgroundColor:c.accentSoft,alignItems:'center',justifyContent:'center'}}><Text style={{...muted,color:c.text,fontSize:10}}>{item.key==='CIRCUIT'?'Exo '+n:'Série '+n}</Text></View>)}</View>):<><View style={{...row,height:45,gap:3}}>{Array.from({length:item.key==='TABATA'?8:4},(_,i)=><View key={i} style={{flex:3,flexDirection:'row',gap:1,height:'100%'}}><View style={{flex:2,backgroundColor:c.secondaryAccent,borderRadius:3}}/><View style={{flex:1,backgroundColor:c.accent,borderRadius:3}}/></View>)}</View><Text style={{...muted,textAlign:'center'}}>{item.key==='TABATA'?'20 s effort · 10 s repos · 8 cycles':'Effort / récupération personnalisables'}</Text></>}
   </View>
  </View>
  <View style={{...row,justifyContent:'center'}}>{items.map((x,i)=><Pressable key={x.key} accessibilityRole="button" accessibilityLabel={x.title} accessibilityState={{selected:i===index}} disabled={disabled} onPress={()=>onChange(x.key)} style={{width:34,height:30,alignItems:'center',justifyContent:'center'}}><View style={{width:i===index?24:8,height:8,borderRadius:4,backgroundColor:i===index?c.secondaryAccent:c.borderStrong}}/></Pressable>)}</View>
 </View>;
}
