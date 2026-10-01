export const fontFamilies = {
  // Interface UGEROD
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semiBold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extraBold: 'Manrope_800ExtraBold',

  // Alias sémantiques.
  interface: 'Manrope_400Regular',
  interfaceStrong: 'Manrope_700Bold',
  display: 'Manrope_800ExtraBold',

  // Réservé aux grosses données sportives : chrono, compteur, métrique.
  sportMetric: 'BebasNeue_400Regular',

  // Compatibilité temporaire avec d’anciens consommateurs de tokens.
  // Ces alias rendent désormais du Manrope : Oswald ne fait plus partie du
  // contrat visuel du nouveau player.
  oswaldRegular: 'Manrope_400Regular',
  oswaldMedium: 'Manrope_500Medium',
  oswaldSemiBold: 'Manrope_600SemiBold',
  oswaldBold: 'Manrope_700Bold',
};

export const fontWeights = {
  regular: '400',
  medium: '500',
  semiBold: '600',
  bold: '700',
  extraBold: '800',
};

export const typography = {
  // Les titres font partie de l’interface : Manrope.
  hero: {
    fontFamily: fontFamilies.extraBold,
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: -0.8,
  },

  display: {
    fontFamily: fontFamilies.extraBold,
    fontSize: 36,
    lineHeight: 41,
    letterSpacing: -0.7,
  },

  screenTitle: {
    fontFamily: fontFamilies.extraBold,
    fontSize: 30,
    lineHeight: 35,
    letterSpacing: -0.5,
  },

  sectionTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.2,
  },

  cardTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.1,
  },

  bodyLarge: {
    fontFamily: fontFamilies.regular,
    fontSize: 17,
    lineHeight: 24,
  },

  body: {
    fontFamily: fontFamilies.regular,
    fontSize: 15,
    lineHeight: 22,
  },

  bodySmall: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 19,
  },

  label: {
    fontFamily: fontFamilies.semiBold,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.35,
  },

  button: {
    fontFamily: fontFamilies.extraBold,
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: 0.25,
  },

  caption: {
    fontFamily: fontFamilies.medium,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.1,
  },

  // Bebas Neue est réservé à la lecture sportive instantanée.
  metric: {
    fontFamily: fontFamilies.sportMetric,
    fontSize: 34,
    lineHeight: 37,
    letterSpacing: 0.8,
  },

  metricHero: {
    fontFamily: fontFamilies.sportMetric,
    fontSize: 58,
    lineHeight: 64,
    letterSpacing: 0.8,
  },
};
