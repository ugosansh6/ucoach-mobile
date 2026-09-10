import fs from 'node:fs';

const file = 'app/profile/equipment.js';
let src = fs.readFileSync(file, 'utf8');

function replaceOnce(from, to, label) {
  if (!src.includes(from)) {
    throw new Error(`EQP-003 missing anchor: ${label}`);
  }
  src = src.replace(from, to);
}

replaceOnce(
  "import { router, useLocalSearchParams } from 'expo-router';\nimport { LinearGradient } from 'expo-linear-gradient';",
  "import { router, useLocalSearchParams } from 'expo-router';\nimport { LinearGradient } from 'expo-linear-gradient';\nimport { StatusBar } from 'expo-status-bar';",
  'StatusBar import'
);

replaceOnce(
  "import {\n  colors,\n  spacing,\n  typography,\n} from '../../src/constants';",
  "import {\n  spacing,\n  typography,\n} from '../../src/constants';\nimport { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';",
  'theme imports'
);

replaceOnce(
  "const brandIcon = require(\n  '../../assets/branding/ugerod-icon.png'\n);",
  "const darkBrandIcon = require(\n  '../../assets/branding/ugerod-icon.png'\n);\n\nconst lightBrandIcon = require(\n  '../../assets/branding/LOGO VERSION NOIR.png'\n);",
  'brand icons'
);

replaceOnce(
  "export default function ProfileEquipmentScreen() {\n  const { returnTo } = useLocalSearchParams();",
  `export default function ProfileEquipmentScreen() {\n  const { returnTo } = useLocalSearchParams();\n  const { colors: themeColors, isDark } = useUgerodTheme();\n\n  const colors = useMemo(\n    () => ({\n      ...themeColors,\n      // Cette page applique la nouvelle charte UGEROD dans les deux thèmes.\n      accent: BRAND_KAKI,\n      accentStrong: BRAND_KAKI,\n      accentSoft: isDark\n        ? 'rgba(94,102,51,0.22)'\n        : 'rgba(94,102,51,0.12)',\n      secondaryAccent: BRAND_ORANGE,\n      secondaryAccentStrong: BRAND_ORANGE,\n      secondaryAccentSoft: isDark\n        ? 'rgba(255,107,25,0.18)'\n        : 'rgba(255,107,25,0.12)',\n      primary: BRAND_KAKI,\n      primaryLight: isDark ? '#A8B09A' : BRAND_KAKI,\n      textPrimary: themeColors.text,\n      brandWhite: '#FFFFFF',\n    }),\n    [themeColors, isDark]\n  );\n\n  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);\n  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;\n\n  const QuantityControl = (props) => (\n    <EquipmentQuantityControl {...props} styles={styles} colors={colors} />\n  );\n\n  const LoadInput = (props) => (\n    <EquipmentLoadInput {...props} styles={styles} colors={colors} />\n  );`,
  'screen theme setup'
);

replaceOnce(
  "      <ImageBackground\n        source={backgroundImage}\n        resizeMode=\"cover\"\n        style={styles.background}\n      >\n        <View\n          style={styles.darkOverlay}\n        />\n\n        <LinearGradient\n          colors={[\n            'rgba(7,9,12,0.45)',\n            'rgba(7,9,12,0.72)',\n            'rgba(7,9,12,0.95)',\n            'rgba(7,9,12,1)',\n          ]}\n          locations={[\n            0,\n            0.26,\n            0.68,\n            1,\n          ]}\n          style={\n            StyleSheet.absoluteFill\n          }\n        />",
  `      <ImageBackground\n        source={isDark ? backgroundImage : undefined}\n        resizeMode=\"cover\"\n        style={styles.background}\n      >\n        {isDark && (\n          <>\n            <View style={styles.darkOverlay} />\n            <LinearGradient\n              colors={[\n                'rgba(7,9,12,0.42)',\n                'rgba(7,9,12,0.62)',\n                'rgba(7,9,12,0.90)',\n                'rgba(7,9,12,0.99)',\n              ]}\n              locations={[0, 0.24, 0.62, 1]}\n              style={StyleSheet.absoluteFill}\n            />\n          </>\n        )}`,
  'theme background'
);

replaceOnce(
  "        <SafeAreaView\n          style={styles.safeArea}\n        >",
  "        <SafeAreaView\n          style={styles.safeArea}\n        >\n          <StatusBar style={isDark ? 'light' : 'dark'} />",
  'status bar'
);

replaceOnce(
  "function QuantityControl({\n  row,\n  onMinus,\n  onPlus,\n  compact = false,\n}) {",
  "function EquipmentQuantityControl({\n  row,\n  onMinus,\n  onPlus,\n  compact = false,\n  styles,\n  colors,\n}) {",
  'quantity helper'
);

replaceOnce(
  "function LoadInput({\n  label,\n  value,\n  placeholder,\n  onChange,\n}) {",
  "function EquipmentLoadInput({\n  label,\n  value,\n  placeholder,\n  onChange,\n  styles,\n  colors,\n}) {",
  'load helper'
);

replaceOnce(
  "const styles = StyleSheet.create({",
  "function createStyles(colors, isDark) {\n  return StyleSheet.create({",
  'dynamic styles'
);

const endAnchor = "\n  pressed: {\n    opacity: 0.72,\n  },\n});";
if (!src.includes(endAnchor)) {
  throw new Error('EQP-003 missing style closing anchor');
}
src = src.replace(
  endAnchor,
  "\n  pressed: {\n    opacity: 0.72,\n  },\n  });\n}"
);

const replacements = [
  ["  background: {\n    flex: 1,\n  },", "  background: {\n    flex: 1,\n    backgroundColor: colors.background,\n  },"],
  ["  safeArea: {\n    flex: 1,\n  },", "  safeArea: {\n    flex: 1,\n    backgroundColor: isDark ? 'transparent' : colors.background,\n  },"],
  ["    paddingHorizontal:\n      spacing.xl,", "    paddingHorizontal:\n      spacing.lg,"],
  ["    backgroundColor:\n      'rgba(17,21,26,0.90)',\n    borderWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.10)',", "    backgroundColor: isDark\n      ? 'rgba(17,21,26,0.92)'\n      : colors.surfaceElevated,\n    borderWidth: 1,\n    borderColor: isDark\n      ? 'rgba(255,255,255,0.10)'\n      : colors.border,"],
  ["    backgroundColor:\n      'rgba(94,102,51,0.08)',", "    backgroundColor: colors.accentSoft,"],
  ["    backgroundColor:\n      'rgba(255,107,25,0.08)',", "    backgroundColor: colors.secondaryAccentSoft,"],
  ["    borderColor: 'rgba(255,255,255,0.11)',\n    backgroundColor: 'rgba(17,21,26,0.92)',", "    borderColor: isDark ? 'rgba(255,255,255,0.11)' : colors.border,\n    backgroundColor: isDark ? 'rgba(17,21,26,0.92)' : colors.surfaceElevated,"],
  ["    borderColor: 'rgba(255,255,255,0.10)',\n    backgroundColor: 'rgba(17,21,26,0.82)',", "    borderColor: isDark ? 'rgba(255,255,255,0.10)' : colors.border,\n    backgroundColor: isDark ? 'rgba(17,21,26,0.82)' : colors.surfaceElevated,"],
  ["    borderColor: 'rgba(255,255,255,0.10)',\n    backgroundColor: 'rgba(17,21,26,0.88)',", "    borderColor: isDark ? 'rgba(255,255,255,0.10)' : colors.border,\n    backgroundColor: isDark ? 'rgba(17,21,26,0.88)' : colors.surfaceElevated,"],
  ["    borderColor: BRAND_KAKI,\n    backgroundColor: 'rgba(94,102,51,0.18)',", "    borderColor: BRAND_KAKI,\n    backgroundColor: colors.accentSoft,"],
  ["    backgroundColor:\n      'rgba(17,21,26,0.92)',\n    borderWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.09)',", "    backgroundColor: isDark\n      ? 'rgba(17,21,26,0.92)'\n      : colors.surfaceElevated,\n    borderWidth: 1,\n    borderColor: isDark\n      ? 'rgba(255,255,255,0.09)'\n      : colors.border,"],
  ["    borderColor:\n      'rgba(255,255,255,0.08)',", "    borderColor: isDark\n      ? 'rgba(255,255,255,0.08)'\n      : colors.border,"],
  ["    borderColor:\n      'rgba(255,255,255,0.20)',\n    backgroundColor:\n      'rgba(255,255,255,0.03)',", "    borderColor: isDark\n      ? 'rgba(255,255,255,0.20)'\n      : colors.borderStrong,\n    backgroundColor: isDark\n      ? 'rgba(255,255,255,0.03)'\n      : colors.surface,"],
  ["    borderTopColor:\n      'rgba(255,255,255,0.07)',", "    borderTopColor: isDark\n      ? 'rgba(255,255,255,0.07)'\n      : colors.border,"],
  ["    backgroundColor:\n      'rgba(255,255,255,0.04)',", "    backgroundColor: isDark\n      ? 'rgba(255,255,255,0.04)'\n      : colors.surface,"],
  ["    borderColor:\n      'rgba(255,255,255,0.10)',\n    backgroundColor:\n      'rgba(255,255,255,0.03)',", "    borderColor: isDark\n      ? 'rgba(255,255,255,0.10)'\n      : colors.border,\n    backgroundColor: isDark\n      ? 'rgba(255,255,255,0.03)'\n      : colors.surface,"],
  ["    backgroundColor:\n      'rgba(255,255,255,0.025)',\n    borderWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.07)',", "    backgroundColor: isDark\n      ? 'rgba(255,255,255,0.025)'\n      : colors.surface,\n    borderWidth: 1,\n    borderColor: isDark\n      ? 'rgba(255,255,255,0.07)'\n      : colors.border,"],
  ["    borderColor:\n      'rgba(255,255,255,0.11)',\n    backgroundColor:\n      'rgba(255,255,255,0.035)',", "    borderColor: isDark\n      ? 'rgba(255,255,255,0.11)'\n      : colors.border,\n    backgroundColor: isDark\n      ? 'rgba(255,255,255,0.035)'\n      : colors.surfaceElevated,"],
  ["    borderColor: 'rgba(255,255,255,0.11)',\n    backgroundColor: 'rgba(255,255,255,0.03)',", "    borderColor: isDark ? 'rgba(255,255,255,0.11)' : colors.border,\n    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : colors.surfaceElevated,"],
  ["    backgroundColor: 'rgba(94,102,51,0.06)',", "    backgroundColor: colors.accentSoft,"],
  ["    backgroundColor:\n      'rgba(94,102,51,0.06)',", "    backgroundColor: colors.accentSoft,"],
  ["    backgroundColor:\n      BRAND_KAKI,", "    backgroundColor:\n      BRAND_ORANGE,"],
];

for (const [from, to] of replacements) {
  src = src.split(from).join(to);
}

// Header/content hierarchy: same language as the current Profile screen.
src = src
  .replace("    borderRadius: 21,", "    borderRadius: 14,")
  .replace("    minHeight: 74,\n    flexDirection: 'row',\n    alignItems: 'center',\n    gap: 12,", "    minHeight: 60,\n    flexDirection: 'row',\n    alignItems: 'center',\n    gap: 12,")
  .replace("    marginTop: 25,", "    marginTop: 18,")
  .replace("    fontSize: 31,\n    lineHeight: 34,", "    fontSize: 29,\n    lineHeight: 33,")
  .replace("    marginTop: 22,", "    marginTop: 18,");

// Ensure light theme never inherits the old full-screen dark overlay through static styles.
if (!src.includes("const { colors: themeColors, isDark } = useUgerodTheme();")) {
  throw new Error('EQP-003 theme hook not installed');
}
if (!src.includes("function createStyles(colors, isDark)")) {
  throw new Error('EQP-003 dynamic styles not installed');
}
if (!src.includes("source={isDark ? backgroundImage : undefined}")) {
  throw new Error('EQP-003 light background not installed');
}

fs.writeFileSync(file, src);
