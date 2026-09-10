import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return source.replace(from, to);
}

// Session player: use V3 shell, keep format editable until actual WOD start,
// and derive conservative statuses on partial WOD completion.
{
  const path = 'app/workout/session-focused-core.js';
  let s = read(path);
  s = replaceOnce(
    s,
    "import { adaptSessionExercise } from '../../src/services/sessionAdaptationService';\nimport WodProtocolPlayer from '../../src/components/workout/WodProtocolPlayer';",
    "import { adaptSessionExercise } from '../../src/services/sessionAdaptationService';\nimport { applyWodRuntimeStatuses } from '../../src/services/wodRuntimeStatus';\nimport WodProtocolPlayer from '../../src/components/workout/WodProtocolPlayerV3';",
    'session imports'
  );
  s = replaceOnce(
    s,
    "  function finalizeBlock(block, extraExercisePatch = null) {\n    const nextValidated = Array.from(new Set([...validatedBlocks, block.id]));\n    const nextExercises = (workout?.exercises ?? []).map((exercise) => {",
    "  function finalizeBlock(block, extraExercisePatch = null) {\n    const nextValidated = Array.from(new Set([...validatedBlocks, block.id]));\n    const completionBaseExercises = block.id === 'wod'\n      ? applyWodRuntimeStatuses(workout?.exercises ?? [], block, workout?.wodRuntime ?? null)\n      : (workout?.exercises ?? []);\n    const nextExercises = completionBaseExercises.map((exercise) => {",
    'wod status base'
  );
  s = replaceOnce(
    s,
    "      return statusValue(next) === 'pending' ? { ...next, status: 'completed' } : next;",
    "      if (block.id === 'wod') return next;\n      return statusValue(next) === 'pending' ? { ...next, status: 'completed' } : next;",
    'do not auto complete partial wod'
  );
  s = replaceOnce(
    s,
    "  async function openFormatModal() {\n    if (!workout?.sessionId || workout?.formatLocked || workout?.wodRuntime?.started) return;",
    "  async function openFormatModal() {\n    const wodHasStarted = Boolean(workout?.wodRuntime?.started || workout?.wodStarted || workout?.wodStartedAt);\n    if (!workout?.sessionId || wodHasStarted) return;",
    'format modal guard'
  );
  s = replaceOnce(
    s,
    "              {[activeBlock.structure, activeBlock.durationLabel].filter(Boolean).join(' · ')}",
    "              {(activeBlock.id === 'wod'\n                ? [workout?.format ?? activeBlock?.source?.mechanicLabel, activeBlock.durationLabel]\n                : [activeBlock.structure, activeBlock.durationLabel])\n                .filter(Boolean)\n                .join(' · ')}",
    'header duplicate duration'
  );
  s = s.replaceAll(
    "remainingFormatChanges > 0 && !workout?.formatLocked",
    "remainingFormatChanges > 0 && !workout?.wodStarted && !workout?.wodStartedAt"
  );
  s = s.replaceAll('<Text style={styles.smallActionText}>Modifier</Text>', '<Text style={styles.smallActionText}>Changer</Text>');
  write(path, s);
}

// Completion screen safety: pending/unknown never silently means completed.
{
  const path = 'app/workout/completion-core.js';
  let s = read(path);
  s = replaceOnce(
    s,
    "function executionStatus(exercise) {\n  if (exercise.status === 'adapted') {\n    return 'adapted';\n  }\n\n  if (\n    exercise.status ===\n      'not_completed' ||\n    exercise.status === 'skipped'\n  ) {\n    return 'not_completed';\n  }\n\n  return 'completed';\n}",
    "function executionStatus(exercise) {\n  if (exercise.status === 'completed') return 'completed';\n  if (exercise.status === 'adapted') return 'adapted';\n  return 'not_completed';\n}",
    'completion pending safety'
  );
  write(path, s);
}

// Completion payload safety: only explicit completed/adapted count as performed.
{
  const path = 'src/services/workoutService.js';
  let s = read(path);
  s = replaceOnce(
    s,
    "function normalizeUserExecutionStatus(status) {\n  if (status === 'adapted') {\n    return 'adapted';\n  }\n\n  if (\n    status === 'not_completed' ||\n    status === 'skipped'\n  ) {\n    return 'not_completed';\n  }\n\n  return 'completed';\n}",
    "function normalizeUserExecutionStatus(status) {\n  if (status === 'completed') return 'completed';\n  if (status === 'adapted') return 'adapted';\n  return 'not_completed';\n}",
    'payload pending safety'
  );
  write(path, s);
}

// Protocol outcome: controlled interval formats now produce per-exercise actual evidence
// when a full interval/cycle was objectively completed.
{
  const path = 'src/services/wodProtocolOutcome.js';
  let s = read(path);

  const emomTail = "    outcome.completion_ratio =\n      plannedIntervals > 0\n        ? clamp01(\n            intervals / plannedIntervals\n          )\n        : outcome.protocol_completed\n          ? 1\n          : 0;\n  } else if (\n    mechanic === 'EVERY_X_MINUTES'\n  ) {";
  const emomNew = "    outcome.completion_ratio =\n      plannedIntervals > 0\n        ? clamp01(\n            intervals / plannedIntervals\n          )\n        : outcome.protocol_completed\n          ? 1\n          : 0;\n\n    for (let interval = 0; interval < intervals; interval += 1) {\n      const exerciseIndex = mechanic === 'EMOM'\n        ? interval % Math.max(1, wodExercises.length)\n        : Math.max(\n            0,\n            numberOr(\n              (interval + 1) % 2 === 1 ? parameters.odd_position : parameters.even_position,\n              (interval + 1) % 2 === 1 ? 1 : 2\n            ) - 1\n          );\n      const exercise = wodExercises[exerciseIndex] ?? wodExercises[0] ?? null;\n      if (exercise) addExactRoundObservation(actuals, exercise, 1, 'controlled_interval');\n    }\n  } else if (\n    mechanic === 'EVERY_X_MINUTES'\n  ) {";
  s = replaceOnce(s, emomTail, emomNew, 'emom odd-even actuals');

  const everyTail = "    outcome.completion_ratio =\n      plannedCycles > 0\n        ? clamp01(cycles / plannedCycles)\n        : outcome.protocol_completed\n          ? 1\n          : 0;\n  } else if (mechanic === 'HIIT') {";
  const everyNew = "    outcome.completion_ratio =\n      plannedCycles > 0\n        ? clamp01(cycles / plannedCycles)\n        : outcome.protocol_completed\n          ? 1\n          : 0;\n\n    for (let cycle = 0; cycle < cycles; cycle += 1) {\n      for (const exercise of wodExercises) {\n        addExactRoundObservation(actuals, exercise, 1, 'every_x_cycle');\n      }\n    }\n  } else if (mechanic === 'HIIT') {";
  s = replaceOnce(s, everyTail, everyNew, 'every x actuals');

  const hiitTail = "    outcome.completion_ratio = clamp01(\n      stations / plannedStations\n    );\n  } else if (\n    mechanic === 'LADDER' ||";
  const hiitNew = "    outcome.completion_ratio = clamp01(\n      stations / plannedStations\n    );\n\n    for (let station = 0; station < stations; station += 1) {\n      const exercise = wodExercises[station % Math.max(1, wodExercises.length)] ?? null;\n      if (!exercise) continue;\n      addSessionTotals(actuals, exercise, { durationSeconds: workSeconds });\n      setCapabilityObservation(actuals, exercise, {\n        durationSeconds: workSeconds,\n        unit: 'controlled_work_interval',\n      });\n    }\n  } else if (\n    mechanic === 'LADDER' ||";
  s = replaceOnce(s, hiitTail, hiitNew, 'hiit actuals');

  write(path, s);
}
