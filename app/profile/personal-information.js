import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
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

import {
  getCurrentProfile,
  updatePersonalInformation,
} from '../../src/services/profileService';

import { supabase } from '../../src/lib/supabase';

const backgroundImage = require(
  '../../assets/backgrounds/welcome-default.jpg'
);

const brandIcon = require(
  '../../assets/branding/ugerod-icon.png'
);

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

  const match = trimmed.match(
    /^(\d{2})\/(\d{2})\/(\d{4})$/
  );

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
    throw new Error(
      'L’année de naissance indiquée est invalide.'
    );
  }

  if (month < 1 || month > 12) {
    throw new Error(
      'Le mois de naissance indiqué est invalide.'
    );
  }

  const daysInMonth = new Date(
    year,
    month,
    0
  ).getDate();

  if (day < 1 || day > daysInMonth) {
    throw new Error(
      'Le jour de naissance indiqué est invalide.'
    );
  }

  const formattedMonth =
    String(month).padStart(2, '0');

  const formattedDay =
    String(day).padStart(2, '0');

  return `${year}-${formattedMonth}-${formattedDay}`;
}

function formatBirthdateInput(value) {
  const digits = value
    .replace(/\D/g, '')
    .slice(0, 8);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export default function PersonalInformationScreen() {
  const [firstName, setFirstName] =
    useState('');

  const [lastName, setLastName] =
    useState('');

  const [email, setEmail] =
    useState('');

  const [birthdate, setBirthdate] =
    useState('');

  const [height, setHeight] =
    useState('');

  const [weight, setWeight] =
    useState('');

  const [isLoading, setIsLoading] =
    useState(true);

  const [isSaving, setIsSaving] =
    useState(false);

  const [saved, setSaved] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState('');

  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true);
        setErrorMessage('');

        const [
          profile,
          userResult,
        ] = await Promise.all([
          getCurrentProfile(),
          supabase.auth.getUser(),
        ]);

        if (userResult.error) {
          throw userResult.error;
        }

        setFirstName(
          profile?.firstname ?? ''
        );

        setLastName(
          profile?.lastname ?? ''
        );

        setBirthdate(
          isoToFrenchDate(
            profile?.birthdate
          )
        );

        setHeight(
          profile?.height !== null &&
          profile?.height !== undefined
            ? String(profile.height)
            : ''
        );

        setWeight(
          profile?.weight !== null &&
          profile?.weight !== undefined
            ? String(profile.weight)
            : ''
        );

        setEmail(
          userResult.data?.user?.email ??
            ''
        );
      } catch (error) {
        console.log(
          'PERSONAL INFORMATION LOAD ERROR',
          {
            message: error?.message,
            code: error?.code,
            details: error?.details,
          }
        );

        setErrorMessage(
          error?.message ??
            'Impossible de charger tes informations.'
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  function handleBack() {
    if (isSaving) {
      return;
    }

    router.back();
  }

  function handleChangePassword() {
    router.push('/profile/security');
  }

  async function handleSave() {
    if (isSaving) {
      return;
    }

    try {
      setIsSaving(true);
      setSaved(false);
      setErrorMessage('');

      const parsedBirthdate =
        frenchDateToIso(birthdate);

      const parsedHeight =
        height.trim()
          ? Number(height)
          : null;

      const parsedWeight =
        weight
          .trim()
          .replace(',', '.')
          ? Number(
              weight
                .trim()
                .replace(',', '.')
            )
          : null;

      if (
        parsedHeight !== null &&
        (
          Number.isNaN(parsedHeight) ||
          parsedHeight < 100 ||
          parsedHeight > 250
        )
      ) {
        throw new Error(
          'Indique une taille valide en centimètres.'
        );
      }

      if (
        parsedWeight !== null &&
        (
          Number.isNaN(parsedWeight) ||
          parsedWeight < 30 ||
          parsedWeight > 300
        )
      ) {
        throw new Error(
          'Indique un poids valide en kilogrammes.'
        );
      }

      await updatePersonalInformation({
        firstname:
          firstName.trim(),
        lastname:
          lastName.trim(),
        birthdate:
          parsedBirthdate,
        height:
          parsedHeight,
        weight:
          parsedWeight,
      });

      console.log(
        'PERSONAL INFORMATION — sauvegardé'
      );

      setSaved(true);

      setTimeout(() => {
        router.back();
      }, 600);
    } catch (error) {
      console.log(
        'PERSONAL INFORMATION SAVE ERROR',
        {
          message: error?.message,
          code: error?.code,
          details: error?.details,
          hint: error?.hint,
        }
      );

      setErrorMessage(
        error?.message ??
          'Impossible d’enregistrer tes informations.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator
          size="large"
          color={colors.primary}
        />

        <Text style={styles.loadingText}>
          CHARGEMENT DE TES INFORMATIONS...
        </Text>
      </View>
    );
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
          locations={[
            0,
            0.26,
            0.68,
            1,
          ]}
          style={
            StyleSheet.absoluteFill
          }
        />

        <SafeAreaView
          style={styles.safeArea}
        >
          <KeyboardAvoidingView
            style={
              styles.keyboardView
            }
            behavior={
              Platform.OS === 'ios'
                ? 'padding'
                : undefined
            }
          >
            <ScrollView
              showsVerticalScrollIndicator={
                false
              }
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={
                styles.content
              }
            >
              {/* HEADER */}
              <View style={styles.header}>
                <Pressable
                  onPress={handleBack}
                  hitSlop={12}
                  style={({
                    pressed,
                  }) => [
                    styles.backButton,
                    pressed &&
                      styles.pressed,
                  ]}
                >
                  <Ionicons
                    name="arrow-back"
                    size={22}
                    color={
                      colors.textPrimary
                    }
                  />
                </Pressable>

                <View
                  style={
                    styles.headerText
                  }
                >
                  <Text
                    style={
                      styles.headerEyebrow
                    }
                  >
                    TON COMPTE
                  </Text>

                  <Text
                    style={
                      styles.headerTitle
                    }
                  >
                    TES INFOS
                    <Text
                      style={
                        styles.blueDot
                      }
                    >
                      .
                    </Text>
                  </Text>
                </View>

                <Image
                  source={brandIcon}
                  style={
                    styles.brandIcon
                  }
                  resizeMode="contain"
                />
              </View>

              {/* INTRO */}
              <View style={styles.intro}>
                <Text
                  style={
                    styles.introTitle
                  }
                >
                  INFORMATIONS PERSONNELLES
                </Text>

                <Text
                  style={
                    styles.introText
                  }
                >
                  Ces informations permettent
                  à UGEROD de personnaliser
                  ton profil et de mieux
                  suivre ton évolution.
                </Text>
              </View>

              {/* ERREUR */}
              {!!errorMessage && (
                <View
                  style={
                    styles.errorCard
                  }
                >
                  <Ionicons
                    name="alert-circle-outline"
                    size={20}
                    color="#FF6B6B"
                  />

                  <Text
                    style={
                      styles.errorText
                    }
                  >
                    {errorMessage}
                  </Text>
                </View>
              )}

              {/* IDENTITÉ */}
              <SectionTitle
                title="IDENTITÉ"
                subtitle="Les informations principales de ton compte."
              />

              <View
                style={
                  styles.formCard
                }
              >
                <Field
                  label="PRÉNOM"
                  value={firstName}
                  onChangeText={
                    setFirstName
                  }
                  placeholder="Ton prénom"
                  icon="person-outline"
                />

                <Field
                  label="NOM"
                  value={lastName}
                  onChangeText={
                    setLastName
                  }
                  placeholder="Ton nom"
                  icon="person-outline"
                />

                <View style={styles.field}>
                  <Text
                    style={styles.label}
                  >
                    EMAIL
                  </Text>

                  <View
                    style={[
                      styles.inputWrapper,
                      styles.inputWrapperDisabled,
                    ]}
                  >
                    <Ionicons
                      name="mail-outline"
                      size={19}
                      color={
                        colors.textMuted
                      }
                    />

                    <Text
                      style={[
                        styles.input,
                        styles.disabledInputText,
                      ]}
                    >
                      {email ||
                        'EMAIL NON DISPONIBLE'}
                    </Text>

                    <Ionicons
                      name="lock-closed-outline"
                      size={15}
                      color={
                        colors.textMuted
                      }
                    />
                  </View>

                  <Text
                    style={
                      styles.fieldHelp
                    }
                  >
                    L’adresse email est liée
                    à ton compte UGEROD.
                  </Text>
                </View>
              </View>

              {/* DONNÉES PHYSIQUES */}
              <SectionTitle
                title="DONNÉES PHYSIQUES"
                subtitle="Utilisées pour personnaliser ton suivi."
              />

              <View
                style={
                  styles.formCard
                }
              >
                <Field
                  label="DATE DE NAISSANCE"
                  value={birthdate}
                  onChangeText={(value) => {
                    setBirthdate(
                      formatBirthdateInput(value)
                    );
                  }}
                  placeholder="JJ/MM/AAAA"
                  icon="calendar-outline"
                  keyboardType="number-pad"
                />

                <Field
                  label="TAILLE"
                  value={height}
                  onChangeText={
                    setHeight
                  }
                  placeholder="Ex : 178"
                  icon="resize-outline"
                  keyboardType="number-pad"
                  unit="CM"
                />

                <Field
                  label="POIDS"
                  value={weight}
                  onChangeText={
                    setWeight
                  }
                  placeholder="Ex : 82"
                  icon="scale-outline"
                  keyboardType="decimal-pad"
                  unit="KG"
                  last
                />
              </View>

              {/* INFO */}
              <View
                style={styles.infoCard}
              >
                <Ionicons
                  name="analytics-outline"
                  size={21}
                  color={
                    colors.primaryLight
                  }
                />

                <Text
                  style={
                    styles.infoText
                  }
                >
                  Ces données pourront
                  aider UGEROD à enrichir
                  le suivi de ta progression
                  et l’adaptation de tes
                  séances.
                </Text>
              </View>

              {/* SÉCURITÉ */}
              <SectionTitle
                title="SÉCURITÉ"
                subtitle="Gère l’accès à ton compte."
              />

              <Pressable
                onPress={
                  handleChangePassword
                }
                style={({
                  pressed,
                }) => [
                  styles.securityCard,
                  pressed &&
                    styles.cardPressed,
                ]}
              >
                <View
                  style={
                    styles.securityIcon
                  }
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color={
                      colors.textPrimary
                    }
                  />
                </View>

                <View
                  style={
                    styles.securityMain
                  }
                >
                  <Text
                    style={
                      styles.securityTitle
                    }
                  >
                    MODIFIER MON MOT DE PASSE
                  </Text>

                  <Text
                    style={
                      styles.securitySubtitle
                    }
                  >
                    Accéder aux paramètres
                    de sécurité
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={
                    colors.textMuted
                  }
                />
              </Pressable>

              {/* CTA */}
              <Pressable
                onPress={handleSave}
                disabled={
                  isSaving || saved
                }
                style={({
                  pressed,
                }) => [
                  styles.saveButton,
                  saved &&
                    styles.saveButtonDone,
                  pressed &&
                    !saved &&
                    !isSaving &&
                    styles.saveButtonPressed,
                  isSaving &&
                    styles.saveButtonDisabled,
                ]}
              >
                {isSaving ? (
                  <>
                    <ActivityIndicator
                      size="small"
                      color={
                        colors.brandWhite
                      }
                    />

                    <Text
                      style={
                        styles.saveButtonText
                      }
                    >
                      ENREGISTREMENT...
                    </Text>
                  </>
                ) : (
                  <>
                    <Text
                      style={
                        styles.saveButtonText
                      }
                    >
                      {saved
                        ? 'INFORMATIONS ENREGISTRÉES'
                        : 'ENREGISTRER'}
                    </Text>

                    <Ionicons
                      name={
                        saved
                          ? 'checkmark-circle'
                          : 'checkmark-circle-outline'
                      }
                      size={21}
                      color={
                        colors.brandWhite
                      }
                    />
                  </>
                )}
              </Pressable>

              <View
                style={
                  styles.bottomSpace
                }
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function SectionTitle({
  title,
  subtitle,
}) {
  return (
    <View
      style={styles.sectionHeader}
    >
      <Text
        style={styles.sectionTitle}
      >
        {title}
      </Text>

      <Text
        style={
          styles.sectionSubtitle
        }
      >
        {subtitle}
      </Text>
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
}) {
  return (
    <View
      style={[
        styles.field,
        !last &&
          styles.fieldBorder,
      ]}
    >
      <Text style={styles.label}>
        {label}
      </Text>

      <View
        style={styles.inputWrapper}
      >
        <Ionicons
          name={icon}
          size={19}
          color={colors.textMuted}
        />

        <TextInput
          value={value}
          onChangeText={
            onChangeText
          }
          placeholder={
            placeholder
          }
          placeholderTextColor={
            colors.textMuted
          }
          keyboardType={
            keyboardType
          }
          autoCorrect={false}
          style={styles.input}
        />

        {unit ? (
          <Text
            style={
              styles.inputUnit
            }
          >
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor:
      colors.background,
  },

  loadingScreen: {
    flex: 1,
    backgroundColor:
      colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },

  loadingText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    color:
      colors.textSecondary,
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
    backgroundColor:
      'rgba(0,0,0,0.30)',
  },

  content: {
    paddingHorizontal:
      spacing.xl,
    paddingTop: 8,
  },

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
    backgroundColor:
      'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerText: {
    flex: 1,
  },

  headerEyebrow: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color:
      colors.textSecondary,
  },

  headerTitle: {
    ...typography.display,
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 1.7,
    color:
      colors.textPrimary,
  },

  blueDot: {
    color:
      colors.primary,
  },

  brandIcon: {
    width: 45,
    height: 45,
  },

  intro: {
    marginTop: 25,
  },

  introTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.4,
    color:
      colors.textPrimary,
  },

  introText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color:
      colors.textSecondary,
    marginTop: 6,
    maxWidth: 345,
  },

  errorCard: {
    minHeight: 58,
    marginTop: 16,
    borderRadius: 14,
    padding: 12,
    backgroundColor:
      'rgba(255,107,107,0.08)',
    borderWidth: 1,
    borderColor:
      'rgba(255,107,107,0.25)',
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
  },

  errorText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      colors.textSecondary,
  },

  sectionHeader: {
    marginTop: 27,
    marginBottom: 10,
  },

  sectionTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.7,
    color:
      colors.textPrimary,
  },

  sectionSubtitle: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      colors.textMuted,
    marginTop: 3,
  },

  formCard: {
    borderRadius: 17,
    paddingHorizontal: 15,
    backgroundColor:
      'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.09)',
    overflow: 'hidden',
  },

  field: {
    paddingVertical: 14,
  },

  fieldBorder: {
    borderBottomWidth: 1,
    borderBottomColor:
      'rgba(255,255,255,0.06)',
  },

  label: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.8,
    color:
      colors.textSecondary,
    marginBottom: 8,
  },

  inputWrapper: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor:
      'rgba(7,9,12,0.60)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  inputWrapperDisabled: {
    opacity: 0.7,
  },

  input: {
    flex: 1,
    fontFamily:
      'Oswald_500Medium',
    fontSize: 13,
    color:
      colors.textPrimary,
    paddingVertical: 0,
  },

  disabledInputText: {
    color:
      colors.textSecondary,
  },

  inputUnit: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.6,
    color:
      colors.textMuted,
  },

  fieldHelp: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 9,
    lineHeight: 14,
    color:
      colors.textMuted,
    marginTop: 7,
  },

  infoCard: {
    minHeight: 82,
    marginTop: 16,
    borderRadius: 15,
    padding: 14,
    backgroundColor:
      'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  infoText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      colors.textSecondary,
  },

  securityCard: {
    minHeight: 78,
    borderRadius: 16,
    paddingHorizontal: 14,
    backgroundColor:
      'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  securityIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor:
      'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  securityMain: {
    flex: 1,
  },

  securityTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 17,
    color:
      colors.textPrimary,
  },

  securitySubtitle: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color:
      colors.textMuted,
    marginTop: 2,
  },

  cardPressed: {
    backgroundColor:
      'rgba(25,30,36,0.96)',
  },

  saveButton: {
    minHeight: 56,
    marginTop: 26,
    borderRadius: 14,
    backgroundColor:
      colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  saveButtonDone: {
    backgroundColor:
      colors.primaryDark,
  },

  saveButtonPressed: {
    backgroundColor:
      colors.primaryDark,
    transform: [
      {
        scale: 0.985,
      },
    ],
  },

  saveButtonDisabled: {
    opacity: 0.65,
  },

  saveButtonText: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 1.1,
    color:
      colors.brandWhite,
  },

  bottomSpace: {
    height: 42,
  },

  pressed: {
    opacity: 0.65,
  },
});