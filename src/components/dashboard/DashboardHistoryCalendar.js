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
import ProductOnboardingModal from '../onboarding/ProductOnboardingModal';
import DashboardHistoryCalendarBase from './DashboardHistoryCalendarBase';

export default function DashboardHistoryCalendar(props) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <ProductOnboardingModal />
      <DashboardHistoryCalendarBase {...props} />

      <View style={styles.addSection}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: addOpen }}
          onPress={() => setAddOpen((current) => !current)}
          style={({ pressed }) => [
            styles.addHeader,
            addOpen && styles.addHeaderOpen,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.addHeaderLeft}>
            <View style={styles.addHeaderIcon}>
              <Ionicons
                name="add"
                size={20}
                color={colors.primaryLight}
              />
            </View>

            <View>
              <Text style={styles.addEyebrow}>TU VIENS DE T’ENTRAÎNER ?</Text>
              <Text style={styles.addTitle}>AJOUTER À UGEROD</Text>
            </View>
          </View>

          <Ionicons
            name={addOpen ? 'chevron-up' : 'chevron-down'}
            size={19}
            color={colors.textSecondary}
          />
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
    </>
  );
}

const styles = StyleSheet.create({
  addSection: {
    marginTop: 18,
  },
  addHeader: {
    minHeight: 68,
    paddingHorizontal: 15,
    borderRadius: 16,
    backgroundColor: 'rgba(17,21,26,0.91)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addHeaderOpen: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  addHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingRight: 10,
  },
  addHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(8,104,255,0.11)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.9,
    color: colors.textMuted,
  },
  addTitle: {
    marginTop: 2,
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.6,
    color: colors.textPrimary,
  },
  addActions: {
    overflow: 'hidden',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: 'rgba(13,17,22,0.97)',
    borderWidth: 1,
    borderTopWidth: 0,
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
  pressed: {
    opacity: 0.72,
  },
});