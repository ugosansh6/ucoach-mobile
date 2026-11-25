from pathlib import Path

# PLAY-014b: align the GYM/OUTDOOR presentation with the focused Player while
# preserving every specialized environment runtime and completion path.

env_path = Path('app/workout/environment-session-core.js')
env = env_path.read_text(encoding='utf-8')

# Theme + inline options imports.
if "useUgerodTheme" not in env:
    env = env.replace(
        "import { useWorkout } from '../../src/contexts/WorkoutContext';\n",
        "import { useWorkout } from '../../src/contexts/WorkoutContext';\nimport { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';\n",
        1,
    )
if "EnvironmentSwapOverlay" not in env:
    env = env.replace(
        "import EnvironmentWodBlock from '../../src/components/workout/EnvironmentWodBlock';\n",
        "import EnvironmentWodBlock from '../../src/components/workout/EnvironmentWodBlock';\nimport EnvironmentSwapOverlay from '../../src/components/workout/EnvironmentSwapOverlay';\n",
        1,
    )

old_signature = "export default function EnvironmentSessionCore({ environmentCode }) {\n  const { workout, updateWorkout } = useWorkout();"
new_signature = """export default function EnvironmentSessionCore({
  environmentCode,
  onOpenOverview,
  onOpenPlanB,
  onOpenWhy,
  onOpenAdjust,
  showPlanB = false,
}) {
  const { workout, updateWorkout } = useWorkout();
  const { colors: themeColors, isDark } = useUgerodTheme();
  const shellStyles = useMemo(
    () => createShellStyles(themeColors, isDark),
    [themeColors, isDark]
  );"""
if old_signature not in env:
    raise SystemExit('EnvironmentSessionCore signature not found')
env = env.replace(old_signature, new_signature, 1)

# Focus the simple/preparation block on one exercise at a time, like HOME.
start = env.index('function SimpleBlock({ block, exercises, onComplete }) {')
end = env.index('\nfunction StrengthBlock(', start)
new_simple = r'''function SimpleBlock({ block, exercises, onComplete }) {
  const { colors: themeColors, isDark } = useUgerodTheme();
  const focusedStyles = useMemo(
    () => createEnvironmentFocusedStyles(themeColors, isDark),
    [themeColors, isDark]
  );
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const exercise = exercises[exerciseIndex] ?? exercises[0] ?? null;

  if (!exercise) {
    return (
      <View style={focusedStyles.exerciseCard}>
        <Text style={focusedStyles.exerciseName}>Bloc vide</Text>
        <Text style={focusedStyles.exercisePrescription}>Aucun exercice exécutable n’a été reçu.</Text>
      </View>
    );
  }

  const isLast = exerciseIndex >= exercises.length - 1;

  function validateCurrent() {
    if (isLast) {
      onComplete();
      return;
    }
    setExerciseIndex((current) => Math.min(exercises.length - 1, current + 1));
  }

  return (
    <>
      <View style={focusedStyles.mediaCard}>
        <View style={focusedStyles.mediaFallback}>
          <View style={focusedStyles.mediaFallbackIcon}>
            <Ionicons name="barbell-outline" size={34} color={themeColors.accent} />
          </View>
          <Text style={focusedStyles.mediaFallbackText}>{blockTitle(block)}</Text>
        </View>
        <View style={focusedStyles.mediaOverlayTop}>
          <Text style={focusedStyles.exercisePosition}>
            Exercice {exerciseIndex + 1} / {exercises.length}
          </Text>
        </View>
      </View>

      <View style={focusedStyles.exerciseCard}>
        <Text style={focusedStyles.exerciseName}>{exercise.name}</Text>
        {exercise.prescription ? (
          <Text style={focusedStyles.exercisePrescription}>{exercise.prescription}</Text>
        ) : null}
      </View>

      {exercises.length > 1 ? (
        <View style={focusedStyles.exerciseNav}>
          <Pressable
            onPress={() => setExerciseIndex((current) => Math.max(0, current - 1))}
            disabled={exerciseIndex === 0}
            style={[focusedStyles.navButton, exerciseIndex === 0 && focusedStyles.actionDisabled]}
          >
            <Ionicons name="chevron-back" size={20} color={themeColors.text} />
          </Pressable>
          <View style={focusedStyles.navDots}>
            {exercises.map((row, index) => (
              <View
                key={exerciseKey(row) ?? `${index}`}
                style={[focusedStyles.navDot, index === exerciseIndex && focusedStyles.navDotActive]}
              />
            ))}
          </View>
          <Pressable
            onPress={() => setExerciseIndex((current) => Math.min(exercises.length - 1, current + 1))}
            disabled={isLast}
            style={[focusedStyles.navButton, isLast && focusedStyles.actionDisabled]}
          >
            <Ionicons name="chevron-forward" size={20} color={themeColors.text} />
          </Pressable>
        </View>
      ) : null}

      <Pressable onPress={validateCurrent} style={focusedStyles.primaryButtonLarge}>
        <Ionicons name="checkmark-circle-outline" size={20} color={themeColors.textOnAccent} />
        <Text style={focusedStyles.primaryButtonTextLarge}>
          {isLast ? 'Réalisé · terminer le bloc' : 'Réalisé · suivant'}
        </Text>
      </Pressable>
    </>
  );
}
'''
env = env[:start] + new_simple + env[end:]

old_header = r'''  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconButton}>
          <Ionicons name="arrow-back" size={21} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{environmentCode === 'GYM' ? 'SALLE' : 'EXTÉRIEUR'}</Text>
          <Text style={styles.headerTitle}>{blockTitle(currentBlock, currentKey.toUpperCase())}</Text>
        </View>
        <Text style={styles.stepText}>{currentIndex + 1}/{blocks.length}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((currentIndex + 1) / blocks.length) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>'''
new_header = r'''  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: themeColors.background }]}>
      <View style={shellStyles.header}>
        <View style={shellStyles.headerTop}>
          <Pressable
            onPress={() => router.replace('/workout/preparation')}
            hitSlop={12}
            style={shellStyles.iconButton}
          >
            <Ionicons name="arrow-back" size={21} color={themeColors.text} />
          </Pressable>

          <View style={shellStyles.headerCopy}>
            <Text style={shellStyles.headerEyebrow}>
              {(environmentCode === 'GYM' ? 'SALLE' : 'EXTÉRIEUR')} · Bloc {currentIndex + 1}/{blocks.length}
            </Text>
            <Text style={shellStyles.headerTitle}>
              {blockTitle(currentBlock, currentKey.toUpperCase())}
            </Text>
            <Text numberOfLines={1} style={shellStyles.headerMeta}>
              {[
                currentBlock?.structure ?? currentBlock?.execution_style?.label_fr ?? null,
                Number(currentBlock?.duration_minutes ?? currentBlock?.durationMinutes) > 0
                  ? `${Number(currentBlock?.duration_minutes ?? currentBlock?.durationMinutes)} min`
                  : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>

          {typeof onOpenOverview === 'function' ? (
            <Pressable
              onPress={onOpenOverview}
              accessibilityRole="button"
              accessibilityLabel="Voir ma séance"
              style={shellStyles.overviewButton}
            >
              <Ionicons name="clipboard-outline" size={17} color={themeColors.text} />
              <Text style={shellStyles.overviewButtonText}>Ma séance</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={shellStyles.coachTools}>
          {typeof onOpenWhy === 'function' ? (
            <Pressable onPress={onOpenWhy} style={shellStyles.coachTool}>
              <Ionicons name="help-circle-outline" size={17} color={themeColors.textSecondary} />
              <Text style={shellStyles.coachToolText}>Pourquoi ?</Text>
            </Pressable>
          ) : null}
          {typeof onOpenAdjust === 'function' ? (
            <Pressable onPress={onOpenAdjust} style={shellStyles.coachTool}>
              <Ionicons name="options-outline" size={17} color={themeColors.accent} />
              <Text style={shellStyles.coachToolText}>Ajuster</Text>
            </Pressable>
          ) : null}
          {showPlanB && typeof onOpenPlanB === 'function' ? (
            <Pressable onPress={onOpenPlanB} style={shellStyles.coachTool}>
              <Ionicons name="shuffle-outline" size={17} color={themeColors.secondaryAccent} />
              <Text style={shellStyles.coachToolText}>Plan B</Text>
            </Pressable>
          ) : null}
          <EnvironmentSwapOverlay variant="inline" />
        </View>
      </View>

      <View style={shellStyles.progressTrack}>
        <View
          style={[
            shellStyles.progressFill,
            { width: `${blocks.length > 0 ? Math.round((currentIndex / blocks.length) * 100) : 0}%` },
          ]}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>'''
if old_header not in env:
    raise SystemExit('legacy environment header not found')
env = env.replace(old_header, new_header, 1)

style_marker = '\nconst styles = StyleSheet.create({'
if style_marker not in env:
    raise SystemExit('style marker not found')
new_styles = r'''
function createShellStyles(colors, isDark) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: 8,
      paddingBottom: 10,
      backgroundColor: colors.background,
    },
    headerTop: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    iconButton: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerCopy: { flex: 1, minWidth: 0 },
    headerEyebrow: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      color: colors.accent,
    },
    headerTitle: {
      marginTop: 2,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 22,
      lineHeight: 27,
      color: colors.text,
    },
    headerMeta: {
      marginTop: 2,
      fontFamily: 'Manrope_500Medium',
      fontSize: 10,
      lineHeight: 14,
      color: colors.textSecondary,
    },
    overviewButton: {
      minHeight: 38,
      paddingHorizontal: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    overviewButtonText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      color: colors.text,
    },
    coachTools: {
      marginTop: 8,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    coachTool: {
      minHeight: 36,
      paddingHorizontal: 11,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    coachToolText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      color: colors.text,
    },
    progressTrack: { height: 3, backgroundColor: colors.border },
    progressFill: { height: 3, backgroundColor: colors.accent },
  });
}

function createEnvironmentFocusedStyles(colors, isDark) {
  return StyleSheet.create({
    mediaCard: {
      minHeight: 190,
      borderRadius: 18,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    mediaFallback: {
      flex: 1,
      minHeight: 190,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: colors.surface,
    },
    mediaFallbackIcon: {
      width: 64,
      height: 64,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    mediaFallbackText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 16,
      color: colors.textSecondary,
    },
    mediaOverlayTop: {
      position: 'absolute',
      top: 12,
      right: 12,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: isDark ? 'rgba(0,0,0,0.58)' : 'rgba(255,255,255,0.88)',
    },
    exercisePosition: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      color: colors.text,
    },
    exerciseCard: {
      marginTop: 12,
      padding: 18,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    exerciseName: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 20,
      lineHeight: 25,
      color: colors.text,
    },
    exercisePrescription: {
      marginTop: 6,
      fontFamily: 'Manrope_500Medium',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    exerciseNav: {
      marginTop: 12,
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    navButton: {
      width: 42,
      height: 42,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    navDots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 7 },
    navDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.borderStrong },
    navDotActive: { width: 20, backgroundColor: colors.accent },
    actionDisabled: { opacity: 0.35 },
    primaryButtonLarge: {
      minHeight: 54,
      marginTop: 14,
      paddingHorizontal: 18,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      backgroundColor: colors.accent,
    },
    primaryButtonTextLarge: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 12,
      color: colors.textOnAccent,
    },
  });
}
'''
env = env.replace(style_marker, new_styles + style_marker, 1)
env_path.write_text(env, encoding='utf-8')

overlay_path = Path('src/components/workout/EnvironmentSwapOverlay.js')
overlay = overlay_path.read_text(encoding='utf-8')

if "variant = 'floating'" not in overlay:
    overlay = overlay.replace(
        'export default function EnvironmentSwapOverlay() {',
        "export default function EnvironmentSwapOverlay({ variant = 'floating' } = {}) {",
        1,
    )

old_target = r'''  const swapExercise =
    current &&
    isManualBuilderBlock &&
    SUPPORTED_SWAP_RUNTIME_BLOCKS.has(current.key)
      ? current.pendingExercises?.[0] ?? null
      : null;'''
new_target = r'''  // The UI may expose adaptation for any current exercise, but the existing
  // backend availability remains the authority on whether a swap is possible.
  const swapExercise = current?.pendingExercises?.[0] ?? null;
  const needsBuilderRuntimeSync = Boolean(
    current && isManualBuilderBlock && SUPPORTED_SWAP_RUNTIME_BLOCKS.has(current.key)
  );'''
if old_target not in overlay:
    raise SystemExit('swap target block not found')
overlay = overlay.replace(old_target, new_target, 1)

old_sync = r'''      await syncEnvironmentBuilderSwapRuntime({
        sessionExerciseId: swapExercise.sessionExerciseId,
        oldExerciseId,
        substitute: result?.substitute ?? {},
      });'''
new_sync = r'''      if (needsBuilderRuntimeSync) {
        await syncEnvironmentBuilderSwapRuntime({
          sessionExerciseId: swapExercise.sessionExerciseId,
          oldExerciseId,
          substitute: result?.substitute ?? {},
        });
      }'''
if old_sync not in overlay:
    raise SystemExit('builder sync block not found')
overlay = overlay.replace(old_sync, new_sync, 1)

old_trigger = r'''      <Pressable
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.floatingButton, pressed && styles.pressed]}
      >
        <Ionicons name="ellipsis-horizontal" size={17} color={colors.textPrimary} />
        <Text style={styles.floatingText}>OPTIONS</Text>
      </Pressable>'''
new_trigger = r'''      <Pressable
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          variant === 'inline' ? styles.inlineButton : styles.floatingButton,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={hasSwapChoice ? 'swap-horizontal-outline' : 'ellipsis-horizontal'}
          size={17}
          color={colors.textPrimary}
        />
        <Text style={styles.floatingText}>{hasSwapChoice ? 'Adapter' : 'Options'}</Text>
      </Pressable>'''
if old_trigger not in overlay:
    raise SystemExit('overlay trigger not found')
overlay = overlay.replace(old_trigger, new_trigger, 1)

style_anchor = "  floatingText: {\n    fontFamily: 'Oswald_700Bold',"
inline_style = """  inlineButton: {
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  floatingText: {
    fontFamily: 'Oswald_700Bold',"""
if style_anchor not in overlay:
    raise SystemExit('overlay style anchor not found')
overlay = overlay.replace(style_anchor, inline_style, 1)
overlay_path.write_text(overlay, encoding='utf-8')
