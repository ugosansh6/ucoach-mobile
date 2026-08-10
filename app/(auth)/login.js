import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
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

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

import { signIn } from '../../src/services/authService';

const brandLogo = require('../../assets/branding/ugerod-logo-white.png');

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  function handleBack() {
    router.back();
  }

  function handleForgotPassword() {
    router.push('/(auth)/forgot-password');
  }

  function handleRegister() {
    router.push('/(auth)/register');
  }

  async function handleLogin() {
    if (!email.trim() || !password) {
      return;
    }

    try {
      setLoading(true);

      const data = await signIn(email, password);

      if (!data?.session) {
        throw new Error(
          'Connexion réussie mais aucune session Supabase n’a été créée.'
        );
      }

      console.log('Connexion Supabase réussie :', data.user?.id);

      router.replace('/');
    } catch (error) {
      console.error('Erreur connexion Supabase :', error);

      Alert.alert(
        'Connexion impossible',
        error?.message || 'Une erreur est survenue pendant la connexion.'
      );
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    !loading;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
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
                name="chevron-back"
                size={28}
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

          <View style={styles.content}>
            <View style={styles.titleArea}>
              <Text style={styles.title}>BON RETOUR</Text>

              <Text style={styles.subtitle}>
                Connecte-toi pour retrouver tes séances et ta progression.
              </Text>
            </View>

            <View style={styles.form}>
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
                  textContentType="emailAddress"
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>MOT DE PASSE</Text>

                <View style={styles.passwordContainer}>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••••••"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    textContentType="password"
                    style={styles.passwordInput}
                  />

                  <Pressable
                    onPress={() =>
                      setShowPassword((value) => !value)
                    }
                    hitSlop={10}
                    style={({ pressed }) => [
                      styles.eyeButton,
                      pressed && styles.pressed,
                    ]}
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

                <Pressable
                  onPress={handleForgotPassword}
                  style={({ pressed }) => [
                    styles.forgotButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.forgotText}>
                    MOT DE PASSE OUBLIÉ ?
                  </Text>
                </Pressable>
              </View>

              <Pressable
                onPress={handleLogin}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  styles.primaryButton,
                  !canSubmit && styles.primaryButtonDisabled,
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
                  {loading ? 'CONNEXION...' : 'SE CONNECTER'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.registerArea}>
              <Text style={styles.registerQuestion}>
                PAS ENCORE MEMBRE ?
              </Text>

              <Pressable
                onPress={handleRegister}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.registerButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.registerLink}>
                  CRÉER UN COMPTE
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
    paddingBottom: spacing.xxl,
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
    flex: 1,
    justifyContent: 'center',
    paddingBottom: spacing.xxl,
  },

  titleArea: {
    marginBottom: spacing.xxl,
  },

  title: {
    ...typography.display,
    color: colors.textPrimary,
    fontSize: 36,
    lineHeight: 40,
  },

  subtitle: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    maxWidth: 330,
  },

  form: {
    gap: spacing.xl,
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

  forgotButton: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
  },

  forgotText: {
    ...typography.caption,
    color: colors.primaryLight,
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
    color: colors.textOnPrimary,
  },

  primaryButtonTextDisabled: {
    color: colors.textDisabled,
  },

  registerArea: {
    alignItems: 'center',
    marginTop: spacing.xxxl,
  },

  registerQuestion: {
    ...typography.caption,
    color: colors.textSecondary,
  },

  registerButton: {
    marginTop: spacing.xs,
    padding: 6,
  },

  registerLink: {
    ...typography.button,
    color: colors.primaryLight,
    fontSize: 15,
  },

  pressed: {
    opacity: 0.65,
  },
});