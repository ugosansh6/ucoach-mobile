#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/utils/weekRemovalRequestGuard.js', 'utf8');
const helpers = new Function(
  source.replaceAll('export async function ', 'async function ')
    .replaceAll('export function ', 'function ') +
  '\nreturn {withWeekRemovalTimeout,isConfirmedWeekRemovalRow,weekRemovalFeedback};'
)();
const {withWeekRemovalTimeout,isConfirmedWeekRemovalRow,weekRemovalFeedback} = helpers;
async function main() {
  assert.equal(isConfirmedWeekRemovalRow({status:'skipped',planning_context_json:{user_removed:true}}),true);
  assert.equal(isConfirmedWeekRemovalRow({status:'skipped',planning_context_json:{}}),false);
  assert.equal(isConfirmedWeekRemovalRow({status:'available',planning_context_json:{user_removed:true}}),false);
  assert.equal(isConfirmedWeekRemovalRow(null),false);
  assert.match(weekRemovalFeedback({code:'WEEK_REMOVE_TIMEOUT'}),/non confirmé/);
  assert.match(weekRemovalFeedback({message:'This session can no longer be removed'}),/historique est protégé/);
  assert.equal(await withWeekRemovalTimeout(() => Promise.resolve('ack'),100),'ack');
  let aborted=false;
  await assert.rejects(
    withWeekRemovalTimeout((signal) => new Promise(() => {
      signal.addEventListener('abort', () => { aborted=true; });
    }),10),
    (error) => error?.code === 'WEEK_REMOVE_TIMEOUT'
  );
  assert.equal(aborted,true,'the hanging request was aborted');
  console.log('PASS: removal feedback, strict server confirmation and bounded network wait');
}
main().catch((error) => { console.error(error); process.exitCode=1; });
