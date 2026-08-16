import fs from 'node:fs';
import path from 'node:path';

const file = path.join(
  process.cwd(),
  'app/workout/session.js'
);

if (!fs.existsSync(file)) {
  throw new Error(
    'Fichier introuvable: app/workout/session.js'
  );
}

const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let source = raw.replace(/\r\n/g, '\n');

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);

  if (first < 0) {
    throw new Error(
      `Patch impossible (${label}): bloc attendu introuvable.`
    );
  }

  if (
    source.indexOf(
      before,
      first + before.length
    ) >= 0
  ) {
    throw new Error(
      `Patch ambigu (${label}): bloc trouvé plusieurs fois.`
    );
  }

  source =
    source.slice(0, first) +
    after +
    source.slice(first + before.length);
}

// Titles: display-only. Internal block keys stay unchanged.
if (source.includes("  tabata: 'TABATA CORE',")) {
  source = source.replace(
    "  tabata: 'TABATA CORE',",
    "  tabata: 'TABATA',"
  );
} else if (!source.includes("  tabata: 'TABATA',")) {
  throw new Error(
    'Libellé TABATA inattendu: aucune modification appliquée.'
  );
}

if (
  source.includes(
    "  warmup: 'WARM-UP SPÉCIFIQUE',"
  )
) {
  source = source.replace(
    "  warmup: 'WARM-UP SPÉCIFIQUE',",
    "  warmup: 'WARM-UP',"
  );
} else if (
  !source.includes("  warmup: 'WARM-UP',")
) {
  throw new Error(
    'Libellé WARM-UP inattendu: aucune modification appliquée.'
  );
}

const helperMarker = `function buildPreWodBlockStructure({`;

if (!source.includes(helperMarker)) {
  replaceOnce(
`function readBlockStructure(block) {
  return (
    block?.structure ??
    block?.mechanicLabel ??
    ''
  );
}

function buildBlocks(`,
`function readBlockStructure(block) {
  return (
    block?.structure ??
    block?.mechanicLabel ??
    ''
  );
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function formatCompactNumber(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Number.isInteger(numeric)
    ? String(numeric)
    : String(
        Math.round(numeric * 10) / 10
      );
}

function getExercisePrescription(exercise) {
  const value =
    exercise?.prescriptionJson ??
    exercise?.prescription_json ??
    (exercise?.prescription &&
    typeof exercise.prescription === 'object'
      ? exercise.prescription
      : null);

  return value && typeof value === 'object'
    ? value
    : {};
}

function formatExerciseCount(count) {
  const safeCount = Math.max(
    1,
    Number(count) || 1
  );

  return \`${safeCount} exercice\${
    safeCount > 1 ? 's' : ''
  }\`;
}

function buildPreWodBlockStructure({
  blockId,
  source,
  blockExercises,
  durationMinutes,
}) {
  const exerciseCount =
    blockExercises.length;
  const prescription =
    getExercisePrescription(
      blockExercises[0]
    );
  const protocol =
    prescription?.protocol &&
    typeof prescription.protocol === 'object'
      ? prescription.protocol
      : {};

  if (blockId === 'tabata') {
    const rounds = firstFiniteNumber(
      source?.rounds,
      protocol.rounds,
      8
    );
    const workSeconds =
      firstFiniteNumber(
        source?.workSeconds,
        source?.work_seconds,
        protocol.work_seconds
      );
    const restSeconds =
      firstFiniteNumber(
        source?.restSeconds,
        source?.rest_seconds,
        protocol.rest_seconds
      );

    if (
      rounds != null &&
      workSeconds != null &&
      restSeconds != null
    ) {
      return \`${formatCompactNumber(
        rounds
      )} séries · ${formatCompactNumber(
        workSeconds
      )}s travail / ${formatCompactNumber(
        restSeconds
      )}s repos\`;
    }
  }

  if (blockId === 'skill') {
    const contract =
      source?.skillContract ??
      source?.skill_contract ??
      {};
    const patch =
      contract?.prescription_patch &&
      typeof contract.prescription_patch ===
        'object'
        ? contract.prescription_patch
        : {};

    const sets = firstFiniteNumber(
      contract?.sets,
      patch?.sets,
      prescription?.sets
    );
    const restSeconds =
      firstFiniteNumber(
        contract?.restSeconds,
        contract?.rest_seconds,
        patch?.rest_between_sets_seconds,
        prescription?.rest_between_sets_seconds
      );
    const workSeconds =
      firstFiniteNumber(
        patch?.execution_target_duration_seconds,
        prescription?.execution_target_duration_seconds
      );
    const targetReps =
      firstFiniteNumber(
        patch?.execution_target_reps,
        prescription?.execution_target_reps
      );
    const repsMin = firstFiniteNumber(
      prescription?.reps_min
    );
    const repsMax = firstFiniteNumber(
      prescription?.reps_max
    );

    const seriesLabel = sets != null
      ? \`${formatCompactNumber(
          sets
        )} séries\`
      : '1 série';

    if (workSeconds != null) {
      const workLabel =
        \`${formatCompactNumber(
          workSeconds
        )}s travail\`;

      return restSeconds != null
        ? \`${seriesLabel} · ${workLabel} / ${formatCompactNumber(
            restSeconds
          )}s repos\`
        : \`${seriesLabel} · ${workLabel}\`;
    }

    let repsLabel = null;

    if (targetReps != null) {
      repsLabel = \`${formatCompactNumber(
        targetReps
      )} reps\`;
    } else if (
      repsMin != null ||
      repsMax != null
    ) {
      const min = formatCompactNumber(
        repsMin ?? repsMax
      );
      const max = formatCompactNumber(
        repsMax ?? repsMin
      );

      repsLabel = min === max
        ? \`${min} reps\`
        : \`${min}–${max} reps\`;
    }

    if (repsLabel) {
      return restSeconds != null
        ? \`${seriesLabel} · ${repsLabel} · ${formatCompactNumber(
            restSeconds
          )}s repos\`
        : \`${seriesLabel} · ${repsLabel}\`;
    }

    return seriesLabel;
  }

  if (
    blockId === 'unlock' ||
    blockId === 'warmup'
  ) {
    const safeCount = Math.max(
      1,
      exerciseCount
    );
    const totalSeconds =
      Math.max(
        0,
        Number(durationMinutes) || 0
      ) * 60;
    const secondsPerExercise =
      totalSeconds > 0
        ? Math.round(
            totalSeconds / safeCount
          )
        : null;

    const parts = [
      '1 série',
      formatExerciseCount(safeCount),
    ];

    if (secondsPerExercise != null) {
      parts.push(
        \`${formatCompactNumber(
          secondsPerExercise
        )}s / exercice\`
      );
    }

    return parts.join(' · ');
  }

  return readBlockStructure(source);
}

function buildBlocks(`,
    'block summary helpers'
  );
}

replaceOnce(
`      const structure =
        readBlockStructure(source);`,
`      const structure =
        buildPreWodBlockStructure({
          blockId,
          source,
          blockExercises,
          durationMinutes: duration,
        });`,
  'dynamic block summary'
);

replaceOnce(
`        structure:
          structure ||
          (blockId === 'unlock'
            ? 'Mobilité / déverrouillage · faible fatigue'
            : blockId === 'tabata'
              ? '8 rounds · 20s travail / 10s repos'
              : blockId === 'warmup'
                ? 'Préparation directe du Skill et du WOD'
                : blockId === 'wod'
                  ? workout.format ??
                    'FORMAT UGEROD'
                  : ''),`,
`        structure:
          structure ||
          (blockId === 'wod'
            ? workout.format ??
              'FORMAT UGEROD'
            : ''),`,
  'remove descriptive pre-WOD fallbacks'
);

fs.writeFileSync(
  file,
  source.replace(/\n/g, eol),
  'utf8'
);

console.log(
  '✅ Résumés UNLOCK / TABATA / WARM-UP / SKILL homogénéisés.'
);
console.log('Fichier modifié:');
console.log(' - app/workout/session.js');
console.log('Exemples attendus:');
console.log(' - UNLOCK · 1 série · 2 exercices · 60s / exercice');
console.log(' - TABATA · 8 séries · 20s travail / 10s repos');
console.log(' - WARM-UP · 1 série · 3 exercices · 80s / exercice');
console.log(' - SKILL · 3 séries · 35s travail / 75s repos');
