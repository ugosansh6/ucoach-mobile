#!/usr/bin/env node
'use strict';
// Uses actual compiler outputs from composer_shared_wod_v2_rollback.sql when supplied.
// Generates rollback SQL to replay Player actuals through the real completion/history RPC.
const fs=require('node:fs');
const assert=require('node:assert/strict');
function load(file,names) { return new Function(fs.readFileSync(file,'utf8').replaceAll('export function ','function ')+`\nreturn {${names}};`)(); }
const {buildWodProtocolCompletion}=load('src/services/wodProtocolOutcome.js','buildWodProtocolCompletion');
const {deriveWodExerciseStatuses}=load('src/services/wodRuntimeStatus.js','deriveWodExerciseStatuses');
const present=load('src/utils/composerPresentation.js','formatComposerDose,composerWodProtocol,composerWodTimeSummary,composerMechanicIdentity,composerPreviewIssue,composerMechanicAdjustmentReason,composerWodRegionAdvisory');
assert.notEqual(present.composerMechanicIdentity({key:'COUPLET'}),present.composerMechanicIdentity({key:'COUPLET',variant_key:'DESCENDING_COUPLET'}));
assert.match(present.composerPreviewIssue({block_type:'WOD',reason:'EXERCISE_COUNT'}),/nombre de mouvements.*mécanique/);
assert.match(present.composerPreviewIssue({block_type:'WOD',reason:'PREMIUM_REQUIRED'}),/mécanique.*Premium/);
assert.doesNotMatch(present.composerPreviewIssue({block_type:'WOD'}),/Musculation|Renforcement/);
assert.match(present.composerWodTimeSummary({minutes:40,time:{budget_minutes:40,prescribed_seconds:900,duration_semantic:'time_cap'},parameters:{cap_seconds:2400}}),/limite 40 min.*15 min.*avant/);
assert.match(present.formatComposerDose({prescription_json:{reps_min:3,mechanic_overlay:{base_reps:3,increment_reps:2}}},'WOD',{mechanic:'COUPLET',variant_key:'DESCENDING_COUPLET',parameters:{rungs:4}}),/9 → 3 reps · −2/);
assert.match(present.composerMechanicAdjustmentReason({reason_code:'EXERCISE_COUNT',contract:{min_exercises:4,max_exercises:7}}),/4 et 7 mouvements/);
assert.match(present.composerMechanicAdjustmentReason({reason_code:'C4_PROTOCOL_REJECTED',details:['ATHLETE_WORKLOAD_ENVELOPE_EXCEEDED']}),/charge de travail/);
assert.match(present.composerWodRegionAdvisory({time:{advisories:['EXPLICIT_TARGET_REGION_COHERENCE_60']}}),/conserver/);
assert.equal(present.composerWodRegionAdvisory({time:{advisories:[]}}),null);
console.log('PASS: variant identities, progression dose, WOD errors and honest duration semantics');
if (!process.argv[2]) process.exit(0);
const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const player=fs.readFileSync('src/components/workout/WodProtocolPlayerV3.js','utf8');
const duration=new Function('numberOr',player.slice(player.indexOf('function totalSecondsForMechanic('),player.indexOf('\nfunction protocolSummary('))+'\nreturn totalSecondsForMechanic;')((n,f=0)=>Number.isFinite(Number(n))?Number(n):f);
const cases=[];
for(const [identity,b] of Object.entries(data.examples)) for(const full of [false,true]) {
 const mechanic=b.mechanic,params=b.mechanic_json.parameters;
 const ex=b.exercises.map(x=>({id:x.exercise_id,name:x.name,sessionExerciseId:x.session_exercise_id,blockKey:'wod',prescriptionJson:x.prescription_json}));
 const maxSeconds=duration({mechanic,params,durationMinutes:b.duration_minutes,exerciseCount:ex.length});
 const finish={AMRAP:'timer_complete',EMOM:'timer_complete',HIIT:'timer_complete',FOR_TIME:'rounds_complete',CIRCUIT:'rounds_complete',LADDER:'steps_complete',COUPLET:'steps_complete',PYRAMID:'steps_complete',CHIPPER:'sequence_complete',REP_TARGET:'sequence_complete',EVERY_X_MINUTES:'timer_complete',ODD_EVEN:'timer_complete',PROGRESSIVE_INTERVAL:'time_cap',SETS_REPS:'sets_complete',DECK:'deck_complete'}[mechanic];
 const steps=mechanic==='PYRAMID' ? params.cycles*params.multipliers.length : params.rungs ?? params.sets ?? 1;
 const runtime={started:true,finished:true,mechanic,variant:b.mechanic_json.variant_key,parameters:params,
  finishReason:full?finish:'manual_stop',elapsedSeconds:full?(maxSeconds??480):90,
  completedRounds:full?(params.rounds??params.cycles??3):1,manualStep:full?steps:1,
  currentItemIndex:full?(mechanic==='DECK'?params.deck_order.length-1:ex.length-1):0,
  currentStage:full?Math.floor((maxSeconds??480)/(params.interval_seconds??60)):2,controlledWindow:true};
 const result=buildWodProtocolCompletion({workout:{durationMinutes:b.duration_minutes,wodRuntime:runtime},exercises:ex});
 const states=deriveWodExerciseStatuses({mechanic,exercises:ex},runtime);
 assert.equal(result.outcome.protocol_completed,full,identity);
 assert.equal(result.outcome.variant_key,b.mechanic_json.variant_key??null,identity);
 assert.equal(result.exercises.length,ex.length);
 const previewBlock={mechanic,variant_key:b.mechanic_json.variant_key,parameters:params};
 assert.doesNotMatch(present.composerWodProtocol(previewBlock),/undefined|NaN/);
 for(const e of b.exercises) assert.doesNotMatch(present.formatComposerDose({reps:e.prescription_json.execution_target_reps,prescription_json:e.prescription_json},'WOD',previewBlock),/undefined|NaN/);
 const actuals=result.exercises.map(e=>({session_exercise_id:e.sessionExerciseId,exercise_id:e.id,
   user_execution_status:states.get(e.sessionExerciseId)??states.get(e.id)??(full?'completed':'adapted'),
   execution_reason_code:full?null:'TIME',reps_completed:e.repsCompleted??null,duration_seconds:e.durationSeconds??null,distance_meters:e.distanceMeters??null,
   performance_actual_json:e.performanceActualJson??null}));
 cases.push({identity,full,block:b,actuals,outcome:result.outcome});
}
const json=JSON.stringify(cases).replaceAll("'","''");
const sql=`-- Generated by qa-composer-wod-runtime.cjs from real DEV compiler outputs. Synthetic replay, not device UI.
BEGIN;
SET LOCAL statement_timeout='120s';
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
('00000000-0000-0000-0000-000000938003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-runtime-history-v2@example.invalid',now(),now());
INSERT INTO profiles(id,weight) VALUES('00000000-0000-0000-0000-000000938003',80) ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000938003';
DO $qa$
DECLARE c jsonb; e jsonb; sid uuid; r jsonb; actual jsonb; n int:=0; pos int; result jsonb:='[]';
BEGIN
 FOR c IN SELECT value FROM jsonb_array_elements('${json}'::jsonb) LOOP
  BEGIN
   sid:=gen_random_uuid();
   INSERT INTO workout_sessions(id,user_id,status,duration_minutes,readiness,focus,target_region,generated_at,generation_local_date,planned_environment_code,progression_intent,mechanic_json,generated_workout)
   VALUES(sid,auth.uid(),'generated',60,'6','General Fitness','Full Body',now(),current_date,'HOME','MAINTAIN',c#>'{block,mechanic_json}',jsonb_build_object('blocks',jsonb_build_array(c->'block')));
   pos:=0;
   FOR e IN SELECT value FROM jsonb_array_elements(c#>'{block,exercises}') LOOP
    pos:=pos+1;
    INSERT INTO workout_session_exercises(id,session_id,exercise_id,exercise_name,block_key,position,status,prescription_json,expected_outcome_json,user_execution_status)
    VALUES((e->>'session_exercise_id')::uuid,sid,e->>'exercise_id',e->>'name','wod',pos,'pending',e->'prescription_json',e->'prescription_json','pending');
   END LOOP;
   PERFORM public.e_mark_session_started(sid,current_date);
   PERFORM public.mark_wod_revealed(sid);
   PERFORM public.mark_wod_started(sid);
   r:=public.complete_workout_session_v2(sid,6,7,'Synthetic QA replay',c->'actuals',c->'outcome');
   IF r->>'status'<>'COMPLETED' THEN RAISE EXCEPTION 'Completion failed: %',r; END IF;
   SELECT actual_protocol_outcome_json INTO actual FROM workout_sessions WHERE id=sid AND status='completed';
   IF actual->'protocol_completed' IS DISTINCT FROM c->'full' OR actual->>'mechanic_key'<>c#>>'{block,mechanic}'
    OR actual->'completion_ratio' IS DISTINCT FROM c#>'{outcome,completion_ratio}' THEN RAISE EXCEPTION 'History outcome mismatch for %',c->>'identity'; END IF;
   IF (SELECT count(*) FROM exercise_logs WHERE session_id=sid)<>jsonb_array_length(c->'actuals') THEN RAISE EXCEPTION 'History logs missing'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(c->'actuals') a JOIN exercise_logs el ON el.session_exercise_id=(a->>'session_exercise_id')::uuid
     WHERE el.session_id=sid AND (el.reps_completed IS DISTINCT FROM (a->>'reps_completed')::int
      OR el.user_execution_status IS DISTINCT FROM a->>'user_execution_status')) THEN RAISE EXCEPTION 'Actual reps/status lost'; END IF;
   IF EXISTS(SELECT 1 FROM workout_session_exercises WHERE session_id=sid AND user_execution_status='pending') THEN RAISE EXCEPTION 'Pending exercises after completion'; END IF;
   IF public.complete_workout_session_v2(sid,6,7,NULL,c->'actuals',c->'outcome')->>'status'<>'ALREADY_COMPLETED' THEN RAISE EXCEPTION 'Completion not idempotent'; END IF;
   n:=n+1; result:=result||jsonb_build_array(jsonb_build_object('identity',c->>'identity','full',c->'full','status','PASS'));
   RAISE SQLSTATE 'Z0001' USING MESSAGE='CASE_ROLLBACK';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END;
 END LOOP;
 PERFORM set_config('ugerod.qa_runtime_history',jsonb_build_object('cases',n,'results',result)::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_runtime_history')::jsonb AS audit;
ROLLBACK;
`;
assert.ok(process.argv[3], 'Provide output SQL path');fs.writeFileSync(process.argv[3],sql);
console.log('PASS: '+cases.length+' partial/full real protocol replays generated for completion/history QA');
