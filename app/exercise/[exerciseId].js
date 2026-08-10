import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

const brandIcon = require('../../assets/branding/ugerod-icon.png');

const EXERCISES = {
  'air-squat': {
    name: 'AIR SQUAT',
    region: 'BAS DU CORPS',
    equipment: 'POIDS DU CORPS',
    description:
      'Un mouvement fondamental pour développer le contrôle, la mobilité et la force des jambes.',
    tips: [
      'Garde les pieds bien ancrés au sol.',
      'Pousse les genoux dans l’axe des pieds.',
      'Garde le buste haut pendant toute la descente.',
      'Remonte jusqu’à l’extension complète.',
    ],
    mistakes: [
      'Genoux qui rentrent vers l’intérieur.',
      'Talons qui se décollent.',
      'Dos qui s’arrondit en bas du mouvement.',
    ],
    muscles: [
      'QUADRICEPS',
      'FESSIERS',
      'ISCHIO-JAMBIERS',
      'CORE',
    ],
  },

  'goblet-squat': {
    name: 'GOBLET SQUAT',
    region: 'BAS DU CORPS',
    equipment: 'KETTLEBELL / HALTÈRE',
    description:
      'Une variante chargée du squat où la charge est maintenue devant la poitrine.',
    tips: [
      'Garde la charge proche du sternum.',
      'Descends de façon contrôlée.',
      'Maintiens le tronc engagé.',
      'Pousse fort dans le sol pour remonter.',
    ],
    mistakes: [
      'Charge trop éloignée du corps.',
      'Dos qui s’arrondit.',
      'Genoux qui s’effondrent vers l’intérieur.',
    ],
    muscles: [
      'QUADRICEPS',
      'FESSIERS',
      'ADDUCTEURS',
      'CORE',
    ],
  },

  'push-up': {
    name: 'PUSH-UP',
    region: 'HAUT DU CORPS',
    equipment: 'POIDS DU CORPS',
    description:
      'Un exercice de poussée au poids du corps pour renforcer le haut du corps et le gainage.',
    tips: [
      'Garde le corps aligné.',
      'Serre les abdominaux et les fessiers.',
      'Descends la poitrine vers le sol.',
      'Pousse jusqu’à l’extension complète des bras.',
    ],
    mistakes: [
      'Bassin qui s’affaisse.',
      'Coudes trop ouverts.',
      'Amplitude trop courte.',
    ],
    muscles: [
      'PECTORAUX',
      'TRICEPS',
      'ÉPAULES',
      'CORE',
    ],
  },
};

export default function ExerciseDetailScreen() {
  const params = useLocalSearchParams();

  const exerciseId =
    typeof params.exerciseId === 'string'
      ? params.exerciseId
      : 'air-squat';

  const exercise = useMemo(() => {
    return EXERCISES[exerciseId] || EXERCISES['air-squat'];
  }, [exerciseId]);

  const [favorite, setFavorite] = useState(false);

  function handleBack() {
    router.back();
  }

  function toggleFavorite() {
    setFavorite((current) => !current);

    /*
     * Plus tard :
     * Supabase exercise_favorites
     */
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="arrow-back"
              size={22}
              color={colors.textPrimary}
            />
          </Pressable>

          <View style={styles.headerSpacer} />

          <Pressable
            onPress={toggleFavorite}
            style={({ pressed }) => [
              styles.headerButton,
              favorite && styles.favoriteButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={favorite ? 'heart' : 'heart-outline'}
              size={21}
              color={
                favorite
                  ? colors.primaryLight
                  : colors.textPrimary
              }
            />
          </Pressable>

          <Image
            source={brandIcon}
            style={styles.brandIcon}
            resizeMode="contain"
          />
        </View>

        {/* VISUEL */}
        <View style={styles.imageCard}>
          <View style={styles.imagePlaceholder}>
            <Ionicons
              name="fitness-outline"
              size={52}
              color={colors.textMuted}
            />

            <Text style={styles.imagePlaceholderTitle}>
              VISUEL EXERCICE
            </Text>

            <Text style={styles.imagePlaceholderSubtitle}>
              L’image Supabase sera affichée ici.
            </Text>
          </View>

          <View style={styles.imageGradient} />
        </View>

        {/* TITRE */}
        <View style={styles.titleArea}>
          <Text style={styles.eyebrow}>
            {exercise.region}
          </Text>

          <Text style={styles.title}>
            {exercise.name}
            <Text style={styles.blueDot}>.</Text>
          </Text>

          <View style={styles.equipmentBadge}>
            <Ionicons
              name="barbell-outline"
              size={15}
              color={colors.primaryLight}
            />

            <Text style={styles.equipmentText}>
              {exercise.equipment}
            </Text>
          </View>
        </View>

        {/* DESCRIPTION */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            LE MOUVEMENT
          </Text>

          <View style={styles.descriptionCard}>
            <Text style={styles.description}>
              {exercise.description}
            </Text>
          </View>
        </View>

        {/* CONSEILS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            POINTS TECHNIQUES
          </Text>

          <View style={styles.infoCard}>
            {exercise.tips.map((tip, index) => (
              <View
                key={`${tip}-${index}`}
                style={[
                  styles.infoRow,
                  index !== exercise.tips.length - 1 &&
                    styles.infoRowBorder,
                ]}
              >
                <View style={styles.tipIcon}>
                  <Ionicons
                    name="checkmark"
                    size={14}
                    color={colors.brandWhite}
                  />
                </View>

                <Text style={styles.infoText}>
                  {tip}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ERREURS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            À ÉVITER
          </Text>

          <View style={styles.mistakeCard}>
            {exercise.mistakes.map((mistake, index) => (
              <View
                key={`${mistake}-${index}`}
                style={[
                  styles.infoRow,
                  index !== exercise.mistakes.length - 1 &&
                    styles.infoRowBorder,
                ]}
              >
                <View style={styles.mistakeIcon}>
                  <Ionicons
                    name="close"
                    size={14}
                    color={colors.brandWhite}
                  />
                </View>

                <Text style={styles.infoText}>
                  {mistake}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* MUSCLES */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            MUSCLES CIBLÉS
          </Text>

          <View style={styles.musclesCard}>
            {exercise.muscles.map((muscle) => (
              <View
                key={muscle}
                style={styles.muscleChip}
              >
                <Text style={styles.muscleText}>
                  {muscle}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* FAVORI */}
        <Pressable
          onPress={toggleFavorite}
          style={({ pressed }) => [
            styles.favoriteCta,
            favorite && styles.favoriteCtaActive,
            pressed && styles.favoriteCtaPressed,
          ]}
        >
          <Ionicons
            name={favorite ? 'heart' : 'heart-outline'}
            size={20}
            color={
              favorite
                ? colors.primaryLight
                : colors.brandWhite
            }
          />

          <Text
            style={[
              styles.favoriteCtaText,
              favorite && styles.favoriteCtaTextActive,
            ]}
          >
            {favorite
              ? 'AJOUTÉ AUX FAVORIS'
              : 'AJOUTER AUX FAVORIS'}
          </Text>
        </Pressable>

        <View style={styles.bottomSpace} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },

  /* HEADER */

  header: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  favoriteButtonActive: {
    backgroundColor: 'rgba(8,104,255,0.10)',
    borderColor: 'rgba(8,104,255,0.30)',
  },

  headerSpacer: {
    flex: 1,
  },

  brandIcon: {
    width: 44,
    height: 44,
  },

  /* IMAGE */

  imageCard: {
    height: 250,
    marginTop: 8,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundSoft,
  },

  imagePlaceholderTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 23,
    lineHeight: 26,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    marginTop: 12,
  },

  imagePlaceholderSubtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
    marginTop: 3,
  },

  imageGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 60,
    backgroundColor: 'rgba(7,9,12,0.38)',
  },

  /* TITRE */

  titleArea: {
    marginTop: 20,
  },

  eyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color: colors.primaryLight,
  },

  title: {
    ...typography.display,
    fontSize: 42,
    lineHeight: 45,
    letterSpacing: 2,
    color: colors.textPrimary,
    marginTop: 4,
  },

  blueDot: {
    color: colors.primary,
  },

  equipmentBadge: {
    alignSelf: 'flex-start',
    minHeight: 32,
    marginTop: 10,
    paddingHorizontal: 11,
    borderRadius: 16,
    backgroundColor: 'rgba(8,104,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.24)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  equipmentText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.5,
    color: colors.primaryLight,
  },

  /* SECTIONS */

  section: {
    marginTop: 28,
  },

  sectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.7,
    color: colors.textPrimary,
    marginBottom: 10,
  },

  descriptionCard: {
    borderRadius: 17,
    padding: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  description: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.textSecondary,
  },

  /* INFOS */

  infoCard: {
    borderRadius: 17,
    paddingHorizontal: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },

  mistakeCard: {
    borderRadius: 17,
    paddingHorizontal: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,59,59,0.18)',
    overflow: 'hidden',
  },

  infoRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  infoRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },

  tipIcon: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  mistakeIcon: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: colors.brandRed,
    alignItems: 'center',
    justifyContent: 'center',
  },

  infoText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },

  /* MUSCLES */

  musclesCard: {
    borderRadius: 17,
    padding: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  muscleChip: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: colors.backgroundSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  muscleText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },

  /* FAVORI */

  favoriteCta: {
    minHeight: 56,
    marginTop: 30,
    borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  favoriteCtaActive: {
    backgroundColor: 'rgba(8,104,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.30)',
  },

  favoriteCtaPressed: {
    transform: [{ scale: 0.985 }],
  },

  favoriteCtaText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 18,
    lineHeight: 21,
    letterSpacing: 1,
    color: colors.brandWhite,
  },

  favoriteCtaTextActive: {
    color: colors.primaryLight,
  },

  bottomSpace: {
    height: 40,
  },

  pressed: {
    opacity: 0.65,
  },
});