const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sessionPath = path.join(root, 'app', 'workout', 'session.js');

const raw = fs.readFileSync(sessionPath, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

function replaceRequired(search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`Bloc attendu introuvable : ${label}`);
  }
  text = text.replace(search, replacement);
}

// 1) Make the modal react to browser/mobile viewport changes.
if (!text.includes('  useWindowDimensions,\n')) {
  replaceRequired(
    `  Vibration,\n  View,\n} from 'react-native';`,
    `  Vibration,\n  View,\n  useWindowDimensions,\n} from 'react-native';`,
    'react-native imports'
  );
}

replaceRequired(
  `function FormatModal({\n  visible,\n  onClose,\n  loading,\n  changing,\n  error,\n  options,\n  subscriptionTier,\n  onSelect,\n}) {\n  return (`,
  `function FormatModal({\n  visible,\n  onClose,\n  loading,\n  changing,\n  error,\n  options,\n  subscriptionTier,\n  onSelect,\n}) {\n  const {\n    width: viewportWidth,\n    height: viewportHeight,\n  } = useWindowDimensions();\n\n  const compactViewport =\n    viewportWidth <= 600;\n\n  const modalHeight = compactViewport\n    ? Math.max(320, viewportHeight - 24)\n    : Math.min(\n        720,\n        Math.max(\n          480,\n          Math.round(viewportHeight * 0.84)\n        )\n      );\n\n  return (`,
  'FormatModal viewport sizing'
);

// Support either the original bottom sheet or the already-applied V2 centered modal.
if (text.includes(`  modalOverlay: {\n    flex: 1,\n    justifyContent: 'flex-end',\n  },`)) {
  text = text.replace(
    `  modalOverlay: {\n    flex: 1,\n    justifyContent: 'flex-end',\n  },`,
    `  modalOverlay: {\n    flex: 1,\n    justifyContent: 'center',\n    alignItems: 'center',\n    paddingHorizontal: 12,\n    paddingVertical: 12,\n  },`
  );
} else if (text.includes(`  modalOverlay: {\n    flex: 1,\n    justifyContent: 'center',\n    alignItems: 'center',\n    paddingHorizontal: 16,\n    paddingVertical: 16,\n  },`)) {
  text = text.replace(
    `  modalOverlay: {\n    flex: 1,\n    justifyContent: 'center',\n    alignItems: 'center',\n    paddingHorizontal: 16,\n    paddingVertical: 16,\n  },`,
    `  modalOverlay: {\n    flex: 1,\n    justifyContent: 'center',\n    alignItems: 'center',\n    paddingHorizontal: 12,\n    paddingVertical: 12,\n  },`
  );
}

replaceRequired(
  `        <SafeAreaView\n          style={styles.modalSheet}\n        >`,
  `        <SafeAreaView\n          style={[\n            styles.modalSheet,\n            { height: modalHeight },\n          ]}\n        >`,
  'modalSheet dynamic height'
);

// Support V2 modalSheet first; otherwise upgrade original version.
if (text.includes(`  modalSheet: {\n    width: '100%',\n    maxWidth: 560,\n    maxHeight: '88%',\n    minHeight: '60%',\n    borderRadius: 24,\n    overflow: 'hidden',\n    backgroundColor:\n      colors.background,\n    borderWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.10)',\n    paddingHorizontal:\n      spacing.xl,\n  },`)) {
  text = text.replace(
    `  modalSheet: {\n    width: '100%',\n    maxWidth: 560,\n    maxHeight: '88%',\n    minHeight: '60%',\n    borderRadius: 24,\n    overflow: 'hidden',\n    backgroundColor:\n      colors.background,\n    borderWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.10)',\n    paddingHorizontal:\n      spacing.xl,\n  },`,
    `  modalSheet: {\n    width: '100%',\n    maxWidth: 560,\n    maxHeight: '100%',\n    flexShrink: 1,\n    borderRadius: 20,\n    overflow: 'hidden',\n    backgroundColor:\n      colors.background,\n    borderWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.10)',\n    paddingHorizontal: 16,\n  },`
  );
} else if (text.includes(`  modalSheet: {\n    maxHeight: '88%',\n    minHeight: '60%',\n    borderTopLeftRadius: 24,\n    borderTopRightRadius: 24,\n    backgroundColor:\n      colors.background,\n    borderTopWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.10)',\n    paddingHorizontal:\n      spacing.xl,\n  },`)) {
  text = text.replace(
    `  modalSheet: {\n    maxHeight: '88%',\n    minHeight: '60%',\n    borderTopLeftRadius: 24,\n    borderTopRightRadius: 24,\n    backgroundColor:\n      colors.background,\n    borderTopWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.10)',\n    paddingHorizontal:\n      spacing.xl,\n  },`,
    `  modalSheet: {\n    width: '100%',\n    maxWidth: 560,\n    maxHeight: '100%',\n    flexShrink: 1,\n    borderRadius: 20,\n    overflow: 'hidden',\n    backgroundColor:\n      colors.background,\n    borderWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.10)',\n    paddingHorizontal: 16,\n  },`
  );
} else {
  throw new Error('Bloc attendu introuvable : modalSheet styles');
}

replaceRequired(
  `  formatList: {\n    flex: 1,\n  },`,
  `  formatList: {\n    flex: 1,\n    minHeight: 0,\n  },`,
  'formatList flex sizing'
);

// 2) Remove the explanatory footer requested for deletion.
const footer = `\n              <View\n                style={styles.formatFooter}\n              >\n                <Ionicons\n                  name="shield-checkmark-outline"\n                  size={18}\n                  color={colors.primaryLight}\n                />\n                <Text\n                  style={styles.formatFooterText}\n                >\n                  Un format reste indisponible si le moteur juge qu’il n’est pas adapté à la séance, même en Premium.\n                </Text>\n              </View>`;

if (text.includes(footer)) {
  text = text.replace(footer, '');
}

// 3) Slightly larger descriptions for readability.
replaceRequired(
  `  formatOptionDescription: {\n    marginTop: 4,\n    fontFamily:\n      'Oswald_400Regular',\n    fontSize: 11,\n    lineHeight: 16,\n    color:\n      colors.textSecondary,\n  },`,
  `  formatOptionDescription: {\n    marginTop: 5,\n    fontFamily:\n      'Oswald_400Regular',\n    fontSize: 13,\n    lineHeight: 19,\n    color:\n      colors.textSecondary,\n  },`,
  'format description typography'
);

fs.writeFileSync(sessionPath, text.replace(/\n/g, eol), 'utf8');

console.log('FORMAT MODAL V3 RESPONSIVE PATCH APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/session.js');
console.log('Removed: Premium availability footer sentence.');
console.log('Typography: format descriptions increased to 13px / 19px line-height.');
console.log('Responsive: modal now uses live viewport height and scrollable content on mobile/F12.');
console.log('Product ordering and premium/unavailable rules are unchanged.');
