// The shared Skill producer is in DEV; the guided creation flow stays off
// until its Player/default-structure integration is complete. Keep existing
// authored preferences visible instead of silently downgrading their contract.
export const COMPOSER_GUIDED_V1_ENABLED = false;

export function composerInitialSkillEngineVersion(enabled = COMPOSER_GUIDED_V1_ENABLED) {
  return enabled ? 'C4_COMPOSER_SKILL_V1' : null;
}

export function composerGuidedPreferencesEnabled({
  skillEngineVersion = null, preferredRegions = [], skillTargetPath = null,
} = {}, enabled = COMPOSER_GUIDED_V1_ENABLED) {
  return enabled || Boolean(skillEngineVersion || skillTargetPath || preferredRegions.length > 1);
}
