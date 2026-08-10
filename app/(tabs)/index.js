import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
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

const dashboardBackground = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

const DAY_LABELS = [
  'DIM',
  'LUN',
  'MAR',
  'MER',
  'JEU',
  'VEN',
  'SAM',
];

/*
 * =========================================================
 * MODE TEST TEMPORAIRE
 * =========================================================
 *
 * 0 = utilisateur qui n'a encore réalisé aucune séance
 * 2 = utilisateur déjà actif
 *
 * Plus tard cette valeur viendra de Supabase.
 */
const MOCK_COMPLETED_SESSIONS = 0;

const MOCK_WEEKLY_TARGET = 4;

function createCurrentWeek(hasCompletedWorkout) {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  const currentDay = today.getDay();

  const distanceFromMonday =
    currentDay === 0 ? 6 : currentDay - 1;

  const monday = new Date(today);

  monday.setDate(
    today.getDate() - distanceFromMonday
  );

  /*
   * TEMPORAIRE AVANT SUPABASE
   *
   * Dashboard actif :
   * lundi + mercredi = séances réalisées.
   *
   * Première séance :
   * aucune séance réalisée.
   */
  const completedOffsets =
    hasCompletedWorkout ? [0, 2] : [];

  return Array.from(
    {
      length: 7,
    },
    (_, index) => {
      const date = new Date(monday);

      date.setDate(
        monday.getDate() + index
      );

      date.setHours(0, 0, 0, 0);

      const completed =
        completedOffsets.includes(index);

      const sessionId = completed
        ? 'session-1'
        : null;

      return {
        key: date.toISOString(),
        day: DAY_LABELS[date.getDay()],
        date: String(
          date.getDate()
        ).padStart(2, '0'),
        completed,
        sessionId,
        today:
          date.getTime() ===
          today.getTime(),
      };
    }
  );
}

function getCurrentMonthLabel() {
  return new Date()
    .toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    })
    .toUpperCase();
}

export default function DashboardScreen() {
  /*
   * =========================================================
   * TEMPORAIRE AVANT SUPABASE
   * =========================================================
   *
   * Plus tard :
   *
   * completedSessions
   * = séances terminées cette semaine
   *
   * totalCompletedSessions
   * = séances terminées depuis la création du compte
   */

  const completedSessions =
    MOCK_COMPLETED_SESSIONS;

  const totalCompletedSessions =
    MOCK_COMPLETED_SESSIONS;

  const weeklyTarget =
    MOCK_WEEKLY_TARGET;

  const hasCompletedWorkout =
    totalCompletedSessions > 0;

  const goalReached =
    completedSessions >= weeklyTarget;

  const week = createCurrentWeek(
    hasCompletedWorkout
  );

  const monthLabel =
    getCurrentMonthLabel();

  function handleProfile() {
    router.push('/profile');
  }

  function handlePrepareWorkout() {
    router.push(
      '/workout/preparation'
    );
  }

  function handlePlanning() {
    router.push(
      '/(tabs)/planning'
    );
  }

  function handleDayPress(item) {
    if (
      !item.completed ||
      !item.sessionId
    ) {
      return;
    }

    router.push(
      `/workout/${item.sessionId}`
    );
  }

  function handleLastWorkout() {
    router.push(
      '/workout/session-1'
    );
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={dashboardBackground}
        style={styles.background}
        resizeMode="cover"
      >
        {/* VOILE NOIR */}
        <View
          style={styles.darkOverlay}
        />

        {/* DÉGRADÉ VERTICAL */}
        <LinearGradient
          colors={[
            'rgba(7,9,12,0.32)',
            'rgba(7,9,12,0.20)',
            'rgba(7,9,12,0.70)',
            'rgba(7,9,12,0.98)',
          ]}
          locations={[
            0,
            0.3,
            0.62,
            1,
          ]}
          style={
            StyleSheet.absoluteFill
          }
        />

        {/* DÉGRADÉ LATÉRAL */}
        <LinearGradient
          colors={[
            'rgba(7,9,12,0.55)',
            'rgba(7,9,12,0.08)',
          ]}
          start={{
            x: 0,
            y: 0.5,
          }}
          end={{
            x: 1,
            y: 0.5,
          }}
          style={
            StyleSheet.absoluteFill
          }
        />

        <SafeAreaView
          style={styles.safeArea}
        >
          <View
            style={styles.content}
          >
            {/* HEADER */}
            <View
              style={styles.header}
            >
              <Pressable
                onPress={handleProfile}
                style={({
                  pressed,
                }) => [
                  styles.profileButton,
                  pressed &&
                    styles.pressed,
                ]}
              >
                <Ionicons
                  name="person-outline"
                  size={21}
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
                    styles.greeting
                  }
                >
                  BONJOUR
                </Text>

                <Text
                  style={styles.name}
                >
                  {hasCompletedWorkout
                    ? 'PRÊT À T’ENTRAÎNER ?'
                    : 'PRÊT À COMMENCER ?'}
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

            {!hasCompletedWorkout ? (
              /*
               * ===============================================
               * DASHBOARD 1
               * AVANT LA PREMIÈRE SÉANCE
               * ===============================================
               */
              <>
                {/* PREMIÈRE SÉANCE */}
                <View
                  style={
                    styles.firstWorkoutCard
                  }
                >
                  <View
                    style={
                      styles.firstWorkoutTop
                    }
                  >
                    <View
                      style={
                        styles.firstBadge
                      }
                    >
                      <Ionicons
                        name="flag-outline"
                        size={15}
                        color={
                          colors.brandWhite
                        }
                      />

                      <Text
                        style={
                          styles.firstBadgeText
                        }
                      >
                        PREMIÈRE SÉANCE
                      </Text>
                    </View>
                  </View>

                  <Text
                    style={
                      styles.firstWorkoutTitle
                    }
                  >
                    TON PREMIER
                    {'\n'}
                    WOD T’ATTEND
                    <Text
                      style={
                        styles.blueDot
                      }
                    >
                      .
                    </Text>
                  </Text>

                  <Text
                    style={
                      styles.firstWorkoutDescription
                    }
                  >
                    Indique ta forme, ton
                    temps disponible et ton
                    matériel. UGEROD
                    s’occupe du reste.
                  </Text>

                  <Pressable
                    onPress={
                      handlePrepareWorkout
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.primaryButton,
                      styles.firstWorkoutButton,
                      pressed &&
                        styles.primaryButtonPressed,
                    ]}
                  >
                    <Text
                      style={
                        styles.primaryButtonText
                      }
                    >
                      CRÉER MA PREMIÈRE
                      SÉANCE
                    </Text>

                    <Ionicons
                      name="arrow-forward"
                      size={19}
                      color={
                        colors.brandWhite
                      }
                    />
                  </Pressable>
                </View>

                {/* OBJECTIF PREMIÈRE SÉANCE */}
                <View
                  style={
                    styles.firstCalendarSection
                  }
                >
                  <View
                    style={
                      styles.calendarHeader
                    }
                  >
                    <View>
                      <Text
                        style={
                          styles.sectionTitle
                        }
                      >
                        TON OBJECTIF
                      </Text>

                      <Text
                        style={
                          styles.monthLabel
                        }
                      >
                        {monthLabel}
                      </Text>
                    </View>

                    <View
                      style={
                        styles.weekScore
                      }
                    >
                      <Text
                        style={[
                          styles.weekScoreValue,
                          {
                            color:
                              colors.brandRed,
                          },
                        ]}
                      >
                        0
                      </Text>

                      <Text
                        style={
                          styles.weekScoreDivider
                        }
                      >
                        /
                      </Text>

                      <Text
                        style={
                          styles.weekScoreTarget
                        }
                      >
                        {weeklyTarget}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={
                      styles.firstWeekCard
                    }
                  >
                    {week.map(
                      (item) => (
                        <View
                          key={
                            item.key
                          }
                          style={[
                            styles.dayItem,
                            item.today &&
                              styles.dayItemToday,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayName,
                              item.today &&
                                styles.dayNameToday,
                            ]}
                          >
                            {item.day}
                          </Text>

                          <View
                            style={[
                              styles.dateCircle,
                              item.today &&
                                styles.dateCircleToday,
                            ]}
                          >
                            <Text
                              style={[
                                styles.dateText,
                                item.today &&
                                  styles.dateTextToday,
                              ]}
                            >
                              {
                                item.date
                              }
                            </Text>
                          </View>

                          {item.today && (
                            <View
                              style={
                                styles.todayDot
                              }
                            />
                          )}
                        </View>
                      )
                    )}
                  </View>

                  <Text
                    style={
                      styles.weekHint
                    }
                  >
                    Aucun jour imposé.
                    Lance ta séance quand
                    tu es disponible.
                  </Text>
                </View>

                {/* COMMENT ÇA MARCHE */}
                <View
                  style={
                    styles.firstStepsSection
                  }
                >
                  <Text
                    style={
                      styles.sectionTitle
                    }
                  >
                    COMMENT ÇA MARCHE ?
                  </Text>

                  <View
                    style={
                      styles.firstStepsCard
                    }
                  >
                    <FirstStep
                      number="1"
                      icon="options-outline"
                      title="PRÉPARE"
                      description="Forme, temps et matériel."
                    />

                    <View
                      style={
                        styles.firstStepDivider
                      }
                    />

                    <FirstStep
                      number="2"
                      icon="sparkles-outline"
                      title="UGEROD GÉNÈRE"
                      description="Une séance adaptée."
                    />

                    <View
                      style={
                        styles.firstStepDivider
                      }
                    />

                    <FirstStep
                      number="3"
                      icon="checkmark-circle-outline"
                      title="VALIDE"
                      description="Enregistre ta séance."
                    />
                  </View>
                </View>

                {/* ÉVOLUTION VIDE */}
                <View
                  style={
                    styles.emptyHistoryCard
                  }
                >
                  <View
                    style={
                      styles.emptyHistoryIcon
                    }
                  >
                    <Ionicons
                      name="analytics-outline"
                      size={21}
                      color={
                        colors.primaryLight
                      }
                    />
                  </View>

                  <View
                    style={
                      styles.emptyHistoryMain
                    }
                  >
                    <Text
                      style={
                        styles.emptyHistoryTitle
                      }
                    >
                      TON ÉVOLUTION
                      COMMENCE ICI
                    </Text>

                    <Text
                      style={
                        styles.emptyHistoryText
                      }
                    >
                      Régularité,
                      historique et
                      performances
                      apparaîtront après
                      ta première séance.
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              /*
               * ===============================================
               * DASHBOARD 2
               * APRÈS LA PREMIÈRE SÉANCE
               * ===============================================
               */
              <>
                {/* SÉANCE DU JOUR */}
                <View
                  style={
                    styles.workoutCard
                  }
                >
                  <View
                    style={
                      styles.workoutTopLine
                    }
                  >
                    <View
                      style={
                        styles.redMarker
                      }
                    />

                    <Text
                      style={
                        styles.cardEyebrow
                      }
                    >
                      SÉANCE DU JOUR
                    </Text>
                  </View>

                  <Text
                    style={
                      styles.workoutTitle
                    }
                  >
                    PRÊT À DÉCOUVRIR
                    {'\n'}
                    TA SÉANCE
                    <Text
                      style={
                        styles.blueDot
                      }
                    >
                      .
                    </Text>
                  </Text>

                  <Text
                    style={
                      styles.workoutDescription
                    }
                  >
                    Adaptée à ta forme,
                    ton temps disponible
                    et ton matériel du
                    jour.
                  </Text>

                  <Pressable
                    onPress={
                      handlePrepareWorkout
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.primaryButton,
                      pressed &&
                        styles.primaryButtonPressed,
                    ]}
                  >
                    <Text
                      style={
                        styles.primaryButtonText
                      }
                    >
                      PRÉPARER MA SÉANCE
                    </Text>

                    <Ionicons
                      name="arrow-forward"
                      size={19}
                      color={
                        colors.brandWhite
                      }
                    />
                  </Pressable>
                </View>

                {/* SEMAINE */}
                <View
                  style={
                    styles.calendarSection
                  }
                >
                  <View
                    style={
                      styles.calendarHeader
                    }
                  >
                    <View>
                      <Text
                        style={
                          styles.sectionTitle
                        }
                      >
                        CETTE SEMAINE
                      </Text>

                      <Text
                        style={
                          styles.monthLabel
                        }
                      >
                        {monthLabel}
                      </Text>
                    </View>

                    <View
                      style={
                        styles.weekScore
                      }
                    >
                      <Text
                        style={[
                          styles.weekScoreValue,
                          {
                            color:
                              goalReached
                                ? colors.primaryLight
                                : colors.brandRed,
                          },
                        ]}
                      >
                        {
                          completedSessions
                        }
                      </Text>

                      <Text
                        style={
                          styles.weekScoreDivider
                        }
                      >
                        /
                      </Text>

                      <Text
                        style={
                          styles.weekScoreTarget
                        }
                      >
                        {weeklyTarget}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={
                      styles.weekCard
                    }
                  >
                    {week.map(
                      (item) => (
                        <Pressable
                          key={
                            item.key
                          }
                          onPress={() =>
                            handleDayPress(
                              item
                            )
                          }
                          style={[
                            styles.dayItem,
                            item.today &&
                              styles.dayItemToday,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayName,
                              item.today &&
                                styles.dayNameToday,
                            ]}
                          >
                            {item.day}
                          </Text>

                          <View
                            style={[
                              styles.dateCircle,
                              item.completed &&
                                styles.dateCircleCompleted,
                              item.today &&
                                !item.completed &&
                                styles.dateCircleToday,
                            ]}
                          >
                            {item.completed ? (
                              <Ionicons
                                name="checkmark"
                                size={17}
                                color={
                                  colors.brandWhite
                                }
                              />
                            ) : (
                              <Text
                                style={[
                                  styles.dateText,
                                  item.today &&
                                    styles.dateTextToday,
                                ]}
                              >
                                {
                                  item.date
                                }
                              </Text>
                            )}
                          </View>

                          {item.today && (
                            <View
                              style={
                                styles.todayDot
                              }
                            />
                          )}
                        </Pressable>
                      )
                    )}
                  </View>

                  <Pressable
                    onPress={
                      handlePlanning
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.planningShortcut,
                      pressed &&
                        styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={14}
                      color={
                        colors.textMuted
                      }
                    />

                    <Text
                      style={
                        styles.planningShortcutText
                      }
                    >
                      VOIR MON PLANNING
                    </Text>

                    <Ionicons
                      name="chevron-forward"
                      size={14}
                      color={
                        colors.textMuted
                      }
                    />
                  </Pressable>
                </View>

                {/* RÉGULARITÉ */}
                <View
                  style={
                    styles.regularitySection
                  }
                >
                  <Text
                    style={
                      styles.sectionTitle
                    }
                  >
                    TA RÉGULARITÉ
                  </Text>

                  <View
                    style={
                      styles.metricsGrid
                    }
                  >
                    <MetricCard
                      value={`${completedSessions}/${weeklyTarget}`}
                      label="SÉANCES CETTE SEMAINE"
                    />

                    <MetricCard
                      value="3"
                      label="SEMAINES AU BON RYTHME"
                    />
                  </View>
                </View>

                {/* DERNIÈRE SÉANCE */}
                <View
                  style={
                    styles.lastWorkoutSection
                  }
                >
                  <Text
                    style={
                      styles.sectionTitle
                    }
                  >
                    DERNIÈRE SÉANCE
                  </Text>

                  <Pressable
                    onPress={
                      handleLastWorkout
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.lastWorkoutCard,
                      pressed &&
                        styles.lastWorkoutCardPressed,
                    ]}
                  >
                    <View
                      style={
                        styles.lastWorkoutLeft
                      }
                    >
                      <View
                        style={
                          styles.completedIcon
                        }
                      >
                        <Ionicons
                          name="checkmark"
                          size={17}
                          color={
                            colors.brandWhite
                          }
                        />
                      </View>

                      <View>
                        <Text
                          style={
                            styles.lastWorkoutDate
                          }
                        >
                          MER 05 AOÛT
                        </Text>

                        <Text
                          style={
                            styles.lastWorkoutStatus
                          }
                        >
                          SÉANCE TERMINÉE
                        </Text>
                      </View>
                    </View>

                    <View
                      style={
                        styles.lastWorkoutLink
                      }
                    >
                      <Text
                        style={
                          styles.lastWorkoutLinkText
                        }
                      >
                        RÉCAP
                      </Text>

                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={
                          colors.primaryLight
                        }
                      />
                    </View>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function MetricCard({
  value,
  label,
}) {
  return (
    <View style={styles.metricCard}>
      <Text
        style={styles.metricValue}
      >
        {value}
      </Text>

      <Text
        style={styles.metricLabel}
      >
        {label}
      </Text>
    </View>
  );
}

function FirstStep({
  number,
  icon,
  title,
  description,
}) {
  return (
    <View style={styles.firstStep}>
      <View
        style={
          styles.firstStepNumber
        }
      >
        <Text
          style={
            styles.firstStepNumberText
          }
        >
          {number}
        </Text>
      </View>

      <View
        style={
          styles.firstStepIcon
        }
      >
        <Ionicons
          name={icon}
          size={18}
          color={
            colors.primaryLight
          }
        />
      </View>

      <View
        style={
          styles.firstStepMain
        }
      >
        <Text
          style={
            styles.firstStepTitle
          }
        >
          {title}
        </Text>

        <Text
          style={
            styles.firstStepDescription
          }
        >
          {description}
        </Text>
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

  background: {
    flex: 1,
  },

  safeArea: {
    flex: 1,
  },

  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor:
      'rgba(0,0,0,0.26)',
  },

  content: {
    flex: 1,
    paddingHorizontal:
      spacing.xl,
    paddingTop: 8,
    paddingBottom: 6,
  },

  /* ===================== */
  /* HEADER */
  /* ===================== */

  header: {
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor:
      'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor:
      colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerText: {
    flex: 1,
  },

  greeting: {
    fontFamily:
      'Oswald_500Medium',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1,
    color:
      colors.textSecondary,
  },

  name: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 23,
    lineHeight: 26,
    letterSpacing: 1.3,
    color:
      colors.textPrimary,
  },

  brandIcon: {
    width: 46,
    height: 46,
  },

  blueDot: {
    color: colors.primary,
  },

  /* ===================== */
  /* DASHBOARD PREMIÈRE SÉANCE */
  /* ===================== */

  firstWorkoutCard: {
    padding: 15,
    borderRadius: 17,
    backgroundColor:
      'rgba(17,21,26,0.94)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.28)',
  },

  firstWorkoutTop: {
    flexDirection: 'row',
  },

  firstBadge: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor:
      colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  firstBadgeText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.8,
    color:
      colors.brandWhite,
  },

  firstWorkoutTitle: {
    ...typography.display,
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 1.6,
    color:
      colors.textPrimary,
    marginTop: 9,
  },

  firstWorkoutDescription: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color:
      colors.textSecondary,
    marginTop: 6,
  },

  firstWorkoutButton: {
    marginTop: 12,
  },

  firstCalendarSection: {
    marginTop: 16,
  },

  firstWeekCard: {
    height: 70,
    borderRadius: 14,
    backgroundColor:
      'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    paddingHorizontal: 5,
    paddingVertical: 4,
    flexDirection: 'row',
  },

  weekHint: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color:
      colors.textMuted,
    marginTop: 6,
  },

  firstStepsSection: {
    marginTop: 15,
  },

  firstStepsCard: {
    marginTop: 7,
    borderRadius: 15,
    paddingHorizontal: 12,
    backgroundColor:
      'rgba(17,21,26,0.91)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
  },

  firstStep: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  firstStepDivider: {
    height: 1,
    marginLeft: 72,
    backgroundColor:
      'rgba(255,255,255,0.06)',
  },

  firstStepNumber: {
    width: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  firstStepNumberText: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 15,
    lineHeight: 17,
    color:
      colors.brandWhite,
  },

  firstStepIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor:
      'rgba(8,104,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  firstStepMain: {
    flex: 1,
  },

  firstStepTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.5,
    color:
      colors.textPrimary,
  },

  firstStepDescription: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 9,
    lineHeight: 13,
    color:
      colors.textMuted,
    marginTop: 1,
  },

  emptyHistoryCard: {
    minHeight: 64,
    marginTop: 11,
    marginBottom: 0,
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor:
      'rgba(8,104,255,0.07)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.20)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  emptyHistoryIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor:
      'rgba(8,104,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyHistoryMain: {
    flex: 1,
  },

  emptyHistoryTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.5,
    color:
      colors.textPrimary,
  },

  emptyHistoryText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 9,
    lineHeight: 13,
    color:
      colors.textSecondary,
    marginTop: 2,
  },

  /* ===================== */
  /* DASHBOARD ACTIF */
  /* ===================== */

  workoutCard: {
    padding: 16,
    borderRadius: 19,
    backgroundColor:
      'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
  },

  workoutTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  redMarker: {
    width: 4,
    height: 16,
    borderRadius: 2,
    backgroundColor:
      colors.brandRed,
  },

  cardEyebrow: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 1.2,
    color:
      colors.brandRed,
  },

  workoutTitle: {
    ...typography.display,
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 1.7,
    color:
      colors.textPrimary,
    marginTop: 8,
  },

  workoutDescription: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 18,
    color:
      colors.textSecondary,
    marginTop: 7,
  },

  /* ===================== */
  /* CTA COMMUN */
  /* ===================== */

  primaryButton: {
    height: 48,
    marginTop: 12,
    borderRadius: 12,
    backgroundColor:
      colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  primaryButtonPressed: {
    backgroundColor:
      colors.primaryDark,
    transform: [
      {
        scale: 0.985,
      },
    ],
  },

  primaryButtonText: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 18,
    letterSpacing: 1.1,
    color:
      colors.brandWhite,
  },

  /* ===================== */
  /* TITRES */
  /* ===================== */

  sectionTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.7,
    color:
      colors.textPrimary,
  },

  /* ===================== */
  /* CALENDRIER DASHBOARD ACTIF */
  /* ===================== */

  calendarSection: {
    marginTop: 22,
  },

  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent:
      'space-between',
    marginBottom: 7,
  },

  monthLabel: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 22,
    letterSpacing: 1.2,
    color:
      colors.textSecondary,
  },

  weekScore: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },

  weekScoreValue: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 27,
  },

  weekScoreDivider: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 14,
    color:
      colors.textMuted,
    marginHorizontal: 3,
  },

  weekScoreTarget: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 21,
    color:
      colors.textSecondary,
  },

  weekCard: {
    height: 78,
    borderRadius: 15,
    backgroundColor:
      'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    paddingHorizontal: 5,
    paddingVertical: 6,
    flexDirection: 'row',
  },

  dayItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 9,
  },

  dayItemToday: {
    backgroundColor:
      'rgba(255,59,59,0.06)',
  },

  dayName: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.3,
    color:
      colors.textMuted,
  },

  dayNameToday: {
    color:
      colors.brandRed,
  },

  dateCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  dateCircleCompleted: {
    backgroundColor:
      colors.primary,
  },

  dateCircleToday: {
    borderWidth: 1.5,
    borderColor:
      colors.brandRed,
  },

  dateText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 12,
    color:
      colors.textSecondary,
  },

  dateTextToday: {
    color:
      colors.brandWhite,
  },

  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor:
      colors.brandRed,
  },

  planningShortcut: {
    minHeight: 28,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'flex-end',
    gap: 4,
  },

  planningShortcutText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 8,
    letterSpacing: 0.6,
    color:
      colors.textMuted,
  },

  /* ===================== */
  /* RÉGULARITÉ */
  /* ===================== */

  regularitySection: {
    marginTop: 22,
  },

  metricsGrid: {
    marginTop: 7,
    flexDirection: 'row',
    gap: 10,
  },

  metricCard: {
    flex: 1,
    height: 72,
    borderRadius: 15,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor:
      'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    justifyContent:
      'space-between',
  },

  metricValue: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 27,
    lineHeight: 29,
    letterSpacing: 1,
    color:
      colors.textPrimary,
  },

  metricLabel: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.4,
    color:
      colors.textSecondary,
  },

  /* ===================== */
  /* DERNIÈRE SÉANCE */
  /* ===================== */

  lastWorkoutSection: {
    marginTop: 22,
  },

  lastWorkoutCard: {
    height: 64,
    marginTop: 9,
    borderRadius: 15,
    paddingHorizontal: 14,
    backgroundColor:
      'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
  },

  lastWorkoutCardPressed: {
    backgroundColor:
      'rgba(23,28,34,0.94)',
    transform: [
      {
        scale: 0.99,
      },
    ],
  },

  lastWorkoutLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  completedIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  lastWorkoutDate: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.5,
    color:
      colors.textPrimary,
  },

  lastWorkoutStatus: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.7,
    color:
      colors.primaryLight,
    marginTop: 2,
  },

  lastWorkoutLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },

  lastWorkoutLinkText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color:
      colors.primaryLight,
  },

  pressed: {
    opacity: 0.65,
  },
});