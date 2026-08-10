import { StyleSheet, Text, View } from 'react-native';

import {
  colors,
  spacing,
  typography,
} from '../../constants';

export default function PlaceholderScreen({
  title = 'ÉCRAN EN CONSTRUCTION',
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      <View style={styles.tricolor}>
        <View style={[styles.segment, styles.blue]} />
        <View style={[styles.segment, styles.white]} />
        <View style={[styles.segment, styles.red]} />
      </View>

      <Text style={styles.message}>
        Cet écran sera intégré dans un prochain lot.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
  },

  title: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },

  tricolor: {
    flexDirection: 'row',
    width: 120,
    height: 4,
    marginTop: spacing.md,
  },

  segment: {
    flex: 1,
  },

  blue: {
    backgroundColor: colors.primary,
  },

  white: {
    backgroundColor: colors.brandWhite,
  },

  red: {
    backgroundColor: colors.brandRed,
  },

  message: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
});
