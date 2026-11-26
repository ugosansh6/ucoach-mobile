#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const constants=fs.readFileSync('src/constants/outdoorContext.js','utf8');
const outdoor=new Function(constants.replaceAll('export ','')+';return {OUTDOOR_PLACES,selectableOutdoorPlaces,terrainOptionsForPlace,TERRAIN_OPTIONS};')();
const api=new Function(...Object.keys(outdoor),fs.readFileSync('src/utils/composerFrame.js','utf8').replace(/^import .*;\n/m,'').replaceAll('export ','')+';return {frameOutdoorPlace,frameSurfaceValid,frameCanContinue,frameSelectPlace,frameSelectSurface,frameSurfaceLabel,frameDurationStep,frameDurationDrag};')(...Object.values(outdoor));
const empty={place_code:null,surface_code:null,running_allowed:false,reliable_distance:true};
assert.equal(api.frameCanContinue('OUTDOOR',empty,false),false);
assert.equal(api.frameCanContinue('HOME',empty,false),true);
assert.equal(api.frameCanContinue('BOX',empty,true),false);
assert.equal(api.frameCanContinue('UNKNOWN',empty,false),false);
for(const p of outdoor.selectableOutdoorPlaces()){
 const c=api.frameSelectPlace(empty,p.code);
 assert.equal(c.place_code,p.code);assert.equal(c.running_allowed,false);assert.equal(c.reliable_distance,true);
 if(p.surface){assert.equal(c.surface_code,p.surface);assert.equal(api.frameCanContinue('OUTDOOR',c,false),true);assert.ok(api.frameSurfaceLabel(c));}
 else{assert.equal(c.surface_code,null);assert.equal(api.frameCanContinue('OUTDOOR',c,false),false);}
 for(const t of outdoor.TERRAIN_OPTIONS){
  const valid=(p.surface===t.code)||outdoor.terrainOptionsForPlace(p).some(x=>x.code===t.code);
  const result=api.frameSelectSurface(c,t.code);
  if(valid){assert.equal(result.surface_code,t.code);assert.equal(api.frameSurfaceValid(result),true);}
  else assert.equal(result,c,'Invalid terrain must not modify context');
 }
}
const park=api.frameSelectSurface(api.frameSelectPlace(empty,'PARK'),'GRASS');
assert.equal(api.frameSelectPlace(park,'FOREST_PATH').surface_code,'GRASS');
const road=api.frameSelectSurface(park,'ROAD');
assert.equal(api.frameSelectPlace(road,'FOREST_PATH').surface_code,null);
assert.equal(api.frameSelectPlace(road,'ATHLETICS_TRACK').surface_code,'TRACK');
assert.equal(api.frameSelectPlace(road,'NOPE'),road);
assert.equal(api.frameSelectPlace(road,'GRASS_FIELD'),road);
assert.equal(api.frameCanContinue('OUTDOOR',{...empty,place_code:'GRASS_FIELD',surface_code:'GRASS'},false),true,'Restore historical valid context without exposing a retired place');
assert.equal(api.frameCanContinue('OUTDOOR',{...empty,place_code:'ATHLETICS_TRACK',surface_code:'TRAIL'},false),false);
const ds=[20,30,45,60,75,90];
for(let i=0;i<ds.length;i++){
 assert.equal(api.frameDurationStep(ds,ds[i],1),ds[Math.min(i+1,ds.length-1)]);
 assert.equal(api.frameDurationStep(ds,ds[i],-1),ds[Math.max(i-1,0)]);
 assert.equal(api.frameDurationDrag(ds,ds[i],-64),ds[Math.min(i+1,ds.length-1)]);
 assert.equal(api.frameDurationDrag(ds,ds[i],64),ds[Math.max(i-1,0)]);
 assert.equal(api.frameDurationDrag(ds,ds[i],0),ds[i]);
}
assert.equal(api.frameDurationDrag(ds,50,0),50,'Do not silently normalize a restored duration');
assert.equal(api.frameDurationStep(ds,50,1),60);assert.equal(api.frameDurationStep(ds,50,-1),45);
assert.equal(api.frameDurationDrag(ds,50,-64),60);assert.equal(api.frameDurationDrag(ds,50,64),45);
assert.equal(api.frameDurationDrag(ds,45,32),30);assert.equal(api.frameDurationDrag(ds,45,-32),60);
const ui=fs.readFileSync('src/workout/WeekComposerV7.js','utf8');
require('@babel/parser').parse(ui,{sourceType:'module',plugins:['jsx']});
const frame=ui.slice(ui.indexOf('{step === 0 ? ('),ui.indexOf('{step === 1 ? ('));
const durationColorExpression=ui.match(/const durationColor = ([^;]+);/)[1];
const durationColorFor=new Function('value','colors','return '+durationColorExpression);
for(const colors of [{accent:'#646F5E',secondaryAccent:'#FF6B19',text:'#171A15'},{accent:'#646F5E',secondaryAccent:'#FF6B19',text:'#F7F9FC'}]){
 for(const value of [20,30])assert.equal(durationColorFor(value,colors),colors.accent);
 for(const value of [45,60,50])assert.equal(durationColorFor(value,colors),colors.text);
 for(const value of [75,90])assert.equal(durationColorFor(value,colors),colors.secondaryAccent);
}
assert.match(ui,/style=\{\[styles\.frameDialValue, \{ color: durationColor \}\]\}/);

assert.match(frame,/ExpoImage source=\{FRAME_PHOTOS\[item.code\]\}/);
assert.match(frame,/ExpoImage source=\{FRAME_EQUIPMENT_PHOTO\}/);
assert.doesNotMatch(ui,/visible=\{sheet === 'equipment'\}|setSheet\('equipment'\)/);
assert.match(frame,/Matériel retenu pour la séance/);
assert.match(frame,/Choisir mon matériel/);
assert.match(frame,/referenceEquipment.map\(item=>\{/);
assert.match(frame,/const selected=equipmentIds.includes\(item.id\)/);
assert.match(frame,/accessibilityState=\{\{checked:selected\}\}/);
assert.equal((frame.match(/<ScrollView horizontal nestedScrollEnabled/g)||[]).length,1);
assert.equal((frame.match(/onPress=\{\(\)=>toggleEquipment\(item.id\)\}/g)||[]).length,1);
assert.doesNotMatch(frame,/Matériel à ajouter|frameEquipmentTagRemove|frameEquipmentTagAdd|excludedEquipment|Retirer.*de la séance/);
assert.match(frame,/retainedEquipment.length\}\/\{referenceEquipment.length/);
assert.ok(frame.indexOf('>Poids du corps</Text>')<frame.indexOf('>Tout mon matériel</Text>'));
assert.ok(frame.indexOf('styles.frameEquipmentTags')<frame.indexOf('onPress={openProfileEquipment}'));
assert.match(frame,/Modifier mon matériel/);
assert.match(frame,/onPress=\{\(\) => setEquipmentIds\(referenceEquipment.map\(\(item\) => item.id\)\)\}/);
assert.match(frame,/onPress=\{\(\) => setEquipmentIds\(\[\]\)\}/);
assert.match(frame,/onPress=\{openProfileEquipment\}/);
assert.match(frame,/item.detail/);
assert.match(ui,/retainedEquipment = referenceEquipment.filter\(item=>equipmentIds.includes\(item.id\)\)/);
assert.doesNotMatch(ui,/const excludedEquipment =/);
const toggleSource=ui.slice(ui.indexOf('function toggleEquipment('),ui.indexOf('function equipmentNames()'));
let ids=['E01','E02','E03'];
const toggle=new Function('setEquipmentIds',toggleSource+';return toggleEquipment;')(fn=>{ids=fn(ids);});
toggle('E02');assert.equal(ids.join('|'),'E01|E03');toggle('E02');assert.equal(ids.join('|'),'E01|E03|E02');
ids=[];toggle('E01');assert.equal(ids.join('|'),'E01');toggle('E01');assert.equal(ids.length,0);
const originalInventory=Object.freeze([{id:'E01'},{id:'E02'},{id:'E03'}].map(Object.freeze));
const displayedIds=()=>originalInventory.map(item=>item.id).join('|');
ids=originalInventory.map(item=>item.id);toggle('E02');
assert.equal(displayedIds(),'E01|E02|E03');
assert.equal(ids.join('|'),'E01|E03');
toggle('E02');assert.equal(displayedIds(),'E01|E02|E03');
ids=[];assert.equal(displayedIds(),'E01|E02|E03');
ids=originalInventory.map(item=>item.id);assert.equal(ids.join('|'),'E01|E02|E03');
assert.ok(frame.indexOf('Matériel retenu pour la séance')<frame.indexOf('styles.frameEquipmentTags'));
const selectedNamesSource=ui.slice(ui.indexOf('function selectedEquipmentNames('),ui.indexOf('function DurationControl('));
const selectedNames=new Function(selectedNamesSource+';return selectedEquipmentNames;')();
const equipment=[{id:'E01',name:'Haltères'},{id:'E02',name:'Tapis'},{id:'E03',name:'Élastiques'}];
assert.equal(selectedNames(equipment,['E01','E03']).join('|'),'Haltères|Élastiques');
assert.equal(selectedNames(equipment,[]).length,0);
assert.equal(selectedNames(equipment,['E02']).join('|'),'Tapis');
assert.equal(selectedNames(equipment,['E01','E02','E03']).length,3);
const thumb=fs.readFileSync('assets/composer-environments/equipment.webp');
assert.equal(thumb.toString('ascii',0,4),'RIFF');assert.equal(thumb.toString('ascii',8,12),'WEBP');assert.ok(thumb.length<50000);
assert.match(frame,/frameSurfaceLabel\(outdoorContext\)/);
assert.match(frame,/disabled=\{!selectedOutdoorPlace\}/);
assert.match(frame,/selectedOutdoorPlace\?\.surface && frameSurfaceValid\(outdoorContext\)/);
assert.match(frame,/ATHLETICS_TRACK/);
assert.match(frame,/running_allowed:!current.running_allowed/);
assert.match(ui,/frameCanContinue\(environmentCode,outdoorContext,equipmentLoading\)\)setStep\(1\)/);
assert.match(ui,/selectableOutdoorPlaces\(\)\.map\(place/);
assert.match(ui,/terrainOptionsForPlace\(selectedOutdoorPlace\)/);
assert.match(ui,/frameSelectSurface\(current,terrain.code\)/);
assert.doesNotMatch(frame,/Le lieu ne déclare|name=\{item.icon\}|checkmark-circle|ChoiceChip/);
for(const [environment,file] of Object.entries({HOME:'home.webp',BOX:'box.webp',GYM:'salle2.png',OUTDOOR:'outdoor.webp'})){
 assert.ok(ui.includes(environment+": require('../../assets/composer-environments/"+file+"')"),'Expected local photo for '+environment);
 const bytes=fs.readFileSync('assets/composer-environments/'+file);
 if(file.endsWith('.webp')){
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert.ok(bytes.length<50000);
 }else if(file.endsWith('.png')){
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',file+' PNG signature');
  if(bytes.length>200000)console.warn(file+' : '+bytes.length+' bytes; consider optimizing for mobile');
 }else{
  assert.equal(bytes[0],0xff,file+' JPEG signature');assert.equal(bytes[1],0xd8,file+' JPEG signature');assert.equal(bytes[2],0xff,file+' JPEG signature');
  if(bytes.length>200000)console.warn(file+' : '+bytes.length+' bytes; consider optimizing for mobile');
 }
}
console.log('PASS Composer frame: current catalogue, terrain constraints, mandatory context, explicit course preference, duration, local photo wiring');
