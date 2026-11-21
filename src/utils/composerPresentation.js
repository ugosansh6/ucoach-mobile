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

export function formatComposerDose(dose, blockType, block = null) {
  if (!dose) return '';
  if (blockType === 'CARDIO') return dose.text ?? dose.prescription_json?.text ?? 'Protocole cardio';
  if (blockType === 'TABATA') return dose.intervals_per_exercise
    ? `${dose.intervals_per_exercise} passages · 20 s effort / 10 s repos`
    : '20 s effort / 10 s repos';
  const parts = [];
  let work = '';
  if (blockType === 'WOD' && block?.parameters) {
    const protocolDose = composerProgressionDose(dose, block);
    if (protocolDose) return protocolDose;
  }
  if (dose.reps != null && Number.isFinite(Number(dose.reps))) {
    work = `${dose.reps} reps${dose.reps_semantics === 'per_side' ? ' / côté' : ''}`;
  } else if (dose.duration_seconds != null) work = `${dose.duration_seconds} s`;
  else if (dose.distance_meters != null) work = `${dose.distance_meters} m`;
  const sets = dose.sets ?? (block?.mechanic === 'SETS_REPS' ? block.parameters?.sets : null);
  if (work) parts.push(sets ? `${sets} × ${work}` : work);
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
  if (option.available === false) {
    const reasons = (option.details ?? []).join(' ');
    if (/ATHLETE_WORKLOAD|VOLUME_EXCEEDS|TOO_MUCH/.test(reasons)) return 'Le volume de ce protocole dépasse la charge validée pour ton profil. Essaie une durée plus courte ou d’autres mouvements.';
    if (/TOO_SHORT|FAILURE_TOO_EARLY|UNDERFILLED/.test(reasons)) return 'Ce protocole se terminerait trop tôt pour le temps prévu. Ajuste la durée ou les mouvements.';
    if (/NO_COMPLETE_CYCLE|PARTIAL_CYCLE/.test(reasons)) return 'La durée ne permet pas un cycle complet avec ces mouvements.';
    return option.reason;
  }
  return {
    AMRAP: 'Répète les exercices dans l’ordre jusqu’à la fin du temps.',
    EMOM: 'À chaque minute, passe au mouvement suivant. Récupère sur le temps restant.',
    CIRCUIT: 'Enchaîne les exercices sur le nombre de tours prévu.',
    FOR_TIME: 'Termine les tours prévus avant la limite de temps.',
    HIIT: 'Alterne les périodes d’effort et de récupération.',
  }[option.key] || option.description;
}

export function composerMechanicIdentity(option) {
  return option ? `${option.key}:${option.variant_key ?? ''}` : null;
}

export function composerWodTimeSummary(block) {
  if (!block?.time) return null;
  const time = block.time;
  const semantic = time.duration_semantic;
  const planned = Number(time.budget_minutes ?? block.minutes);
  const estimate = Number(time.prescribed_seconds);
  const estimated = time.prescribed_seconds != null && Number.isFinite(estimate)
    ? ` · environ ${Math.round(estimate / 60)} min estimées` : '';
  const p = block.parameters ?? {};
  if (semantic === 'fixed_duration') {
    return `${planned} min réservées${estimated}. La durée exécutée suit les cycles complets du protocole.`;
  }
  if (semantic === 'time_cap') {
    const cap = Number(p.cap_seconds ?? p.time_limit_seconds);
    return `${planned} min réservées${Number.isFinite(cap) ? ` · limite ${cap / 60} min` : ''}${estimated}. Fin possible avant la limite.`;
  }
  return `${planned} min réservées${estimated}. La fin dépend du volume à réaliser.`;
}

export function composerWodProtocol(block) {
  if (!block) return null;
  const p = block.parameters;
  if (p) {
    const rest = p.rest_between_rounds_seconds;
    switch (block.mechanic) {
      case 'AMRAP': return `${p.duration_minutes} min · répète les mouvements dans l’ordre`;
      case 'EMOM': return `${p.cycles} cycles · ${p.station_seconds} s par mouvement`;
      case 'FOR_TIME': return `${p.rounds} tours · limite ${Number(p.cap_seconds) / 60} min`;
      case 'CIRCUIT': return `${p.rounds} tours${rest != null ? ` · ${rest} s repos entre les tours` : ''}`;
      case 'HIIT': return `${p.rounds} tours · ${p.work_seconds} s effort / ${p.rest_seconds} s repos`;
      case 'LADDER': case 'COUPLET': return `${p.rungs} étapes · ${p.sequence_direction === 'descending' || block.variant_key === 'DESCENDING_COUPLET' ? 'répétitions décroissantes' : 'répétitions croissantes'}`;
      case 'PYRAMID': return `${p.cycles} cycles · progression ${(p.multipliers ?? []).join(' → ')}`;
      case 'CHIPPER': return 'Un seul passage · termine le volume de chaque mouvement';
      case 'REP_TARGET': return `${p.total_rep_target} répétitions au total · volumes répartis par mouvement`;
      case 'EVERY_X_MINUTES': return `${p.cycles} départs · un départ toutes les ${p.interval_seconds} s`;
      case 'ODD_EVEN': return `${p.cycles} cycles · mouvements alternés toutes les ${p.station_seconds} s`;
      case 'PROGRESSIVE_INTERVAL': return `${p.interval_seconds} s par étape · arrêt à l’échec ou à la limite ${Number(p.time_limit_seconds) / 60} min`;
      case 'SETS_REPS': return `${p.sets} séries · ${p.rest_between_exercises_seconds} s repos`;
      case 'DECK': return `${p.cards} cartes · 4 mouvements associés aux couleurs des cartes`;
      default: return null;
    }
  }
  const parts = [];
  if (block.rounds != null) parts.push(`${block.rounds} ${block.mechanic === 'EMOM' || block.mechanic === 'HIIT' ? 'cycles' : 'tours'}`);
  if (block.work_seconds != null && block.rest_seconds != null) parts.push(`${block.work_seconds} s effort / ${block.rest_seconds} s repos`);
  return parts.join(' · ') || null;
}

function composerProgressionDose(dose, block) {
  const p = dose.prescription_json ?? {};
  const overlay = p.mechanic_overlay ?? {};
  const params = block.parameters;
  const suffix = p.reps_semantics === 'per_side' ? ' / côté' : '';
  if (block.mechanic === 'DECK') return `Répétitions données par chaque carte${suffix}`;
  const base = Number(overlay.start_reps ?? overlay.base_reps ?? p.execution_target_reps ?? p.reps_min);
  const increment = Number(overlay.increment_reps);
  if (['LADDER', 'COUPLET', 'PROGRESSIVE_INTERVAL'].includes(block.mechanic) && Number.isFinite(base) && Number.isFinite(increment)) {
    if (block.mechanic === 'PROGRESSIVE_INTERVAL') return `${base} reps au départ · +${increment} par étape${suffix}`;
    const descending = params.sequence_direction === 'descending' || block.variant_key === 'DESCENDING_COUPLET';
    const first = descending ? Number(overlay.first_stage_reps ?? base + (params.rungs - 1) * increment) : base;
    const last = descending ? base : base + (params.rungs - 1) * increment;
    return `${first} → ${last} reps · ${descending ? '−' : '+'}${increment} par étape${suffix}`;
  }
  if (block.mechanic === 'PYRAMID' && Number.isFinite(base) && Array.isArray(params.multipliers)) {
    return `${params.multipliers.map((n) => n * base).join(' → ')} reps${suffix}`;
  }
  return null;
}

export function composerPreviewIssue(issue, environmentCode = 'BOX') {
  if (issue?.block_type === 'SKILL') {
    const reasons = {
      OUTDOOR_GYM_UNAVAILABLE: 'Aucun exercice Gym extérieur compatible avec le matériel déclaré. Vérifie ton matériel ou utilise un WOD.',
      OUTDOOR_GYM_CATALOG_REQUIRED: 'Choisis un mouvement dans le catalogue Gym extérieur ou précise un apprentissage technique.',
      SKILL_MAX_THREE_EXERCISES: 'Le Skill se concentre sur trois mouvements maximum. Retire un mouvement ou répartis le travail dans un autre bloc.',
      SKILL_TARGET_UNAVAILABLE: 'Ce parcours technique n’est plus disponible. Choisis un autre mouvement cible.',
      SKILL_TARGET_NOT_FEASIBLE: 'Ce mouvement cible ne dispose pas d’étape compatible avec ton contexte actuel. Ajuste le matériel ou choisis un autre parcours.',
      SKILL_LESSON_EXCEEDS_THREE: 'Cette leçon technique demande plus de trois exercices. UGEROD conserve les étapes nécessaires : choisis un autre parcours pour cette séance.',
      SKILL_LESSON_CHANGED: 'Les exercices choisis ne correspondent plus à la leçon technique. Reviens aux mouvements pour actualiser la proposition ou retire l’objectif technique.',
      SKILL_CONTEXT_INCOMPATIBLE: 'Un exercice du Skill ne convient pas au matériel, au lieu ou à tes capacités du jour. Ajuste les mouvements ou le contexte.',
      SKILL_TIME_MISMATCH: 'Le Skill ne tient pas dans le temps réservé, récupérations comprises. Augmente sa durée ou retire un mouvement.',
      SKILL_TEST_CONFIRMATION_REQUIRED: 'Ce Skill demande un test contrôlé. Une séance de pratique ne peut pas le lancer automatiquement.',
    };
    return reasons[issue.reason] ?? 'Le Skill ne peut pas être validé. Ajuste sa durée, ses mouvements ou son objectif technique.';
  }
  if (issue?.block_type === 'CARDIO' && String(issue.reason).startsWith('OUTDOOR_')) return ({
    OUTDOOR_CONTEXT_REQUIRED: 'Précise le contexte extérieur avant de recalculer la course.',
    OUTDOOR_SURFACE_REQUIRED: 'Précise le lieu et le terrain de ta séance extérieure.',
    OUTDOOR_RUNNING_UNAVAILABLE: 'La course est désactivée : retire Cardio extérieur et conserve Gym ou WOD.',
    OUTDOOR_RUNNING_CONTEXT_INCOMPATIBLE: 'La course ne convient pas au contexte du jour. Ajuste la structure ou le contexte.',
  })[issue.reason] ?? 'Le protocole de course doit être adapté au contexte extérieur.';
  if (issue?.block_type === 'CARDIO') return issue.reason === 'CARDIO_EQUIPMENT_REQUIRED'
    ? 'Aucune machine cardio compatible. Modifie ton matériel ou retire le bloc Cardio.'
    : 'Le protocole cardio doit être actualisé. Reviens aux mouvements pour le recalculer avec ton contexte.';
  if (issue?.block_type === 'WOD') {
    if (issue.reason === 'PREMIUM_REQUIRED') return 'Ce format nécessite Premium. Choisis un autre format.';
    if (issue.reason === 'EXERCISE_COUNT') return 'Le nombre de mouvements ne convient pas à ce format. Ajuste les mouvements ou choisis un autre format.';
    return 'Le WOD ne peut pas être validé avec cette durée et ces mouvements. Ajuste les mouvements, la durée ou le format.';
  }
  const label = environmentCode === 'GYM' ? 'Musculation' : 'Renforcement';
  return `Le bloc ${label} ne correspond pas au temps prévu : ${Math.round(Number(issue?.time?.prescribed_seconds ?? 0) / 60)} min estimées, récupérations comprises, pour ${issue?.block_minutes} min prévues. Reviens ajuster les mouvements ou la structure.`;
}

export function currentComposerAssessment(result, resultSignature, requestSignature, loading, error) {
  return !loading && !error && resultSignature === requestSignature ? result : null;
}
