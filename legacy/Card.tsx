import React from 'react';
import { View, StyleSheet, ViewStyle, TouchableOpacity } from 'react-native';
import { COLORS, RADIUS } from '../theme/colors';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  accentColor?: string;
  active?: boolean;
}

export const Card: React.FC<CardProps> = ({ 
  children, 
  style, 
  onPress, 
  accentColor,
  active = false 
}) => {
  const Container = onPress ? TouchableOpacity : View;

  return (
    <Container 
      style={[
        styles.card, 
        accentColor ? { borderLeftWidth: 4, borderLeftColor: accentColor } : null,
        active && styles.activeCard,
        style
      ]} 
      onPress={onPress}
      activeOpacity={0.85}
    >
      {children}
    </Container>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  activeCard: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surfaceLight,
  },
});