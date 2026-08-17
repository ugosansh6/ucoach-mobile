import { router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../constants';

export default function AddToUgerodCard() {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <View style={styles.addSection}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: addOpen }}
        onPress={() => setAddOpen((current) => !current)}
        style={({ pressed }) => [
          styles.addCard,
          addOpen && styles.addCardOpen,
          pressed && styles.addCardPressed,
        ]}
      >
        <View style={styles.addTopLine}>
          <View style={styles.redMarker} />
          <Text style={styles.addEyebrow}>AJOUTER À UGEROD</Text>
        </View>

        <View style={styles.addTitleRow}>
          <Text style={styles.addTitle}>
            TU VIENS DE{`\n`}T’ENTRAÎNER
            <Text style={styles.blueDot}>.</Text>
          </Text>

          <View style={styles.addToggleIcon}>
            <Ionicons
              name={addOpen ? 'chevron-up' : 'add'}
              size={22}
              color={colors.brandWhite}
            />
          </View>
        </View>

        <Text style={styles.addDescription}>
          Enregistre une séance réalisée ailleurs ou un nouveau record.
        </Text>

        <View style={styles.addCtaRow}>
          <Text style={styles.addCtaText}>
            {addOpen ? 'FERMER' : 'AJOUTER UNE PERFORMANCE'}
          </Text>
          <Ionicons
            name={addOpen ? 'chevron-up' : 'chevron-down'}
            size={17}
            color={colors.primaryLight}
          />
        </View>
      </Pressable>

      {addOpen && (
        <View style={styles.addActions}>
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
                size={20}
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
                size={20}
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
  addSection: {
    marginTop: 28,
  },
  addCard: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderRadius: 19,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  addCardOpen: {
    borderColor: 'rgba(8,104,255,0.24)',
  },
  addCardPressed: {
    backgroundColor: 'rgba(23,28,34,0.94)',
    transform: [{ scale: 0.992 }],
  },
  addTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  redMarker: {
    width: 4,
    height: 16,
    borderRadius: 2,
    backgroundColor: colors.brandRed,
  },
  addEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.2,
    color: colors.brandRed,
  },
  addTitleRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addTitle: {
    flex: 1,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 1.5,
    color: colors.textPrimary,
  },
  blueDot: {
    color: colors.primary,
  },
  addToggleIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addDescription: {
    marginTop: 10,
    maxWidth: 310,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  addCtaRow: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addCtaText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    color: colors.primaryLight,
  },
  addActions: {
    marginTop: 8,
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: 'rgba(13,17,22,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  actionRow: {
    minHeight: 72,
    paddingHorizontal: 15,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionRowPressed: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(8,104,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordIcon: {
    backgroundColor: 'rgba(255,59,59,0.08)',
  },
  actionMain: {
    flex: 1,
  },
  actionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    color: colors.textPrimary,
  },
  actionDescription: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
  },
  actionDivider: {
    height: 1,
    marginLeft: 65,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
});