export const UGEROD_THEME_MODES = {
  DARK: 'dark',
  LIGHT: 'light',
};

const shared = {
  accentName: 'kaki',
  secondaryAccentName: 'orange',
};

export const ugerodThemes = {
  dark: {
    ...shared,
    mode: UGEROD_THEME_MODES.DARK,
    isDark: true,
    colors: {
      background: '#07090C',
      surface: '#11151A',
      surfaceElevated: '#171C22',
      surfacePressed: '#1E252D',

      accent: '#66734D',
      accentStrong: '#9AA77D',
      accentSoft: '#252C1E',

      secondaryAccent: '#D86D2B',
      secondaryAccentStrong: '#F09A61',
      secondaryAccentSoft: '#2D1B12',

      text: '#F7F9F4',
      textSecondary: '#C0C7BA',
      textMuted: '#8C9587',
      textDisabled: '#626A5F',
      textOnAccent: '#FFFFFF',

      border: '#2B3328',
      borderStrong: '#3B4537',
      inputDisabled: '#0D1013',

      success: '#7E9B72',
      successSoft: '#1C281A',
      warning: '#E18449',
      warningSoft: '#2D1B12',
      error: '#E18449',
      errorSoft: '#2D1B12',

      warningBorder: '#6A3C22',
      warningIconBackground: '#382218',
      logoutBorder: '#6A3C22',
      logoutPressed: '#382218',
      shadow: '#000000',
    },
  },

  light: {
    ...shared,
    mode: UGEROD_THEME_MODES.LIGHT,
    isDark: false,
    colors: {
      background: '#FFFFFF',
      surface: '#F7F8F3',
      surfaceElevated: '#FFFFFF',
      surfacePressed: '#EEF1E7',

      accent: '#66734D',
      accentStrong: '#4D5938',
      accentSoft: '#E9EDDF',

      secondaryAccent: '#D86D2B',
      secondaryAccentStrong: '#B9571F',
      secondaryAccentSoft: '#FBE9DE',

      text: '#171A15',
      textSecondary: '#50584B',
      textMuted: '#747C70',
      textDisabled: '#9AA095',
      textOnAccent: '#FFFFFF',

      border: '#D9DED3',
      borderStrong: '#C7CDBF',
      inputDisabled: '#F1F2EE',

      success: '#527A55',
      successSoft: '#E7F0E5',
      warning: '#D86D2B',
      warningSoft: '#FBE9DE',
      error: '#D86D2B',
      errorSoft: '#FBE9DE',

      warningBorder: '#F0C6AA',
      warningIconBackground: '#FFF6EF',
      logoutBorder: '#E9B793',
      logoutPressed: '#F8DDCA',
      shadow: '#000000',
    },
  },
};

export function getUgerodTheme(mode) {
  return ugerodThemes[mode] ?? ugerodThemes.dark;
}
