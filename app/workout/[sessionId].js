import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Image,
  ImageBackground,
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

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

/*
 * TEMPORAIRE AVANT SUPABASE
 */
const SESSION = {
  date: 'MER 05 AOÛT',
  title: 'FULL BODY',
  duration: '45 MIN',
  format: 'AMRAP',
  form: 8,
  rpe: 7,

  completedExercises: [
    {
      id: 'air-squat',
      name: 'AIR SQUAT',
      prescription: '12 REPS',
      load: null,
    },
    {
      id: 'goblet-squat',
      name: 'GOBLET SQUAT',
      prescription: '8 REPS',
      load: '24 KG',
    },
    {
      id: 'dead-bug',
      name: 'DEAD BUG',
      prescription: '20 SEC',
      load: null,
    },
    {
      id: 'dumbbell-thruster',
      name: 'DUMBBELL THRUSTER',
      prescription: '10 REPS',
      load: '2 × 12 KG',
    },
    {
      id: 'dumbbell-row',
      name: 'DUMBBELL ROW',
      prescription: '12 REPS',
      load: '18 KG',
    },
  ],

  skippedExercises: [
    {
      id: 'burpee',
      name: 'BURPEE',
      prescription: '8 REPS',
    },
  ],
};

export default function WorkoutHistoryDetailScreen() {
  const params = useLocalSearchParams();

  const sessionId =
    typeof params.sessionId === 'string'
      ? params.sessionId
      : null;

  function handleBack() {
    router.back();
  }

  function handleExercisePress(exerciseId) {
    router.push(`/exercise/${exerciseId}`);
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

        {/* DÉGRADÉ VERTICAL */}
        <LinearGradient
          colors={[
            'rgba(7,9,12,0.46)',
            'rgba(7,9,12,0.62)',
            'rgba(7,9,12,0.88)',
            'rgba(7,9,12,0.99)',
          ]}
          locations={[0, 0.24, 0.60, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* DÉGRADÉ LATÉRAL */}
        <LinearGradient
          colors={[
            'rgba(7,9,12,0.46)',
            'rgba(7,9,12,0.05)',
            'rgba(7,9,12,0.28)',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
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
                  HISTORIQUE
                </Text>

                <Text style={styles.headerTitle}>
                  TA SÉANCE
                  <Text style={styles.blueDot}>.</Text>
                </Text>
              </View>

              <Image
                source={brandIcon}
                style={styles.brandIcon}
                resizeMode="contain"
              />
            </View>

            {/* HERO */}
            <View style={styles.heroCard}>
              <View style={styles.heroTop}>
                <View>
                  <Text style={styles.sessionDate}>
                    {SESSION.date}
                  </Text>

                  <Text style={styles.sessionTitle}>
                    {SESSION.title}
                  </Text>
                </View>

                <View style={styles.completedBadge}>
                  <Ionicons
                    name="checkmark"
                    size={15}
                    color={colors.brandWhite}
                  />

                  <Text style={styles.completedBadgeText}>
                    TERMINÉE
                  </Text>
                </View>
              </View>

              <View style={styles.heroStats}>
                <HeroStat
                  value={SESSION.duration}
                  label="DURÉE"
                />

                <View style={styles.heroDivider} />

                <HeroStat
                  value={SESSION.format}
                  label="FORMAT"
                />

                <View style={styles.heroDivider} />

                <HeroStat
                  value={`${SESSION.completedExercises.length}`}
                  label="EXOS FAITS"
                />
              </View>

              {sessionId && (
                <Text style={styles.sessionReference}>
                  SÉANCE #{sessionId}
                </Text>
              )}
            </View>

            {/* RESSENTI */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                TON RESSENTI
              </Text>

              <View style={styles.feedbackGrid}>
                <FeedbackCard
                  icon="pulse-outline"
                  label="FORME APRÈS"
                  value={`${SESSION.form}/10`}
                />

                <FeedbackCard
                  icon="speedometer-outline"
                  label="RPE"
                  value={`${SESSION.rpe}/10`}
                />
              </View>
            </View>

            {/* EXERCICES RÉALISÉS */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  EXERCICES RÉALISÉS
                </Text>

                <Text style={styles.sectionCount}>
                  {SESSION.completedExercises.length}
                </Text>
              </View>

              <View style={styles.exerciseList}>
                {SESSION.completedExercises.map(
                  (exercise, index) => (
                    <Pressable
                      key={exercise.id}
                      onPress={() =>
                        handleExercisePress(exercise.id)
                      }
                      style={({ pressed }) => [
                        styles.exerciseCard,
                        pressed &&
                          styles.exerciseCardPressed,
                      ]}
                    >
                      <View style={styles.completedIcon}>
                        <Ionicons
                          name="checkmark"
                          size={14}
                          color={colors.brandWhite}
                        />
                      </View>

                      <View style={styles.exerciseMain}>
                        <Text style={styles.exerciseName}>
                          {exercise.name}
                        </Text>

                        <Text style={styles.exercisePrescription}>
                          {exercise.prescription}
                        </Text>
                      </View>

                      {exercise.load && (
                        <View style={styles.loadBadge}>
                          <Ionicons
                            name="barbell-outline"
                            size={13}
                            color={colors.primaryLight}
                          />

                          <Text style={styles.loadText}>
                            {exercise.load}
                          </Text>
                        </View>
                      )}

                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  )
                )}
              </View>
            </View>

            {/* NON RÉALISÉS */}
            {SESSION.skippedExercises.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>
                    NON RÉALISÉS
                  </Text>

                  <Text style={styles.skippedCount}>
                    {SESSION.skippedExercises.length}
                  </Text>
                </View>

                <View style={styles.skippedList}>
                  {SESSION.skippedExercises.map(
                    (exercise) => (
                      <View
                        key={exercise.id}
                        style={styles.skippedCard}
                      >
                        <View style={styles.skippedIcon}>
                          <Ionicons
                            name="close"
                            size={14}
                            color={colors.brandWhite}
                          />
                        </View>

                        <View style={styles.exerciseMain}>
                          <Text style={styles.skippedName}>
                            {exercise.name}
                          </Text>

                          <Text
                            style={
                              styles.exercisePrescription
                            }
                          >
                            {exercise.prescription}
                          </Text>
                        </View>
                      </View>
                    )
                  )}
                </View>
              </View>
            )}

            {/* INFO */}
            <View style={styles.infoCard}>
              <Ionicons
                name="analytics-outline"
                size={22}
                color={colors.primaryLight}
              />

              <View style={styles.infoMain}>
                <Text style={styles.infoTitle}>
                  CETTE SÉANCE COMPTE DANS TON ÉVOLUTION.
                </Text>

                <Text style={styles.infoText}>
                  Tes exercices réalisés, tes charges et ton ressenti seront utilisés pour suivre ta progression.
                </Text>
              </View>
            </View>

            <View style={styles.bottomSpace} />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function HeroStat({
  value,
  label,
}) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatValue}>
        {value}
      </Text>

      <Text style={styles.heroStatLabel}>
        {label}
      </Text>
    </View>
  );
}

function FeedbackCard({
  icon,
  label,
  value,
}) {
  return (
    <View style={styles.feedbackCard}>
      <View style={styles.feedbackIcon}>
        <Ionicons
          name={icon}
          size={20}
          color={colors.primaryLight}
        />
      </View>

      <Text style={styles.feedbackValue}>
        {value}
      </Text>

      <Text style={styles.feedbackLabel}>
        {label}
      </Text>
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
    width: 46,
    height: 46,
  },

  /* HERO */

  heroCard: {
    marginTop: 9,
    borderRadius: 19,
    padding: 17,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },

  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },

  sessionDate: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    color: colors.primaryLight,
  },

  sessionTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 34,
    lineHeight: 37,
    letterSpacing: 1.5,
    color: colors.textPrimary,
    marginTop: 3,
  },

  completedBadge: {
    minHeight: 31,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(8,104,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.34)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  completedBadgeText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.6,
    color: colors.primaryLight,
  },

  heroStats: {
    marginTop: 19,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
  },

  heroStat: {
    flex: 1,
    alignItems: 'center',
  },

  heroStatValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    lineHeight: 25,
    letterSpacing: 0.8,
    color: colors.textPrimary,
  },

  heroStatLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 0.6,
    color: colors.textMuted,
    marginTop: 2,
  },

  heroDivider: {
    width: 1,
    height: 29,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  sessionReference: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 8,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 12,
  },

  /* SECTIONS */

  section: {
    marginTop: 28,
  },

  sectionHeader: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  sectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },

  sectionCount: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    color: colors.primaryLight,
  },

  skippedCount: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    color: colors.brandRed,
  },

  /* RESSENTI */

  feedbackGrid: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 10,
  },

  feedbackCard: {
    flex: 1,
    minHeight: 116,
    borderRadius: 16,
    padding: 14,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'space-between',
  },

  feedbackIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(8,104,255,0.11)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  feedbackValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 30,
    lineHeight: 32,
    color: colors.textPrimary,
  },

  feedbackLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },

  /* EXERCICES */

  exerciseList: {
    gap: 9,
  },

  exerciseCard: {
    minHeight: 70,
    borderRadius: 15,
    paddingHorizontal: 13,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  exerciseCardPressed: {
    backgroundColor: 'rgba(23,28,34,0.96)',
    transform: [{ scale: 0.99 }],
  },

  completedIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  exerciseMain: {
    flex: 1,
  },

  exerciseName: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.3,
    color: colors.textPrimary,
  },

  exercisePrescription: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
    marginTop: 2,
  },

  loadBadge: {
    minHeight: 29,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(8,104,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  loadText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 12,
    color: colors.primaryLight,
  },

  /* SKIPPED */

  skippedList: {
    gap: 9,
  },

  skippedCard: {
    minHeight: 66,
    borderRadius: 15,
    paddingHorizontal: 13,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,59,0.20)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  skippedIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.brandRed,
    alignItems: 'center',
    justifyContent: 'center',
  },

  skippedName: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  /* INFO */

  infoCard: {
    minHeight: 92,
    marginTop: 28,
    borderRadius: 16,
    padding: 15,
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.24)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },

  infoMain: {
    flex: 1,
  },

  infoTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.5,
    color: colors.textPrimary,
  },

  infoText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 4,
  },

  bottomSpace: {
    height: 42,
  },

  pressed: {
    opacity: 0.65,
  },
});