import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';

import { useUgerodTheme } from '../../contexts/UgerodThemeContext';

export default function SessionPlanBPanel({
  visible,
  canRegeneratePlanB = false,
  canChangeSkill = false,
  hasSkill = false,
  progressRecorded = false,
  devTestReload = false,
  busyAction = null,
  onClose,
  onAlternateSkill,
  onSkipSkill,
  onAlternateSession,
}) {
  const { colors } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!visible) return null;

  const title = canRegeneratePlanB
    ? devTestReload && progressRecorded
      ? 'Recharger pour continuer les tests ?'
      : 'Envie d’autre chose ?'
    : 'Ta séance a déjà commencé.';

  const explanation = canRegeneratePlanB
    ? devTestReload && progressRecorded
      ? 'Mode développement : tu peux recharger une nouvelle séance pour continuer les tests. Les résultats déjà persistés restent protégés.'
      : 'Tu peux encore changer de proposition : aucun résultat d’exercice n’a été enregistré.'
    : 'Les résultats déjà réalisés restent intacts. Pour la suite, utilise Adapter ou Refuser sur l’exercice concerné.';

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable
        style={styles.backdrop}
        disabled={Boolean(busyAction)}
        onPress={() => !busyAction && onClose?.()}
      />
      <SafeAreaView style={styles.safe} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.icon}>
              <Ionicons name="shuffle-outline" size={20} color={colors.textOnAccent} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>PLAN B</Text>
              <Text style={styles.title}>{title}</Text>
            </View>
            <Pressable
              disabled={Boolean(busyAction)}
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <Text style={styles.explanation}>{explanation}</Text>

          {canRegeneratePlanB ? (
            <View style={styles.options}>
              {hasSkill && canChangeSkill ? (
                <>
                  <PlanBOption
                    title="Un autre Skill aujourd’hui"
                    description="UGEROD choisit un autre parcours compatible et ajuste l’échauffement spécifique."
                    icon="swap-horizontal-outline"
                    loading={busyAction === 'ALTERNATE_SKILL'}
                    disabled={Boolean(busyAction)}
                    onPress={onAlternateSkill}
                    styles={styles}
                    colors={colors}
                  />
                  <PlanBOption
                    title="Pas de Skill aujourd’hui"
                    description="Le bloc disparaît uniquement si le reste de la séance reste cohérent et sûr."
                    icon="remove-circle-outline"
                    loading={busyAction === 'SKIP_SKILL'}
                    disabled={Boolean(busyAction)}
                    onPress={onSkipSkill}
                    styles={styles}
                    colors={colors}
                  />
                </>
              ) : null}

              <PlanBOption
                title={devTestReload && progressRecorded ? 'Recharger une séance de test' : 'Une autre séance'}
                description={
                  devTestReload && progressRecorded
                    ? 'La session de test en cours est abandonnée proprement, puis UGEROD recharge une nouvelle proposition avec le même check-in.'
                    : 'Même durée, matériel et forme du jour. UGEROD reconstruit une proposition différente.'
                }
                icon="refresh-outline"
                loading={busyAction === 'ALTERNATE_SESSION'}
                disabled={Boolean(busyAction)}
                onPress={onAlternateSession}
                styles={styles}
                colors={colors}
              />
            </View>
          ) : null}

          <Pressable
            disabled={Boolean(busyAction)}
            onPress={onClose}
            style={styles.keepButton}
          >
            <Text style={styles.keepText}>
              {canRegeneratePlanB ? 'Garder la séance' : 'Retour à la séance'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function PlanBOption({ title, description, icon, loading, disabled, onPress, styles, colors }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && !disabled && styles.pressed]}
    >
      <View style={styles.optionIcon}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.secondaryAccent} />
        ) : (
          <Ionicons name={icon} size={20} color={colors.secondaryAccent} />
        )}
      </View>
      <View style={styles.optionCopy}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionBody}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 120,
      elevation: 120,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.42)',
    },
    safe: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      maxHeight: '86%',
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 22,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    handle: {
      width: 42,
      height: 4,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 14,
      backgroundColor: colors.border,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    icon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.secondaryAccent,
    },
    headerCopy: { flex: 1 },
    eyebrow: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      letterSpacing: 1.1,
      color: colors.secondaryAccent,
    },
    title: {
      marginTop: 3,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 23,
      lineHeight: 28,
      color: colors.text,
    },
    closeButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    explanation: {
      marginTop: 14,
      fontFamily: 'Manrope_500Medium',
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    options: { gap: 10, paddingTop: 16, paddingBottom: 6 },
    option: {
      minHeight: 70,
      paddingHorizontal: 13,
      paddingVertical: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
    },
    optionIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.secondaryAccentSoft,
    },
    optionCopy: { flex: 1 },
    optionTitle: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 13,
      color: colors.text,
    },
    optionBody: {
      marginTop: 3,
      fontFamily: 'Manrope_500Medium',
      fontSize: 10,
      lineHeight: 15,
      color: colors.textSecondary,
    },
    keepButton: {
      marginTop: 16,
      minHeight: 48,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    keepText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 12,
      color: colors.text,
    },
    pressed: { opacity: 0.76 },
  });
}
