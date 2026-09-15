import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useUgerodTheme } from '../../contexts/UgerodThemeContext';
import WodProtocolPlayerV3 from './WodProtocolPlayerV3';

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export default function EnvironmentWodBlock({
  block,
  exercises,
  runtime,
  onBeforeStart,
  onRuntimeChange,
  onComplete,
}) {
  const { colors } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const durationMinutes = Math.max(
    1,
    numberOr(block?.duration_minutes ?? block?.durationMinutes, 10)
  );

  const playerBlock = {
    id: 'wod',
    source: block,
    title: block?.label_fr ?? block?.label ?? block?.title ?? block?.block_name ?? 'WOD',
    durationMinutes,
    duration: `${durationMinutes} MIN`,
    mechanic: block?.mechanic ?? null,
    exercises: Array.isArray(exercises) ? exercises : [],
  };

  return (
    <View style={styles.container}>
      <WodProtocolPlayerV3
        block={playerBlock}
        initialRuntime={runtime ?? null}
        onBeforeStart={onBeforeStart}
        onRuntimeChange={onRuntimeChange}
      />

      {runtime?.finished ? (
        <Pressable
          onPress={onComplete}
          style={({ pressed }) => [
            styles.completeButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.completeButtonText}>Terminer le bloc</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { gap: 12 },
    completeButton: {
      minHeight: 54,
      paddingHorizontal: 18,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    completeButtonText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 12,
      color: colors.textOnAccent,
    },
    pressed: { opacity: 0.72 },
  });
}
