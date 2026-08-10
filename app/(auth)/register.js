import { router } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

import {
  signUp,
} from '../../src/services/authService';

const brandLogo = require('../../assets/branding/ugerod-logo-white.png');

export default function RegisterScreen() {
  const [firstname, setFirstname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [registerError, setRegisterError] = useState('');

  const passwordsMatch =
    confirmPassword.length === 0 || password === confirmPassword;

  const hasMinLength = password.length >= 6;
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialCharacter =
    /[^A-Za-z0-9]/.test(password);

  const passwordIsValid =
    hasMinLength &&
    hasUppercase &&
    hasNumber &&
    hasSpecialCharacter;

  const emailIsValid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const canSubmit =
    firstname.trim().length > 0 &&
    emailIsValid &&
    passwordIsValid &&
    confirmPassword.length > 0 &&
    password === confirmPassword &&
    acceptTerms &&
    !loading;

  function handleBack() {
    router.back();
  }

  function handleLogin() {
    router.push('/(auth)/login');
  }

  async function handleRegister() {
    if (!canSubmit) return;

    try {
      setRegisterError('');
      setLoading(true);

      const data = await signUp({
        firstname: firstname.trim(),
        email: email.trim().toLowerCase(),
        password,
      });

      if (!data?.session) {
        router.replace({
          pathname: '/(auth)/email-confirmation',
          params: {
            email: email.trim().toLowerCase(),
          },
        });
        return;
      }

      router.replace('/onboarding/level');
    } catch (error) {
      setRegisterError(
        error?.message ??
          "Impossible de créer ton compte."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
                size={23}
                color={colors.textPrimary}
              />
            </Pressable>

            <View style={styles.logoArea}>
              <Image
                source={brandLogo}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>

            <View style={styles.headerSpacer} />
          </View>

          {/* CONTENT */}
          <View style={styles.content}>
            <View style={styles.titleArea}>
              <Text style={styles.title}>
                REJOINS UGEROD
                <Text style={styles.blueDot}>.</Text>
              </Text>

              <Text style={styles.subtitle}>
                Crée ton profil et construis des séances adaptées à ton niveau,
                ton matériel et tes objectifs.
              </Text>
            </View>

            <View style={styles.form}>
              {/* PRÉNOM */}
              <View style={styles.field}>
                <Text style={styles.label}>PRÉNOM</Text>

                <TextInput
                  value={firstname}
                  onChangeText={setFirstname}
                  placeholder="Ton prénom"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  autoCorrect={false}
                  style={styles.input}
                />
              </View>

              {/* EMAIL */}
              <View style={styles.field}>
                <Text style={styles.label}>E-MAIL</Text>

                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="nom@email.com"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
              </View>

              {/* MOT DE PASSE */}
              <View style={styles.field}>
                <Text style={styles.label}>MOT DE PASSE</Text>

                <View style={styles.passwordContainer}>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="6 caractères + majuscule, chiffre et symbole"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    style={styles.passwordInput}
                  />

                  <Pressable
                    onPress={() => setShowPassword((value) => !value)}
                    style={styles.eyeButton}
                    hitSlop={10}
                  >
                    <Ionicons
                      name={
                        showPassword
                          ? 'eye-off-outline'
                          : 'eye-outline'
                      }
                      size={22}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                </View>
              </View>

              <View style={styles.passwordRules}>
                <PasswordRule
                  valid={hasMinLength}
                  label="6 caractères minimum"
                />
                <PasswordRule
                  valid={hasUppercase}
                  label="1 majuscule"
                />
                <PasswordRule
                  valid={hasNumber}
                  label="1 chiffre"
                />
                <PasswordRule
                  valid={hasSpecialCharacter}
                  label="1 caractère spécial"
                />
              </View>

              {/* CONFIRMATION */}
              <View style={styles.field}>
                <Text style={styles.label}>
                  CONFIRMER LE MOT DE PASSE
                </Text>

                <View
                  style={[
                    styles.passwordContainer,
                    !passwordsMatch && styles.inputError,
                  ]}
                >
                  <TextInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Répète ton mot de passe"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    style={styles.passwordInput}
                  />

                  <Pressable
                    onPress={() =>
                      setShowConfirmPassword((value) => !value)
                    }
                    style={styles.eyeButton}
                    hitSlop={10}
                  >
                    <Ionicons
                      name={
                        showConfirmPassword
                          ? 'eye-off-outline'
                          : 'eye-outline'
                      }
                      size={22}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                </View>

                {!passwordsMatch && (
                  <Text style={styles.errorText}>
                    Les mots de passe ne correspondent pas.
                  </Text>
                )}
              </View>

              {/* CONDITIONS */}
              <Pressable
                onPress={() => setAcceptTerms((value) => !value)}
                style={styles.termsRow}
              >
                <View
                  style={[
                    styles.checkbox,
                    acceptTerms && styles.checkboxSelected,
                  ]}
                >
                  {acceptTerms && (
                    <Ionicons
                      name="checkmark"
                      size={16}
                      color={colors.brandWhite}
                    />
                  )}
                </View>

                <Text style={styles.termsText}>
                  J’accepte les{' '}
                  <Text style={styles.termsLink}>
                    conditions d’utilisation
                  </Text>{' '}
                  et la politique de confidentialité.
                </Text>
              </Pressable>

              {registerError ? (
                <View style={styles.registerErrorBox}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={18}
                    color={colors.error}
                  />
                  <Text style={styles.registerErrorText}>
                    {registerError}
                  </Text>
                </View>
              ) : null}

              {/* CTA */}
              <Pressable
                onPress={handleRegister}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  styles.primaryButton,
                  !canSubmit && styles.primaryButtonDisabled,
                  pressed && canSubmit && styles.primaryButtonPressed,
                ]}
              >
                <Text
                  style={[
                    styles.primaryButtonText,
                    !canSubmit && styles.primaryButtonTextDisabled,
                  ]}
                >
                  {loading
                    ? 'CRÉATION...'
                    : 'CRÉER MON COMPTE'}
                </Text>
              </Pressable>
            </View>

            {/* CONNEXION */}
            <View style={styles.loginArea}>
              <Text style={styles.loginQuestion}>
                DÉJÀ MEMBRE ?
              </Text>

              <Pressable
                onPress={handleLogin}
                style={({ pressed }) => [
                  styles.loginButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.loginLink}>
                  SE CONNECTER
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PasswordRule({
  valid,
  label,
}) {
  return (
    <View style={styles.passwordRuleRow}>
      <Ionicons
        name={
          valid
            ? 'checkmark-circle'
            : 'ellipse-outline'
        }
        size={15}
        color={
          valid
            ? colors.primaryLight
            : colors.textMuted
        }
      />

      <Text
        style={[
          styles.passwordRuleText,
          valid && styles.passwordRuleTextValid,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },

  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },

  header: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
  },

  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerSpacer: {
    width: 44,
  },

  logoArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  logo: {
    width: 190,
    height: 68,
  },

  content: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingTop: spacing.lg,
  },

  titleArea: {
    marginBottom: spacing.xxl,
  },

  title: {
    ...typography.display,
    color: colors.textPrimary,
    fontSize: 34,
    lineHeight: 38,
  },

  blueDot: {
    color: colors.primary,
  },

  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    maxWidth: 420,
  },

  form: {
    gap: spacing.lg,
  },

  field: {
    gap: spacing.xs,
  },

  label: {
    ...typography.label,
    color: colors.textPrimary,
  },

  input: {
    height: 56,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    fontSize: 16,
  },

  passwordContainer: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },

  passwordInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    fontSize: 16,
  },

  eyeButton: {
    width: 52,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },

  passwordRules: {
    gap: 6,
    marginTop: 2,
  },

  passwordRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  passwordRuleText: {
    ...typography.caption,
    color: colors.textMuted,
  },

  passwordRuleTextValid: {
    color: colors.primaryLight,
  },

  registerErrorBox: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },

  registerErrorText: {
    ...typography.caption,
    color: colors.error,
    flex: 1,
    lineHeight: 18,
  },

  inputError: {
    borderColor: colors.error,
  },

  errorText: {
    ...typography.caption,
    color: colors.error,
  },

  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },

  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  termsText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 18,
  },

  termsLink: {
    color: colors.textPrimary,
    fontWeight: '700',
  },

  primaryButton: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    marginTop: spacing.sm,
  },

  primaryButtonDisabled: {
    backgroundColor: colors.surfaceElevated,
  },

  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },

  primaryButtonText: {
    ...typography.button,
    color: colors.brandWhite,
  },

  primaryButtonTextDisabled: {
    color: colors.textDisabled,
  },

  loginArea: {
    alignItems: 'center',
    marginTop: spacing.xxxl,
  },

  loginQuestion: {
    ...typography.caption,
    color: colors.textSecondary,
  },

  loginButton: {
    marginTop: spacing.xs,
    padding: 6,
  },

  loginLink: {
    ...typography.button,
    color: colors.primaryLight,
    fontSize: 15,
  },

  pressed: {
    opacity: 0.65,
  },
});