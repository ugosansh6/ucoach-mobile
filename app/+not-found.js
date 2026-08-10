import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import {
  colors,
  spacing,
  typography,
} from '../src/constants';

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>PAGE INTROUVABLE</Text>

      <Text style={styles.message}>
        Cette page n’existe pas ou n’est plus disponible.
      </Text>

      <Link href="/" style={styles.link}>
        RETOUR À L’ACCUEIL
      </Link>
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

  message: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },

  link: {
    ...typography.button,
    color: colors.primary,
    marginTop: spacing.xxl,
  },
});
