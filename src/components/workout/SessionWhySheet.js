import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useUgerodTheme } from '../../contexts/UgerodThemeContext';
import { useWorkout } from '../../contexts/WorkoutContext';
import { supabase } from '../../lib/supabase';

export default function SessionWhySheet({ visible = false, onClose }) {
  const { workout } = useWorkout();
  const { colors } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [why, setWhy] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!visible || !workout?.sessionId) return;

      setLoading(true);
      setError('');

      try {
        const { data, error: rpcError } = await supabase.rpc('w3_session_why_v1', {
          p_session_id: workout.sessionId,
        });
        if (rpcError) throw rpcError;
        if (!cancelled) setWhy(data ?? null);
      } catch (loadError) {
        console.warn('Session why trace', loadError);
        if (!cancelled) {
          setWhy(null);
          setError('UGEROD ne peut pas expliquer cette décision pour le moment.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (visible) load();
    else {
      setError('');
      setWhy(null);
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [visible, workout?.sessionId]);

  if (!workout?.sessionId) return null;

  const reasons = Array.isArray(why?.reasons)
    ? why.reasons.filter(
        (reason) => typeof reason?.text === 'string' && reason.text.trim().length > 0
      )
    : [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => !loading && onClose?.()}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={() => !loading && onClose?.()} />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerMain}>
              <Text style={styles.eyebrow}>DÉCISION DU COACH</Text>
              <Text style={styles.title}>Pourquoi cette séance ?</Text>
            </View>
            <Pressable
              onPress={() => !loading && onClose?.()}
              disabled={loading}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={21} color={colors.text} />
            </Pressable>
          </View>

          <Text style={styles.helper}>
            UGEROD affiche uniquement les raisons présentes dans la trace de décision de cette séance.
          </Text>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.loadingText}>Lecture de la décision…</Text>
            </View>
          ) : null}

          {!loading && error ? (
            <View style={styles.messageBox}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.secondaryAccent} />
              <Text style={styles.messageText}>{error}</Text>
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
                  <View key={`${reason.type ?? 'reason'}-${index}`} style={styles.reasonRow}>
                    <View style={styles.reasonIndex}>
                      <Text style={styles.reasonIndexText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.reasonText}>{reason.text}</Text>
                  </View>
                ))
              ) : (
                <View style={styles.messageBox}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.messageText}>
                    La trace disponible n’est pas suffisante pour expliquer cette séance sans inventer de causalité.
                  </Text>
                </View>
              )}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.38)',
    },
    backdrop: { ...StyleSheet.absoluteFillObject },
    card: {
      maxHeight: '76%',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 34,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
    headerMain: { flex: 1 },
    eyebrow: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      letterSpacing: 0.9,
      color: colors.accent,
    },
    title: {
      marginTop: 4,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 26,
      lineHeight: 31,
      color: colors.text,
    },
    closeButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    helper: {
      marginTop: 12,
      fontFamily: 'Manrope_500Medium',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    loadingBox: {
      marginTop: 16,
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    loadingText: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 12,
      color: colors.textSecondary,
    },
    messageBox: {
      marginTop: 16,
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    messageText: {
      flex: 1,
      fontFamily: 'Manrope_500Medium',
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    reasonsScroll: { marginTop: 12 },
    reasons: { paddingBottom: 4, gap: 10 },
    reasonRow: {
      minHeight: 62,
      padding: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    reasonIndex: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    reasonIndexText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 11,
      color: colors.accent,
    },
    reasonText: {
      flex: 1,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 13,
      lineHeight: 19,
      color: colors.text,
    },
  });
}
