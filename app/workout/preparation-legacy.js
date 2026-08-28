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
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  colors,
  spacing,
} from '../../src/constants';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import PreparationScreenContent from '../../src/workout/PreparationScreenContent';
import { getUserSessionBuilderBootstrap } from '../../src/services/userSessionBuilderService';

const FALLBACK_ENVIRONMENTS = [
  { environment_code: 'HOME', label_fr: 'Maison' },
  { environment_code: 'BOX', label_fr: 'Box' },
  { environment_code: 'GYM', label_fr: 'Salle de sport' },
  { environment_code: 'OUTDOOR', label_fr: 'Extérieur' },
];

function EnvironmentFormatContext({
  preparation,
  updatePreparation,
}) {
  const storedEnvironment =
    preparation?.environmentCode ?? 'HOME';

  const [previewEnvironment, setPreviewEnvironment] =
    useState(storedEnvironment);
  const [bootstrap, setBootstrap] =
    useState(null);
  const [loading, setLoading] =
    useState(true);
  const [error, setError] =
    useState('');

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const data = await getUserSessionBuilderBootstrap(
        previewEnvironment
      );
      setBootstrap(data ?? null);
    } catch (loadError) {
      setError(
        loadError?.message ??
          'Impossible de charger les environnements.'
      );
    } finally {
      setLoading(false);
    }
  }, [previewEnvironment]);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  const environments =
    Array.isArray(bootstrap?.environments) &&
    bootstrap.environments.length > 0
      ? bootstrap.environments
      : FALLBACK_ENVIRONMENTS;

  const formats = useMemo(
    () =>
      Array.isArray(bootstrap?.formats)
        ? bootstrap.formats
        : [],
    [bootstrap?.formats]
  );

  const generationFormats = useMemo(
    () =>
      formats.filter(
        (item) => item?.auto_generation_enabled
      ),
    [formats]
  );

  const previewGenerationEnabled =
    generationFormats.length > 0;

  useEffect(() => {
    if (
      previewEnvironment !== storedEnvironment ||
      !previewGenerationEnabled
    ) {
      return;
    }

    const currentFormat =
      preparation?.formatCode ?? null;

    const formatStillValid =
      generationFormats.some(
        (item) =>
          item.format_code === currentFormat
      );

    if (formatStillValid) {
      return;
    }

    const nextFormat =
      generationFormats.find(
        (item) => item.is_default
      ) ?? generationFormats[0];

    if (nextFormat?.format_code) {
      updatePreparation({
        environmentCode: storedEnvironment,
        formatCode: nextFormat.format_code,
      });
    }
  }, [
    generationFormats,
    preparation?.formatCode,
    previewEnvironment,
    previewGenerationEnabled,
    storedEnvironment,
    updatePreparation,
  ]);

  function handleEnvironmentPress(item) {
    const code = item.environment_code;
    setPreviewEnvironment(code);

    if (['HOME', 'BOX'].includes(code)) {
      updatePreparation({
        environmentCode: code,
        formatCode: null,
      });
    }
  }

  function handleFormatPress(item) {
    if (!item?.auto_generation_enabled) {
      return;
    }

    updatePreparation({
      environmentCode: previewEnvironment,
      formatCode: item.format_code,
    });
  }

  const previewLabel =
    environments.find(
      (item) =>
        item.environment_code === previewEnvironment
    )?.label_fr ?? previewEnvironment;

  return (
    <View style={styles.contextPanel}>
      <View style={styles.contextHeader}>
        <View style={styles.contextHeaderCopy}>
          <Text style={styles.contextEyebrow}>
            CONTEXTE DE SÉANCE
          </Text>
          <Text style={styles.contextTitle}>
            OÙ TU T’ENTRAÎNES ?
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator
            size="small"
            color={colors.primaryLight}
          />
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.environmentRow}
      >
        {environments.map((item) => {
          const selected =
            item.environment_code === previewEnvironment;
          const autoReady =
            ['HOME', 'BOX'].includes(
              item.environment_code
            );

          return (
            <Pressable
              key={item.environment_code}
              onPress={() =>
                handleEnvironmentPress(item)
              }
              style={({ pressed }) => [
                styles.environmentChip,
                selected &&
                  styles.environmentChipSelected,
                !autoReady &&
                  styles.environmentChipPending,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.environmentChipText,
                  selected &&
                    styles.environmentChipTextSelected,
                ]}
              >
                {String(item.label_fr ?? '')
                  .toUpperCase()}
              </Text>

              {!autoReady ? (
                <Text style={styles.pendingLabel}>
                  AUTO BIENTÔT
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? (
        <Pressable
          onPress={loadBootstrap}
          style={styles.contextError}
        >
          <Ionicons
            name="alert-circle-outline"
            size={17}
            color={colors.brandRed}
          />
          <Text style={styles.contextErrorText}>
            {error} Réessayer.
          </Text>
        </Pressable>
      ) : null}

      {!loading && !error ? (
        <View style={styles.formatArea}>
          <Text style={styles.formatLabel}>
            FORMAT — {String(previewLabel).toUpperCase()}
          </Text>

          {formats.length > 0 ? (
            <View style={styles.formatGrid}>
              {formats.map((item) => {
                const enabled =
                  Boolean(
                    item.auto_generation_enabled
                  );
                const selected =
                  enabled &&
                  previewEnvironment ===
                    storedEnvironment &&
                  item.format_code ===
                    preparation?.formatCode;

                return (
                  <Pressable
                    key={item.format_code}
                    disabled={!enabled}
                    onPress={() =>
                      handleFormatPress(item)
                    }
                    style={({ pressed }) => [
                      styles.formatChip,
                      selected &&
                        styles.formatChipSelected,
                      !enabled &&
                        styles.formatChipDisabled,
                      pressed &&
                        enabled &&
                        styles.pressed,
                    ]}
                  >
                    <View style={styles.formatCopy}>
                      <Text
                        style={[
                          styles.formatChipTitle,
                          selected &&
                            styles.formatChipTitleSelected,
                          !enabled &&
                            styles.formatChipTitleDisabled,
                        ]}
                      >
                        {String(item.label_fr ?? '')
                          .toUpperCase()}
                      </Text>

                      {!enabled ? (
                        <Text style={styles.formatChipStatus}>
                          GÉNÉRATION AUTO NON ACTIVÉE
                        </Text>
                      ) : null}
                    </View>

                    <Ionicons
                      name={
                        selected
                          ? 'checkmark-circle'
                          : enabled
                            ? 'ellipse-outline'
                            : 'lock-closed-outline'
                      }
                      size={18}
                      color={
                        selected
                          ? colors.primaryLight
                          : colors.textMuted
                      }
                    />
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={styles.noFormatText}>
              Aucun format disponible pour cet environnement.
            </Text>
          )}

          {!previewGenerationEnabled ? (
            <View style={styles.pendingNotice}>
              <Ionicons
                name="construct-outline"
                size={18}
                color={colors.primaryLight}
              />
              <View style={styles.pendingNoticeCopy}>
                <Text style={styles.pendingNoticeTitle}>
                  GÉNÉRATION UGEROD PAS ENCORE ACTIVÉE
                </Text>
                <Text style={styles.pendingNoticeBody}>
                  Les formats sont déjà définis, mais le compilateur {previewEnvironment === 'GYM' ? 'Salle' : 'Extérieur'} reste volontairement bloqué tant que ses tests ne sont pas terminés.
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  router.push('/workout/builder')
                }
                style={styles.builderShortcut}
              >
                <Text style={styles.builderShortcutText}>
                  CRÉER
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function PreparationScreen() {
  const {
    workout,
    preparation,
    updatePreparation,
  } = useWorkout();

  const normalizedStatus = String(
    workout?.status ?? ''
  ).toLowerCase();

  const hasActiveSession = Boolean(
    workout?.sessionId
  ) && ![
    'completed',
    'abandoned',
  ].includes(normalizedStatus);

  const sessionStarted = Boolean(
    workout?.sessionStarted ||
      workout?.startedAt ||
      workout?.wodStarted ||
      workout?.wodStartedAt ||
      workout?.wodRuntime?.started ||
      normalizedStatus === 'in_progress'
  );

  function handleResumeSession() {
    router.replace('/workout/session');
  }

  return (
    <View style={styles.screen}>
      <EnvironmentFormatContext
        preparation={preparation}
        updatePreparation={updatePreparation}
      />

      <View style={styles.preparationBody}>
        <PreparationScreenContent />
      </View>

      {hasActiveSession ? (
        <View style={styles.resumeDock}>
          <View style={styles.guidanceRow}>
            <View style={styles.guidanceIcon}>
              <Ionicons
                name="swap-horizontal-outline"
                size={20}
                color={colors.primaryLight}
              />
            </View>

            <View style={styles.guidanceText}>
              <Text style={styles.guidanceTitle}>
                {sessionStarted
                  ? 'SÉANCE EN COURS'
                  : 'SÉANCE DÉJÀ GÉNÉRÉE'}
              </Text>
              <Text style={styles.guidanceBody}>
                Une gêne apparue pendant la séance ? Retourne à la séance et utilise Swap sur l’exercice concerné. Modifie le check-in ici seulement si tu veux régénérer l’ensemble de la séance.
              </Text>
            </View>
          </View>

          <Pressable
            onPress={handleResumeSession}
            style={({ pressed }) => [
              styles.resumeButton,
              pressed && styles.resumeButtonPressed,
            ]}
          >
            <Ionicons
              name="play-circle-outline"
              size={20}
              color={colors.brandWhite}
            />
            <Text style={styles.resumeButtonText}>
              RETOUR À LA SÉANCE EN COURS
            </Text>
            <Ionicons
              name="arrow-forward"
              size={18}
              color={colors.brandWhite}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  preparationBody: {
    flex: 1,
  },

  contextPanel: {
    paddingHorizontal: spacing.xl,
    paddingTop: 10,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },

  contextHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },

  contextHeaderCopy: {
    flex: 1,
  },

  contextEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.9,
    color: colors.textMuted,
  },

  contextTitle: {
    marginTop: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.6,
    color: colors.textPrimary,
  },

  environmentRow: {
    paddingTop: 8,
    paddingRight: spacing.xl,
    gap: 8,
  },

  environmentChip: {
    minHeight: 39,
    minWidth: 88,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },

  environmentChipSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(8,104,255,0.12)',
  },

  environmentChipPending: {
    borderStyle: 'dashed',
  },

  environmentChipText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },

  environmentChipTextSelected: {
    color: colors.primaryLight,
  },

  pendingLabel: {
    marginTop: 2,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 7,
    lineHeight: 10,
    letterSpacing: 0.45,
    color: colors.textMuted,
  },

  contextError: {
    marginTop: 8,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  contextErrorText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textSecondary,
  },

  formatArea: {
    marginTop: 9,
  },

  formatLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.65,
    color: colors.textMuted,
  },

  formatGrid: {
    marginTop: 6,
    gap: 6,
  },

  formatChip: {
    minHeight: 42,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  formatChipSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(8,104,255,0.10)',
  },

  formatChipDisabled: {
    opacity: 0.62,
  },

  formatCopy: {
    flex: 1,
  },

  formatChipTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.45,
    color: colors.textPrimary,
  },

  formatChipTitleSelected: {
    color: colors.primaryLight,
  },

  formatChipTitleDisabled: {
    color: colors.textSecondary,
  },

  formatChipStatus: {
    marginTop: 1,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 7,
    lineHeight: 10,
    letterSpacing: 0.4,
    color: colors.textMuted,
  },

  noFormatText: {
    marginTop: 5,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textSecondary,
  },

  pendingNotice: {
    marginTop: 7,
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.22)',
    backgroundColor: 'rgba(8,104,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  pendingNoticeCopy: {
    flex: 1,
  },

  pendingNoticeTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.45,
    color: colors.primaryLight,
  },

  pendingNoticeBody: {
    marginTop: 2,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    lineHeight: 13,
    color: colors.textSecondary,
  },

  builderShortcut: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  builderShortcutText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.5,
    color: colors.primaryLight,
  },

  resumeDock: {
    paddingHorizontal: spacing.xl,
    paddingTop: 11,
    paddingBottom: 13,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    gap: 10,
  },

  guidanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  guidanceIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,104,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.24)',
  },

  guidanceText: {
    flex: 1,
  },

  guidanceTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.65,
    color: colors.primaryLight,
  },

  guidanceBody: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },

  resumeButton: {
    minHeight: 50,
    borderRadius: 13,
    paddingHorizontal: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  resumeButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },

  resumeButtonText: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.7,
    color: colors.brandWhite,
  },

  pressed: {
    opacity: 0.72,
  },
});