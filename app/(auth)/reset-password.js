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

export default function ResetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [updated, setUpdated] = useState(false);

  const passwordsMatch =
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password === confirmPassword;

  const passwordLongEnough = password.length >= 8;

  const canSubmit =
    passwordLongEnough &&
    passwordsMatch;

  function handleBack() {
    router.back();
  }

  function handleUpdatePassword() {
    if (!canSubmit) {
      return;
    }

    /*
     * PLUS TARD AVEC SUPABASE :
     *
     * const { error } = await supabase.auth.updateUser({
     *   password,
     * });
     *
     * if (error) {
     *   // afficher le message d'erreur
     *   return;
     * }
     */

    setUpdated(true);
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={backgroundImage}
        style={styles.background}
        resizeMode="cover"
      >
        <View style={styles.darkOverlay} />

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

              {!updated ? (
                <>
                  {/* TITRE */}
                  <View style={styles.titleArea}>
                    <Text style={styles.eyebrow}>
                      SÉCURITÉ
                    </Text>

                    <Text style={styles.title}>
                      NOUVEAU
                      {'\n'}
                      MOT DE PASSE
                      <Text style={styles.blueDot}>.</Text>
                    </Text>

                    <Text style={styles.description}>
                      Choisis un nouveau mot de passe pour accéder à ton compte UGEROD.
                    </Text>
                  </View>

                  {/* FORM */}
                  <View style={styles.form}>
                    <Text style={styles.label}>
                      NOUVEAU MOT DE PASSE
                    </Text>

                    <View style={styles.inputWrapper}>
                      <Ionicons
                        name="lock-closed-outline"
                        size={20}
                        color={colors.textMuted}
                      />

                      <TextInput
                        value={password}
                        onChangeText={setPassword}
                        placeholder="8 caractères minimum"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={styles.input}
                      />

                      <Pressable
                        onPress={() =>
                          setShowPassword((current) => !current)
                        }
                        hitSlop={8}
                      >
                        <Ionicons
                          name={
                            showPassword
                              ? 'eye-off-outline'
                              : 'eye-outline'
                          }
                          size={20}
                          color={colors.textMuted}
                        />
                      </Pressable>
                    </View>

                    <View style={styles.passwordRule}>
                      <Ionicons
                        name={
                          passwordLongEnough
                            ? 'checkmark-circle'
                            : 'ellipse-outline'
                        }
                        size={15}
                        color={
                          passwordLongEnough
                            ? colors.primaryLight
                            : colors.textMuted
                        }
                      />

                      <Text
                        style={[
                          styles.passwordRuleText,
                          passwordLongEnough &&
                            styles.passwordRuleTextValid,
                        ]}
                      >
                        8 caractères minimum
                      </Text>
                    </View>

                    <Text style={styles.confirmLabel}>
                      CONFIRMER LE MOT DE PASSE
                    </Text>

                    <View style={styles.inputWrapper}>
                      <Ionicons
                        name="lock-closed-outline"
                        size={20}
                        color={colors.textMuted}
                      />

                      <TextInput
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        placeholder="Retape ton mot de passe"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showConfirmPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={handleUpdatePassword}
                        style={styles.input}
                      />

                      <Pressable
                        onPress={() =>
                          setShowConfirmPassword(
                            (current) => !current
                          )
                        }
                        hitSlop={8}
                      >
                        <Ionicons
                          name={
                            showConfirmPassword
                              ? 'eye-off-outline'
                              : 'eye-outline'
                          }
                          size={20}
                          color={colors.textMuted}
                        />
                      </Pressable>
                    </View>

                    {confirmPassword.length > 0 && (
                      <View style={styles.passwordRule}>
                        <Ionicons
                          name={
                            passwordsMatch
                              ? 'checkmark-circle'
                              : 'close-circle'
                          }
                          size={15}
                          color={
                            passwordsMatch
                              ? colors.primaryLight
                              : colors.brandRed
                          }
                        />

                        <Text
                          style={[
                            styles.passwordRuleText,

                            passwordsMatch &&
                              styles.passwordRuleTextValid,

                            !passwordsMatch &&
                              styles.passwordRuleTextError,
                          ]}
                        >
                          {passwordsMatch
                            ? 'Les mots de passe correspondent'
                            : 'Les mots de passe ne correspondent pas'}
                        </Text>
                      </View>
                    )}

                    <Pressable
                      onPress={handleUpdatePassword}
                      disabled={!canSubmit}
                      style={({ pressed }) => [
                        styles.primaryButton,

                        !canSubmit &&
                          styles.primaryButtonDisabled,

                        pressed &&
                          canSubmit &&
                          styles.primaryButtonPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.primaryButtonText,

                          !canSubmit &&
                            styles.primaryButtonTextDisabled,
                        ]}
                      >
                        ENREGISTRER
                      </Text>

                      <Ionicons
                        name="checkmark-circle-outline"
                        size={20}
                        color={
                          canSubmit
                            ? colors.brandWhite
                            : colors.textMuted
                        }
                      />
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  {/* SUCCÈS */}
                  <View style={styles.successArea}>
                    <View style={styles.successIcon}>
                      <Ionicons
                        name="checkmark"
                        size={31}
                        color={colors.brandWhite}
                      />
                    </View>

                    <Text style={styles.successEyebrow}>
                      MOT DE PASSE MODIFIÉ
                    </Text>

                    <Text style={styles.successTitle}>
                      C’EST BON
                      <Text style={styles.blueDot}>.</Text>
                    </Text>

                    <Text style={styles.successDescription}>
                      Ton nouveau mot de passe est enregistré. Tu peux maintenant te reconnecter à UGEROD.
                    </Text>

                    <Pressable
                      onPress={() =>
                        router.replace('/(auth)/login')
                      }
                      style={({ pressed }) => [
                        styles.primaryButton,
                        styles.successButton,
                        pressed &&
                          styles.primaryButtonPressed,
                      ]}
                    >
                      <Text style={styles.primaryButtonText}>
                        SE CONNECTER
                      </Text>

                      <Ionicons
                        name="arrow-forward"
                        size={19}
                        color={colors.brandWhite}
                      />
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
    flex: 0.35,
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
    fontSize: 47,
    lineHeight: 50,
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
    marginTop: 28,
  },

  label: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.9,
    color: colors.textSecondary,
    marginBottom: 8,
  },

  confirmLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.9,
    color: colors.textSecondary,
    marginTop: 20,
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

  passwordRule: {
    minHeight: 28,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  passwordRuleText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },

  passwordRuleTextValid: {
    color: colors.primaryLight,
  },

  passwordRuleTextError: {
    color: colors.brandRed,
  },

  /* BOUTON */

  primaryButton: {
    minHeight: 56,
    marginTop: 24,
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

  /* SUCCESS */

  successArea: {
    alignItems: 'center',
    marginTop: 20,
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
    fontSize: 48,
    lineHeight: 51,
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
    maxWidth: 310,
    marginTop: 14,
  },

  successButton: {
    width: '100%',
    marginTop: 28,
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