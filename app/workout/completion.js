import { StyleSheet } from 'react-native';

import CompletionV3 from './completion-v3';

// V3 garde son implémentation fonctionnelle actuelle. Ce patch visuel est ciblé
// uniquement sur sa feuille de styles : pas de barre de progression et la durée
// est centrée dans sa colonne du récap.
const baseCreate = StyleSheet.create.bind(StyleSheet);

if (!globalThis.__UGEROD_COMPLETION_V3_RECAP_PATCH__) {
  StyleSheet.create = (styles) => {
    const isCompletionV3 = Boolean(
      styles?.recapProgressBlock &&
        styles?.recapTrackKnobCore &&
        styles?.recapDurationValue &&
        styles?.reasonSheet &&
        styles?.scaleChoice
    );

    if (!isCompletionV3) return baseCreate(styles);

    return baseCreate({
      ...styles,
      recapDuration: {
        ...styles.recapDuration,
        width: 82,
        alignItems: 'center',
        justifyContent: 'center',
      },
      recapDurationValue: {
        ...styles.recapDurationValue,
        alignSelf: 'stretch',
        textAlign: 'center',
      },
      recapDurationUnit: {
        ...styles.recapDurationUnit,
        alignSelf: 'stretch',
        textAlign: 'center',
      },
      recapProgressBlock: {
        ...styles.recapProgressBlock,
        display: 'none',
        height: 0,
        marginTop: 0,
        paddingTop: 0,
        borderTopWidth: 0,
        overflow: 'hidden',
      },
    });
  };

  globalThis.__UGEROD_COMPLETION_V3_RECAP_PATCH__ = true;
}

export default function CompletionScreen() {
  return <CompletionV3 />;
}
