const fs=require('node:fs'),assert=require('node:assert/strict'),babel=require('@babel/core'),React=require('react'),RN=require('react-native-web');
const {renderToStaticMarkup}=require('react-dom/server');
const service=fs.readFileSync('src/services/composerService.js','utf8');
const api=new Function(service.slice(service.indexOf('function wodLabel(minutes)'),service.indexOf('/**\n * MSW-036')).replaceAll('export function ','function ')+'\nreturn {composerBlockDisplayLabel,composerArchitectureDisplayTitle,composerArchitecturePurpose,composerArchitectureMatchesIntent};')();
const ui=fs.readFileSync('src/workout/WeekComposerV7.js','utf8');
const card=ui.slice(ui.indexOf('function ArchitectureCard('),ui.indexOf('\nfunction ExerciseCard('));
const code=babel.transformSync(card,{babelrc:false,configFile:false,presets:[['@babel/preset-react',{runtime:'automatic'}]],plugins:['@babel/plugin-transform-modules-commonjs']}).code;
const Card=new Function('require','View','Text','Pressable','Ionicons',...Object.keys(api),code+'\nreturn ArchitectureCard;')(require,RN.View,RN.Text,RN.Pressable,()=>null,...Object.values(api));
const editor=new Function(fs.readFileSync('src/utils/composerArchitectureEditor.js','utf8').replaceAll('export const ','const ').replaceAll('export function ','function ')+'\nreturn {editComposerArchitecture};')();
let cases=0;
for(const env of ['HOME','BOX']) for(const dark of [false,true]) for(const [index,[skill,wod,label]] of [[17,28,'Répartition conseillée'],[22,23,'Répartition équilibrée'],[28,17,'Plus de temps pour le Skill']].entries()){
 const option={key:'layout'+index,distribution_label:label,recommended:index===0,estimatedMinutes:60,transitionReserveMinutes:5,blocks:[{type:'WARMUP',minutes:6},{type:'TABATA',minutes:4},{type:'SKILL',minutes:skill},{type:'WOD',minutes:wod}]};
 const html=renderToStaticMarkup(React.createElement(Card,{option,environmentCode:env,intentKey:'STRENGTH',selected:index===0,styles:{},colors:{text:dark?'#fff':'#111',accent:'#636e5c',secondaryAccent:'#ff6b1a'}}));
 assert.match(html,/Skill \+ WOD/);assert.ok(html.includes(skill+' min'));assert.ok(html.includes(wod+' min'));assert.doesNotMatch(html,/Force seule|Renforcement seul|Skill seul/);
 if(index>0)assert.ok(html.includes(label));
 const removed=editor.editComposerArchitecture(option,{kind:'remove',blockType:'SKILL'});assert.equal(removed.ok,true);assert.deepEqual(removed.architecture.blocks.map(b=>b.type),['WARMUP','TABATA','WOD']);assert.equal(removed.architecture.blocks[2].minutes,45);assert.equal(removed.architecture.distribution_label,null);
 cases++;
}
console.log('PASS '+cases+' actual-card SSR cases in both themes; distinct layouts, labels and explicit Skill removal');
