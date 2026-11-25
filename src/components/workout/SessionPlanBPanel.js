import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';

import { useUgerodTheme } from '../../contexts/UgerodThemeContext';

export default function SessionPlanBPanel({
  visible,
  canRegeneratePlanB = false,
  canChangeSkill = false,
  hasSkill = false,
  busyAction = null,
  onClose,
  onAlternateSkill,
  onSkipSkill,
  onAlternateSession,
}) {
  const { colors } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [actionError, setActionError] = useState('');
  const [pendingAction, setPendingAction] = useState(null);
  const activeAction = busyAction ?? pendingAction;

  useEffect(() => {
    if (visible) {
      setActionError('');
      setPendingAction(null);
    }
  }, [visible]);

  if (!visible) return null;

  async function runAction(action, callback) {
    if (!callback || activeAction) return;
    setActionError('');
    setPendingAction(action);

    try {
      const result = await callback();
      if (result?.ok === false) {
        setActionError(result.error || 'UGEROD n’a pas pu modifier cette séance.');
      }
    } catch (error) {
      setActionError(error?.message || 'UGEROD n’a pas pu modifier cette séance.');
    } finally {
      setPendingAction(null);
    }
  }

  const title = canRegeneratePlanB ? 'Envie d’autre chose ?' : 'Ta séance a déjà commencé.';
  const explanation = canRegeneratePlanB
    ? 'Choisis ce que tu veux changer. Rien ne bouge tant que tu n’as pas choisi.'
    : 'Plan B est disponible uniquement avant de commencer.';

  const busyLabel =
    activeAction === 'ALTERNATE_SKILL'
      ? 'UGEROD prépare un autre Skill…'
      : activeAction === 'SKIP_SKILL'
        ? 'UGEROD réorganise la séance…'
        : activeAction === 'ALTERNATE_SESSION'
          ? 'UGEROD prépare une autre séance…'
          : null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.backdrop} pointerEvents="none" />
      <SafeAreaView style={styles.safe} pointerEvents="box-none">
        <View style={styles.sheet} pointerEvents="auto">
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
              disabled={Boolean(activeAction)}
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <Text style={styles.explanation}>{explanation}</Text>

          {busyLabel ? (
            <View style={styles.statusBox}>
              <ActivityIndicator size="small" color={colors.secondaryAccent} />
              <Text style={styles.statusText}>{busyLabel}</Text>
            </View>
          ) : null}

          {actionError ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.secondaryAccent} />
              <Text style={styles.errorText}>{actionError}</Text>
            </View>
          ) : null}

          {canRegeneratePlanB ? (
            <View style={styles.options}>
              {hasSkill && canChangeSkill ? (
                <>
                  <PlanBOption
                    title="Un autre Skill aujourd’hui"
                    description="Changer uniquement le parcours Skill de cette séance."
                    icon="swap-horizontal-outline"
                    loading={activeAction === 'ALTERNATE_SKILL'}
                    disabled={Boolean(activeAction)}
                    onPress={() => runAction('ALTERNATE_SKILL', onAlternateSkill)}
                    styles={styles}
                    colors={colors}
                  />
                  <PlanBOption
                    title="Pas de Skill aujourd’hui"
                    description="Retirer le Skill si le reste de la séance reste cohérent."
                    icon="remove-circle-outline"
                    loading={activeAction === 'SKIP_SKILL'}
                    disabled={Boolean(activeAction)}
                    onPress={() => runAction('SKIP_SKILL', onSkipSkill)}
                    styles={styles}
                    colors={colors}
                  />
                </>
              ) : null}

              <PlanBOption
                title="Une autre séance"
                description="Reconstruire une autre proposition avec le même check-in."
                icon="refresh-outline"
                loading={activeAction === 'ALTERNATE_SESSION'}
                disabled={Boolean(activeAction)}
                onPress={() => runAction('ALTERNATE_SESSION', onAlternateSession)}
                styles={styles}
                colors={colors}
              />
            </View>
          ) : null}

          <Pressable
            disabled={Boolean(activeAction)}
            onPress={onClose}
            style={styles.keepButton}
          >
            <Text style={styles.keepText}>{canRegeneratePlanB ? 'Garder la séance' : 'Retour à la séance'}</Text>
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
      zIndex: 2,
      elevation: 2,
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
      zIndex: 3,
      elevation: 3,
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
    statusBox: {
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      backgroundColor: colors.secondaryAccentSoft,
    },
    statusText: {
      flex: 1,
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.text,
    },
    errorBox: {
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.secondaryAccent,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 9,
      backgroundColor: colors.surface,
    },
    errorText: {
      flex: 1,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      color: colors.text,
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
