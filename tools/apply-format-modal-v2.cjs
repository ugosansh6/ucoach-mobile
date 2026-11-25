const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sessionPath = path.join(root, 'app', 'workout', 'session.js');

function readWithEol(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return {
    eol: raw.includes('\r\n') ? '\r\n' : '\n',
    text: raw.replace(/\r\n/g, '\n'),
  };
}

function writeWithEol(file, text, eol) {
  fs.writeFileSync(file, text.replace(/\n/g, eol), 'utf8');
}

function replaceOnce(text, search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`Bloc attendu introuvable : ${label}`);
  }

  return text.replace(search, replacement);
}

const file = readWithEol(sessionPath);
let session = file.text;

// ---------------------------------------------------------------------------
// 1. Ordre produit : choix actuel -> disponibles -> premium -> indisponibles
// ---------------------------------------------------------------------------
session = replaceOnce(
  session,
  `      const rank = (item) => {\n        if (item.current) {\n          return 0;\n        }\n\n        if (item.entitled) {\n          return 1;\n        }\n\n        if (item.locked) {\n          return 2;\n        }\n\n        return 3;\n      };`,
  `      const rank = (item) => {\n        if (item.current) {\n          return 0;\n        }\n\n        if (\n          item.compatible &&\n          !item.locked\n        ) {\n          return 1;\n        }\n\n        if (\n          item.compatible &&\n          item.locked\n        ) {\n          return 2;\n        }\n\n        return 3;\n      };`,
  'format option order'
);

// ---------------------------------------------------------------------------
// 2. États visibles :
//    - choix actuel conservé
//    - disponible : aucun label "COMPATIBLE" / "UGEROD ADAPTERA LE WOD"
//    - premium compatible : PREMIUM + cadenas
//    - incompatible : NON ADAPTÉ À CETTE SÉANCE, même si premium
// ---------------------------------------------------------------------------
session = replaceOnce(
  session,
  `  if (\n    option.classification ===\n    'ADAPTABLE'\n  ) {\n    return {\n      label:\n        'UGEROD ADAPTERA LE WOD',\n      icon: 'options-outline',\n      tone: 'adaptable',\n    };\n  }\n\n  return {\n    label: 'COMPATIBLE',\n    icon: 'checkmark',\n    tone: 'compatible',\n  };`,
  `  return {\n    label: null,\n    icon: 'checkmark',\n    tone: 'available',\n  };`,
  'format available labels'
);

// Premium yellow only if the option is compatible. A premium option that is
// incompatible remains visually in the unavailable group.
session = replaceOnce(
  session,
  `                      option.locked &&\n                        styles.formatOptionLocked,`,
  `                      option.locked &&\n                        option.compatible &&\n                        styles.formatOptionLocked,`,
  'premium compatible tile condition'
);

// Locked + compatible must stay visually premium, not muted.
session = replaceOnce(
  session,
  `                            (!option.compatible ||\n                              option.locked) &&\n                              !option.current &&\n                              styles.formatOptionTitleMuted,`,
  `                            !option.compatible &&\n                              !option.current &&\n                              styles.formatOptionTitleMuted,`,
  'premium title color'
);

session = replaceOnce(
  session,
  `                          (!option.compatible ||\n                            option.locked) &&\n                            !option.current &&\n                            styles.formatOptionDescriptionMuted,`,
  `                          !option.compatible &&\n                            !option.current &&\n                            styles.formatOptionDescriptionMuted,`,
  'premium description color'
);

session = replaceOnce(
  session,
  `                              state.tone ===\n                                'incompatible'\n                                ? colors.textMuted\n                                : state.tone ===\n                                    'locked'\n                                  ? colors.textMuted\n                                  : colors.primaryLight`,
  `                              state.tone ===\n                                'incompatible'\n                                ? colors.textMuted\n                                : state.tone ===\n                                    'locked'\n                                  ? '#F5A623'\n                                  : colors.primaryLight`,
  'premium lock icon color'
);

// Do not render an empty status line for normal available options.
session = replaceOnce(
  session,
  `                      <Text\n                        style={[\n                          styles.formatOptionState,\n                          state.tone ===\n                            'incompatible' &&\n                            styles.formatStateMuted,\n                          state.tone ===\n                            'locked' &&\n                            styles.formatStateLocked,\n                        ]}\n                      >\n                        {state.label}\n                      </Text>`,
  `                      {state.label ? (\n                        <Text\n                          style={[\n                            styles.formatOptionState,\n                            state.tone ===\n                              'incompatible' &&\n                              styles.formatStateMuted,\n                            state.tone ===\n                              'locked' &&\n                              styles.formatStateLocked,\n                          ]}\n                        >\n                          {state.label}\n                        </Text>\n                      ) : null}`,
  'optional format state label'
);

// ---------------------------------------------------------------------------
// 3. Responsive modal : centered card on web / wide screens, safe margins on
//    mobile. Fixes the full-width bottom-sheet effect.
// ---------------------------------------------------------------------------
session = replaceOnce(
  session,
  `  modalOverlay: {\n    flex: 1,\n    justifyContent: 'flex-end',\n  },`,
  `  modalOverlay: {\n    flex: 1,\n    justifyContent: 'center',\n    alignItems: 'center',\n    paddingHorizontal: 16,\n    paddingVertical: 16,\n  },`,
  'responsive modal overlay'
);

session = replaceOnce(
  session,
  `  modalSheet: {\n    maxHeight: '88%',\n    minHeight: '60%',\n    borderTopLeftRadius: 24,\n    borderTopRightRadius: 24,\n    backgroundColor:\n      colors.background,\n    borderTopWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.10)',\n    paddingHorizontal:\n      spacing.xl,\n  },`,
  `  modalSheet: {\n    width: '100%',\n    maxWidth: 560,\n    maxHeight: '88%',\n    minHeight: '60%',\n    borderRadius: 24,\n    overflow: 'hidden',\n    backgroundColor:\n      colors.background,\n    borderWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.10)',\n    paddingHorizontal:\n      spacing.xl,\n  },`,
  'responsive modal sheet'
);

// ---------------------------------------------------------------------------
// 4. Premium compatible = yellow/gold visual language, no opacity penalty.
// ---------------------------------------------------------------------------
session = replaceOnce(
  session,
  `  formatOptionLocked: {\n    opacity: 0.58,\n  },`,
  `  formatOptionLocked: {\n    backgroundColor:\n      'rgba(245,166,35,0.10)',\n    borderColor:\n      'rgba(245,166,35,0.48)',\n  },`,
  'premium tile visual'
);

session = replaceOnce(
  session,
  `  formatStateLocked: {\n    color:\n      colors.textSecondary,\n  },`,
  `  formatStateLocked: {\n    color:\n      '#F5A623',\n  },`,
  'premium state color'
);

writeWithEol(sessionPath, session, file.eol);

console.log('FORMAT MODAL V2 PATCH APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/session.js');
console.log('Responsive: mechanics modal centered, max width 560px, mobile-safe margins.');
console.log('Order: current -> available -> premium -> unavailable.');
console.log('Labels: CHOIX ACTUEL kept; COMPATIBLE and UGEROD ADAPTERA LE WOD removed.');
console.log('Premium: compatible locked formats use a yellow/gold tile + lock icon.');
console.log('Unavailable: incompatible formats remain NON ADAPTE A CETTE SEANCE, including premium formats.');
