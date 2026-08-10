import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  RefreshControl,
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

import {
  getProgressionDashboard,
} from '../../src/services/progressionService';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

const PERIODS = [
  {
    id: '4w',
    label: '4 SEM.',
  },
  {
    id: '3m',
    label: '3 MOIS',
  },
  {
    id: '1y',
    label: '1 AN',
  },
];

const DIMENSION_ICONS = {
  strength: 'barbell-outline',
  conditioning: 'pulse-outline',
  power: 'flash-outline',
  stability: 'git-branch-outline',
  mobility: 'body-outline',
};

function formatDelta(value) {
  if (
    value == null ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  const percent = Math.round(
    value * 100
  );

  if (percent > 0) {
    return `+${percent}%`;
  }

  return `${percent}%`;
}

function getTrendIcon(value) {
  if (value > 0.015) {
    return 'trending-up';
  }

  if (value < -0.015) {
    return 'trending-down';
  }

  return 'remove-outline';
}

function getTrendLabel(value) {
  if (value > 0.015) {
    return 'EN HAUSSE';
  }

  if (value < -0.015) {
    return 'EN BAISSE';
  }

  return 'STABLE';
}

export default function ProgressionScreen() {
  const [period, setPeriod] =
    useState('4w');

  const [dashboard, setDashboard] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState('');

  const loadDashboard =
    useCallback(
      async ({
        refresh = false,
      } = {}) => {
        try {
          if (refresh) {
            setRefreshing(true);
          } else {
            setLoading(true);
          }

          setError('');

          const data =
            await getProgressionDashboard(
              period
            );

          setDashboard(data);
        } catch (loadError) {
          setError(
            loadError?.message ??
              'Impossible de charger ta progression.'
          );
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      },
      [period]
    );

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const maxLoad = useMemo(() => {
    const values =
      dashboard?.weeklyLoad?.map(
        (item) => item.load
      ) ?? [];

    return Math.max(
      1,
      ...values
    );
  }, [dashboard]);

  function handleProfile() {
    router.push('/profile');
  }

  function handlePlanning() {
    router.push(
      '/(tabs)/planning'
    );
  }

  function handleExercisePress(
    exercise
  ) {
    router.push(
      `/exercise/${exercise.id}`
    );
  }

  function handleSessionPress(
    session
  ) {
    router.push(
      `/workout/${session.id}`
    );
  }

  if (
    loading &&
    !dashboard
  ) {
    return (
      <SafeAreaView
        style={styles.loadingScreen}
      >
        <Image
          source={brandIcon}
          style={styles.loadingLogo}
          resizeMode="contain"
        />

        <ActivityIndicator
          size="small"
          color={colors.primaryLight}
        />

        <Text
          style={styles.loadingText}
        >
          ANALYSE DE TA PROGRESSION...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={backgroundImage}
        resizeMode="cover"
        style={styles.background}
      >
        <View
          style={styles.darkOverlay}
        />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.34)',
            'rgba(7,9,12,0.56)',
            'rgba(7,9,12,0.90)',
            'rgba(7,9,12,0.99)',
          ]}
          locations={[
            0,
            0.18,
            0.5,
            1,
          ]}
          style={
            StyleSheet.absoluteFill
          }
        />

        <SafeAreaView
          style={styles.safeArea}
        >
          <ScrollView
            contentContainerStyle={
              styles.content
            }
            showsVerticalScrollIndicator={
              false
            }
            refreshControl={
              <RefreshControl
                refreshing={
                  refreshing
                }
                onRefresh={() =>
                  loadDashboard({
                    refresh: true,
                  })
                }
                tintColor={
                  colors.primaryLight
                }
              />
            }
          >
            <View
              style={styles.header}
            >
              <Pressable
                onPress={
                  handleProfile
                }
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
                    styles.headerEyebrow
                  }
                >
                  TON ÉVOLUTION
                </Text>

                <Text
                  style={
                    styles.headerTitle
                  }
                >
                  PROGRESSION
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

            <View
              style={
                styles.periodRow
              }
            >
              {PERIODS.map(
                (item) => {
                  const selected =
                    item.id ===
                    period;

                  return (
                    <Pressable
                      key={
                        item.id
                      }
                      onPress={() =>
                        setPeriod(
                          item.id
                        )
                      }
                      style={[
                        styles.periodButton,
                        selected &&
                          styles.periodButtonSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.periodText,
                          selected &&
                            styles.periodTextSelected,
                        ]}
                      >
                        {
                          item.label
                        }
                      </Text>
                    </Pressable>
                  );
                }
              )}
            </View>

            {error ? (
              <View
                style={
                  styles.errorCard
                }
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={20}
                  color={
                    colors.brandRed
                  }
                />

                <View
                  style={{
                    flex: 1,
                  }}
                >
                  <Text
                    style={
                      styles.errorTitle
                    }
                  >
                    DONNÉES INDISPONIBLES
                  </Text>

                  <Text
                    style={
                      styles.errorText
                    }
                  >
                    {error}
                  </Text>
                </View>
              </View>
            ) : null}

            <View
              style={
                styles.summaryGrid
              }
            >
              <SummaryCard
                icon="checkmark-circle-outline"
                value={
                  dashboard?.summary
                    ?.completedSessions ??
                  0
                }
                label="SÉANCES"
              />

              <SummaryCard
                icon="time-outline"
                value={
                  dashboard?.summary
                    ?.totalTimeLabel ??
                  '0 min'
                }
                label="TEMPS"
              />

              <SummaryCard
                icon="calendar-outline"
                value={`${
                  dashboard?.summary
                    ?.regularityPercent ??
                  0
                }%`}
                label="RÉGULARITÉ"
              />

              <SummaryCard
                icon="speedometer-outline"
                value={
                  dashboard?.summary
                    ?.avgRpe != null
                    ? dashboard
                        .summary
                        .avgRpe
                    : '—'
                }
                suffix={
                  dashboard?.summary
                    ?.avgRpe != null
                    ? '/10'
                    : null
                }
                label="RPE MOYEN"
              />
            </View>

            <SectionHeader
              title="CHARGE D’ENTRAÎNEMENT"
              meta="PAR SEMAINE"
            />

            <View
              style={
                styles.chartCard
              }
            >
              {dashboard?.weeklyLoad
                ?.length > 0 ? (
                <>
                  <View
                    style={
                      styles.loadChart
                    }
                  >
                    {dashboard.weeklyLoad.map(
                      (item) => {
                        const height =
                          Math.max(
                            5,
                            Math.round(
                              (item.load /
                                maxLoad) *
                                100
                            )
                          );

                        return (
                          <View
                            key={
                              item.key
                            }
                            style={
                              styles.loadBarItem
                            }
                          >
                            <Text
                              style={
                                styles.loadValue
                              }
                            >
                              {
                                item.load
                              }
                            </Text>

                            <View
                              style={
                                styles.loadTrack
                              }
                            >
                              <View
                                style={[
                                  styles.loadFill,
                                  {
                                    height: `${height}%`,
                                  },
                                ]}
                              />
                            </View>

                            <Text
                              style={
                                styles.loadLabel
                              }
                            >
                              {
                                item.label
                              }
                            </Text>
                          </View>
                        );
                      }
                    )}
                  </View>

                  <Text
                    style={
                      styles.chartHint
                    }
                  >
                    Charge =
                    durée × RPE.
                    UGEROD compare
                    surtout son
                    évolution à ton
                    propre historique.
                  </Text>
                </>
              ) : (
                <EmptyState
                  text="Termine une séance pour commencer à suivre ta charge."
                />
              )}
            </View>

            <SectionHeader
              title="TON PROFIL ATHLÉTIQUE"
              meta="SCORE + CONFIANCE"
            />

            <View
              style={
                styles.profileCard
              }
            >
              {dashboard
                ?.athleticProfile
                ?.length > 0 ? (
                dashboard.athleticProfile.map(
                  (
                    item,
                    index
                  ) => (
                    <AthleticRow
                      key={
                        item.dimension
                      }
                      item={item}
                      last={
                        index ===
                        dashboard
                          .athleticProfile
                          .length -
                          1
                      }
                    />
                  )
                )
              ) : (
                <EmptyState
                  text="Le profil athlétique apparaîtra après les premières séances analysées."
                />
              )}
            </View>

            <SectionHeader
              title="TES MOUVEMENTS"
              meta="LES PLUS FIABLES"
            />

            <View
              style={
                styles.movementList
              }
            >
              {dashboard?.movements
                ?.length > 0 ? (
                dashboard.movements.map(
                  (movement) => (
                    <MovementCard
                      key={
                        movement.id
                      }
                      movement={
                        movement
                      }
                      onPress={() =>
                        handleExercisePress(
                          movement
                        )
                      }
                    />
                  )
                )
              ) : (
                <View
                  style={
                    styles.simpleCard
                  }
                >
                  <EmptyState
                    text="Aucun mouvement n’a encore assez de données."
                  />
                </View>
              )}
            </View>

            <SectionHeader
              title="CE QU’UGEROD OBSERVE"
              meta="COACH"
            />

            <View
              style={
                styles.coachCard
              }
            >
              {dashboard
                ?.coachObservations
                ?.map(
                  (
                    observation,
                    index
                  ) => (
                    <View
                      key={`${observation.title}-${index}`}
                      style={[
                        styles.observationRow,
                        index !==
                          dashboard
                            .coachObservations
                            .length -
                            1 &&
                          styles.observationBorder,
                      ]}
                    >
                      <View
                        style={
                          styles.observationIcon
                        }
                      >
                        <Ionicons
                          name={
                            observation.icon
                          }
                          size={18}
                          color={
                            colors.primaryLight
                          }
                        />
                      </View>

                      <View
                        style={{
                          flex: 1,
                        }}
                      >
                        <Text
                          style={
                            styles.observationTitle
                          }
                        >
                          {
                            observation.title
                          }
                        </Text>

                        <Text
                          style={
                            styles.observationText
                          }
                        >
                          {
                            observation.text
                          }
                        </Text>
                      </View>
                    </View>
                  )
                )}
            </View>

            <SectionHeader
              title="RÉGULARITÉ"
              meta={`OBJECTIF ${
                dashboard?.summary
                  ?.weeklyTarget ?? 0
              } / SEM.`}
            />

            <View
              style={
                styles.regularityCard
              }
            >
              <View
                style={
                  styles.regularityBars
                }
              >
                {dashboard?.regularity?.map(
                  (item) => (
                    <RegularityBar
                      key={
                        item.key
                      }
                      item={item}
                    />
                  )
                )}
              </View>
            </View>

            <View
              style={
                styles.historyHeader
              }
            >
              <View>
                <Text
                  style={
                    styles.sectionTitle
                  }
                >
                  HISTORIQUE
                </Text>

                <Text
                  style={
                    styles.historySubtitle
                  }
                >
                  Le calendrier
                  raconte ce que tu
                  fais.
                </Text>
              </View>

              <Pressable
                onPress={
                  handlePlanning
                }
                style={({
                  pressed,
                }) => [
                  styles.calendarButton,
                  pressed &&
                    styles.pressed,
                ]}
              >
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={
                    colors.primaryLight
                  }
                />

                <Text
                  style={
                    styles.calendarButtonText
                  }
                >
                  CALENDRIER
                </Text>
              </Pressable>
            </View>

            <View
              style={
                styles.sessionsList
              }
            >
              {dashboard
                ?.recentSessions
                ?.length > 0 ? (
                dashboard.recentSessions.map(
                  (session) => (
                    <Pressable
                      key={
                        session.id
                      }
                      onPress={() =>
                        handleSessionPress(
                          session
                        )
                      }
                      style={({
                        pressed,
                      }) => [
                        styles.sessionCard,
                        pressed &&
                          styles.sessionCardPressed,
                      ]}
                    >
                      <View
                        style={
                          styles.sessionCheck
                        }
                      >
                        <Ionicons
                          name="checkmark"
                          size={14}
                          color={
                            colors.brandWhite
                          }
                        />
                      </View>

                      <View
                        style={
                          styles.sessionMain
                        }
                      >
                        <Text
                          style={
                            styles.sessionDate
                          }
                        >
                          {
                            session.date
                          }
                        </Text>

                        <Text
                          style={
                            styles.sessionTitle
                          }
                        >
                          {
                            session.title
                          }
                        </Text>

                        <Text
                          style={
                            styles.sessionDuration
                          }
                        >
                          {
                            session.duration
                          }
                        </Text>
                      </View>

                      <View
                        style={
                          styles.sessionStats
                        }
                      >
                        <SessionStat
                          label="FORME"
                          value={
                            session.form ??
                            '—'
                          }
                        />

                        <SessionStat
                          label="RPE"
                          value={
                            session.rpe ??
                            '—'
                          }
                        />
                      </View>

                      <Ionicons
                        name="chevron-forward"
                        size={17}
                        color={
                          colors.textMuted
                        }
                      />
                    </Pressable>
                  )
                )
              ) : (
                <View
                  style={
                    styles.simpleCard
                  }
                >
                  <EmptyState
                    text="Aucune séance terminée sur cette période."
                  />
                </View>
              )}
            </View>

            <View
              style={
                styles.infoCard
              }
            >
              <Ionicons
                name="analytics-outline"
                size={22}
                color={
                  colors.primaryLight
                }
              />

              <View
                style={{
                  flex: 1,
                }}
              >
                <Text
                  style={
                    styles.infoTitle
                  }
                >
                  PAS DE SCORE MAGIQUE.
                </Text>

                <Text
                  style={
                    styles.infoText
                  }
                >
                  Chaque score
                  augmente en
                  fiabilité à mesure
                  qu’UGEROD observe
                  tes performances,
                  ton RPE et ta
                  régularité.
                </Text>
              </View>
            </View>

            <View
              style={
                styles.bottomSpace
              }
            />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function SectionHeader({
  title,
  meta,
}) {
  return (
    <View
      style={
        styles.sectionHeader
      }
    >
      <Text
        style={
          styles.sectionTitle
        }
      >
        {title}
      </Text>

      <Text
        style={
          styles.sectionMeta
        }
      >
        {meta}
      </Text>
    </View>
  );
}

function SummaryCard({
  icon,
  value,
  suffix,
  label,
}) {
  return (
    <View
      style={
        styles.summaryCard
      }
    >
      <Ionicons
        name={icon}
        size={18}
        color={
          colors.primaryLight
        }
      />

      <Text
        style={
          styles.summaryValue
        }
      >
        {value}

        {suffix ? (
          <Text
            style={
              styles.summarySuffix
            }
          >
            {suffix}
          </Text>
        ) : null}
      </Text>

      <Text
        style={
          styles.summaryLabel
        }
      >
        {label}
      </Text>
    </View>
  );
}

function AthleticRow({
  item,
  last,
}) {
  const score =
    item.score ?? null;

  const width =
    score == null
      ? 0
      : Math.max(
          2,
          Math.min(
            100,
            score
          )
        );

  return (
    <View
      style={[
        styles.athleticRow,
        !last &&
          styles.athleticBorder,
      ]}
    >
      <View
        style={
          styles.athleticTop
        }
      >
        <View
          style={
            styles.athleticIdentity
          }
        >
          <Ionicons
            name={
              DIMENSION_ICONS[
                item.dimension
              ] ??
              'analytics-outline'
            }
            size={17}
            color={
              colors.primaryLight
            }
          />

          <Text
            style={
              styles.athleticLabel
            }
          >
            {item.label}
          </Text>
        </View>

        <View
          style={
            styles.athleticScoreRow
          }
        >
          <Ionicons
            name={getTrendIcon(
              item.trend
            )}
            size={14}
            color={
              colors.primaryLight
            }
          />

          <Text
            style={
              styles.athleticScore
            }
          >
            {score ?? '—'}
          </Text>
        </View>
      </View>

      <View
        style={
          styles.scoreTrack
        }
      >
        <View
          style={[
            styles.scoreFill,
            {
              width: `${width}%`,
            },
          ]}
        />
      </View>

      <View
        style={
          styles.athleticBottom
        }
      >
        <Text
          style={
            styles.confidenceText
          }
        >
          CONFIANCE{' '}
          {Math.round(
            item.confidence
          )}
          %
        </Text>

        <Text
          style={
            styles.trendText
          }
        >
          {getTrendLabel(
            item.trend
          )}
        </Text>
      </View>
    </View>
  );
}

function MovementCard({
  movement,
  onPress,
}) {
  const delta =
    formatDelta(
      movement.performanceDelta
    );

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.movementCard,
        pressed &&
          styles.cardPressed,
      ]}
    >
      <View
        style={
          styles.movementIcon
        }
      >
        <Ionicons
          name="barbell-outline"
          size={18}
          color={
            colors.primaryLight
          }
        />
      </View>

      <View
        style={{
          flex: 1,
        }}
      >
        <Text
          style={
            styles.movementName
          }
        >
          {movement.name.toUpperCase()}
        </Text>

        <Text
          style={
            styles.movementState
          }
        >
          {movement.stateLabel}
        </Text>

        <View
          style={
            styles.movementMetaRow
          }
        >
          {movement.currentValue ? (
            <Text
              style={
                styles.movementValue
              }
            >
              {
                movement.currentValue
              }
            </Text>
          ) : null}

          <Text
            style={
              styles.movementConfidence
            }
          >
            CONFIANCE{' '}
            {
              movement.confidence
            }
            %
          </Text>
        </View>

        {movement.recommendationLabel ? (
          <Text
            style={
              styles.recommendationText
            }
          >
            {
              movement.recommendationLabel
            }
          </Text>
        ) : null}
      </View>

      {delta ? (
        <View
          style={
            styles.deltaBadge
          }
        >
          <Ionicons
            name={
              movement.performanceDelta >=
              0
                ? 'trending-up'
                : 'trending-down'
            }
            size={12}
            color={
              movement.performanceDelta >=
              0
                ? colors.primaryLight
                : colors.brandRed
            }
          />

          <Text
            style={[
              styles.deltaText,
              movement.performanceDelta <
                0 && {
                color:
                  colors.brandRed,
              },
            ]}
          >
            {delta}
          </Text>
        </View>
      ) : null}

      <Ionicons
        name="chevron-forward"
        size={17}
        color={
          colors.textMuted
        }
      />
    </Pressable>
  );
}

function RegularityBar({
  item,
}) {
  const target =
    Math.max(
      1,
      Number(item.target ?? 1)
    );

  const reached =
    item.value >= target;

  const height =
    Math.max(
      6,
      Math.round(
        Math.min(
          item.value / target,
          1
        ) * 100
      )
    );

  return (
    <View
      style={
        styles.regularityItem
      }
    >
      <Text
        style={[
          styles.regularityValue,
          reached && {
            color:
              colors.primaryLight,
          },
        ]}
      >
        {item.value}/{target}
      </Text>

      <View
        style={
          styles.regularityTrack
        }
      >
        <View
          style={[
            styles.regularityFill,
            {
              height: `${height}%`,
            },
          ]}
        />
      </View>

      <Text
        style={
          styles.regularityLabel
        }
      >
        {item.label}
      </Text>
    </View>
  );
}

function SessionStat({
  label,
  value,
}) {
  return (
    <View
      style={
        styles.sessionStat
      }
    >
      <Text
        style={
          styles.sessionStatLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.sessionStatValue
        }
      >
        {value}
      </Text>
    </View>
  );
}

function EmptyState({
  text,
}) {
  return (
    <View
      style={
        styles.emptyState
      }
    >
      <Ionicons
        name="analytics-outline"
        size={20}
        color={
          colors.textMuted
        }
      />

      <Text
        style={
          styles.emptyText
        }
      >
        {text}
      </Text>
    </View>
  );
}

const styles =
  StyleSheet.create({
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
        'rgba(0,0,0,0.28)',
    },

    content: {
      paddingHorizontal:
        spacing.xl,
      paddingTop: 8,
    },

    loadingScreen: {
      flex: 1,
      backgroundColor:
        colors.background,
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 14,
    },

    loadingLogo: {
      width: 55,
      height: 55,
    },

    loadingText: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 11,
      letterSpacing: 0.8,
      color:
        colors.textSecondary,
    },

    header: {
      minHeight: 74,
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
        'rgba(255,255,255,0.10)',
      alignItems: 'center',
      justifyContent:
        'center',
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
      color: colors.primary,
    },

    brandIcon: {
      width: 46,
      height: 46,
    },

    periodRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
    },

    periodButton: {
      flex: 1,
      minHeight: 38,
      borderRadius: 12,
      borderWidth: 1,
      borderColor:
        'rgba(255,255,255,0.08)',
      backgroundColor:
        'rgba(17,21,26,0.88)',
      alignItems: 'center',
      justifyContent:
        'center',
    },

    periodButtonSelected: {
      borderColor:
        colors.primary,
      backgroundColor:
        'rgba(8,104,255,0.12)',
    },

    periodText: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 9,
      letterSpacing: 0.5,
      color:
        colors.textMuted,
    },

    periodTextSelected: {
      color:
        colors.primaryLight,
    },

    errorCard: {
      marginTop: 14,
      borderRadius: 15,
      borderWidth: 1,
      borderColor:
        'rgba(255,59,59,0.22)',
      backgroundColor:
        'rgba(255,59,59,0.08)',
      padding: 14,
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
    },

    errorTitle: {
      fontFamily:
        'Oswald_700Bold',
      fontSize: 10,
      color:
        colors.brandRed,
    },

    errorText: {
      fontFamily:
        'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 17,
      color:
        colors.textSecondary,
      marginTop: 3,
    },

    summaryGrid: {
      marginTop: 16,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },

    summaryCard: {
      width: '48%',
      minHeight: 105,
      borderRadius: 17,
      padding: 14,
      backgroundColor:
        'rgba(17,21,26,0.92)',
      borderWidth: 1,
      borderColor:
        'rgba(255,255,255,0.08)',
      justifyContent:
        'space-between',
    },

    summaryValue: {
      fontFamily:
        'BebasNeue_400Regular',
      fontSize: 29,
      lineHeight: 31,
      color:
        colors.textPrimary,
    },

    summarySuffix: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 11,
      color:
        colors.textSecondary,
    },

    summaryLabel: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 9,
      letterSpacing: 0.5,
      color:
        colors.textSecondary,
    },

    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      marginTop: 29,
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

    sectionMeta: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 9,
      letterSpacing: 0.6,
      color:
        colors.textMuted,
    },

    chartCard: {
      borderRadius: 17,
      padding: 15,
      backgroundColor:
        'rgba(17,21,26,0.92)',
      borderWidth: 1,
      borderColor:
        'rgba(255,255,255,0.08)',
    },

    loadChart: {
      minHeight: 170,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent:
        'space-between',
      gap: 5,
    },

    loadBarItem: {
      flex: 1,
      alignItems: 'center',
      minWidth: 0,
    },

    loadValue: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 8,
      color:
        colors.textSecondary,
      marginBottom: 5,
    },

    loadTrack: {
      width: '68%',
      height: 110,
      borderRadius: 8,
      backgroundColor:
        'rgba(255,255,255,0.06)',
      overflow: 'hidden',
      justifyContent:
        'flex-end',
    },

    loadFill: {
      width: '100%',
      minHeight: 4,
      borderRadius: 8,
      backgroundColor:
        colors.primary,
    },

    loadLabel: {
      fontFamily:
        'Oswald_500Medium',
      fontSize: 7,
      color:
        colors.textMuted,
      marginTop: 7,
      textAlign: 'center',
    },

    chartHint: {
      fontFamily:
        'Oswald_400Regular',
      fontSize: 10,
      lineHeight: 16,
      color:
        colors.textMuted,
      textAlign: 'center',
      marginTop: 13,
    },

    profileCard: {
      borderRadius: 17,
      paddingHorizontal: 15,
      backgroundColor:
        'rgba(17,21,26,0.92)',
      borderWidth: 1,
      borderColor:
        'rgba(255,255,255,0.08)',
    },

    athleticRow: {
      paddingVertical: 15,
    },

    athleticBorder: {
      borderBottomWidth: 1,
      borderBottomColor:
        'rgba(255,255,255,0.06)',
    },

    athleticTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
    },

    athleticIdentity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },

    athleticLabel: {
      fontFamily:
        'Oswald_700Bold',
      fontSize: 11,
      letterSpacing: 0.4,
      color:
        colors.textPrimary,
    },

    athleticScoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },

    athleticScore: {
      fontFamily:
        'BebasNeue_400Regular',
      fontSize: 24,
      color:
        colors.textPrimary,
    },

    scoreTrack: {
      height: 7,
      borderRadius: 999,
      backgroundColor:
        'rgba(255,255,255,0.06)',
      overflow: 'hidden',
      marginTop: 10,
    },

    scoreFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor:
        colors.primary,
    },

    athleticBottom: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
      marginTop: 7,
    },

    confidenceText: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 8,
      letterSpacing: 0.4,
      color:
        colors.textMuted,
    },

    trendText: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 8,
      color:
        colors.primaryLight,
    },

    movementList: {
      gap: 9,
    },

    movementCard: {
      minHeight: 98,
      borderRadius: 16,
      padding: 13,
      backgroundColor:
        'rgba(17,21,26,0.92)',
      borderWidth: 1,
      borderColor:
        'rgba(255,255,255,0.08)',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },

    movementIcon: {
      width: 35,
      height: 35,
      borderRadius: 18,
      backgroundColor:
        'rgba(8,104,255,0.10)',
      alignItems: 'center',
      justifyContent:
        'center',
    },

    movementName: {
      fontFamily:
        'Oswald_700Bold',
      fontSize: 12,
      color:
        colors.textPrimary,
    },

    movementState: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 8,
      color:
        colors.textMuted,
      letterSpacing: 0.4,
      marginTop: 2,
    },

    movementMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      marginTop: 5,
    },

    movementValue: {
      fontFamily:
        'Oswald_700Bold',
      fontSize: 10,
      color:
        colors.textPrimary,
    },

    movementConfidence: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 8,
      color:
        colors.textMuted,
    },

    recommendationText: {
      fontFamily:
        'Oswald_700Bold',
      fontSize: 8,
      letterSpacing: 0.3,
      color:
        colors.primaryLight,
      marginTop: 5,
    },

    deltaBadge: {
      minHeight: 27,
      borderRadius: 14,
      paddingHorizontal: 8,
      backgroundColor:
        'rgba(8,104,255,0.10)',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },

    deltaText: {
      fontFamily:
        'Oswald_700Bold',
      fontSize: 9,
      color:
        colors.primaryLight,
    },

    coachCard: {
      borderRadius: 17,
      paddingHorizontal: 15,
      backgroundColor:
        'rgba(8,104,255,0.08)',
      borderWidth: 1,
      borderColor:
        'rgba(8,104,255,0.24)',
    },

    observationRow: {
      minHeight: 88,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingVertical: 13,
    },

    observationBorder: {
      borderBottomWidth: 1,
      borderBottomColor:
        'rgba(255,255,255,0.06)',
    },

    observationIcon: {
      width: 35,
      height: 35,
      borderRadius: 18,
      backgroundColor:
        'rgba(8,104,255,0.12)',
      alignItems: 'center',
      justifyContent:
        'center',
    },

    observationTitle: {
      fontFamily:
        'Oswald_700Bold',
      fontSize: 10,
      letterSpacing: 0.4,
      color:
        colors.textPrimary,
    },

    observationText: {
      fontFamily:
        'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 17,
      color:
        colors.textSecondary,
      marginTop: 3,
    },

    regularityCard: {
      borderRadius: 17,
      padding: 15,
      backgroundColor:
        'rgba(17,21,26,0.92)',
      borderWidth: 1,
      borderColor:
        'rgba(255,255,255,0.08)',
    },

    regularityBars: {
      minHeight: 145,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent:
        'space-between',
      gap: 5,
    },

    regularityItem: {
      flex: 1,
      alignItems: 'center',
      minWidth: 0,
    },

    regularityValue: {
      fontFamily:
        'Oswald_700Bold',
      fontSize: 8,
      color:
        colors.textSecondary,
      marginBottom: 5,
    },

    regularityTrack: {
      width: '64%',
      height: 90,
      borderRadius: 8,
      backgroundColor:
        'rgba(255,255,255,0.06)',
      overflow: 'hidden',
      justifyContent:
        'flex-end',
    },

    regularityFill: {
      width: '100%',
      borderRadius: 8,
      backgroundColor:
        colors.primary,
      minHeight: 4,
    },

    regularityLabel: {
      fontFamily:
        'Oswald_500Medium',
      fontSize: 7,
      color:
        colors.textMuted,
      marginTop: 7,
      textAlign: 'center',
    },

    historyHeader: {
      marginTop: 29,
      marginBottom: 10,
      flexDirection: 'row',
      justifyContent:
        'space-between',
      alignItems: 'center',
    },

    historySubtitle: {
      fontFamily:
        'Oswald_400Regular',
      fontSize: 10,
      color:
        colors.textMuted,
      marginTop: 2,
    },

    calendarButton: {
      minHeight: 38,
      borderRadius: 12,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor:
        'rgba(8,104,255,0.25)',
      backgroundColor:
        'rgba(8,104,255,0.10)',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },

    calendarButtonText: {
      fontFamily:
        'Oswald_700Bold',
      fontSize: 9,
      color:
        colors.primaryLight,
      letterSpacing: 0.4,
    },

    sessionsList: {
      gap: 9,
    },

    sessionCard: {
      minHeight: 88,
      borderRadius: 16,
      paddingHorizontal: 13,
      paddingVertical: 11,
      backgroundColor:
        'rgba(17,21,26,0.92)',
      borderWidth: 1,
      borderColor:
        'rgba(255,255,255,0.08)',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },

    sessionCardPressed: {
      backgroundColor:
        'rgba(23,28,34,0.96)',
      transform: [
        {
          scale: 0.99,
        },
      ],
    },

    sessionCheck: {
      width: 27,
      height: 27,
      borderRadius: 14,
      backgroundColor:
        colors.primary,
      alignItems: 'center',
      justifyContent:
        'center',
    },

    sessionMain: {
      flex: 1,
    },

    sessionDate: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 8,
      color:
        colors.primaryLight,
      letterSpacing: 0.5,
    },

    sessionTitle: {
      fontFamily:
        'BebasNeue_400Regular',
      fontSize: 19,
      color:
        colors.textPrimary,
      marginTop: 1,
    },

    sessionDuration: {
      fontFamily:
        'Oswald_500Medium',
      fontSize: 9,
      color:
        colors.textMuted,
      marginTop: 1,
    },

    sessionStats: {
      flexDirection: 'row',
      gap: 10,
    },

    sessionStat: {
      alignItems: 'center',
    },

    sessionStatLabel: {
      fontFamily:
        'Oswald_600SemiBold',
      fontSize: 7,
      color:
        colors.textMuted,
    },

    sessionStatValue: {
      fontFamily:
        'BebasNeue_400Regular',
      fontSize: 16,
      color:
        colors.textPrimary,
      marginTop: 2,
    },

    simpleCard: {
      borderRadius: 16,
      padding: 15,
      backgroundColor:
        'rgba(17,21,26,0.92)',
      borderWidth: 1,
      borderColor:
        'rgba(255,255,255,0.08)',
    },

    emptyState: {
      minHeight: 72,
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 7,
      paddingHorizontal: 12,
    },

    emptyText: {
      fontFamily:
        'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 17,
      color:
        colors.textMuted,
      textAlign: 'center',
    },

    infoCard: {
      minHeight: 86,
      marginTop: 28,
      borderRadius: 16,
      padding: 14,
      backgroundColor:
        'rgba(8,104,255,0.08)',
      borderWidth: 1,
      borderColor:
        'rgba(8,104,255,0.24)',
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 11,
    },

    infoTitle: {
      fontFamily:
        'Oswald_700Bold',
      fontSize: 10,
      color:
        colors.textPrimary,
      letterSpacing: 0.4,
    },

    infoText: {
      fontFamily:
        'Oswald_400Regular',
      fontSize: 11,
      lineHeight: 17,
      color:
        colors.textSecondary,
      marginTop: 4,
    },

    cardPressed: {
      backgroundColor:
        'rgba(23,28,34,0.96)',
      transform: [
        {
          scale: 0.99,
        },
      ],
    },

    pressed: {
      opacity: 0.65,
    },

    bottomSpace: {
      height: 38,
    },
  });