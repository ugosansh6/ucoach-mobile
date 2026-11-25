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

// Requires the V3 responsive FormatModal patch to be present locally.
replaceRequired(
  `  const modalHeight = compactViewport\n    ? Math.max(320, viewportHeight - 24)\n    : Math.min(\n        720,\n        Math.max(\n          480,\n          Math.round(viewportHeight * 0.84)\n        )\n      );`,
  `  const modalHeight = compactViewport\n    ? viewportHeight\n    : Math.min(\n        720,\n        Math.max(\n          480,\n          Math.round(viewportHeight * 0.84)\n        )\n      );`,
  'mobile modal height'
);

replaceRequired(
  `        <SafeAreaView\n          style={[\n            styles.modalSheet,\n            { height: modalHeight },\n          ]}\n        >`,
  `        <SafeAreaView\n          style={[\n            styles.modalSheet,\n            compactViewport &&\n              styles.modalSheetCompact,\n            { height: modalHeight },\n          ]}\n        >`,
  'compact modal style hook'
);

replaceRequired(
  `  modalOverlay: {\n    flex: 1,\n    justifyContent: 'center',\n    alignItems: 'center',\n    paddingHorizontal: 12,\n    paddingVertical: 12,\n  },`,
  `  modalOverlay: {\n    flex: 1,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },`,
  'remove overlay padding'
);

replaceRequired(
  `  modalSheet: {\n    width: '100%',\n    maxWidth: 560,\n    maxHeight: '100%',\n    flexShrink: 1,\n    borderRadius: 20,\n    overflow: 'hidden',\n    backgroundColor:\n      colors.background,\n    borderWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.10)',\n    paddingHorizontal: 16,\n  },`,
  `  modalSheet: {\n    width: 'calc(100% - 24px)',\n    maxWidth: 560,\n    maxHeight: 'calc(100% - 24px)',\n    flexShrink: 1,\n    borderRadius: 20,\n    overflow: 'hidden',\n    backgroundColor:\n      colors.background,\n    borderWidth: 1,\n    borderColor:\n      'rgba(255,255,255,0.10)',\n    paddingHorizontal: 16,\n  },\n\n  modalSheetCompact: {\n    width: '100%',\n    maxWidth: '100%',\n    maxHeight: '100%',\n    borderRadius: 0,\n    borderWidth: 0,\n    paddingHorizontal: 16,\n  },`,
  'desktop card and mobile fullscreen styles'
);

// React Native native does not support calc(). Keep the desktop card portable by
// using margins on the modal itself instead of CSS calc if this is ever run native.
text = text.replace(
  `    width: 'calc(100% - 24px)',\n    maxWidth: 560,\n    maxHeight: 'calc(100% - 24px)',`,
  `    width: '94%',\n    maxWidth: 560,\n    maxHeight: '94%',`
);

fs.writeFileSync(sessionPath, text.replace(/\n/g, eol), 'utf8');

console.log('FORMAT MODAL V4 MOBILE FULLSCREEN PATCH APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/session.js');
console.log('Mobile/F12 <= 600px: mechanics modal now fills the viewport.');
console.log('Desktop: mechanics modal remains a centered card with max width 560px.');
console.log('Background image behavior is unchanged because it does not control modal layout.');
