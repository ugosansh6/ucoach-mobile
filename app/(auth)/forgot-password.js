import { router } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const logo = require('../../assets/branding/ugerod-logo-white.png');

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  function handleBack() {
    router.back();
  }

  function handleResetPassword() {
    if (!email.trim()) {
      return;
    }

    /*
     * PLUS TARD AVEC SUPABASE :
     *
     * await supabase.auth.resetPasswordForEmail(email, {
     *   redirectTo: '...',
     * });
     */

    setSent(true);
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={backgroundImage}
        style={styles.background}
        resizeMode="cover"
      >
        {/* VOILE NOIR */}
        <View style={styles.darkOverlay} />

        {/* DÉGRADÉ */}
        <LinearGradient
          colors={[
            'rgba(7,9,12,0.48)',
            'rgba(7,9,12,0.72)',
            'rgba(7,9,12,0.94)',
            'rgba(7,9,12,1)',
          ]}
          locations={[0, 0.32, 0.68, 1]}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <KeyboardAvoidingView
            style={styles.keyboardView}
            behavior={
              Platform.OS === 'ios'
                ? 'padding'
                : undefined
            }
          >
            <View style={styles.content}>
              {/* HEADER */}
              <View style={styles.header}>
                <Pressable
                  onPress={handleBack}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.backButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name="arrow-back"
                    size={22}
                    color={colors.textPrimary}
                  />
                </Pressable>

                <Image
                  source={logo}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </View>

              <View style={styles.spacerTop} />

              {!sent ? (
                <>
                  {/* TITRE */}
                  <View style={styles.titleArea}>
                    <Text style={styles.eyebrow}>
                      ACCÈS AU COMPTE
                    </Text>

                    <Text style={styles.title}>
                      MOT DE PASSE
                      {'\n'}
                      OUBLIÉ
                      <Text style={styles.blueDot}>.</Text>
                    </Text>

                    <Text style={styles.description}>
                      Entre ton adresse email. Nous t’enverrons un lien pour choisir un nouveau mot de passe.
                    </Text>
                  </View>

                  {/* EMAIL */}
                  <View style={styles.form}>
                    <Text style={styles.label}>
                      EMAIL
                    </Text>

                    <View style={styles.inputWrapper}>
                      <Ionicons
                        name="mail-outline"
                        size={20}
                        color={colors.textMuted}
                      />

                      <TextInput
                        value={email}
                        onChangeText={setEmail}
                        placeholder="ton@email.com"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={handleResetPassword}
                        style={styles.input}
                      />
                    </View>

                    <Pressable
                      onPress={handleResetPassword}
                      disabled={!email.trim()}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        !email.trim() &&
                          styles.primaryButtonDisabled,
                        pressed &&
                          email.trim() &&
                          styles.primaryButtonPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.primaryButtonText,
                          !email.trim() &&
                            styles.primaryButtonTextDisabled,
                        ]}
                      >
                        ENVOYER LE LIEN
                      </Text>

                      <Ionicons
                        name="arrow-forward"
                        size={19}
                        color={
                          email.trim()
                            ? colors.brandWhite
                            : colors.textMuted
                        }
                      />
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  {/* CONFIRMATION */}
                  <View style={styles.successArea}>
                    <View style={styles.successIcon}>
                      <Ionicons
                        name="mail-open-outline"
                        size={31}
                        color={colors.brandWhite}
                      />
                    </View>

                    <Text style={styles.successEyebrow}>
                      EMAIL ENVOYÉ
                    </Text>

                    <Text style={styles.successTitle}>
                      REGARDE TA
                      {'\n'}
                      BOÎTE MAIL
                      <Text style={styles.blueDot}>.</Text>
                    </Text>

                    <Text style={styles.successDescription}>
                      Si un compte est associé à
                    </Text>

                    <Text style={styles.emailValue}>
                      {email}
                    </Text>

                    <Text style={styles.successDescriptionBottom}>
                      tu recevras un lien pour réinitialiser ton mot de passe.
                    </Text>

                    <View style={styles.infoCard}>
                      <Ionicons
                        name="information-circle-outline"
                        size={20}
                        color={colors.primaryLight}
                      />

                      <Text style={styles.infoText}>
                        Pense aussi à vérifier tes courriers indésirables.
                      </Text>
                    </View>

                    <Pressable
                      onPress={() =>
                        router.replace('/(auth)/login')
                      }
                      style={({ pressed }) => [
                        styles.primaryButton,
                        pressed &&
                          styles.primaryButtonPressed,
                      ]}
                    >
                      <Text style={styles.primaryButtonText}>
                        RETOUR À LA CONNEXION
                      </Text>

                      <Ionicons
                        name="arrow-forward"
                        size={19}
                        color={colors.brandWhite}
                      />
                    </Pressable>

                    <Pressable
                      onPress={() => setSent(false)}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.secondaryButtonText}>
                        MODIFIER L’ADRESSE EMAIL
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}

              <View style={styles.spacerBottom} />

              <Text style={styles.footer}>
                UGEROD · TON OBJECTIF. TA SÉANCE. TON ÉVOLUTION.
              </Text>
            </View>
          </KeyboardAvoidingView>
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

  safeArea: {
    flex: 1,
  },

  keyboardView: {
    flex: 1,
  },

  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },

  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 8,
    paddingBottom: 24,
  },

  /* HEADER */

  header: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  logo: {
    width: 105,
    height: 38,
    marginLeft: 'auto',
  },

  spacerTop: {
    flex: 0.45,
  },

  spacerBottom: {
    flex: 1,
  },

  /* TITRE */

  titleArea: {
    marginTop: 18,
  },

  eyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.1,
    color: colors.textSecondary,
  },

  title: {
    ...typography.display,
    fontSize: 48,
    lineHeight: 51,
    letterSpacing: 2.2,
    color: colors.textPrimary,
    marginTop: 8,
  },

  blueDot: {
    color: colors.primary,
  },

  description: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    marginTop: 14,
    maxWidth: 350,
  },

  /* FORM */

  form: {
    marginTop: 32,
  },

  label: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.9,
    color: colors.textSecondary,
    marginBottom: 8,
  },

  inputWrapper: {
    minHeight: 54,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  input: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    color: colors.textPrimary,
    paddingVertical: 0,
  },

  /* BOUTONS */

  primaryButton: {
    minHeight: 56,
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  primaryButtonDisabled: {
    backgroundColor: 'rgba(40,45,52,0.92)',
  },

  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },

  primaryButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 1.1,
    color: colors.brandWhite,
  },

  primaryButtonTextDisabled: {
    color: colors.textMuted,
  },

  secondaryButton: {
    minHeight: 48,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  secondaryButtonText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.7,
    color: colors.textSecondary,
  },

  /* SUCCESS */

  successArea: {
    alignItems: 'center',
  },

  successIcon: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 19,
  },

  successEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color: colors.primaryLight,
  },

  successTitle: {
    ...typography.display,
    fontSize: 45,
    lineHeight: 48,
    letterSpacing: 2.1,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 7,
  },

  successDescription: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
  },

  emailValue: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 19,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 3,
  },

  successDescriptionBottom: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
    marginTop: 3,
  },

  infoCard: {
    width: '100%',
    minHeight: 64,
    marginTop: 25,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  infoText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  /* FOOTER */

  footer: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 0.7,
    color: colors.textMuted,
    textAlign: 'center',
  },

  pressed: {
    opacity: 0.65,
  },
});