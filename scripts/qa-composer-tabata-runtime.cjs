#!/usr/bin/env node
'use strict';
// Execute existing Player logic without rendering React Native. This proves
// timing/actuals contracts, not device playback or persistence into history.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const focused = fs.readFileSync('app/workout/session-focused-core.js', 'utf8');
const start = focused.indexOf('export function FocusedTabata(');
const end = focused.indexOf('\n  return (', start);
assert.ok(start >= 0 && end > start, 'FocusedTabata logic not found');
const createPlayer = new Function('useRef', 'restoreRunningClock', 'useState', 'useEffect', 'prescriptionObject',
  'TABATA_RING_SEGMENTS', 'Alert', 'setInterval', 'clearInterval',
  focused.slice(start, end).replace('export ', '') +
  '\nreturn {rounds,workSeconds,restSeconds,totalSeconds,remaining,resting,finished,' +
  'scheduledExerciseIndex,startTabata,finishTabata};\n}\nreturn FocusedTabata;');
const protocol = {rounds:8,work_seconds:20,rest_seconds:10};
function render({elapsed=0, started=true, paused=false, enabled=true, count=2}={}) {
  const state = [started,paused,elapsed,0];
  const effects = [], results = [], updates = [], timers = [], cleared = [];
  let index = 0;
  const component = createPlayer(value => ({current:value}), value => value, () => {
    const slot = index++;
    return [state[slot], next => updates.push([slot,
      typeof next === 'function' ? next(state[slot]) : next])];
  }, effect => effects.push(effect), e => e.prescription,
  40, {alert(){}}, (callback,ms) => {timers.push({callback,ms});return 123;},
  id => cleared.push(id));
  const player = component({
    block:{exercises:Array.from({length:count},()=>({prescription:{protocol}}))},
    executionEnabled:enabled, onFinish:r=>results.push(r), colors:{},
  });
  return {player,effects,results,updates,timers,cleared};
}
for (const count of [1,2]) {
  let workTicks=0, restTicks=0;
  for (let second=0;second<240;second++) {
    const {player}=render({elapsed:second,count});
    assert.equal(player.totalSeconds,240);
    assert.equal(player.finished,false);
    assert.ok(player.remaining>0);
    assert.ok(player.scheduledExerciseIndex>=0 && player.scheduledExerciseIndex<count);
    if(player.resting)restTicks++;else workTicks++;
  }
  assert.equal(workTicks,160,'Eight 20-second efforts');
  assert.equal(restTicks,80,'Eight 10-second rests, including the last');
  const full=render({elapsed:240,count});
  assert.equal(full.player.finished,true);
  assert.equal(full.player.remaining,0);
  full.player.finishTabata();
  assert.deepEqual(full.results,[{elapsedSeconds:240,totalSeconds:240,rounds:8,
    workSeconds:20,restSeconds:10,completedWorkIntervals:8,protocolCompleted:true}]);
}
for(const [elapsed,completed] of [[0,0],[19,0],[20,1],[29,1],[30,1],[239,8]]) {
  const value=render({elapsed});value.player.finishTabata();
  assert.equal(value.results[0].completedWorkIntervals,completed);
  assert.equal(value.results[0].protocolCompleted,false);
}
for(const args of [{started:false},{enabled:false}]) {
  const value=render(args);value.player.finishTabata();assert.equal(value.results.length,0);
}
const tick=render({elapsed:239});
const cleanup=tick.effects[1]();
assert.equal(tick.timers[0].ms,1000);
tick.timers[0].callback();
assert.deepEqual(tick.updates,[[2,240]]);
cleanup();assert.deepEqual(tick.cleared,[123]);
for(const args of [{paused:true},{started:false},{enabled:false},{elapsed:240}]) {
  const value=render(args);value.effects[1]();assert.equal(value.timers.length,0);
}

const environment=fs.readFileSync('app/workout/environment-session-core.js','utf8');
function section(from,to) {
  const a=environment.indexOf(from),b=environment.indexOf(to,a);
  assert.ok(a>=0 && b>a,from);return environment.slice(a,b);
}
const actualsFactory=new Function('currentExercises','advanceWithUpdates',
  section('function numberOr(', '\nfunction ') +
  section('function positiveInt(', '\nfunction ') +
  section('function exerciseKey(', '\nfunction ') +
  section('  function completeEnvironmentTabata(', '\n  function completeWodBlock(') +
  '\nreturn completeEnvironmentTabata;');
for(const [intervals,complete,statuses,counts] of [
  [8,true,['completed','completed'],[4,4]],
  [1,false,['adapted','not_completed'],[1,0]],
  [0,false,['not_completed','not_completed'],[0,0]],
]) {
  let updates;
  const exercises=[{id:'a'},{id:'b'}];
  const finish=actualsFactory(exercises,value=>{updates=value;});
  finish({completedWorkIntervals:intervals,protocolCompleted:complete,
    elapsedSeconds:complete?240:20,rounds:8,workSeconds:20,restSeconds:10});
  const values=Object.values(updates);
  assert.deepEqual(values.map(x=>x.userExecutionStatus),statuses);
  assert.deepEqual(values.map(x=>x.performanceActualJson.work_intervals_completed),counts);
  assert.ok(values.every(x=>x.performanceActualJson.controlled_timing===true));
  assert.ok(values.every(x=>x.performanceActualJson.planned_rounds===8));
}
console.log('PASS: existing Tabata Player 240s, phase boundaries, pause/gates and partial/full actuals');
