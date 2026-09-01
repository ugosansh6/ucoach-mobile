import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMemo, useState } from 'react';

import { spacing, typography } from '../../src/constants';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';

const darkBrandIcon = require('../../assets/branding/ugerod-icon.png');
const lightBrandIcon = require('../../assets/branding/LOGO VERSION NOIR.png');

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
  const raw = Array.isArray(values) ? values.filter(Boolean) : [];

  if (raw.length === 0 || raw.includes('Aucune')) {
    return [];
  }

  return Array.from(
    new Set(
      raw
        .map((value) => LEGACY_ZONE_MAP[value] ?? value)
        .filter((value) => BODY_ZONES.includes(value))
    )
  );
}

export default function WorkoutInjuriesScreen() {
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;
  const { preparation, updatePreparation } = useWorkout();

  const initialPainZones = Array.isArray(preparation?.painZones)
    ? preparation.painZones
    : [];
  const [selectedZones, setSelectedZones] = useState(() =>
    normalizeSelectedZones(initialPainZones)
  );
  const [confirmedNoPain, setConfirmedNoPain] = useState(() =>
    initialPainZones.includes('Aucune')
  );

  const canValidate = confirmedNoPain || selectedZones.length > 0;

  function selectNoPain() {
    setConfirmedNoPain(true);
    setSelectedZones([]);
  }

  function toggleZone(zone) {
    setConfirmedNoPain(false);
    setSelectedZones((current) => {
      if (current.includes(zone)) {
        return current.filter((item) => item !== zone);
      }
      return [...current, zone];
    });
  }

  function handleValidate() {
    if (!canValidate) return;

    updatePreparation({
      painZones: confirmedNoPain ? ['Aucune'] : selectedZones,
    });
    router.back();
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-back" size={21} color={colors.text} />
          </Pressable>

          <View style={styles.headerText}>
            <Text style={styles.headerEyebrow}>SÉANCE DU JOUR</Text>
            <Text style={styles.headerTitle}>
              TES GÊNES<Text style={styles.dot}>.</Text>
            </Text>
          </View>

          <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
        </View>

        <View style={styles.introBlock}>
          <Text style={styles.introTitle}>UNE ZONE À PROTÉGER ?</Text>
          <Text style={styles.introText}>
            Indique seulement ce qui est vrai aujourd’hui. UGEROD utilisera ces zones comme garde-fous pour construire la séance.
          </Text>
        </View>

        <Pressable
          onPress={selectNoPain}
          style={({ pressed }) => [
            styles.noneCard,
            confirmedNoPain && styles.noneCardSelected,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.noneCardMain}>
            <View
              style={[
                styles.noneIcon,
                confirmedNoPain && styles.noneIconSelected,
              ]}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={21}
                color={confirmedNoPain ? colors.success : colors.textMuted}
              />
            </View>
            <View style={styles.flexOne}>
              <Text
                style={[
                  styles.noneCardText,
                  confirmedNoPain && styles.noneCardTextSelected,
                ]}
              >
                AUCUNE GÊNE
              </Text>
              <Text style={styles.noneCardCaption}>
                Je confirme n’avoir aucune zone à protéger aujourd’hui.
              </Text>
            </View>
          </View>

          <Ionicons
            name={confirmedNoPain ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
            color={confirmedNoPain ? colors.success : colors.textMuted}
          />
        </Pressable>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>OU SÉLECTIONNE LES ZONES</Text>
          <Text style={styles.sectionCaption}>Plusieurs zones peuvent être choisies.</Text>
        </View>

        <View style={styles.zoneGrid}>
          {BODY_ZONES.map((zone) => {
            const selected = selectedZones.includes(zone);

            return (
              <Pressable
                key={zone}
                onPress={() => toggleZone(zone)}
                style={({ pressed }) => [
                  styles.zoneCard,
                  selected && styles.zoneCardSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.zoneText,
                    selected && styles.zoneTextSelected,
                  ]}
                >
                  {zone.toUpperCase()}
                </Text>
                <Ionicons
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={selected ? colors.secondaryAccent : colors.textMuted}
                />
              </Pressable>
            );
          })}
        </View>

        {!canValidate ? (
          <View style={styles.requiredNotice}>
            <Ionicons name="shield-outline" size={17} color={colors.secondaryAccent} />
            <Text style={styles.requiredNoticeText}>
              Confirme « aucune gêne » ou sélectionne au moins une zone.
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleValidate}
          disabled={!canValidate}
          style={({ pressed }) => [
            styles.validateButton,
            !canValidate && styles.validateButtonDisabled,
            pressed && canValidate && styles.pressed,
          ]}
        >
          <Text style={styles.validateButtonText}>VALIDER</Text>
          <Ionicons name="checkmark" size={20} color={colors.textOnAccent} />
        </Pressable>

        <View style={styles.bottomSpace} />
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      paddingBottom: 28,
    },
    header: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
    },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: { flex: 1 },
    headerEyebrow: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 9,
      lineHeight: 12,
      letterSpacing: 1,
      color: colors.textSecondary,
    },
    headerTitle: {
      ...typography.display,
      fontSize: 29,
      lineHeight: 32,
      letterSpacing: 1.4,
      color: colors.text,
    },
    dot: { color: colors.accent },
    brandIcon: { width: 42, height: 42 },
    introBlock: {
      marginTop: 18,
      marginBottom: 14,
    },
    introTitle: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 28,
      lineHeight: 31,
      letterSpacing: 1.15,
      color: colors.text,
    },
    introText: {
      marginTop: 5,
      fontFamily: 'Oswald_400Regular',
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    noneCard: {
      width: '100%',
      minHeight: 76,
      borderRadius: 15,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    noneCardSelected: {
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
    },
    noneCardMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    noneIcon: {
      width: 38,
      height: 38,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
    },
    noneIconSelected: {
      backgroundColor: colors.surface,
    },
    flexOne: { flex: 1 },
    noneCardText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 11,
      lineHeight: 15,
      letterSpacing: 0.55,
      color: colors.text,
    },
    noneCardTextSelected: { color: colors.success },
    noneCardCaption: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 9,
      lineHeight: 13,
      color: colors.textSecondary,
    },
    sectionHeader: { marginTop: 20 },
    sectionTitle: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 10,
      letterSpacing: 0.75,
      color: colors.text,
    },
    sectionCaption: {
      marginTop: 2,
      fontFamily: 'Oswald_400Regular',
      fontSize: 9,
      color: colors.textMuted,
    },
    zoneGrid: {
      marginTop: 9,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    zoneCard: {
      width: '48%',
      flexGrow: 1,
      minHeight: 58,
      borderRadius: 12,
      paddingHorizontal: 11,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 7,
    },
    zoneCardSelected: {
      borderColor: colors.secondaryAccent,
      backgroundColor: colors.secondaryAccentSoft,
    },
    zoneText: {
      flex: 1,
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.25,
      color: colors.textSecondary,
    },
    zoneTextSelected: { color: colors.text },
    requiredNotice: {
      marginTop: 14,
      padding: 10,
      borderRadius: 11,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.secondaryAccentSoft,
      borderWidth: 1,
      borderColor: colors.secondaryAccent,
    },
    requiredNoticeText: {
      flex: 1,
      fontFamily: 'Oswald_400Regular',
      fontSize: 10,
      lineHeight: 14,
      color: colors.textSecondary,
    },
    validateButton: {
      minHeight: 56,
      marginTop: 20,
      borderRadius: 14,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    validateButtonDisabled: { opacity: 0.42 },
    validateButtonText: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 20,
      lineHeight: 23,
      letterSpacing: 1.05,
      color: colors.textOnAccent,
    },
    bottomSpace: { height: 18 },
    pressed: { opacity: 0.7 },
  });
}
