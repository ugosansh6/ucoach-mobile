import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { spacing } from '../../constants';
import { useUgerodTheme } from '../../contexts/UgerodThemeContext';

export default function SessionPlayerHeader({
  eyebrowPrefix = null,
  blockIndex = 0,
  blockCount = 0,
  title,
  meta = null,
  progress = 0,
  onBack,
  onOpenOverview,
  onOpenWhy,
  onOpenAdjust,
  onOpenPlanB,
  onStartSession,
  sessionStarted = false,
  startBusy = false,
  showAdjust = false,
  showPlanB = false,
}) {
  const { colors } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const eyebrow = [
    eyebrowPrefix,
    `Bloc ${blockIndex + 1}/${Math.max(1, blockCount)}`,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable onPress={onBack} hitSlop={12} style={styles.iconButton}>
            <Ionicons name="arrow-back" size={21} color={colors.text} />
          </Pressable>

          <View style={styles.headerCopy}>
            <Text style={styles.headerEyebrow}>{eyebrow}</Text>
            <Text style={styles.headerTitle}>{title}</Text>
            {meta ? (
              <Text numberOfLines={1} style={styles.headerMeta}>
                {meta}
              </Text>
            ) : null}
          </View>

          {typeof onOpenOverview === 'function' ? (
            <Pressable
              onPress={onOpenOverview}
              accessibilityRole="button"
              accessibilityLabel="Voir ma séance"
              style={styles.overviewButton}
            >
              <Ionicons name="clipboard-outline" size={17} color={colors.text} />
              <Text style={styles.overviewButtonText}>Ma séance</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.coachTools}>
          {typeof onOpenWhy === 'function' ? (
            <Pressable onPress={onOpenWhy} style={[styles.coachTool, styles.coachToolWhy]}>
              <Ionicons name="help-circle-outline" size={17} color={colors.textSecondary} />
              <Text style={styles.coachToolText}>Pourquoi ?</Text>
            </Pressable>
          ) : null}

          {showAdjust && typeof onOpenAdjust === 'function' ? (
            <Pressable onPress={onOpenAdjust} style={[styles.coachTool, styles.coachToolAdjust]}>
              <Ionicons name="options-outline" size={17} color={colors.accent} />
              <Text style={styles.coachToolText}>Adapter</Text>
            </Pressable>
          ) : null}

          {showPlanB && typeof onOpenPlanB === 'function' ? (
            <Pressable onPress={onOpenPlanB} style={[styles.coachTool, styles.coachToolPlanB]}>
              <Ionicons name="shuffle-outline" size={17} color={colors.secondaryAccent} />
              <Text style={styles.coachToolText}>Plan B</Text>
            </Pressable>
          ) : null}
        </View>

        {!sessionStarted && typeof onStartSession === 'function' ? (
          <View style={styles.startCard}>
            <View style={styles.startCopy}>
              <Text style={styles.startTitle}>Prêt à commencer ?</Text>
              <Text style={styles.startText}>
                Tu peux encore modifier la séance avant de commencer.
              </Text>
            </View>
            <Pressable
              onPress={onStartSession}
              disabled={startBusy}
              accessibilityRole="button"
              accessibilityLabel="Démarrer ma séance"
              style={({ pressed }) => [
                styles.startButton,
                startBusy && styles.startButtonDisabled,
                pressed && !startBusy && styles.startButtonPressed,
              ]}
            >
              {startBusy ? (
                <ActivityIndicator size="small" color={colors.textOnAccent} />
              ) : (
                <Ionicons name="play" size={16} color={colors.textOnAccent} />
              )}
              <Text style={styles.startButtonText}>
                {startBusy ? 'DÉMARRAGE…' : 'DÉMARRER MA SÉANCE'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.max(0, Math.min(100, Math.round(Number(progress || 0) * 100)))}%` },
          ]}
        />
      </View>
    </>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: 12,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    headerTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerCopy: { flex: 1, minWidth: 0 },
    headerEyebrow: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      color: colors.textSecondary,
    },
    headerTitle: {
      marginTop: 1,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 22,
      lineHeight: 28,
      color: colors.text,
    },
    headerMeta: {
      marginTop: 1,
      fontFamily: 'Manrope_500Medium',
      fontSize: 11,
      lineHeight: 15,
      color: colors.textSecondary,
    },
    overviewButton: {
      minHeight: 42,
      paddingHorizontal: 11,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    overviewButtonText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.text,
    },
    coachTools: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    coachTool: {
      flex: 1,
      minHeight: 40,
      paddingHorizontal: 9,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    coachToolWhy: {
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    coachToolAdjust: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    coachToolPlanB: {
      borderColor: colors.secondaryAccent,
      backgroundColor: colors.secondaryAccentSoft,
    },
    coachToolText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.text,
    },
    startCard: {
      marginTop: 10,
      padding: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      gap: 10,
    },
    startCopy: { flex: 1 },
    startTitle: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 12,
      color: colors.text,
    },
    startText: {
      marginTop: 2,
      fontFamily: 'Manrope_500Medium',
      fontSize: 10,
      lineHeight: 15,
      color: colors.textSecondary,
    },
    startButton: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    startButtonText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 11,
      color: colors.textOnAccent,
    },
    startButtonDisabled: { opacity: 0.55 },
    startButtonPressed: { opacity: 0.82 },
    progressTrack: { height: 4, backgroundColor: colors.border },
    progressFill: { height: 4, backgroundColor: colors.accent },
  });
}
