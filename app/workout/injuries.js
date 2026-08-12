import { useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';
import {
  useWorkout,
} from '../../src/contexts/WorkoutContext';

const brandIcon = require('../../assets/branding/ugerod-icon.png');

const BODY_ZONES = [
  'Épaule',
  'Pectoraux',
  'Bras / coude',
  'Avant-bras / poignet / main',
  'Haut du dos / nuque',
  'Sangle abdominale',
  'Bas du dos',
  'Hanche / fessiers / aine',
  'Cuisse avant / quadriceps',
  'Cuisse arrière / ischios',
  'Genou',
  'Mollet / tibia',
  'Cheville / pied',
];

const LEGACY_ZONE_MAP = {
  Poignet: 'Avant-bras / poignet / main',
  Coude: 'Bras / coude',
  Épaule: 'Épaule',
  Genou: 'Genou',
  'Bas du dos': 'Bas du dos',
};

function normalizeSelectedZones(values) {
  const raw = Array.isArray(values)
    ? values.filter(Boolean)
    : [];

  if (
    raw.length === 0 ||
    raw.includes('Aucune')
  ) {
    return [];
  }

  return Array.from(
    new Set(
      raw
        .map(
          (value) =>
            LEGACY_ZONE_MAP[value] ?? value
        )
        .filter((value) =>
          BODY_ZONES.includes(value)
        )
    )
  );
}

export default function WorkoutInjuriesScreen() {
  const {
    preparation,
    updatePreparation,
  } = useWorkout();

  const [selectedZones, setSelectedZones] =
    useState(() =>
      normalizeSelectedZones(
        preparation.painZones
      )
    );

  const noPain =
    selectedZones.length === 0;

  function handleBack() {
    router.back();
  }

  function selectNoPain() {
    setSelectedZones([]);
  }

  function toggleZone(zone) {
    setSelectedZones((current) => {
      if (current.includes(zone)) {
        return current.filter(
          (item) => item !== zone
        );
      }

      return [...current, zone];
    });
  }

  function handleValidate() {
    updatePreparation({
      painZones:
        selectedZones.length > 0
          ? selectedZones
          : ['Aucune'],
    });

    router.back();
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [
              styles.iconButton,
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
              SÉANCE DU JOUR
            </Text>

            <Text style={styles.headerTitle}>
              TES GÊNES
              <Text style={styles.blueDot}>
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

        <View style={styles.introBlock}>
          <Text style={styles.introTitle}>
            UNE ZONE À PROTÉGER ?
          </Text>

          <Text style={styles.introText}>
            Sélectionne les zones à éviter ou à adapter aujourd’hui.
          </Text>
        </View>

        <Pressable
          onPress={selectNoPain}
          style={({ pressed }) => [
            styles.noneCard,
            noPain && styles.noneCardSelected,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.noneCardMain}>
            <Ionicons
              name="shield-checkmark-outline"
              size={21}
              color={
                noPain
                  ? colors.primaryLight
                  : colors.textMuted
              }
            />

            <Text
              style={[
                styles.noneCardText,
                noPain &&
                  styles.noneCardTextSelected,
              ]}
            >
              AUCUNE GÊNE
            </Text>
          </View>

          {noPain && (
            <Ionicons
              name="checkmark-circle"
              size={19}
              color={colors.primaryLight}
            />
          )}
        </Pressable>

        <View style={styles.zoneGrid}>
          {BODY_ZONES.map((zone) => {
            const selected =
              selectedZones.includes(zone);

            return (
              <Pressable
                key={zone}
                onPress={() =>
                  toggleZone(zone)
                }
                style={({ pressed }) => [
                  styles.zoneCard,
                  selected &&
                    styles.zoneCardSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.zoneText,
                    selected &&
                      styles.zoneTextSelected,
                  ]}
                >
                  {zone.toUpperCase()}
                </Text>

                {selected && (
                  <Ionicons
                    name="checkmark-circle"
                    size={17}
                    color={colors.brandRed}
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handleValidate}
          style={({ pressed }) => [
            styles.validateButton,
            pressed &&
              styles.validateButtonPressed,
          ]}
        >
          <Text style={styles.validateButtonText}>
            VALIDER MES GÊNES
          </Text>

          <Ionicons
            name="checkmark-circle-outline"
            size={20}
            color={colors.brandWhite}
          />
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
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
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.6,
    color: colors.textPrimary,
  },

  blueDot: {
    color: colors.primary,
  },

  brandIcon: {
    width: 45,
    height: 45,
  },

  introBlock: {
    marginTop: 24,
    marginBottom: 18,
  },

  introTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 28,
    lineHeight: 31,
    letterSpacing: 1.2,
    color: colors.textPrimary,
  },

  introText: {
    marginTop: 5,
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },

  noneCard: {
    width: '100%',
    minHeight: 58,
    borderRadius: 14,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  noneCardSelected: {
    borderColor: colors.primary,
    backgroundColor:
      'rgba(8,104,255,0.10)',
  },

  noneCardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  noneCardText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: 0.55,
    color: colors.textSecondary,
  },

  noneCardTextSelected: {
    color: colors.primaryLight,
  },

  zoneGrid: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },

  zoneCard: {
    width: '48%',
    flexGrow: 1,
    minHeight: 60,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },

  zoneCardSelected: {
    borderColor: colors.brandRed,
    backgroundColor:
      'rgba(255,59,59,0.08)',
  },

  zoneText: {
    flex: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.35,
    color: colors.textSecondary,
  },

  zoneTextSelected: {
    color: colors.textPrimary,
  },

  validateButton: {
    minHeight: 58,
    marginTop: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  validateButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [
      {
        scale: 0.985,
      },
    ],
  },

  validateButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 1.1,
    color: colors.brandWhite,
  },

  bottomSpace: {
    height: 36,
  },

  pressed: {
    opacity: 0.68,
  },
});