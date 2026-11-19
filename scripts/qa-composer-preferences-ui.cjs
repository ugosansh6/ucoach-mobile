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
    if(id==='react-native')return RN;
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
