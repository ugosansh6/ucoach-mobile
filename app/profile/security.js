import { router } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  ImageBackground,
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
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

export default function SecurityScreen() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [saved, setSaved] = useState(false);

  const passwordLongEnough = newPassword.length >= 8;

  const passwordsMatch =
    confirmPassword.length > 0 &&
    newPassword === confirmPassword;

  const canSave =
    currentPassword.length > 0 &&
    passwordLongEnough &&
    passwordsMatch;

  function handleBack() {
    router.back();
  }

  function handleForgotPassword() {
    router.push('/(auth)/forgot-password');
  }

  function handleSave() {
    if (!canSave) {
      return;
    }

    /*
     * PLUS TARD AVEC SUPABASE :
     *
     * Pour changer réellement le mot de passe :
     *
     * 1. Vérifier la session utilisateur.
     * 2. Selon notre stratégie Auth, revalider le mot de passe actuel.
     * 3. Mettre à jour le mot de passe :
     *
     * const { error } = await supabase.auth.updateUser({
     *   password: newPassword,
     * });
     *
     * if (error) {
     *   // afficher une erreur
     *   return;
     * }
     */

    setSaved(true);

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');

    setTimeout(() => {
      setSaved(false);
    }, 1600);
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={backgroundImage}
        resizeMode="cover"
        style={styles.background}
      >
        <View style={styles.darkOverlay} />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.45)',
            'rgba(7,9,12,0.72)',
            'rgba(7,9,12,0.95)',
            'rgba(7,9,12,1)',
          ]}
          locations={[0, 0.26, 0.68, 1]}
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
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
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
                    size={22}
                    color={colors.textPrimary}
                  />
                </Pressable>

                <View style={styles.headerText}>
                  <Text style={styles.headerEyebrow}>
                    TON COMPTE
                  </Text>

                  <Text style={styles.headerTitle}>
                    SÉCURITÉ
                    <Text style={styles.blueDot}>.</Text>
                  </Text>
                </View>

                <Image
                  source={brandIcon}
                  style={styles.brandIcon}
                  resizeMode="contain"
                />
              </View>

              {/* INTRO */}
              <View style={styles.intro}>
                <Text style={styles.introTitle}>
                  MOT DE PASSE
                </Text>

                <Text style={styles.introText}>
                  Modifie ton mot de passe pour sécuriser l’accès à ton compte UGEROD.
                </Text>
              </View>

              {/* FORMULAIRE */}
              <View style={styles.formCard}>
                {/* ACTUEL */}
                <View style={styles.field}>
                  <Text style={styles.label}>
                    MOT DE PASSE ACTUEL
                  </Text>

                  <View style={styles.inputWrapper}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={19}
                      color={colors.textMuted}
                    />

                    <TextInput
                      value={currentPassword}
                      onChangeText={setCurrentPassword}
                      placeholder="Ton mot de passe actuel"
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry={!showCurrentPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.input}
                    />

                    <Pressable
                      onPress={() =>
                        setShowCurrentPassword(
                          (current) => !current
                        )
                      }
                      hitSlop={8}
                    >
                      <Ionicons
                        name={
                          showCurrentPassword
                            ? 'eye-off-outline'
                            : 'eye-outline'
                        }
                        size={20}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  </View>
                </View>

                {/* NOUVEAU */}
                <View style={[styles.field, styles.fieldBorder]}>
                  <Text style={styles.label}>
                    NOUVEAU MOT DE PASSE
                  </Text>

                  <View style={styles.inputWrapper}>
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={19}
                      color={colors.textMuted}
                    />

                    <TextInput
                      value={newPassword}
                      onChangeText={setNewPassword}
                      placeholder="8 caractères minimum"
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry={!showNewPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.input}
                    />

                    <Pressable
                      onPress={() =>
                        setShowNewPassword(
                          (current) => !current
                        )
                      }
                      hitSlop={8}
                    >
                      <Ionicons
                        name={
                          showNewPassword
                            ? 'eye-off-outline'
                            : 'eye-outline'
                        }
                        size={20}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  </View>

                  <View style={styles.ruleRow}>
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
                        styles.ruleText,
                        passwordLongEnough &&
                          styles.ruleTextValid,
                      ]}
                    >
                      8 caractères minimum
                    </Text>
                  </View>
                </View>

                {/* CONFIRMATION */}
                <View style={styles.field}>
                  <Text style={styles.label}>
                    CONFIRMER LE NOUVEAU MOT DE PASSE
                  </Text>

                  <View style={styles.inputWrapper}>
                    <Ionicons
                      name="shield-outline"
                      size={19}
                      color={colors.textMuted}
                    />

                    <TextInput
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      placeholder="Retape ton nouveau mot de passe"
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry={!showConfirmPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={handleSave}
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
                    <View style={styles.ruleRow}>
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
                          styles.ruleText,
                          passwordsMatch &&
                            styles.ruleTextValid,
                          !passwordsMatch &&
                            styles.ruleTextError,
                        ]}
                      >
                        {passwordsMatch
                          ? 'Les mots de passe correspondent'
                          : 'Les mots de passe ne correspondent pas'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* MOT DE PASSE OUBLIÉ */}
              <Pressable
                onPress={handleForgotPassword}
                style={({ pressed }) => [
                  styles.forgotButton,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name="key-outline"
                  size={18}
                  color={colors.primaryLight}
                />

                <View style={styles.forgotMain}>
                  <Text style={styles.forgotTitle}>
                    MOT DE PASSE OUBLIÉ ?
                  </Text>

                  <Text style={styles.forgotText}>
                    Recevoir un lien de réinitialisation par email.
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={colors.textMuted}
                />
              </Pressable>

              {/* INFO */}
              <View style={styles.infoCard}>
                <Ionicons
                  name="information-circle-outline"
                  size={21}
                  color={colors.primaryLight}
                />

                <Text style={styles.infoText}>
                  Utilise un mot de passe différent de ceux que tu utilises sur d’autres services.
                </Text>
              </View>

              {/* CONFIRMATION */}
              {saved && (
                <View style={styles.successCard}>
                  <Ionicons
                    name="checkmark-circle"
                    size={21}
                    color={colors.primaryLight}
                  />

                  <Text style={styles.successText}>
                    Ton mot de passe a été modifié.
                  </Text>
                </View>
              )}

              {/* CTA */}
              <Pressable
                onPress={handleSave}
                disabled={!canSave}
                style={({ pressed }) => [
                  styles.saveButton,
                  !canSave &&
                    styles.saveButtonDisabled,
                  pressed &&
                    canSave &&
                    styles.saveButtonPressed,
                ]}
              >
                <Text
                  style={[
                    styles.saveButtonText,
                    !canSave &&
                      styles.saveButtonTextDisabled,
                  ]}
                >
                  MODIFIER MON MOT DE PASSE
                </Text>

                <Ionicons
                  name="shield-checkmark-outline"
                  size={20}
                  color={
                    canSave
                      ? colors.brandWhite
                      : colors.textMuted
                  }
                />
              </Pressable>

              <View style={styles.bottomSpace} />
            </ScrollView>
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
    backgroundColor: 'rgba(0,0,0,0.30)',
  },

  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 8,
  },

  /* HEADER */

  header: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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

  headerText: {
    flex: 1,
  },

  headerEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color: colors.textSecondary,
  },

  headerTitle: {
    ...typography.display,
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 1.7,
    color: colors.textPrimary,
  },

  blueDot: {
    color: colors.primary,
  },

  brandIcon: {
    width: 45,
    height: 45,
  },

  /* INTRO */

  intro: {
    marginTop: 25,
  },

  introTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.4,
    color: colors.textPrimary,
  },

  introText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: 6,
    maxWidth: 345,
  },

  /* FORM */

  formCard: {
    marginTop: 25,
    borderRadius: 17,
    paddingHorizontal: 15,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    overflow: 'hidden',
  },

  field: {
    paddingVertical: 15,
  },

  fieldBorder: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },

  label: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.8,
    color: colors.textSecondary,
    marginBottom: 8,
  },

  inputWrapper: {
    minHeight: 50,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(7,9,12,0.60)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  input: {
    flex: 1,
    fontFamily: 'Oswald_500Medium',
    fontSize: 13,
    color: colors.textPrimary,
    paddingVertical: 0,
  },

  ruleRow: {
    minHeight: 27,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  ruleText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },

  ruleTextValid: {
    color: colors.primaryLight,
  },

  ruleTextError: {
    color: colors.brandRed,
  },

  /* FORGOT */

  forgotButton: {
    minHeight: 78,
    marginTop: 14,
    borderRadius: 16,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  forgotMain: {
    flex: 1,
  },

  forgotTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.5,
    color: colors.textPrimary,
  },

  forgotText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
    marginTop: 2,
  },

  /* INFO */

  infoCard: {
    minHeight: 74,
    marginTop: 14,
    borderRadius: 15,
    padding: 14,
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  infoText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  /* SUCCESS */

  successCard: {
    minHeight: 54,
    marginTop: 12,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  successText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    lineHeight: 16,
    color: colors.primaryLight,
  },

  /* CTA */

  saveButton: {
    minHeight: 56,
    marginTop: 22,
    borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  saveButtonDisabled: {
    backgroundColor: 'rgba(40,45,52,0.92)',
  },

  saveButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },

  saveButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: 1,
    color: colors.brandWhite,
  },

  saveButtonTextDisabled: {
    color: colors.textMuted,
  },

  bottomSpace: {
    height: 42,
  },

  pressed: {
    opacity: 0.65,
  },
});