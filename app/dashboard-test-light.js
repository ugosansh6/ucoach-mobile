import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import DashboardDesignLight from './workbench/dashboard-design-light';

const KHAKI = '#646F5E';
const SURFACE = '#FFFFFF';

export default function DashboardTestLightScreen() {
  return (
    <View style={styles.screen}>
      <DashboardDesignLight />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Créer ma séance"
        onPress={() => router.push('/workout/builder')}
        style={({ pressed }) => [
          styles.builderButton,
          pressed && styles.builderButtonPressed,
        ]}
      >
        <View style={styles.builderIcon}>
          <Ionicons
            name="construct-outline"
            size={18}
            color={SURFACE}
          />
        </View>

        <Text style={styles.builderText}>CRÉER MA SÉANCE</Text>

        <Ionicons
          name="arrow-forward"
          size={17}
          color={SURFACE}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  builderButton: {
    position: 'absolute',
    right: 16,
    bottom: 88,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 24,
    backgroundColor: KHAKI,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  builderButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  builderIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  builderText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.65,
    color: SURFACE,
  },
});
