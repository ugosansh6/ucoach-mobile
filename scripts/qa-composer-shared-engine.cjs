#!/usr/bin/env node
'use strict';
/* Regression guard for the Composer/standard-engine integration.
 * Static CI protects wiring; DEV SQL rollback QA proves live C2/C4 behavior.
 */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(p, 'utf8');
const service = read('src/services/composerService.js');
const ui = read('src/workout/WeekComposerV7.js');
const dayj = read('supabase/migrations/20261028160000_composer_dayj_preserve_c2_strength_dose.sql');
const preview = read('supabase/migrations/20261028155000_composer_preview_preserve_c2_strength_dose.sql');
const engine = read('supabase/migrations/20261028143000_composer_shared_strength_environment_contract_v2.sql');
const qa = read('supabase/qa/composer_shared_strength_authority_rollback.sql');
const generation = read('src/services/workoutGenerationService.js');
let checks = 0;
function check(name, fn) { fn(); ++checks; console.log('PASS',name); }
check('one shared C2/C4 engine drives preview and Day-J',()=>{
 assert.match(preview,/week_composer_strength_authority_v2\(/);
 assert.match(dayj,/week_composer_strength_authority_v2\(/);
 assert.match(engine,/c4_finalize_sets_reps_candidate\(/);
 assert.match(engine,/gym_estimate_real_elapsed_time_v1\(/);
 assert.match(engine,/c2_solver_prescription\(/);
});
check('no custom Strength set count or 90s rest remains in latest compiler',()=>{
 assert.doesNotMatch(dayj,/elsif v_type in \('STRENGTH','SKILL'\) then\s+v_sets/);
 assert.doesNotMatch(dayj,/when v_type='STRENGTH' then 90/);
 assert.match(dayj,/v_sets:=\(v_strength_plan->>'sets'\)::int/);
});
check('strength count is owned by backend, not a duration threshold',()=>{
 assert.match(service,/week_composer_strength_autopick_v2/);
 assert.match(service,/week_composer_strength_authority_v2/);
 assert.match(service,/if \(blockType === 'STRENGTH'\) \{\s*\/\/ Eight is the existing Composer draft/);
 assert.match(ui,/proposal\.selected_exercises\.map/);
 assert.match(ui,/getComposerStrengthAutoPick\(/);
 assert.match(ui,/getComposerStrengthAssessment\(/);
});
check('live environment-aware duration semantics',()=>{
 assert.match(engine,/C4_STANDARD_DURATION/);
 assert.match(engine,/GYM_STANDARD_REAL_ELAPSED/);
 assert.match(service,/p_environment_code: environmentCode/);
});
check('failed or stale preview blocks persistence before week item mutation',()=>{
 const gate = ui.indexOf('JSON.stringify(buildCurrentDraft()) !== previewSignature');
 const sideEffect = ui.indexOf('let planItemId = selectedItem?.planItemId');
 assert.ok(gate>=0 && sideEffect>gate);
 assert.match(ui,/previewSignature !== JSON.stringify\(buildCurrentDraft\(\)\)/);
 assert.match(preview,/NEEDS_RECOMPOSITION/);
});
check('Day-J revalidates and provides actionable error instead of silent duplicate',()=>{
 assert.match(dayj,/COMPOSER_STRENGTH_RECOMPOSITION_REQUIRED/);
 assert.match(generation,/COMPOSER_NEEDS_RECOMPOSITION/);
 assert.match(dayj,/if v_item.session_id is not null then/);
 assert.match(dayj,/COMPOSER_DAY_MISMATCH/);
});
check('DEV SQL QA always rolls back',()=>{
 assert.match(qa,/^BEGIN;/);
 assert.match(qa,/ROLLBACK;\s*$/);
});
console.log(checks+' Composer shared-engine contract checks passed.');
