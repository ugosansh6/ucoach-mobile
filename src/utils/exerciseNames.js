import catalogue from '../constants/exerciseNamesV6.json';

// Presentation-only. Never change identity, stored names, prescriptions or engine inputs.
// The V6 decision sheet refines the TRX and ball variants; unresolved gesture distinctions remain provisional.
const refinements = {
  EX043: { fr: 'Pistol Squat assisté au TRX', en: 'TRX-Assisted Pistol Squat' },
  EX306: { fr: 'Lancer de medball au sol' },
  EX478: { fr: 'Pistol Squat avec appui manuel' },
  EX522: { priority: 'en' },
};
export const normalizeExerciseSearch = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const normalizeExerciseNameMode = mode => ['fr','en','bilingual'].includes(mode) ? mode : 'bilingual';
export function exerciseNameEntry(exercise) {
  if (!exercise) return null;
  if (typeof exercise === 'string') return Object.prototype.hasOwnProperty.call(catalogue,exercise) ? {...catalogue[exercise],...refinements[exercise]} : null;
  // Personal routines carry exercise_id:null; never infer a catalogue identity from a free-text label.
  const id = Object.prototype.hasOwnProperty.call(exercise,'exercise_id') ? exercise.exercise_id : exercise.exerciseId ?? exercise.id;
  if (!id || !Object.prototype.hasOwnProperty.call(catalogue,String(id))) return null;
  return {...catalogue[id],...refinements[id]};
}
export function resolveExerciseNames(exercise, mode='bilingual', { fallback, detail=false }={}) {
  const entry=exerciseNameEntry(exercise);
  const legacy=fallback ?? (typeof exercise==='object' ? exercise?.name ?? exercise?.exercise_name ?? exercise?.display_name : null) ?? 'Exercice';
  if (!entry) return { primary:legacy,secondary:null };
  const effective=normalizeExerciseNameMode(mode);
  const language=effective==='bilingual'?entry.priority:effective;
  const primary=entry[language] || legacy;
  const alternate=entry[language==='en'?'fr':'en'];
  const secondary=(effective==='bilingual'||detail)&&alternate&&primary.trim().toLowerCase()!==alternate.trim().toLowerCase()?alternate:null;
  return {primary,secondary};
}
export function exerciseSearchMatches(exercise, query) {
  const q=normalizeExerciseSearch(query);
  if (!q) return true;
  const e=exerciseNameEntry(exercise);
  const aliases=[exercise?.name,exercise?.exercise_name,exercise?.display_name,exercise?.originalName,e?.fr,e?.en,...(e?.aliases??[])];
  const compact=q.replace(/ /g,'');
  const singular=s=>s.split(' ').map(w=>w.length>3?w.replace(/s$/,''):w).join(' ');
  return aliases.some(value=>{
    const v=normalizeExerciseSearch(value);
    return v.includes(q)||v.replace(/ /g,'').includes(compact)||singular(v).includes(singular(q));
  });
}
export function exerciseNameSearchAliases(exercise) {
  const e=exerciseNameEntry(exercise);
  return e?[...new Set([e.fr,e.en,...e.aliases])]:[];
}
