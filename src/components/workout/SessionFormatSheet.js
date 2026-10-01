import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useUgerodTheme } from '../../contexts/UgerodThemeContext';
import { useWorkout } from '../../contexts/WorkoutContext';
import {
  changeWorkoutFormat,
  getWorkoutFormatOptions,
  reloadWorkoutSession,
} from '../../services/sessionMutationService';

function optionTitle(option) {
  return String(
    option?.display_name ??
      option?.option_id ??
      option?.mechanic ??
      'Format'
  );
}

export default function SessionFormatSheet({
  visible,
  onClose,
  onApplied = null,
}) {
  const {
    workout,
    setGeneratedWorkoutPreservingProgress,
  } = useWorkout();
  const { colors } = useUgerodTheme();
  const styles = useMemo(
    () => createStyles(colors),
    [colors]
  );

  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [changing, setChanging] = useState(null);
  const [error, setError] = useState('');

  const loadOptions = useCallback(async () => {
    if (!workout?.sessionId) return;

    try {
      setLoading(true);
      setError('');
      const result = await getWorkoutFormatOptions(
        workout.sessionId
      );
      setOptions(result?.options ?? []);
    } catch (loadError) {
      setError(
        loadError?.message ??
          'Impossible de charger les formats.'
      );
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, [workout?.sessionId]);

  useEffect(() => {
    if (!visible) return;
    loadOptions();
  }, [loadOptions, visible]);

  useEffect(() => {
    if (visible) return;
    setOptions([]);
    setError('');
    setChanging(null);
  }, [visible]);

  async function selectOption(option) {
    if (
      !option?.selectable ||
      option?.current ||
      changing ||
      !workout?.sessionId
    ) {
      return;
    }

    try {
      setChanging(option.option_id ?? option.mechanic);
      setError('');

      const result = await changeWorkoutFormat({
        sessionId: workout.sessionId,
        mechanic: option.mechanic,
        variantKey: option.variant_key ?? null,
      });

      const refreshed = await reloadWorkoutSession({
        sessionId: workout.sessionId,
        preparationSnapshot:
          workout?.preparationSnapshot ?? null,
      });

      setGeneratedWorkoutPreservingProgress({
        ...refreshed,
        formatChangeCount: Number(
          result?.format_change_count ??
            refreshed?.formatChangeCount ??
            0
        ),
        formatChangeLimit: Number(
          result?.format_change_limit ??
            refreshed?.formatChangeLimit ??
            3
        ),
        formatLocked: Boolean(
          result?.format_locked ??
            refreshed?.formatLocked ??
            false
        ),
      });

      if (typeof onApplied === 'function') {
        await onApplied({
          result,
          workout: refreshed,
          option,
        });
      }

      onClose?.();
    } catch (changeError) {
      setError(
        changeError?.message ??
          'Impossible de changer le format.'
      );
    } finally {
      setChanging(null);
    }
  }

  return (
    <Modal
      visible={Boolean(visible)}
      transparent
      animationType="slide"
      onRequestClose={() => !changing && onClose?.()}
    >
      <SafeAreaView style={styles.root}>
        <Pressable
          style={styles.backdrop}
          disabled={Boolean(changing)}
          onPress={() => onClose?.()}
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>
                FORMAT DU WOD
              </Text>
              <Text style={styles.title}>
                Choisis ta mécanique
              </Text>
              <Text style={styles.subtitle}>
                UGEROD vérifie complètement la cohérence du format au moment où tu le choisis.
              </Text>
            </View>
            <Pressable
              disabled={Boolean(changing)}
              onPress={() => onClose?.()}
              style={styles.close}
            >
              <Ionicons
                name="close"
                size={20}
                color={colors.text}
              />
            </Pressable>
          </View>

          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : null}

          {loading ? (
            <ActivityIndicator
              color={colors.accent}
              style={styles.loader}
            />
          ) : null}

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.list}
          >
            {options.map((option) => {
              const key =
                option?.option_id ??
                `${option?.mechanic ?? 'format'}:${option?.variant_key ?? ''}`;
              const disabled =
                !option?.selectable ||
                option?.current ||
                Boolean(changing);

              return (
                <Pressable
                  key={key}
                  disabled={disabled}
                  onPress={() => selectOption(option)}
                  style={[
                    styles.option,
                    disabled &&
                      !option?.current &&
                      styles.disabled,
                  ]}
                >
                  <View style={styles.optionCopy}>
                    <Text style={styles.optionTitle}>
                      {optionTitle(option)}
                    </Text>
                    {option?.description ? (
                      <Text style={styles.optionDescription}>
                        {option.description}
                      </Text>
                    ) : null}
                  </View>

                  {changing === key ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.accent}
                    />
                  ) : option?.current ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.accent}
                    />
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.textMuted}
                    />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.52)',
    },
    sheet: {
      maxHeight: '82%',
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 18,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    handle: {
      width: 42,
      height: 4,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 16,
      backgroundColor: colors.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    headerCopy: {
      flex: 1,
    },
    eyebrow: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.accent,
    },
    title: {
      marginTop: 3,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 24,
      lineHeight: 30,
      color: colors.text,
    },
    subtitle: {
      marginTop: 6,
      fontFamily: 'Manrope_500Medium',
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    close: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    error: {
      marginTop: 14,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 12,
      lineHeight: 17,
      color: colors.error,
    },
    loader: {
      marginTop: 24,
    },
    list: {
      paddingTop: 16,
      paddingBottom: 8,
      gap: 9,
    },
    option: {
      minHeight: 68,
      borderRadius: 16,
      paddingHorizontal: 15,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    disabled: {
      opacity: 0.42,
    },
    optionCopy: {
      flex: 1,
      minWidth: 0,
    },
    optionTitle: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 14,
      color: colors.text,
    },
    optionDescription: {
      marginTop: 3,
      fontFamily: 'Manrope_500Medium',
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
  });
}
