from pathlib import Path

profile = Path('app/profile/equipment.js')
text = profile.read_text(encoding='utf-8')

old_params = """export default function ProfileEquipmentScreen() {
  const { returnTo } = useLocalSearchParams();
  const { colors: themeColors, isDark } = useUgerodTheme();
"""
new_params = """export default function ProfileEquipmentScreen() {
  const { returnTo, environment } = useLocalSearchParams();
  const { colors: themeColors, isDark } = useUgerodTheme();

  const initialEnvironment = useMemo(() => {
    const rawEnvironment = Array.isArray(environment)
      ? environment[0]
      : environment;
    const code = String(rawEnvironment ?? 'HOME').trim().toUpperCase();

    return PROFILE_ENVIRONMENTS.some((item) => item.key === code)
      ? code
      : 'HOME';
  }, [environment]);
"""
if old_params not in text:
    raise SystemExit('params block not found')
text = text.replace(old_params, new_params, 1)

old_state = """  const [activeEnvironment, setActiveEnvironment] =
    useState('HOME');
"""
new_state = """  const [activeEnvironment, setActiveEnvironment] =
    useState(initialEnvironment);
"""
if old_state not in text:
    raise SystemExit('active environment state not found')
text = text.replace(old_state, new_state, 1)

old_load = """          getEquipmentCatalog(),
          getUserEnvironmentEquipmentPreset('HOME'),
"""
new_load = """          getEquipmentCatalog(),
          getUserEnvironmentEquipmentPreset(initialEnvironment),
"""
if old_load not in text:
    raise SystemExit('initial preset load not found')
text = text.replace(old_load, new_load, 1)

old_effect_end = """  }, []);

  const activeEnvironmentLabel =
"""
new_effect_end = """  }, [initialEnvironment]);

  const activeEnvironmentLabel =
"""
if old_effect_end not in text:
    raise SystemExit('initial load dependency not found')
text = text.replace(old_effect_end, new_effect_end, 1)

old_info = """            {/* INFO — utile uniquement pour l'inventaire Maison */}
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
    raise SystemExit('home info block not found')
text = text.replace(old_info, '', 1)
profile.write_text(text, encoding='utf-8')

prep = Path('src/workout/PreparationCheckinV4.js')
prep_text = prep.read_text(encoding='utf-8')
old_route = """                router.push({
                  pathname: '/profile/equipment',
                  params: { returnTo: '/workout/preparation' },
                });
"""
new_route = """                router.push({
                  pathname: '/profile/equipment',
                  params: {
                    returnTo: '/workout/preparation',
                    environment: environmentCode,
                  },
                });
"""
if old_route not in prep_text:
    raise SystemExit('equipment route block not found')
prep_text = prep_text.replace(old_route, new_route, 1)
prep.write_text(prep_text, encoding='utf-8')
