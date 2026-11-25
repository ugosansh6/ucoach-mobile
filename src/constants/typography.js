export const fontFamilies = {
  // Titres / display UGEROD : on conserve Bebas Neue.
  display: 'BebasNeue_400Regular',

  // Manrope remplace uniquement l'ancienne famille Oswald.
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semiBold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extraBold: 'Manrope_800ExtraBold',

  interface: 'Manrope_400Regular',
  interfaceStrong: 'Manrope_700Bold',

  // Alias de compatibilité : tout ancien usage Oswald bascule vers Manrope.
  oswaldRegular: 'Manrope_400Regular',
  oswaldMedium: 'Manrope_500Medium',
  oswaldSemiBold: 'Manrope_600SemiBold',
  oswaldBold: 'Manrope_700Bold',

  // Alias sémantique pour les grosses métriques sportives.
  sportMetric: 'BebasNeue_400Regular',
};

export const fontWeights = {
  regular: '400',
  medium: '500',
  semiBold: '600',
  bold: '700',
  extraBold: '800',
};

export const typography = {
  // Bebas Neue reste la police de display / grands titres.
  hero: {
    fontFamily: fontFamilies.display,
    fontSize: 42,
    lineHeight: 44,
    letterSpacing: 1.6,
  },

  display: {
    fontFamily: fontFamilies.display,
    fontSize: 36,
    lineHeight: 39,
    letterSpacing: 1.3,
  },

  screenTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 30,
    lineHeight: 33,
    letterSpacing: 1.1,
  },

  // Ces usages étaient historiquement Oswald : ils deviennent Manrope.
  sectionTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: 0.4,
  },

  cardTitle: {
    fontFamily: fontFamilies.semiBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 0.3,
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
    letterSpacing: 0.7,
  },

  // Les boutons display qui étaient en Bebas le restent.
  button: {
    fontFamily: fontFamilies.display,
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: 1.1,
  },

  caption: {
    fontFamily: fontFamilies.medium,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.25,
  },

  metric: {
    fontFamily: fontFamilies.display,
    fontSize: 34,
    lineHeight: 37,
    letterSpacing: 0.8,
  },

  metricHero: {
    fontFamily: fontFamilies.display,
    fontSize: 58,
    lineHeight: 64,
    letterSpacing: 0.8,
  },
};
