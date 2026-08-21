import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
} from '../../constants';
import { useWorkout } from '../../contexts/WorkoutContext';
import { supabase } from '../../lib/supabase';

export default function SessionWhyOverlay() {
  const pathname = usePathname();
  const { workout } = useWorkout();

  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [why, setWhy] = useState(null);

  if (
    pathname !== '/workout/session' ||
    !workout?.sessionId
  ) {
    return null;
  }

  async function open() {
    setVisible(true);
    setLoading(true);
    setError('');

    try {
      const { data, error: rpcError } =
        await supabase.rpc(
          'w3_session_why_v1',
          {
            p_session_id: workout.sessionId,
          }
        );

      if (rpcError) {
        throw rpcError;
      }

      setWhy(data ?? null);
    } catch (loadError) {
      console.warn(
        'Session why trace',
        loadError
      );
      setWhy(null);
      setError(
        'UGEROD ne peut pas expliquer cette décision pour le moment.'
      );
    } finally {
      setLoading(false);
    }
  }

  function close() {
    if (loading) {
      return;
    }

    setVisible(false);
    setError('');
  }

  const reasons =
    Array.isArray(why?.reasons)
      ? why.reasons.filter(
          (reason) =>
            typeof reason?.text === 'string' &&
            reason.text.trim().length > 0
        )
      : [];

  return (
    <>
      <View
        pointerEvents="box-none"
        style={styles.floatingLayer}
      >
        <Pressable
          onPress={open}
          style={({ pressed }) => [
            styles.floatingButton,
            pressed &&
              styles.floatingButtonPressed,
          ]}
        >
          <Ionicons
            name="help-circle-outline"
            size={18}
            color={colors.textPrimary}
          />
          <Text style={styles.floatingButtonText}>
            POURQUOI ?
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <View style={styles.overlay}>
          <Pressable
            style={styles.backdrop}
            onPress={close}
          />

          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.headerMain}>
                <Text style={styles.eyebrow}>
                  DÉCISION DU COACH
                </Text>
                <Text style={styles.title}>
                  POURQUOI CETTE SÉANCE ?
                </Text>
              </View>

              <Pressable
                onPress={close}
                disabled={loading}
                style={styles.closeButton}
              >
                <Ionicons
                  name="close"
                  size={21}
                  color={colors.textPrimary}
                />
              </Pressable>
            </View>

            <Text style={styles.helper}>
              UGEROD affiche uniquement les raisons présentes dans la trace de décision de cette séance.
            </Text>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator
                  size="small"
                  color={colors.primaryLight}
                />
                <Text style={styles.loadingText}>
                  Lecture de la décision…
                </Text>
              </View>
            ) : null}

            {!loading && error ? (
              <View style={styles.errorBox}>
                <Ionicons
                  name="alert-circle-outline"
                  size={18}
                  color={colors.brandRed}
                />
                <Text style={styles.errorText}>
                  {error}
                </Text>
              </View>
            ) : null}

            {!loading && !error ? (
              <ScrollView
                style={styles.reasonsScroll}
                contentContainerStyle={styles.reasons}
                showsVerticalScrollIndicator={false}
              >
                {reasons.length > 0 ? (
                  reasons.map((reason, index) => (
                    <View
                      key={`${reason.type ?? 'reason'}-${index}`}
                      style={styles.reasonRow}
                    >
                      <View style={styles.reasonIndex}>
                        <Text style={styles.reasonIndexText}>
                          {index + 1}
                        </Text>
                      </View>

                      <Text style={styles.reasonText}>
                        {reason.text}
                      </Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.errorBox}>
                    <Ionicons
                      name="information-circle-outline"
                      size={18}
                      color={colors.textSecondary}
                    />
                    <Text style={styles.emptyText}>
                      La trace disponible n’est pas suffisante pour expliquer cette séance sans inventer de causalité.
                    </Text>
                  </View>
                )}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  floatingLayer: {
    position: 'absolute',
    left: spacing.xl,
    bottom: 92,
    zIndex: 79,
  },

  floatingButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(15,18,23,0.94)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },

  floatingButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },

  floatingButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 1.05,
    color: colors.textPrimary,
  },

  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.38)',
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },

  card: {
    maxHeight: '76%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingTop: 24,
    paddingBottom: 34,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },

  headerMain: {
    flex: 1,
  },

  eyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.4,
    color: colors.primaryLight,
  },

  title: {
    marginTop: 5,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: 1.2,
    color: colors.textPrimary,
  },

  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  helper: {
    marginTop: 14,
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },

  loadingBox: {
    marginTop: 18,
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },

  loadingText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
  },

  errorBox: {
    marginTop: 18,
    minHeight: 58,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  errorText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: colors.brandRed,
  },

  emptyText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },

  reasonsScroll: {
    marginTop: 18,
  },

  reasons: {
    gap: 10,
    paddingBottom: 2,
  },

  reasonRow: {
    minHeight: 64,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.035)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },

  reasonIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(16,126,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  reasonIndexText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    color: colors.primaryLight,
  },

  reasonText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
});