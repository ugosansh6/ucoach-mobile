export const fontFamilies = {
  display: 'BebasNeue_400Regular',

  oswaldRegular: 'Oswald_400Regular',
  oswaldMedium: 'Oswald_500Medium',
  oswaldSemiBold: 'Oswald_600SemiBold',
  oswaldBold: 'Oswald_700Bold',
};

export const typography = {
  // Gros slogans :
  // TON OBJECTIF
  // BON RETOUR
  // REJOINS UGEROD
  hero: {
    fontFamily: fontFamilies.display,
    fontSize: 42,
    lineHeight: 44,
    letterSpacing: 1.6,
  },

  // Gros titres d'écran
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

  // Titres de sections
  sectionTitle: {
    fontFamily: fontFamilies.oswaldBold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: 0.4,
  },

  cardTitle: {
    fontFamily: fontFamilies.oswaldSemiBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 0.3,
  },

  // Texte courant
  bodyLarge: {
    fontFamily: fontFamilies.oswaldRegular,
    fontSize: 17,
    lineHeight: 24,
  },

  body: {
    fontFamily: fontFamilies.oswaldRegular,
    fontSize: 15,
    lineHeight: 22,
  },

  bodySmall: {
    fontFamily: fontFamilies.oswaldRegular,
    fontSize: 13,
    lineHeight: 19,
  },

  // E-MAIL, MOT DE PASSE, DURÉE, etc.
  label: {
    fontFamily: fontFamilies.oswaldSemiBold,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.7,
  },

  // Boutons principaux
  button: {
    fontFamily: fontFamilies.display,
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: 1.1,
  },

  caption: {
    fontFamily: fontFamilies.oswaldMedium,
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
};