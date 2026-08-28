import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { colors, spacing } from '../../src/constants';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import PreparationScreenContent from '../../src/workout/PreparationScreenContent';
import { getUserSessionBuilderBootstrap } from '../../src/services/userSessionBuilderService';

const FALLBACK_ENVIRONMENTS = [
  { environment_code: 'HOME', label_fr: 'Maison' },
  { environment_code: 'BOX', label_fr: 'Box' },
  { environment_code: 'GYM', label_fr: 'Salle de sport' },
  { environment_code: 'OUTDOOR', label_fr: 'Extérieur' },
];

function EnvironmentFormatContext({ preparation, updatePreparation }) {
  const storedEnvironment = String(preparation?.environmentCode ?? 'HOME').toUpperCase();
  const [previewEnvironment, setPreviewEnvironment] = useState(storedEnvironment);
  const [bootstrap, setBootstrap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getUserSessionBuilderBootstrap(null);
      setBootstrap(data ?? null);
    } catch (loadError) {
      setError(loadError?.message ?? 'Impossible de charger les environnements.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    setPreviewEnvironment(storedEnvironment);
  }, [storedEnvironment]);

  const environments =
    Array.isArray(bootstrap?.environments) && bootstrap.environments.length > 0
      ? bootstrap.environments
      : FALLBACK_ENVIRONMENTS;

  const allFormats = Array.isArray(bootstrap?.formats) ? bootstrap.formats : [];

  const formatsByEnvironment = useMemo(() => {
    const map = new Map();
    for (const item of allFormats) {
      const code = String(item?.environment_code ?? '').toUpperCase();
      if (!map.has(code)) map.set(code, []);
      map.get(code).push(item);
    }
    return map;
  }, [allFormats]);

  const previewFormats = formatsByEnvironment.get(previewEnvironment) ?? [];
  const generationFormats = previewFormats.filter((item) => item?.auto_generation_enabled);
  const previewGenerationEnabled = ['HOME', 'BOX'].includes(previewEnvironment) || generationFormats.length > 0;

  function isEnvironmentAutoReady(code) {
    if (['HOME', 'BOX'].includes(code)) return true;
    return (formatsByEnvironment.get(code) ?? []).some((item) => item?.auto_generation_enabled);
  }

  function handleEnvironmentPress(item) {
    const code = String(item.environment_code ?? '').toUpperCase();
    setPreviewEnvironment(code);

    if (['HOME', 'BOX'].includes(code)) {
      updatePreparation({
        environmentCode: code,
        formatCode: null,
        surfaceCode: null,
        outdoorPlaceCode: null,
        executionStyle: null,
      });
      return;
    }

    const ready = (formatsByEnvironment.get(code) ?? []).filter(
      (format) => format?.auto_generation_enabled
    );

    if (ready.length > 0) {
      const nextFormat = ready.find((format) => format.is_default) ?? ready[0];
      updatePreparation({
        environmentCode: code,
        formatCode: nextFormat?.format_code ?? null,
        surfaceCode: code === 'OUTDOOR' ? preparation?.surfaceCode ?? null : null,
        outdoorPlaceCode: code === 'OUTDOOR' ? preparation?.outdoorPlaceCode ?? null : null,
        executionStyle: code === 'GYM' ? preparation?.executionStyle ?? 'CLASSIC_SETS' : null,
      });
    }
  }

  function handleFormatPress(item) {
    if (!item?.auto_generation_enabled) return;
    updatePreparation({
      environmentCode: previewEnvironment,
      formatCode: item.format_code,
      executionStyle:
        previewEnvironment === 'GYM'
          ? preparation?.executionStyle ?? 'CLASSIC_SETS'
          : null,
    });
  }

  const previewLabel =
    environments.find((item) => item.environment_code === previewEnvironment)?.label_fr ?? previewEnvironment;

  return (
    <View style={styles.contextPanel}>
      <View style={styles.contextHeader}>
        <View style={styles.contextHeaderCopy}>
          <Text style={styles.contextEyebrow}>CONTEXTE DE SÉANCE</Text>
          <Text style={styles.contextTitle}>OÙ TU T’ENTRAÎNES ?</Text>
        </View>
        {loading ? <ActivityIndicator size="small" color={colors.primaryLight} /> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.environmentRow}>
        {environments.map((item) => {
          const code = String(item.environment_code ?? '').toUpperCase();
          const selected = code === previewEnvironment;
          const autoReady = isEnvironmentAutoReady(code);
          return (
            <Pressable
              key={code}
              onPress={() => handleEnvironmentPress(item)}
              style={({ pressed }) => [
                styles.environmentChip,
                selected && styles.environmentChipSelected,
                !autoReady && styles.environmentChipPending,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.environmentChipText, selected && styles.environmentChipTextSelected]}>
                {String(item.label_fr ?? code).toUpperCase()}
              </Text>
              {!autoReady ? <Text style={styles.pendingLabel}>AUTO BIENTÔT</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? (
        <Pressable onPress={loadBootstrap} style={styles.contextError}>
          <Ionicons name="alert-circle-outline" size={17} color={colors.brandRed} />
          <Text style={styles.contextErrorText}>{error} Réessayer.</Text>
        </Pressable>
      ) : null}

      {!loading && !error && !['HOME', 'BOX'].includes(previewEnvironment) ? (
        <View style={styles.formatArea}>
          <Text style={styles.formatLabel}>FORMAT — {String(previewLabel).toUpperCase()}</Text>

          {previewFormats.length > 0 ? (
            <View style={styles.formatGrid}>
              {previewFormats.map((item) => {
                const enabled = Boolean(item.auto_generation_enabled);
                const selected =
                  enabled &&
                  previewEnvironment === storedEnvironment &&
                  item.format_code === preparation?.formatCode;
                return (
                  <Pressable
                    key={item.format_code}
                    disabled={!enabled}
                    onPress={() => handleFormatPress(item)}
                    style={({ pressed }) => [
                      styles.formatChip,
                      selected && styles.formatChipSelected,
                      !enabled && styles.formatChipDisabled,
                      pressed && enabled && styles.pressed,
                    ]}
                  >
                    <View style={styles.formatCopy}>
                      <Text style={[styles.formatChipTitle, selected && styles.formatChipTitleSelected, !enabled && styles.formatChipTitleDisabled]}>
                        {String(item.label_fr ?? item.format_code).toUpperCase()}
                      </Text>
                      {!enabled ? <Text style={styles.formatChipStatus}>GÉNÉRATION AUTO NON ACTIVÉE</Text> : null}
                    </View>
                    <Ionicons
                      name={selected ? 'checkmark-circle' : enabled ? 'ellipse-outline' : 'lock-closed-outline'}
                      size={18}
                      color={selected ? colors.primaryLight : colors.textMuted}
                    />
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {!previewGenerationEnabled ? (
            <View style={styles.pendingNotice}>
              <Ionicons name="construct-outline" size={18} color={colors.primaryLight} />
              <View style={styles.pendingNoticeCopy}>
                <Text style={styles.pendingNoticeTitle}>GÉNÉRATION UGEROD PAS ENCORE ACTIVÉE</Text>
                <Text style={styles.pendingNoticeBody}>Le constructeur manuel reste disponible pendant la validation du compilateur.</Text>
              </View>
              <Pressable onPress={() => router.push('/workout/builder')} style={styles.builderShortcut}>
                <Text style={styles.builderShortcutText}>CRÉER</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function PreparationScreen() {
  const { workout, preparation, updatePreparation } = useWorkout();
  const normalizedStatus = String(workout?.status ?? '').toLowerCase();
  const hasActiveSession = Boolean(workout?.sessionId) && !['completed', 'abandoned'].includes(normalizedStatus);
  const sessionStarted = Boolean(
    workout?.sessionStarted || workout?.startedAt || workout?.wodStarted || workout?.wodStartedAt || workout?.wodRuntime?.started || normalizedStatus === 'in_progress'
  );

  return (
    <View style={styles.screen}>
      <EnvironmentFormatContext preparation={preparation} updatePreparation={updatePreparation} />
      <View style={styles.preparationBody}>
        <PreparationScreenContent />
      </View>

      {hasActiveSession ? (
        <View style={styles.resumeDock}>
          <View style={styles.guidanceRow}>
            <View style={styles.guidanceIcon}>
              <Ionicons name="swap-horizontal-outline" size={20} color={colors.primaryLight} />
            </View>
            <View style={styles.guidanceText}>
              <Text style={styles.guidanceTitle}>{sessionStarted ? 'SÉANCE EN COURS' : 'SÉANCE DÉJÀ GÉNÉRÉE'}</Text>
              <Text style={styles.guidanceBody}>
                Une gêne apparue pendant la séance ? Retourne à la séance et utilise Swap. Modifie le check-in ici seulement si tu veux changer le contexte de la séance.
              </Text>
            </View>
          </View>
          <Pressable onPress={() => router.replace('/workout/session')} style={({ pressed }) => [styles.resumeButton, pressed && styles.pressed]}>
            <Ionicons name="play-circle-outline" size={20} color={colors.brandWhite} />
            <Text style={styles.resumeButtonText}>RETOUR À LA SÉANCE EN COURS</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.brandWhite} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  preparationBody: { flex: 1 },
  contextPanel: { paddingHorizontal: spacing.xl, paddingTop: 10, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.background },
  contextHeader: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  contextHeaderCopy: { flex: 1 },
  contextEyebrow: { fontFamily: 'Oswald_600SemiBold', fontSize: 9, lineHeight: 12, letterSpacing: 0.9, color: colors.textMuted },
  contextTitle: { marginTop: 1, fontFamily: 'Oswald_700Bold', fontSize: 13, lineHeight: 17, letterSpacing: 0.6, color: colors.textPrimary },
  environmentRow: { paddingTop: 8, paddingRight: spacing.xl, gap: 8 },
  environmentChip: { minHeight: 39, minWidth: 88, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  environmentChipSelected: { borderColor: colors.primaryLight, backgroundColor: colors.primary },
  environmentChipPending: { opacity: 0.72 },
  environmentChipText: { fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 0.5, color: colors.textSecondary },
  environmentChipTextSelected: { color: colors.brandWhite },
  pendingLabel: { marginTop: 2, fontFamily: 'Oswald_400Regular', fontSize: 7, letterSpacing: 0.4, color: colors.textMuted },
  contextError: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 7 },
  contextErrorText: { flex: 1, fontFamily: 'Oswald_400Regular', fontSize: 10, color: colors.brandRed },
  formatArea: { marginTop: 10 },
  formatLabel: { fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.7, color: colors.textMuted },
  formatGrid: { marginTop: 7, gap: 7 },
  formatChip: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 8 },
  formatChipSelected: { borderColor: colors.primaryLight },
  formatChipDisabled: { opacity: 0.58 },
  formatCopy: { flex: 1 },
  formatChipTitle: { fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 0.45, color: colors.textPrimary },
  formatChipTitleSelected: { color: colors.primaryLight },
  formatChipTitleDisabled: { color: colors.textMuted },
  formatChipStatus: { marginTop: 2, fontFamily: 'Oswald_400Regular', fontSize: 8, color: colors.textMuted },
  pendingNotice: { marginTop: 9, minHeight: 54, padding: 10, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 9 },
  pendingNoticeCopy: { flex: 1 },
  pendingNoticeTitle: { fontFamily: 'Oswald_700Bold', fontSize: 9, letterSpacing: 0.4, color: colors.textPrimary },
  pendingNoticeBody: { marginTop: 2, fontFamily: 'Oswald_400Regular', fontSize: 9, lineHeight: 13, color: colors.textSecondary },
  builderShortcut: { minHeight: 34, paddingHorizontal: 11, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  builderShortcutText: { fontFamily: 'Oswald_700Bold', fontSize: 9, color: colors.brandWhite },
  resumeDock: { paddingHorizontal: spacing.xl, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  guidanceRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
  guidanceIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  guidanceText: { flex: 1 },
  guidanceTitle: { fontFamily: 'Oswald_700Bold', fontSize: 10, color: colors.textPrimary },
  guidanceBody: { marginTop: 2, fontFamily: 'Oswald_400Regular', fontSize: 9, lineHeight: 13, color: colors.textSecondary },
  resumeButton: { minHeight: 48, borderRadius: 12, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  resumeButtonText: { fontFamily: 'Oswald_700Bold', fontSize: 10, letterSpacing: 0.65, color: colors.brandWhite },
  pressed: { opacity: 0.68 },
});
