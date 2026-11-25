// Transport contract only. Selection, dose and progression remain owned by the
// existing engine. A multi-zone preference must never become its first zone.
export const COMPOSER_PREFERENCES_VERSION = 'composer-preferences-v1';
export const COMPOSER_REGION_LABELS = {
  Upper: 'Haut du corps', Back: 'Dos', Lower: 'Jambes',
  Core: 'Abdos / gainage', 'Full Body': 'Corps entier',
};

export function normalizeComposerRegions(value) {
  const input = value == null ? [] : Array.isArray(value) ? value : [value];
  const regions = [];
  for (const region of input) {
    if (region == null || region === '') continue;
    if (!Object.prototype.hasOwnProperty.call(COMPOSER_REGION_LABELS, region)) {
      throw new Error('Zone de travail inconnue : ' + String(region));
    }
    if (!regions.includes(region)) regions.push(region);
  }
  return regions.includes('Full Body') ? ['Full Body'] : regions;
}

export function readComposerPreferences(source = {}) {
  const preferences = source?.preferences ?? source ?? {};
  if ((source?.preferences || Object.prototype.hasOwnProperty.call(preferences, 'preferred_regions'))
      && preferences.version && preferences.version !== COMPOSER_PREFERENCES_VERSION) {
    throw new Error('Version des préférences de séance non prise en charge.');
  }
  // An explicit empty list means automatic, even if a legacy scalar remains.
  const regions = Object.prototype.hasOwnProperty.call(preferences, 'preferred_regions')
    ? preferences.preferred_regions : source?.target_region;
  const target = preferences.skill_target_path_key ?? null;
  if (target != null && (typeof target !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(target))) {
    throw new Error('Objectif technique invalide.');
  }
  return {
    version: COMPOSER_PREFERENCES_VERSION,
    preferred_regions: normalizeComposerRegions(regions),
    skill_target_path_key: target,
  };
}

export function legacyComposerTargetRegion(preferences) {
  const regions = readComposerPreferences(preferences).preferred_regions;
  return regions.length === 1 ? regions[0] : null;
}

export function toggleComposerRegion(values, next) {
  const current = normalizeComposerRegions(values);
  if (next == null) return [];
  if (next === 'Full Body') return current.includes(next) ? [] : [next];
  normalizeComposerRegions([next]); // Reject an unknown choice, don't erase it.
  return current.includes(next) ? current.filter((region) => region !== next)
    : [...current.filter((region) => region !== 'Full Body'), next];
}

export function composerRegionsLabel(preferences) {
  const regions = readComposerPreferences(preferences).preferred_regions;
  return regions.map((region) => COMPOSER_REGION_LABELS[region]).join(' · ') || 'UGEROD choisit';
}

export function composerShowsSkillTarget(intent, expanded = false, selectedPath = null) {
  return ['TECHNIQUE', 'COACH_TECHNIQUE'].includes(intent?.key)
    || Boolean(expanded || selectedPath);
}

export function withComposerPreferences(draft, preferences) {
  const normalized = readComposerPreferences(preferences);
  return { ...draft, preferences: normalized,
    target_region: legacyComposerTargetRegion(normalized) };
}

export function composerSessionPreferences(planningContext) {
  const draft = planningContext?.composer_draft;
  if (!draft) return null;
  // Resuming an already generated workout must preserve its snapshot, even
  // when a newer preference version cannot be edited by this client yet.
  return draft.preferences ?? readComposerPreferences(draft);
}
