// preparation.js — aligné moteur bright-handler v2.4.2
import { router } from 'expo-router';
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

import {
  useWorkout,
} from '../../src/contexts/WorkoutContext';

const brandIcon = require('../../assets/branding/ugerod-icon.png');

const DURATIONS = [20, 30, 45, 60, 75, 90];

/*
 * Les libellés ci-dessous correspondent exactement
 * aux noms de public.equipment dans Supabase.
 *
 * Exception volontaire :
 * "Poids du corps" est un libellé UI plus naturel.
 * workoutService.js le convertit en "Aucun"
 * avant l'appel à bright-handler.
 */
const EQUIPMENT = [
  'Poids du corps',
  'Tapis',
  'Corde à sauter',
  'Haltères',
  'Kettlebell',
  'Élastiques',
  'TRX',
  'Barre de traction',
  'Banc',
  'Medball',
  'Box',
  'Step',
  'Foam roller',
];

const INJURIES = [
  'Aucune',
  'Poignet',
  'Coude',
  'Épaule',
  'Genou',
  'Bas du dos',
];

const REGIONS = [
  {
    id: null,
    label: 'UGEROD CHOISIT',
  },
  {
    id: 'Upper',
    label: 'HAUT DU CORPS',
  },
  {
    id: 'Lower',
    label: 'BAS DU CORPS',
  },
  {
    id: 'Full Body',
    label: 'CORPS ENTIER',
  },
  {
    id: 'Core',
    label: 'CENTRE DU CORPS',
  },
];

export default function PreparationScreen() {
  const {
    preparation,
    updatePreparation,
  } = useWorkout();

  /*
   * Valeurs par défaut de l'interface.
   *
   * Si l'utilisateur revient sur cet écran,
   * les valeurs déjà enregistrées dans le
   * WorkoutContext sont automatiquement reprises.
   */
  const duration =
    preparation.duration ?? 45;

  const equipment =
    preparation.equipment?.length > 0
      ? preparation.equipment
      : ['Poids du corps'];

  const readiness =
    preparation.readiness ?? 6;

  const injuries =
    preparation.painZones?.length > 0
      ? preparation.painZones
      : ['Aucune'];

  const region =
    preparation.region ?? null;

  function handleBack() {
    router.back();
  }

  function handleDuration(item) {
    updatePreparation({
      duration: item,
    });
  }

  function toggleEquipment(item) {
    let nextEquipment;

    if (equipment.includes(item)) {
      const filtered =
        equipment.filter(
          (value) => value !== item
        );

      nextEquipment =
        filtered.length === 0
          ? ['Poids du corps']
          : filtered;
    } else if (
      item !== 'Poids du corps'
    ) {
      nextEquipment = [
        ...equipment.filter(
          (value) =>
            value !== 'Poids du corps'
        ),
        item,
      ];
    } else {
      nextEquipment = [
        'Poids du corps',
      ];
    }

    updatePreparation({
      equipment: nextEquipment,
    });
  }

  function toggleInjury(item) {
    if (item === 'Aucune') {
      updatePreparation({
        painZones: ['Aucune'],
      });

      return;
    }

    const withoutNone =
      injuries.filter(
        (value) =>
          value !== 'Aucune'
      );

    let nextInjuries;

    if (
      withoutNone.includes(item)
    ) {
      const filtered =
        withoutNone.filter(
          (value) =>
            value !== item
        );

      nextInjuries =
        filtered.length === 0
          ? ['Aucune']
          : filtered;
    } else {
      nextInjuries = [
        ...withoutNone,
        item,
      ];
    }

    updatePreparation({
      painZones: nextInjuries,
    });
  }

  function handleReadiness(value) {
    updatePreparation({
      readiness: value,
    });
  }

  function handleRegion(value) {
    updatePreparation({
      region:
        region === value
          ? null
          : value,
    });
  }

  function getReadinessLabel() {
    // Aligné avec bright-handler :
    // 1-4 = low, 5-7 = normal, 8-10 = high.
    if (readiness <= 4) {
      return 'FAIBLE';
    }

    if (readiness <= 7) {
      return 'NORMALE';
    }

    return 'TRÈS EN FORME';
  }

  function handleGenerate() {
    /*
     * Important :
     *
     * Même si l'utilisateur n'a touché
     * à aucune valeur, on enregistre
     * les valeurs par défaut dans le
     * WorkoutContext avant de continuer.
     */
    updatePreparation({
      duration,
      equipment,
      readiness,
      painZones: injuries,
      region,
    });

    router.push(
      '/workout/generating'
    );
  }

  return (
    <SafeAreaView
      style={styles.screen}
    >
      <ScrollView
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={
          false
        }
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [
              styles.iconButton,
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
            style={styles.headerText}
          >
            <Text
              style={
                styles.headerEyebrow
              }
            >
              SÉANCE DU JOUR
            </Text>

            <Text
              style={
                styles.headerTitle
              }
            >
              PRÉPARATION
              <Text
                style={styles.blueDot}
              >
                .
              </Text>
            </Text>
          </View>

          <Image
            source={brandIcon}
            style={styles.brandIcon}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.intro}>
          Quelques infos avant de
          construire ta séance.
        </Text>

        {/* DURÉE */}
        <SectionTitle
          title="TEMPS DISPONIBLE"
          subtitle="Temps total réel, pauses et transitions comprises."
        />

        <View
          style={styles.durationRow}
        >
          {DURATIONS.map(
            (item) => {
              const selected =
                duration === item;

              return (
                <Pressable
                  key={item}
                  onPress={() =>
                    handleDuration(
                      item
                    )
                  }
                  style={[
                    styles.durationButton,
                    selected &&
                      styles.durationButtonSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.durationValue,
                      selected &&
                        styles.durationValueSelected,
                    ]}
                  >
                    {item}
                  </Text>

                  <Text
                    style={[
                      styles.durationUnit,
                      selected &&
                        styles.durationUnitSelected,
                    ]}
                  >
                    MIN
                  </Text>
                </Pressable>
              );
            }
          )}
        </View>

        {/* MATÉRIEL */}
        <SectionTitle
          title="MATÉRIEL DU JOUR"
          subtitle="Sélectionne ton matériel disponible. Sans matériel, garde Poids du corps."
        />

        <View style={styles.chipGrid}>
          {EQUIPMENT.map(
            (item) => {
              const selected =
                equipment.includes(
                  item
                );

              return (
                <Pressable
                  key={item}
                  onPress={() =>
                    toggleEquipment(
                      item
                    )
                  }
                  style={[
                    styles.chip,
                    selected &&
                      styles.chipSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selected &&
                        styles.chipTextSelected,
                    ]}
                  >
                    {item.toUpperCase()}
                  </Text>
                </Pressable>
              );
            }
          )}
        </View>

        {/* FORME DU JOUR */}
        <SectionTitle
          title="FORME DU JOUR"
          subtitle="Comment tu te sens maintenant ?"
        />

        <View
          style={
            styles.readinessCard
          }
        >
          <View
            style={
              styles.readinessHeader
            }
          >
            <View>
              <Text
                style={
                  styles.readinessValue
                }
              >
                {readiness}

                <Text
                  style={
                    styles.readinessTotal
                  }
                >
                  /10
                </Text>
              </Text>

              <Text
                style={
                  styles.readinessLabel
                }
              >
                {getReadinessLabel()}
              </Text>
            </View>

            <Ionicons
              name="pulse-outline"
              size={27}
              color={
                readiness >= 8
                  ? colors.primaryLight
                  : readiness <= 4
                    ? colors.brandRed
                    : colors.textPrimary
              }
            />
          </View>

          <View
            style={
              styles.readinessNumbers
            }
          >
            {Array.from(
              {
                length: 10,
              },
              (_, index) => {
                const value =
                  index + 1;

                const selected =
                  readiness ===
                  value;

                return (
                  <Pressable
                    key={value}
                    onPress={() =>
                      handleReadiness(
                        value
                      )
                    }
                    style={[
                      styles.readinessNumber,
                      selected &&
                        styles.readinessNumberSelected,
                      selected &&
                        readiness <=
                          4 &&
                        styles.readinessNumberLow,
                    ]}
                  >
                    <Text
                      style={[
                        styles.readinessNumberText,
                        selected &&
                          styles.readinessNumberTextSelected,
                      ]}
                    >
                      {value}
                    </Text>
                  </Pressable>
                );
              }
            )}
          </View>

          <View
            style={
              styles.readinessScale
            }
          >
            <Text
              style={styles.scaleLow}
            >
              FAIBLE
            </Text>

            <Text
              style={
                styles.scaleNormal
              }
            >
              NORMAL
            </Text>

            <Text
              style={
                styles.scaleHigh
              }
            >
              TRÈS EN FORME
            </Text>
          </View>
        </View>

        {/* GÊNE OU BLESSURE */}
        <SectionTitle
          title="GÊNE OU BLESSURE"
          subtitle="Indique ce qu’il faut éviter ou adapter aujourd’hui."
        />

        <View style={styles.chipGrid}>
          {INJURIES.map(
            (item) => {
              const selected =
                injuries.includes(
                  item
                );

              return (
                <Pressable
                  key={item}
                  onPress={() =>
                    toggleInjury(item)
                  }
                  style={[
                    styles.chip,
                    selected &&
                      styles.chipSelected,
                    selected &&
                      item !==
                        'Aucune' &&
                      styles.injurySelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selected &&
                        styles.chipTextSelected,
                      selected &&
                        item !==
                          'Aucune' &&
                        styles.injuryTextSelected,
                    ]}
                  >
                    {item.toUpperCase()}
                  </Text>
                </Pressable>
              );
            }
          )}
        </View>

        {/* ZONE OPTIONNELLE */}
        <SectionTitle
          title="ENVIE DU JOUR"
          subtitle="Optionnel. Par défaut, UGEROD choisit selon ton historique et ta séance du jour."
        />

        <View
          style={styles.regionGrid}
        >
          {REGIONS.map(
            (item) => {
              const selected =
                region === item.id;

              return (
                <Pressable
                  key={item.id ?? 'auto-region'}
                  onPress={() =>
                    handleRegion(
                      item.id
                    )
                  }
                  style={[
                    styles.regionButton,
                    selected &&
                      styles.regionButtonSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.regionText,
                      selected &&
                        styles.regionTextSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            }
          )}
        </View>

        {/* CTA */}
        <Pressable
          onPress={handleGenerate}
          style={({ pressed }) => [
            styles.generateButton,
            pressed &&
              styles.generateButtonPressed,
          ]}
        >
          <Text
            style={
              styles.generateButtonText
            }
          >
            GÉNÉRER MA SÉANCE
          </Text>

          <Ionicons
            name="flash-outline"
            size={20}
            color={
              colors.brandWhite
            }
          />
        </Pressable>

        <View
          style={styles.bottomSpace}
        />
      </ScrollView>
    </SafeAreaView>
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor:
      colors.background,
  },

  content: {
    paddingHorizontal:
      spacing.xl,
    paddingTop: spacing.sm,
  },

  /* HEADER */

  header: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
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
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.6,
    color:
      colors.textPrimary,
  },

  blueDot: {
    color: colors.primary,
  },

  brandIcon: {
    width: 45,
    height: 45,
  },

  intro: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 15,
    lineHeight: 21,
    color:
      colors.textSecondary,
    marginTop: 6,
    marginBottom: 6,
  },

  /* SECTIONS */

  sectionHeader: {
    marginTop: 26,
    marginBottom: 12,
  },

  sectionTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 15,
    lineHeight: 19,
    letterSpacing: 0.7,
    color:
      colors.textPrimary,
  },

  sectionSubtitle: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color:
      colors.textSecondary,
    marginTop: 3,
  },

  /* DURÉE */

  durationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  durationButton: {
    width: '31%',
    minHeight: 62,
    borderRadius: 14,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  durationButtonSelected: {
    backgroundColor:
      'rgba(8,104,255,0.12)',
    borderColor:
      colors.primary,
  },

  durationValue: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 23,
    lineHeight: 25,
    color:
      colors.textPrimary,
  },

  durationValueSelected: {
    color:
      colors.primaryLight,
  },

  durationUnit: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.6,
    color:
      colors.textMuted,
  },

  durationUnitSelected: {
    color:
      colors.primaryLight,
  },

  /* CHIPS */

  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },

  chip: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor:
      colors.border,
    backgroundColor:
      colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  chipSelected: {
    backgroundColor:
      'rgba(8,104,255,0.12)',
    borderColor:
      colors.primary,
  },

  chipText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.5,
    color:
      colors.textSecondary,
  },

  chipTextSelected: {
    color:
      colors.primaryLight,
  },

  injurySelected: {
    backgroundColor:
      'rgba(255,59,59,0.10)',
    borderColor:
      colors.brandRed,
  },

  injuryTextSelected: {
    color:
      colors.brandRed,
  },

  /* READINESS */

  readinessCard: {
    borderRadius: 17,
    padding: 16,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
  },

  readinessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
  },

  readinessValue: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 34,
    lineHeight: 36,
    color:
      colors.textPrimary,
  },

  readinessTotal: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 14,
    color:
      colors.textSecondary,
  },

  readinessLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.8,
    color:
      colors.primaryLight,
    marginTop: 2,
  },

  readinessNumbers: {
    flexDirection: 'row',
    justifyContent:
      'space-between',
    marginTop: 18,
    gap: 4,
  },

  readinessNumber: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor:
      colors.backgroundSoft,
  },

  readinessNumberSelected: {
    backgroundColor:
      colors.primary,
  },

  readinessNumberLow: {
    backgroundColor:
      colors.brandRed,
  },

  readinessNumberText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 12,
    color:
      colors.textSecondary,
  },

  readinessNumberTextSelected: {
    color:
      colors.brandWhite,
  },

  readinessScale: {
    flexDirection: 'row',
    justifyContent:
      'space-between',
    marginTop: 10,
  },

  scaleLow: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.4,
    color:
      colors.brandRed,
  },

  scaleNormal: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.4,
    color:
      colors.textMuted,
  },

  scaleHigh: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.4,
    color:
      colors.primaryLight,
  },

  /* RÉGION */

  regionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },

  regionButton: {
    width: '48%',
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 1,
    borderColor:
      colors.border,
    backgroundColor:
      colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },

  regionButtonSelected: {
    backgroundColor:
      'rgba(8,104,255,0.12)',
    borderColor:
      colors.primary,
  },

  regionText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.5,
    color:
      colors.textSecondary,
  },

  regionTextSelected: {
    color:
      colors.primaryLight,
  },

  /* CTA */

  generateButton: {
    minHeight: 58,
    marginTop: 32,
    borderRadius: 14,
    backgroundColor:
      colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  generateButtonPressed: {
    backgroundColor:
      colors.primaryDark,
    transform: [
      {
        scale: 0.985,
      },
    ],
  },

  generateButtonText: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 21,
    lineHeight: 24,
    letterSpacing: 1.2,
    color:
      colors.brandWhite,
  },

  bottomSpace: {
    height: 36,
  },

  pressed: {
    opacity: 0.65,
  },
});