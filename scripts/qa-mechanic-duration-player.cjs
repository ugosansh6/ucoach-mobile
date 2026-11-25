#!/usr/bin/env node
'use strict';
// #33: evaluate the real timer-budget helper, without a React Native render.
// This is not an end-to-end device, completion or history test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/components/workout/WodProtocolPlayerV3.js','utf8');
function section(from,to) {
  const a=source.indexOf(from),b=source.indexOf(to,a);
  assert.ok(a>=0 && b>a,from);return source.slice(a,b);
}
const numberStart=source.indexOf('function numberOr(');
assert.ok(numberStart>=0);
const numberEnd=source.indexOf('\n}',numberStart)+2;
const timer=new Function(source.slice(numberStart,numberEnd)+'\n'+
  section('function totalSecondsForMechanic(', '\nfunction protocolSummary(')+
  '\nreturn totalSecondsForMechanic;')();
for(const minutes of [8,12,17,22,35,40,60]) {
  assert.equal(timer({mechanic:'AMRAP',params:{duration_minutes:minutes},
    durationMinutes:minutes,exerciseCount:3}),minutes*60);
  assert.equal(timer({mechanic:'FOR_TIME',params:{cap_seconds:minutes*60},
    durationMinutes:minutes,exerciseCount:3}),minutes*60);
}
assert.equal(timer({mechanic:'EMOM',params:{cycles:13,station_seconds:60},
  durationMinutes:40,exerciseCount:3}),39*60,'Follow complete stations, not a fake 40-min timer');
assert.equal(timer({mechanic:'HIIT',params:{rounds:20,exercise_count:3,work_seconds:40,rest_seconds:20},
  durationMinutes:60,exerciseCount:3}),60*60,'No hidden 25-min timer clamp');
assert.equal(timer({mechanic:'PROGRESSIVE_INTERVAL',params:{time_limit_seconds:3600},
  durationMinutes:60,exerciseCount:3}),3600);
assert.equal(timer({mechanic:'CIRCUIT',params:{rounds:4},durationMinutes:60,
  exerciseCount:3}),null,'Circuit uses its round protocol, not a fabricated countdown');
console.log('PASS: real Player timer helper preserves compiled duration/cap; Circuit stays round-driven');
