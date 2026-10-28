#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const service = fs.readFileSync('src/services/weeklyPlanService.js', 'utf8');
const ui = fs.readFileSync('app/(tabs)/planning.js', 'utf8');
const begin = service.indexOf('export function withConfirmedWeekRemoval(');
const end = service.indexOf('\nfunction normalizeWeekRemoveResult(', begin);
assert.ok(begin !== -1 && end > begin, 'Pure removal updater missing');
const source = service.slice(begin, end).replace('export function ', 'function ');
const ctx = vm.createContext({});
vm.runInContext(source + '\nglobalThis.apply = withConfirmedWeekRemoval;', ctx);
const apply = ctx.apply;
let passed = 0;
const check = (name, test) => { test(); ++passed; console.log('PASS', name); };

const original = {
  items: [
    {planItemId:'one', lifecycleStatus:'claimed', sessionId:'session-1'},
    {planItemId:'two', lifecycleStatus:'available'},
  ],
  visibleItems: [
    {planItemId:'one', lifecycleStatus:'claimed', sessionId:'session-1'},
    {planItemId:'two', lifecycleStatus:'available'},
  ],
  contextItems: [{planItemId:'three', lifecycleStatus:'available'}],
  planningSlotCount:3,
  weekStart:'2026-10-26',
};

check('removes only confirmed plan item from all visible collections', () => {
  const result = apply(original, 'one');
  assert.deepEqual(Array.from(result.items, x=>x.planItemId), ['two']);
  assert.deepEqual(Array.from(result.visibleItems, x=>x.planItemId), ['two']);
  assert.deepEqual(Array.from(result.contextItems, x=>x.planItemId), ['three']);
  assert.equal(result.planningSlotCount,2);
  assert.equal(result.weekStart,original.weekStart);
});
check('preserves original contract and remaining session', () => {
  apply(original,'one');
  assert.equal(original.items.length,2);
  assert.equal(original.visibleItems.length,2);
  assert.equal(original.planningSlotCount,3);
});
check('removing a context-only item updates the slot count', () => {
  const result=apply(original,'three');
  assert.equal(result.contextItems.length,0);
  assert.equal(result.items.length,2);
  assert.equal(result.planningSlotCount,2);
});
check('unknown item is a no-op for counts', () => {
  const result=apply(original,'unknown');
  assert.equal(result.planningSlotCount,3);
  assert.equal(result.items.length,2);
});
check('a previously skipped item never consumes a slot twice', () => {
  const item={planItemId:'skip',lifecycleStatus:'skipped'};
  const result=apply({items:[item],visibleItems:[item],planningSlotCount:0},'skip');
  assert.equal(result.planningSlotCount,0);
});
check('null input is safe', () => assert.equal(apply(null,'one'),null));
check('RPC confirms item identity before optimistic UI update',()=>{
  assert.match(service,/!result\.removed \|\| result\.planItemId !== planItemId/);
  assert.match(service,/WEEK_REMOVE_NOT_CONFIRMED/);
  assert.match(ui,/await removeWeekPlanItem\(\{ planItemId, anchorDate: weekAnchorDate \}\)/);
  assert.match(ui,/setContract\(\(current\) => withConfirmedWeekRemoval\(current, planItemId\)\)/);
});
check('refresh failure cannot report removal failure or restore card',()=>{
  const action = ui.slice(ui.indexOf('const handleRemoveWeekItem ='),ui.indexOf('const handleAddSessionDay ='));
  assert.ok(action.indexOf('setContract((current) => withConfirmedWeekRemoval') <
    action.indexOf('const refreshed = await getWeekReadContract'));
  assert.match(action,/post-removal refresh failed, removal is confirmed/);
  assert.match(action,/Séance retirée\. Actualise Ma semaine/);
});
check('mobile sheet prevents tap-through and has accessible hit target',()=>{
  assert.match(ui,/minHeight: 44, alignItems: 'center', justifyContent: 'center'/);
  assert.match(ui,/onPress=\{\(event\) => \{ event\?\.stopPropagation\?\.\(\); onConfirm\?\.\(\); \}\}/);
});
console.log(passed+' week removal regressions passed.');
