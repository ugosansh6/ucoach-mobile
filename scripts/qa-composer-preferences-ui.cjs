#!/usr/bin/env node
'use strict';
// Render the actual new controls with React Native Web in both existing themes.
// Icons and the unchanged SVG silhouette are stubs: no visual/iPhone claim.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const babel=require('@babel/core');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const RN=require('react-native-web');
const cache=new Map();
function load(file){
  const filename=path.resolve(file);
  if(cache.has(filename))return cache.get(filename).exports;
  const mod={exports:{}};cache.set(filename,mod);
  const code=babel.transformSync(fs.readFileSync(filename,'utf8'),{
    filename,babelrc:false,configFile:false,presets:[['@babel/preset-react',{runtime:'automatic'}]],
    plugins:['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const requireLocal=(id)=>{
    if(id==='react')return React;
    if(id==='react-native')return {...RN,Modal:({visible,children})=>visible?React.createElement('section',null,children):null};
    if(id.endsWith('ExerciseNameContext'))return {useExerciseNamePreference:()=>({mode:'bilingual'})};
    if(id.endsWith('UgerodThemeContext'))return {useUgerodTheme:()=>({colors:{text:'#222'}})};
    if(id.startsWith('.')&&id.endsWith('.json'))return require(path.resolve(path.dirname(filename),id));
    if(id==='expo-status-bar')return {StatusBar:()=>null};
    if(id.endsWith('services/exerciseService'))return {getExerciseMuscles:async()=>[]};
    if(id==='@expo/vector-icons')return {Ionicons:()=>React.createElement('span',{'aria-hidden':true})};
    if(id.endsWith('AthleticMuscleMap'))return {default:()=>React.createElement('span',{'data-unchanged-silhouette':true}),__esModule:true};
    if(id.startsWith('.'))return load(path.resolve(path.dirname(filename),id+'.js'));
    return require(id);
  };
  new Function('require','module','exports',code)(requireLocal,mod,mod.exports);
  return mod.exports;
}
const Target=load('src/workout/ComposerSkillTargetSelector.js').default;
const Zones=load('src/workout/ComposerMuscleSelector.js').default;
const {ugerodThemes}=load('src/constants/uxTheme.js');
const props={fontFamilies:{regular:'regular',medium:'medium',bold:'bold'},
  onOpen(){},onChange(){},onRetry(){},onRemove(){},loading:false,error:false};
const options=[{key:'HANDSTAND_HSPU',name:'Handstand / HSPU'},{key:'PULL_UP_MUSCLE_UP',name:'Tractions / Chest-to-Bar'}];
let cases=0;
for(const [mode,theme] of Object.entries(ugerodThemes)){
  const base={...props,colors:theme.colors};
  const closed=renderToStaticMarkup(React.createElement(Target,{...base,visible:false}));
  assert.match(closed,/Ajouter un objectif technique/);
  assert.doesNotMatch(closed,/Mouvement à travailler/);
  const automatic=renderToStaticMarkup(React.createElement(Target,{...base,visible:true,options,selectedPath:null}));
  assert.match(automatic,/Mouvement à travailler/);assert.match(automatic,/Handstand/);
  const selected=renderToStaticMarkup(React.createElement(Target,{...base,visible:true,optional:true,options,selectedPath:'HANDSTAND_HSPU'}));
  assert.match(selected,/Retirer l’objectif technique/);assert.match(selected,/Tu conserves ta dominante/);
  assert.match(selected,/aria-checked="true"/);
  const unavailable=renderToStaticMarkup(React.createElement(Target,{...base,visible:true,optional:true,options:[],error:true,selectedPath:'OLD_PATH'}));
  assert.match(unavailable,/OLD_PATH/);assert.match(unavailable,/Réessayer/);
  const zones=renderToStaticMarkup(React.createElement(Zones,{...base,values:['Back','Lower']}));
  assert.equal((zones.match(/aria-checked="true"/g)||[]).length,2,mode+' must display both selected zones');
  const legacy=renderToStaticMarkup(React.createElement(Zones,{...base,value:'Back'}));
  assert.match(legacy,/role="radio"/);
  cases+=6;
}
console.log('PASS: '+cases+' actual-control SSR cases, both themes; icons/SVG stubbed, not interactive device validation');

const Overview=load('src/components/workout/ComposerMovementOverview.js');
const Detail=load('src/components/exercises/ExerciseDetail.js').default;
for(const theme of Object.values(ugerodThemes)){
 const colors=theme.colors;
 const summary=renderToStaticMarkup(React.createElement(Overview.default,{minutes:60,environment:'Maison',intent:{focus:'Strength'},regions:['Haut du corps'],colors}));
 assert.match(summary,/60 min/);assert.match(summary,/Maison/);assert.match(summary,/Force/);assert.match(summary,/Haut du corps/);
 const solo=renderToStaticMarkup(React.createElement(Overview.ComposerMovementTabs,{blocks:[{type:'STRENGTH',label:'Musculation',minutes:45}],colors}));
 assert.match(solo,/Musculation/);assert.match(solo,/45 min/);assert.doesNotMatch(solo,/role="tab"/);
 const mixed=renderToStaticMarkup(React.createElement(Overview.ComposerMovementTabs,{blocks:[{type:'STRENGTH',label:'Musculation',minutes:20},{type:'WOD',label:'WOD',minutes:15}],selectedIndex:1,colors}));
 assert.match(mixed,/WOD/);assert.match(mixed,/aria-selected="true"/);
 const detail=renderToStaticMarkup(React.createElement(Detail,{exercise:{id:'EX321',name:'Band Row',description:'Tirage',instructions:'1. Fixe l’élastique.\n2. Tire.',tips:'Contrôle',equipmentNames:['Élastiques']},doseLabel:'5 séries × 5 reps · repos 75 s',index:0,count:4,colors,editable:true,onReplace(){},onRemove(){},onClose(){},onNext(){}}));
 assert.match(detail,/Band Row/);assert.ok(detail.includes("Tirage horizontal avec élastique"));assert.match(detail,/5 séries × 5 reps/);assert.match(detail,/Fixe l’élastique/);assert.match(detail,/Élastiques/);assert.match(detail,/Remplacer/);assert.match(detail,/Retirer/);assert.match(detail,/Visuel non disponible/);assert.doesNotMatch(detail,/Commencer l’exercice/);
 const readonly=renderToStaticMarkup(React.createElement(Detail,{exercise:{id:'cardio',name:'Cardio'},colors,onClose(){}}));assert.doesNotMatch(readonly,/Remplacer|Retirer/);
}
console.log('PASS compact movement header, solo/mixed tabs, reusable exercise detail in both themes (SSR, not device)');

for(const theme of Object.values(ugerodThemes)){
 const exercise={id:'EX321',name:'Band Row',instructions:'Tire avec contrôle',equipmentNames:['Élastiques']};
 const browse=renderToStaticMarkup(React.createElement(Detail,{exercise,colors:theme.colors,onClose(){},onSelect(){},closeLabel:'Retour aux exercices'}));
 assert.match(browse,/Ajouter à la séance/);assert.match(browse,/Retour aux exercices/);assert.doesNotMatch(browse,/Retour à la séance|Remplacer|Retirer|Dosage à calibrer/);
 const full=renderToStaticMarkup(React.createElement(Detail,{exercise,colors:theme.colors,onClose(){},onSelect(){},selectDisabled:true,selectHint:'Bloc complet'}));
 assert.match(full,/Bloc complet/);assert.match(full,/aria-disabled="true"/);
 const replacement=renderToStaticMarkup(React.createElement(Detail,{exercise,colors:theme.colors,onClose(){},onSelect(){},selectLabel:'Choisir ce remplacement'}));
 assert.match(replacement,/Choisir ce remplacement/);
}
console.log('PASS shared detail catalogue actions in both themes, capacity guard, no invented prescription');
