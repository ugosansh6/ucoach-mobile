import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

          {typeof onOpenAdjust === 'function' ? (
            <Pressable onPress={onOpenAdjust} style={[styles.coachTool, styles.coachToolAdjust]}>
              <Ionicons name="options-outline" size={17} color={colors.accent} />
              <Text style={styles.coachToolText}>Ajuster</Text>
            </Pressable>
          ) : null}

          {showPlanB && typeof onOpenPlanB === 'function' ? (
            <Pressable onPress={onOpenPlanB} style={[styles.coachTool, styles.coachToolPlanB]}>
              <Ionicons name="shuffle-outline" size={17} color={colors.secondaryAccent} />
              <Text style={styles.coachToolText}>Plan B</Text>
            </Pressable>
          ) : null}
        </View>
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
    progressTrack: { height: 4, backgroundColor: colors.border },
    progressFill: { height: 4, backgroundColor: colors.accent },
  });
}
