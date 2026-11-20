// Native host views are stubs; exercises/favorites service is a fixture.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const React=require('react'),babel=require('@babel/core');const original=Module._load;
Module._load=function(id,...args){return id==='react'?React:original.call(this,id,...args)};
const {act,create}=require(process.env.UGEROD_QA_RENDERER_PATH||'react-test-renderer');Module._load=original;global.IS_REACT_ACT_ENVIRONMENT=true;
const cache=new Map(),favorites=new Set(),navigation=[];
let dark=false,currentId='EX-actual';
const row={id:'EX-actual',name:'Mouvement réel',bodyRegion:'Upper',movementPattern:'push_vertical',trainingFocus:'Strength',equipmentNames:['Haltères'],description:'Première phrase. Explication complète.',instructions:'Consigne détaillée',tips:'Conseil détaillé',difficulty:'Débutant'};
function load(file){const filename=path.resolve(file);if(cache.has(filename))return cache.get(filename).exports;const mod={exports:{}};cache.set(filename,mod);
 const code=babel.transformSync(fs.readFileSync(filename,'utf8'),{filename,babelrc:false,configFile:false,presets:[['@babel/preset-react',{runtime:'automatic'}]],plugins:['@babel/plugin-transform-modules-commonjs']}).code;
 const req=id=>{
  if(id==='react')return React;
  if(id==='expo-router')return {router:{push:v=>navigation.push(v),back:()=>navigation.push('back')},useLocalSearchParams:()=>({exerciseId:currentId}),useFocusEffect:cb=>React.useEffect(cb,[cb])};
  if(id==='@expo/vector-icons')return {Ionicons:'Icon'};
  if(id==='react-native')return {View:'View',Text:'Text',Pressable:'Pressable',TextInput:'TextInput',SafeAreaView:'SafeAreaView',ScrollView:'ScrollView',ActivityIndicator:'ActivityIndicator',FlatList:({data,renderItem,ListEmptyComponent})=>React.createElement('List',null,data.length?data.map((item,index)=>React.createElement(React.Fragment,{key:item.id},renderItem({item,index}))):ListEmptyComponent)};
  if(id.endsWith('UgerodThemeContext'))return {useUgerodTheme:()=>({colors:{background:dark?'#000':'#fff',surface:dark?'#111':'#eee',text:dark?'#fff':'#111',textSecondary:'#777',accent:'#636e5c',border:'#aaa',textOnAccent:'#fff'}})};
  if(id.endsWith('exerciseService'))return {getExercises:async()=>[row],getExerciseById:async id=>id===row.id?row:null,getExerciseFavorites:async()=>[...favorites],setExerciseFavorite:async(id,selected)=>{selected?favorites.add(id):favorites.delete(id);return selected}};
  if(id.startsWith('.'))return load(path.resolve(path.dirname(filename),id+'.js'));
  return require(id);
 };new Function('require','module','exports',code)(req,mod,mod.exports);return mod.exports;
}
const Library=load('app/(tabs)/library.js').default,Detail=load('app/exercise/[exerciseId].js').default;
const text=node=>typeof node==='string'?node:node?.children?.map(text).join('')??'';
async function main(){for(const mode of [false,true]){dark=mode;favorites.clear();let root;
 await act(async()=>{root=create(React.createElement(Library));});
 assert.ok(JSON.stringify(root.toJSON()).includes('Mouvement réel'));
 const favorite=root.root.findAllByType('Pressable').find(p=>p.props.accessibilityLabel==='Favori : Mouvement réel');await act(async()=>favorite.props.onPress());assert.equal(favorites.has(row.id),true);
 const details=root.root.findAllByType('Pressable').find(p=>p.props.accessibilityLabel==='Voir Mouvement réel');await act(async()=>details.props.onPress());assert.equal(navigation.at(-1),'/exercise/EX-actual');
 await act(async()=>root.unmount());await act(async()=>{root=create(React.createElement(Detail));});
 assert.ok(!JSON.stringify(root.toJSON()).includes('Consigne détaillée'),'Details stay collapsed');
 const expand=root.root.findAllByType('Pressable').find(p=>text(p).includes('Exécution'));await act(async()=>expand.props.onPress());assert.ok(JSON.stringify(root.toJSON()).includes('Consigne détaillée'));
 await act(async()=>root.unmount());currentId='missing';await act(async()=>{root=create(React.createElement(Detail));});assert.ok(JSON.stringify(root.toJSON()).includes('Cet exercice n’est pas disponible'));assert.ok(!JSON.stringify(root.toJSON()).includes('Mouvement réel'));
 await act(async()=>root.unmount());currentId='EX-actual';
}console.log('PASS two palettes: real ID navigation, confirmed shared favorite, progressive detail, unknown ID without fallback');}
main().catch(e=>{console.error(e);process.exitCode=1});
