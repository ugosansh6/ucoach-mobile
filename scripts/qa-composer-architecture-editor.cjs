#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/utils/composerArchitectureEditor.js', 'utf8');
const { editComposerArchitecture: edit, composerAddableBlocks, composerMainBlocks } =
  new Function(source.replaceAll('export const ', 'const ').replaceAll('export function ', 'function ') +
    '\nreturn {editComposerArchitecture,composerAddableBlocks,composerMainBlocks};')();

const initial = {
  key: 'balanced', estimatedMinutes: 60, transitionReserveMinutes: 5,
  blocks: [
    { type: 'WARMUP', minutes: 7 },
    { type: 'TABATA', minutes: 4 },
    { type: 'STRENGTH', minutes: 21 },
    { type: 'WOD', minutes: 23 },
  ],
};
function valid(value, types, expectedTotal = 60) {
  assert.equal(value.ok, true, value.error);
  assert.deepEqual(value.architecture.blocks.map((x) => x.type), ['WARMUP', 'TABATA', ...types]);
  assert.equal(value.architecture.blocks[1].minutes, 4);
  assert.equal(value.architecture.blocks[0].minutes, 7);
  assert.equal(value.architecture.blocks.reduce((a,b)=>a+b.minutes,0)+
    value.architecture.transitionReserveMinutes, expectedTotal);
  assert.ok(composerMainBlocks(value.architecture).every((b)=>b.minutes>=8));
  assert.equal(value.architecture.key, 'custom');
}
assert.deepEqual(composerAddableBlocks(initial), ['SKILL']);
const added = edit(initial,{kind:'add',blockType:'SKILL'});
valid(added, ['STRENGTH','WOD','SKILL']);
assert.deepEqual(composerAddableBlocks(added.architecture),[]);
valid(edit(added.architecture,{kind:'move',blockType:'SKILL',direction:-1}),['STRENGTH','SKILL','WOD']);
const moved = edit(added.architecture,{kind:'move',blockType:'SKILL',direction:-1});
const shifted = edit(moved.architecture,{kind:'minutes',blockType:'SKILL',delta:2});
valid(shifted,['STRENGTH','SKILL','WOD']);
valid(edit(shifted.architecture,{kind:'minutes',blockType:'SKILL',delta:-2}),['STRENGTH','SKILL','WOD']);
const removed = edit(shifted.architecture,{kind:'remove',blockType:'STRENGTH'});
valid(removed,['SKILL','WOD']);
assert.equal(removed.removedType,'STRENGTH');
const only = edit(removed.architecture,{kind:'remove',blockType:'WOD'});
valid(only,['SKILL']);
assert.equal(edit(only.architecture,{kind:'remove',blockType:'SKILL'}).ok,false);
assert.equal(edit(initial,{kind:'add',blockType:'WOD'}).ok,false);
assert.equal(edit(initial,{kind:'remove',blockType:'WARMUP'}).ok,false);
assert.equal(edit(initial,{kind:'move',blockType:'STRENGTH',direction:-1}).ok,false);
assert.equal(initial.blocks[2].minutes,21, 'no mutation to original proposal');
const short = {...initial,estimatedMinutes:20,transitionReserveMinutes:3,
 blocks:[{type:'WARMUP',minutes:5},{type:'TABATA',minutes:4},{type:'WOD',minutes:8}]};
assert.equal(edit(short,{kind:'add',blockType:'SKILL'}).ok,false);
const legacy = {
  key: 'user_authored', estimatedMinutes: 30, transitionReserveMinutes: 5,
  blocks: [
    { type:'WARMUP', minutes:5 },
    { type:'SKILL', minutes:8 },
    { type:'WOD', minutes:12 },
  ],
};
const legacyEdited = edit(legacy, {kind:'remove',blockType:'WOD'});
assert.equal(legacyEdited.ok,true,legacyEdited.error);
assert.deepEqual(legacyEdited.architecture.blocks.map(x=>x.type),['WARMUP','SKILL']);
assert.equal(legacyEdited.architecture.blocks[1].minutes,20);
assert.equal(legacyEdited.architecture.blocks.reduce((a,b)=>a+b.minutes,0)+5,30);
assert.equal(legacyEdited.architecture.blocks.some(x=>x.type==='TABATA'),false,
  'Never add new complements to a previously saved user-authored draft');
console.log('PASS: add/remove/reorder, older drafts, time budget and fixed Tabata');
