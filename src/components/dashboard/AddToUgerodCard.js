import { router } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../constants';

const trainingImage = require('../../../assets/backgrounds/welcome-default.jpg');

export default function AddToUgerodCard() {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Créer ma séance"
        onPress={() => router.push('/workout/builder')}
        style={({ pressed }) => [
          styles.card,
          pressed && styles.cardPressed,
        ]}
      >
        <Image
          source={trainingImage}
          style={styles.image}
          resizeMode="cover"
        />

        <View style={styles.content}>
          <View style={styles.titleRow}>
            <View style={styles.blueAccent} />
            <Text style={styles.title}>CRÉER MA SÉANCE</Text>
          </View>

          <Text style={styles.description}>
            Compose toi-même tes blocs et tes exercices.
          </Text>
        </View>

        <Ionicons
          name="chevron-forward"
          size={19}
          color={colors.textMuted}
        />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: addOpen }}
        onPress={() => setAddOpen((current) => !current)}
        style={({ pressed }) => [
          styles.card,
          addOpen && styles.cardOpen,
          pressed && styles.cardPressed,
        ]}
      >
        <Image
          source={trainingImage}
          style={styles.image}
          resizeMode="cover"
        />

        <View style={styles.content}>
          <View style={styles.titleRow}>
            <View style={styles.redAccent} />
            <Text style={styles.title}>TU VIENS DE T’ENTRAÎNER ?</Text>
          </View>

          <Text style={styles.description}>
            Ajoute une séance réalisée ailleurs.
          </Text>
        </View>

        <Ionicons
          name={addOpen ? 'chevron-up' : 'chevron-down'}
          size={19}
          color={colors.textMuted}
        />
      </Pressable>

      {addOpen && (
        <View style={styles.actions}>
          <Pressable
            onPress={() => router.push('/workout/external')}
            style={({ pressed }) => [
              styles.actionRow,
              pressed && styles.actionRowPressed,
            ]}
          >
            <View style={styles.actionIcon}>
              <Ionicons
                name="barbell-outline"
                size={19}
                color={colors.primaryLight}
              />
            </View>

            <View style={styles.actionMain}>
              <Text style={styles.actionTitle}>SÉANCE RÉALISÉE</Text>
              <Text style={styles.actionDescription}>
                Box, salle ou entraînement perso.
              </Text>
            </View>

            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textMuted}
            />
          </Pressable>

          <View style={styles.actionDivider} />

          <Pressable
            onPress={() => router.push('/progression/records?add=1')}
            style={({ pressed }) => [
              styles.actionRow,
              pressed && styles.actionRowPressed,
            ]}
          >
            <View style={[styles.actionIcon, styles.recordIcon]}>
              <Ionicons
                name="trophy-outline"
                size={19}
                color={colors.brandRed}
              />
            </View>

            <View style={styles.actionMain}>
              <Text style={styles.actionTitle}>RECORD / PR</Text>
              <Text style={styles.actionDescription}>
                Charge, reps, chrono ou benchmark.
              </Text>
            </View>

            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textMuted}
            />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 28,
    gap: 8,
  },
  card: {
    minHeight: 92,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: 'rgba(17,21,26,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    paddingRight: 14,
  },
  cardOpen: {
    borderColor: 'rgba(8,104,255,0.24)',
  },
  cardPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.992 }],
  },
  image: {
    alignSelf: 'stretch',
    width: 112,
    minHeight: 92,
  },
  content: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  blueAccent: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.primaryLight,
  },
  redAccent: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.brandRed,
  },
  title: {
    flex: 1,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.65,
    color: colors.textPrimary,
  },
  description: {
    marginTop: 6,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  actions: {
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: 'rgba(13,17,22,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  actionRow: {
    minHeight: 69,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionRowPressed: {
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,104,255,0.10)',
  },
  recordIcon: {
    backgroundColor: 'rgba(255,59,59,0.08)',
  },
  actionMain: {
    flex: 1,
  },
  actionTitle: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.55,
    color: colors.textPrimary,
  },
  actionDescription: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  actionDivider: {
    height: 1,
    marginLeft: 64,
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
});
