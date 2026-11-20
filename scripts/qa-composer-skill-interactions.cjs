// Actual React component interactions with native host views stubbed.
// This is not a browser/device/visual test. Renderer can be provided externally.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const React=require('react'),babel=require('@babel/core'),Module=require('node:module');
const original=Module._load;
Module._load=function(id,...args){if(id==='react')return React;return original.call(this,id,...args)};
const renderer=require(process.env.UGEROD_QA_RENDERER_PATH||'react-test-renderer');
Module._load=original;
global.IS_REACT_ACT_ENVIRONMENT=true;
const {act,create}=renderer;
const cache=new Map();let alerts=[];
let theme={colors:{text:'#161a15',textSecondary:'#646d5e',textMuted:'#646d5e',surface:'#fff',border:'#d9ded5',accent:'#636e5c',textOnAccent:'#fff'}};
function load(file){const filename=path.resolve(file);if(cache.has(filename))return cache.get(filename).exports;const mod={exports:{}};cache.set(filename,mod);
 const code=babel.transformSync(fs.readFileSync(filename,'utf8'),{filename,babelrc:false,configFile:false,presets:[['@babel/preset-react',{runtime:'automatic'}]],plugins:['@babel/plugin-transform-modules-commonjs']}).code;
 const req=id=>id==='react'?React:id==='react-native'?{View:'View',Text:'Text',Pressable:'Pressable',TextInput:'TextInput',Alert:{alert:(...args)=>alerts.push(args)}}:id.endsWith('UgerodThemeContext')?{useUgerodTheme:()=>theme}:id.startsWith('.')?load(path.resolve(path.dirname(filename),id+'.js')):require(id);
 new Function('require','module','exports',code)(req,mod,mod.exports);return mod.exports;
}
const Player=load('src/components/workout/ComposerSkillPlayer.js').default;
const flatten=n=>typeof n==='string'?n:!n?'':(n.children||[]).map(flatten).join('');
async function main(){
 for(const mode of ['light','dark']){
  if(mode==='dark')theme={colors:{...theme.colors,text:'#fff',surface:'#131713'}};
  let runtime=null,finished=null,root;
  const exercises=[{sessionExerciseId:'hold-instance',name:'Maintien',prescriptionJson:{sets:2,execution_target_duration_seconds:35,rest_between_sets_seconds:60,duration_semantics:'per_side'}}];
  function Harness(){const [value,set]=React.useState(runtime);return React.createElement(Player,{exercises,runtime:value,executionEnabled:true,onRuntimeChange:r=>{runtime=r;set(r)},onComplete:r=>{finished=r}})}
  await act(async()=>{root=create(React.createElement(Harness))});
  const click=async label=>{const button=root.root.findAllByType('Pressable').find(n=>flatten(n.toJSON?n.toJSON():{children:n.children.map(c=>typeof c==='string'?c:{children:c.children})}).includes(label));assert.ok(button,'Missing '+label);await act(async()=>button.props.onPress())};
  // Explicit actual, no automatic completion at timer end.
  const input=root.root.findByType('TextInput');await act(async()=>input.props.onChangeText('35'));
  await click('Confirmer la série réalisée');assert.equal(runtime.index,1);assert.equal(Object.keys(runtime.results).length,1);assert.equal(runtime.restUntil,null,'No set rest before the other side');assert.equal(finished,null);
  const snapshot=JSON.parse(JSON.stringify(runtime));await act(async()=>root.unmount());runtime=snapshot;
  await act(async()=>{root=create(React.createElement(Harness))});assert.equal(runtime.index,1,'Resume must keep the right side of set 1');
  await act(async()=>root.root.findByType('TextInput').props.onChangeText('35'));await click('Confirmer la série réalisée');
  assert.equal(runtime.index,2);assert.ok(runtime.restUntil>Date.now(),'Rest after both sides');
  await click('Écourter le repos');assert.equal(runtime.restShortened,true);
  await click('Arrêter le Skill ici');const buttons=alerts.at(-1)[2];await act(async()=>buttons.find(b=>b.text==='Arrêter').onPress());
  assert.equal(finished['hold-instance'].status,'adapted');assert.equal(finished['hold-instance'].performanceActualJson.skill_sets.length,2);assert.equal(finished['hold-instance'].durationSeconds,70);
  await act(async()=>root.unmount());
 }
 console.log('PASS actual React interactions in two palettes: explicit confirmation, sides, recovery, remount/resume, partial stop, no invented sets');
}
main().catch(e=>{console.error(e);process.exitCode=1});
