import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  APP_DESCRIPTION,
  colors,
  spacing,
  typography,
} from '../../src/constants';

const welcomeBackground = require('../../assets/backgrounds/welcome-default.jpg');
const brandLogo = require('../../assets/branding/ugerod-logo-white.png');

export default function WelcomeScreen() {
  function handleStart() {
    router.push('/(auth)/register');
  }

  function handleLogin() {
    router.push('/(auth)/login');
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={welcomeBackground}
        style={styles.background}
        imageStyle={styles.backgroundImage}
        resizeMode="cover"
      >
        {/* Voile sombre global */}
        <View style={styles.darkOverlay} />

        {/* Fondu vertical — référence Dashboard */}
        <LinearGradient
          colors={[
            'rgba(7, 9, 12, 0.32)',
            'rgba(7, 9, 12, 0.20)',
            'rgba(7, 9, 12, 0.70)',
            'rgba(7, 9, 12, 0.98)',
          ]}
          locations={[0, 0.3, 0.62, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* Fondu latéral — référence Dashboard */}
        <LinearGradient
          colors={[
            'rgba(7, 9, 12, 0.55)',
            'rgba(7, 9, 12, 0.08)',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <View style={styles.content}>
            {/* Logo */}
            <View style={styles.logoArea}>
              <Image
                source={brandLogo}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>

            <View style={styles.spacer} />

            {/* Slogan */}
            <View style={styles.messageArea}>
              <Text style={styles.heroLine}>
                TON ENTRAÎNEMENT
                <Text style={styles.blueDot}>.</Text>
              </Text>

              <Text style={styles.heroLine}>
                TON RYTHME
                <Text style={styles.whiteDot}>.</Text>
              </Text>

              <Text style={styles.heroLine}>
                TON COACH
                <Text style={styles.redDot}>.</Text>
              </Text>

              <Text style={styles.description}>
                {APP_DESCRIPTION}
              </Text>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              <Pressable
                onPress={handleStart}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  COMMENCER
                </Text>
              </Pressable>

              <Pressable
                onPress={handleLogin}
                style={({ pressed }) => [
                  styles.loginButton,
                  pressed && styles.loginButtonPressed,
                ]}
              >
                <Text style={styles.loginQuestion}>
                  DÉJÀ MEMBRE ?{' '}
                  <Text style={styles.loginLink}>
                    SE CONNECTER
                  </Text>
                </Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  background: {
    flex: 1,
  },

  backgroundImage: {
    transform: [{ scale: 1.02 }],
  },

  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.26)',
  },

  safeArea: {
    flex: 1,
  },

  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },

  logoArea: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },

  logo: {
    width: '94%',
    maxWidth: 420,
    height: 125,
  },

  spacer: {
    flex: 1,
  },

  messageArea: {
    marginBottom: 34,
    maxWidth: 380,
  },

  heroLine: {
    ...typography.hero,
    color: colors.textPrimary,
    fontSize: 52,
    lineHeight: 56,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.68)',
    textShadowOffset: {
      width: 0,
      height: 2,
    },
    textShadowRadius: 8,
  },

  blueDot: {
    color: colors.primary,
  },

  whiteDot: {
    color: colors.brandWhite,
  },

  redDot: {
    color: colors.brandRed,
  },

  description: {
    ...typography.bodyLarge,
    color: 'rgba(247, 249, 252, 0.82)',
    fontSize: 18,
    lineHeight: 26,
    marginTop: 22,
    maxWidth: 340,
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: {
      width: 0,
      height: 1,
    },
    textShadowRadius: 5,
  },

  actions: {
    gap: 16,
  },

  primaryButton: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: spacing.xl,
  },

  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },

  primaryButtonText: {
    ...typography.button,
    color: colors.brandWhite,
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 1.2,
  },

  loginButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },

  loginButtonPressed: {
    opacity: 0.65,
  },

  loginQuestion: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.3,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  loginLink: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 15,
    color: colors.primaryLight,
  },
});