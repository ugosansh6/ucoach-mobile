import { colors } from './colors';
import { radius, sizes, spacing } from './spacing';
import {
  fontFamilies,
  fontWeights,
  typography,
} from './typography';

export const shadows = {
  none: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },

  small: {
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },

  medium: {
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 7,
  },

  blueGlow: {
    shadowColor: colors.primary,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
};

export const theme = {
  colors,
  spacing,
  radius,
  sizes,
  typography,
  fontFamilies,
  fontWeights,
  shadows,
};