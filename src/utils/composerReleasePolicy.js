// Shared producers and the Player execution/persistence adapters are connected.
// Existing authored contracts keep their recorded version until explicitly edited.
export const COMPOSER_GUIDED_V1_ENABLED = true;

export function composerInitialSkillEngineVersion(enabled = COMPOSER_GUIDED_V1_ENABLED) {
  return enabled ? 'C4_COMPOSER_SKILL_V1' : null;
}

export function composerGuidedPreferencesEnabled({
  skillEngineVersion = null, preferredRegions = [], skillTargetPath = null,
} = {}, enabled = COMPOSER_GUIDED_V1_ENABLED) {
  return enabled || Boolean(skillEngineVersion || skillTargetPath || preferredRegions.length > 1);
}
