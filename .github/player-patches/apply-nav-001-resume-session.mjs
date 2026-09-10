import fs from 'node:fs';

function replaceOnce(path, before, after) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(before)) {
    throw new Error(`Pattern not found in ${path}: ${before.slice(0, 120)}`);
  }
  const next = source.replace(before, after);
  fs.writeFileSync(path, next);
}

replaceOnce(
  'app/workout/session-focused-core.js',
`  const activeExerciseIndex = activeBlock
    ? Math.min(
        exerciseIndexes[activeBlock.id] ?? 0,
        Math.max(0, activeBlock.exercises.length - 1)
      )
    : 0;
  const activeExercise = activeBlock?.exercises?.[activeExerciseIndex] ?? null;`,
`  const savedPlayerCursor = workout?.playerCursor ?? null;
  const savedCursorMatchesBlock =
    Boolean(activeBlock) &&
    normalizeBlockId(savedPlayerCursor?.blockId) === activeBlock.id &&
    (!savedPlayerCursor?.sessionId || savedPlayerCursor.sessionId === workout?.sessionId);
  const savedCursorInstanceIndex =
    savedCursorMatchesBlock && savedPlayerCursor?.sessionExerciseId
      ? activeBlock.exercises.findIndex(
          (exercise) => exercise?.sessionExerciseId === savedPlayerCursor.sessionExerciseId
        )
      : -1;
  const savedCursorNumericIndex = Number(savedPlayerCursor?.exerciseIndex);
  const savedCursorIndex = savedCursorMatchesBlock
    ? savedCursorInstanceIndex >= 0
      ? savedCursorInstanceIndex
      : Number.isFinite(savedCursorNumericIndex)
        ? savedCursorNumericIndex
        : 0
    : 0;

  const activeExerciseIndex = activeBlock
    ? Math.max(
        0,
        Math.min(
          exerciseIndexes[activeBlock.id] ?? savedCursorIndex,
          Math.max(0, activeBlock.exercises.length - 1)
        )
      )
    : 0;
  const activeExercise = activeBlock?.exercises?.[activeExerciseIndex] ?? null;`
);

replaceOnce(
  'app/workout/session-focused-core.js',
`    const nextCursor = {
      blockId: activeBlock.id,
      exerciseIndex: activeExerciseIndex,
      sessionExerciseId: activeExercise?.sessionExerciseId ?? null,
      exerciseId: activeExercise?.exerciseId ?? activeExercise?.id ?? null,
    };`,
`    const nextCursor = {
      sessionId: workout?.sessionId ?? null,
      blockId: activeBlock.id,
      exerciseIndex: activeExerciseIndex,
      sessionExerciseId: activeExercise?.sessionExerciseId ?? null,
      exerciseId: activeExercise?.exerciseId ?? activeExercise?.id ?? null,
    };`
);

replaceOnce(
  'app/workout/session-focused-core.js',
`      currentCursor?.blockId === nextCursor.blockId &&
      Number(currentCursor?.exerciseIndex ?? -1) === nextCursor.exerciseIndex &&`,
`      (currentCursor?.sessionId ?? null) === nextCursor.sessionId &&
      currentCursor?.blockId === nextCursor.blockId &&
      Number(currentCursor?.exerciseIndex ?? -1) === nextCursor.exerciseIndex &&`
);

replaceOnce(
  'app/workout/session-focused-core.js',
`    workout?.playerCursor?.blockId,
    workout?.playerCursor?.exerciseIndex,`,
`    workout?.sessionId,
    workout?.playerCursor?.sessionId,
    workout?.playerCursor?.blockId,
    workout?.playerCursor?.exerciseIndex,`
);

replaceOnce(
  'app/workout/session.js',
`  const progressRecorded = hasRecordedProgress(workout);

  const hasSkill = useMemo(`,
`  const progressRecorded = hasRecordedProgress(workout);
  const hasResumeCursor = Boolean(
    workout?.playerCursor?.blockId &&
      (!workout?.playerCursor?.sessionId || workout.playerCursor.sessionId === workout?.sessionId)
  );

  const hasSkill = useMemo(`
);

replaceOnce(
  'app/workout/session.js',
`    if (!progressRecorded) setOverviewOpen(true);
  }, [progressRecorded, workout?.sessionId]);`,
`    if (!progressRecorded && !hasResumeCursor) setOverviewOpen(true);
  }, [hasResumeCursor, progressRecorded, workout?.sessionId]);`
);

replaceOnce(
  'src/workout/PreparationCheckinV4.js',
`              <Text style={styles.resumeText}>Reprends la séance existante.</Text>`,
`              <Text style={styles.resumeText}>Reprends exactement là où tu t’es arrêté.</Text>`
);

replaceOnce(
  'src/workout/PreparationCheckinV4.js',
`              <Text style={styles.resumeButtonText}>Reprendre</Text>`,
`              <Text style={styles.resumeButtonText}>Continuer</Text>`
);

console.log('NAV-001 resume-session patch applied.');
