import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
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

import { spacing, typography } from '../../src/constants';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import {
  getCurrentProfile,
  updatePersonalInformation,
} from '../../src/services/profileService';
import { supabase } from '../../src/lib/supabase';

const brandIcon = require('../../assets/branding/ugerod-icon.png');

const GENDER_OPTIONS = [
  { value: 'male', label: 'HOMME' },
  { value: 'female', label: 'FEMME' },
];

function isoToFrenchDate(value) {
  if (!value) {
    return '';
  }

  const parts = value.split('-');

  if (parts.length !== 3) {
    return '';
  }

  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function frenchDateToIso(value) {
  const trimmed = value?.trim() ?? '';

  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    throw new Error(
      'La date de naissance doit être au format JJ/MM/AAAA.'
    );
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const currentYear = new Date().getFullYear();

  if (year < 1900 || year > currentYear) {
    throw new Error('L’année de naissance indiquée est invalide.');
  }

  if (month < 1 || month > 12) {
    throw new Error('Le mois de naissance indiqué est invalide.');
  }

  const daysInMonth = new Date(year, month, 0).getDate();

  if (day < 1 || day > daysInMonth) {
    throw new Error('Le jour de naissance indiqué est invalide.');
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatBirthdateInput(value) {
  const digits = value.replace(/\D/g, '').slice(0, 8);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function normalizeGenderValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (['male', 'm', 'homme', 'man'].includes(normalized)) {
    return 'male';
  }

  if (['female', 'f', 'femme', 'woman'].includes(normalized)) {
    return 'female';
  }

  return null;
}

export default function PersonalInformationScreen() {
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState(null);
  const [birthdate, setBirthdate] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true);
        setErrorMessage('');

        const [profile, userResult] = await Promise.all([
          getCurrentProfile(),
          supabase.auth.getUser(),
        ]);

        if (userResult.error) {
          throw userResult.error;
        }

        setFirstName(profile?.firstname ?? '');
        setLastName(profile?.lastname ?? '');
        setGender(normalizeGenderValue(profile?.gender));
        setBirthdate(isoToFrenchDate(profile?.birthdate));
        setHeight(
          profile?.height !== null && profile?.height !== undefined
            ? String(profile.height)
            : ''
        );
        setWeight(
          profile?.weight !== null && profile?.weight !== undefined
            ? String(profile.weight)
            : ''
        );
        setEmail(userResult.data?.user?.email ?? '');
      } catch (error) {
        console.log('PERSONAL INFORMATION LOAD ERROR', {
          message: error?.message,
          code: error?.code,
          details: error?.details,
        });

        setErrorMessage(
          error?.message ?? 'Impossible de charger tes informations.'
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  async function handleSave() {
    if (isSaving) {
      return;
    }

    try {
      setIsSaving(true);
      setSaved(false);
      setErrorMessage('');

      const parsedBirthdate = frenchDateToIso(birthdate);
      const parsedHeight = height.trim() ? Number(height) : null;
      const normalizedWeight = weight.trim().replace(',', '.');
      const parsedWeight = normalizedWeight ? Number(normalizedWeight) : null;

      if (
        parsedHeight !== null &&
        (Number.isNaN(parsedHeight) || parsedHeight < 100 || parsedHeight > 250)
      ) {
        throw new Error('Indique une taille valide en centimètres.');
      }

      if (
        parsedWeight !== null &&
        (Number.isNaN(parsedWeight) || parsedWeight < 30 || parsedWeight > 300)
      ) {
        throw new Error('Indique un poids valide en kilogrammes.');
      }

      await updatePersonalInformation({
        firstname: firstName.trim(),
        lastname: lastName.trim(),
        birthdate: parsedBirthdate,
        gender,
        height: parsedHeight,
        weight: parsedWeight,
      });

      setSaved(true);

      setTimeout(() => {
        router.back();
      }, 500);
    } catch (error) {
      console.log('PERSONAL INFORMATION SAVE ERROR', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
      });

      setErrorMessage(
        error?.message ?? 'Impossible d’enregistrer tes informations.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>CHARGEMENT DE TES INFORMATIONS...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <View style={styles.header}>
            <Pressable
              onPress={() => !isSaving && router.back()}
              hitSlop={12}
              style={({ pressed }) => [
                styles.headerButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="arrow-back" size={23} color={colors.text} />
            </Pressable>

            <Text style={styles.headerTitle}>TES INFOS</Text>

            <Image
              source={brandIcon}
              style={styles.brandIcon}
              resizeMode="contain"
            />
          </View>

          <Text style={styles.pageIntro}>
            Renseigne uniquement les données utiles à ton suivi.
          </Text>

          {!!errorMessage && (
            <View style={styles.errorCard}>
              <Ionicons
                name="alert-circle-outline"
                size={22}
                color={colors.secondaryAccentStrong}
              />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <SectionTitle
            title="IDENTITÉ"
            subtitle="Les informations principales de ton compte."
            styles={styles}
          />

          <View style={styles.formCard}>
            <Field
              label="PRÉNOM"
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Ton prénom"
              icon="person-outline"
              styles={styles}
              colors={colors}
            />

            <Field
              label="NOM"
              value={lastName}
              onChangeText={setLastName}
              placeholder="Ton nom"
              icon="person-outline"
              styles={styles}
              colors={colors}
            />

            <View style={[styles.field, styles.fieldLast]}>
              <Text style={styles.label}>EMAIL</Text>
              <View style={[styles.inputWrapper, styles.inputWrapperDisabled]}>
                <Ionicons
                  name="mail-outline"
                  size={20}
                  color={colors.textMuted}
                />
                <Text style={styles.disabledInputText} numberOfLines={1}>
                  {email || 'EMAIL NON DISPONIBLE'}
                </Text>
                <Ionicons
                  name="lock-closed-outline"
                  size={16}
                  color={colors.textMuted}
                />
              </View>
            </View>
          </View>

          <SectionTitle
            title="REPÈRES PHYSIQUES"
            subtitle="Utilisés seulement quand ils apportent quelque chose au coaching."
            styles={styles}
          />

          <View style={styles.formCard}>
            <View style={styles.field}>
              <Text style={styles.label}>SEXE</Text>
              <View style={styles.segmentedControl}>
                {GENDER_OPTIONS.map((option) => {
                  const selected = gender === option.value;

                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => setGender(option.value)}
                      style={({ pressed }) => [
                        styles.segment,
                        selected && styles.segmentSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons
                        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={19}
                        color={
                          selected
                            ? colors.textOnAccent
                            : colors.textMuted
                        }
                      />
                      <Text
                        style={[
                          styles.segmentText,
                          selected && styles.segmentTextSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.fieldHelp}>
                Utilisé pour les repères de performance lorsque les seuils diffèrent.
              </Text>
            </View>

            <Field
              label="DATE DE NAISSANCE"
              value={birthdate}
              onChangeText={(value) => {
                setBirthdate(formatBirthdateInput(value));
              }}
              placeholder="JJ/MM/AAAA"
              icon="calendar-outline"
              keyboardType="number-pad"
              styles={styles}
              colors={colors}
            />

            <Field
              label="TAILLE"
              value={height}
              onChangeText={setHeight}
              placeholder="Ex : 178"
              icon="resize-outline"
              keyboardType="number-pad"
              unit="CM"
              styles={styles}
              colors={colors}
            />

            <Field
              label="POIDS"
              value={weight}
              onChangeText={setWeight}
              placeholder="Ex : 82"
              icon="scale-outline"
              keyboardType="decimal-pad"
              unit="KG"
              last
              styles={styles}
              colors={colors}
            />
          </View>

          <Pressable
            onPress={handleSave}
            disabled={isSaving || saved}
            style={({ pressed }) => [
              styles.saveButton,
              pressed && !isSaving && !saved && styles.saveButtonPressed,
              (isSaving || saved) && styles.saveButtonDisabled,
            ]}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.textOnAccent} />
            ) : (
              <>
                <Ionicons
                  name={saved ? 'checkmark-circle' : 'save-outline'}
                  size={21}
                  color={colors.textOnAccent}
                />
                <Text style={styles.saveButtonText}>
                  {saved ? 'ENREGISTRÉ' : 'ENREGISTRER'}
                </Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SectionTitle({ title, subtitle, styles }) {
  return (
    <View style={styles.sectionTitleArea}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
  keyboardType = 'default',
  unit,
  last = false,
  styles,
  colors,
}) {
  return (
    <View style={[styles.field, last && styles.fieldLast]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrapper}>
        <Ionicons name={icon} size={20} color={colors.accentStrong} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textDisabled}
          keyboardType={keyboardType}
          style={styles.input}
          selectionColor={colors.accent}
          autoCapitalize="sentences"
        />
        {!!unit && <Text style={styles.unit}>{unit}</Text>}
      </View>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    keyboardView: {
      flex: 1,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: 48,
    },
    loadingScreen: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      backgroundColor: colors.background,
    },
    loadingText: {
      ...typography.body,
      fontSize: 16,
      lineHeight: 23,
      color: colors.textSecondary,
    },
    header: {
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    headerButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerTitle: {
      ...typography.screenTitle,
      fontSize: 32,
      lineHeight: 35,
      color: colors.text,
    },
    brandIcon: {
      width: 38,
      height: 38,
      tintColor: colors.accentStrong,
    },
    pageIntro: {
      ...typography.bodyLarge,
      fontSize: 17,
      lineHeight: 25,
      color: colors.textSecondary,
      marginBottom: spacing.md,
    },
    errorCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderRadius: 16,
      backgroundColor: colors.errorSoft,
      borderWidth: 1,
      borderColor: colors.warningBorder,
    },
    errorText: {
      ...typography.body,
      flex: 1,
      fontSize: 16,
      lineHeight: 23,
      color: colors.secondaryAccentStrong,
    },
    sectionTitleArea: {
      marginTop: 26,
      marginBottom: 10,
    },
    sectionTitle: {
      ...typography.sectionTitle,
      fontSize: 20,
      lineHeight: 26,
      color: colors.text,
    },
    sectionSubtitle: {
      ...typography.body,
      marginTop: 3,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    formCard: {
      borderRadius: 20,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    field: {
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    fieldLast: {
      borderBottomWidth: 0,
    },
    label: {
      ...typography.label,
      marginBottom: 8,
      fontSize: 14,
      lineHeight: 19,
      color: colors.text,
    },
    inputWrapper: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      borderRadius: 16,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    inputWrapperDisabled: {
      backgroundColor: colors.inputDisabled,
    },
    input: {
      ...typography.bodyLarge,
      flex: 1,
      paddingVertical: 0,
      fontSize: 17,
      lineHeight: 24,
      color: colors.text,
    },
    disabledInputText: {
      ...typography.body,
      flex: 1,
      fontSize: 16,
      lineHeight: 23,
      color: colors.textMuted,
    },
    unit: {
      ...typography.label,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textMuted,
    },
    fieldHelp: {
      ...typography.body,
      marginTop: 8,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    segmentedControl: {
      flexDirection: 'row',
      gap: 10,
    },
    segment: {
      minHeight: 50,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
    },
    segmentSelected: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    segmentText: {
      ...typography.label,
      fontSize: 15,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    segmentTextSelected: {
      color: colors.textOnAccent,
    },
    saveButton: {
      minHeight: 58,
      marginTop: 28,
      borderRadius: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: colors.accent,
    },
    saveButtonPressed: {
      opacity: 0.86,
    },
    saveButtonDisabled: {
      opacity: 0.72,
    },
    saveButtonText: {
      ...typography.button,
      fontSize: 19,
      lineHeight: 23,
      color: colors.textOnAccent,
    },
    pressed: {
      opacity: 0.72,
    },
  });
}
