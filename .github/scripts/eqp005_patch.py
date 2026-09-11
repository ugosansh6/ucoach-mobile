from pathlib import Path

path = Path('app/profile/equipment.js')
text = path.read_text(encoding='utf-8')

old_save = """        router.back();
      }, 450);
"""
new_save = """        router.replace('/profile');
      }, 450);
"""
if old_save not in text:
    raise SystemExit('Save fallback not found')
text = text.replace(old_save, new_save, 1)

old_back = """  function handleBack() {
    router.back();
  }
"""
new_back = """  function handleBack() {
    if (isSaving) {
      return;
    }

    if (activeCategory) {
      setSearchQuery('');
      setActiveCategory(null);
      return;
    }

    if (
      typeof returnTo === 'string' &&
      returnTo.length > 0
    ) {
      router.replace(returnTo);
      return;
    }

    router.replace('/profile');
  }
"""
if old_back not in text:
    raise SystemExit('handleBack block not found')
text = text.replace(old_back, new_back, 1)

old_info = """            {/* INFO */}
            <View
              style={styles.infoCard}
            >
              <Ionicons
                name=\"information-circle-outline\"
                size={21}
                color={
                  BRAND_KAKI
                }
              />

              <Text
                style={styles.infoText}
              >
                {activeEnvironment === 'HOME'
                  ? 'Renseigner les charges permet à UGEROD d’adapter plus précisément tes entraînements. Tu peux enregistrer un matériel même si tu ne connais pas sa charge.'
                  : 'Ce preset est utilisé automatiquement dans la préparation quand tu choisis cet environnement. Les changements faits pendant une préparation restent ponctuels.'}
              </Text>
            </View>
"""
new_info = """            {/* INFO — utile uniquement pour l'inventaire Maison */}
            {activeEnvironment === 'HOME' && (
              <View style={styles.infoCard}>
                <Ionicons
                  name=\"information-circle-outline\"
                  size={21}
                  color={BRAND_KAKI}
                />
                <Text style={styles.infoText}>
                  Renseigner les charges aide UGEROD à adapter plus précisément tes séances. Tu peux aussi enregistrer un équipement sans connaître sa charge.
                </Text>
              </View>
            )}
"""
if old_info not in text:
    raise SystemExit('Info block not found')
text = text.replace(old_info, new_info, 1)

path.write_text(text, encoding='utf-8')
