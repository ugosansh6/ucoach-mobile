import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../constants';
import WodProtocolPlayer from './WodProtocolPlayer';

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
      <WodProtocolPlayer
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
          <Text style={styles.completeButtonText}>VALIDER LE WOD</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  completeButton: {
    minHeight: 50,
    paddingHorizontal: 16,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  completeButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.brandWhite,
  },
  pressed: { opacity: 0.72 },
});
