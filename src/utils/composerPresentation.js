// Presentation only: doses and duration checks remain owned by the backend.
export function composerDurationSummary(assessment, budgetMinutes) {
  if (assessment?.time?.prescribed_seconds == null) return null;
  const seconds = Number(assessment?.time?.prescribed_seconds);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const estimate = Math.round(seconds / 60);
  const status = assessment.status === 'READY' ? 'Durée compatible.'
    : seconds < Number(budgetMinutes) * 60 ? 'Le bloc ne remplit pas le temps prévu.'
      : 'Le bloc dépasse le temps prévu.';
  return `${budgetMinutes} min prévues · environ ${estimate} min estimées, récupérations et installation comprises. ${status}`;
}

export function formatComposerDose(dose, blockType) {
  if (!dose) return '';
  if (blockType === 'TABATA') return dose.intervals_per_exercise
    ? `${dose.intervals_per_exercise} passages · 20 s effort / 10 s repos`
    : '20 s effort / 10 s repos';
  const parts = [];
  let work = '';
  if (dose.reps != null && Number.isFinite(Number(dose.reps))) {
    work = `${dose.reps} reps${dose.reps_semantics === 'per_side' ? ' / côté' : ''}`;
  } else if (dose.duration_seconds != null) work = `${dose.duration_seconds} s`;
  else if (dose.distance_meters != null) work = `${dose.distance_meters} m`;
  if (work) parts.push(dose.sets ? `${dose.sets} × ${work}` : work);
  if (dose.load_kg != null) parts.push(`${dose.load_kg} kg`);
  else if (dose.band_resistance_label) parts.push(`Élastique ${dose.band_resistance_label}`);
  if (dose.rest_seconds && ['STRENGTH', 'SKILL'].includes(blockType)) parts.push(`${dose.rest_seconds} s repos`);
  return parts.join(' · ') || 'Dosage à calibrer';
}

export function composerMovementAction(count, limit) {
  if (!count) return 'Choisir un mouvement';
  return count >= limit ? 'Remplacer un mouvement' : 'Ajouter ou remplacer un mouvement';
}

export function composerMechanicDescription(option) {
  if (option.available === false) return option.reason;
  return {
    AMRAP: 'Répète les exercices dans l’ordre jusqu’à la fin du temps.',
    EMOM: 'À chaque minute, passe au mouvement suivant. Récupère sur le temps restant.',
    CIRCUIT: 'Enchaîne les exercices sur le nombre de tours prévu.',
    FOR_TIME: 'Termine les tours prévus avant la limite de temps.',
    HIIT: 'Alterne les périodes d’effort et de récupération.',
  }[option.key] || option.description;
}

export function composerWodProtocol(block) {
  if (!block) return null;
  const parts = [];
  if (block.rounds != null) parts.push(`${block.rounds} ${block.mechanic === 'EMOM' || block.mechanic === 'HIIT' ? 'cycles' : 'tours'}`);
  if (block.work_seconds != null && block.rest_seconds != null) {
    parts.push(`${block.work_seconds} s effort / ${block.rest_seconds} s repos`);
  }
  return parts.join(' · ') || null;
}

export function currentComposerAssessment(result, resultSignature, requestSignature, loading, error) {
  return !loading && !error && resultSignature === requestSignature ? result : null;
}
