export const UGEROD_THEME_MODES = {
  DARK: 'dark',
  LIGHT: 'light',
};

export const ugerodThemes = {
  dark: {
    mode: UGEROD_THEME_MODES.DARK,
    isDark: true,
    accentName: 'bleu',
    secondaryAccentName: 'rouge',
    colors: {
      background: '#07090C',
      surface: '#11151A',
      surfaceElevated: '#171C22',
      surfacePressed: '#1E252D',

      // Palette historique UGEROD : bleu + rouge.
      accent: '#0868FF',
      accentStrong: '#1D8CFF',
      accentSoft: 'rgba(8, 104, 255, 0.14)',

      secondaryAccent: '#FF3B3B',
      secondaryAccentStrong: '#FF6B6B',
      secondaryAccentSoft: 'rgba(255, 59, 59, 0.14)',

      text: '#F7F9FC',
      textSecondary: '#98A2B3',
      textMuted: '#667085',
      textDisabled: '#475467',
      textOnAccent: '#FFFFFF',

      border: '#29313A',
      borderStrong: '#3A4550',
      inputDisabled: '#0B0E12',

      success: '#24C875',
      successSoft: 'rgba(36, 200, 117, 0.14)',
      warning: '#F5A623',
      warningSoft: 'rgba(245, 166, 35, 0.14)',
      error: '#FF3B3B',
      errorSoft: 'rgba(255, 59, 59, 0.14)',

      warningBorder: '#6B4A19',
      warningIconBackground: '#2A2112',
      logoutBorder: '#6D2A2A',
      logoutPressed: '#351818',
      shadow: '#000000',
    },
  },

  light: {
    mode: UGEROD_THEME_MODES.LIGHT,
    isDark: false,
    accentName: 'kaki',
    secondaryAccentName: 'orange',
    colors: {
      background: '#FFFFFF',
      surface: '#F7F8F3',
      surfaceElevated: '#FFFFFF',
      surfacePressed: '#EEF1ED',

      // Palette claire UGEROD : kaki #646F5E + orange vif #FF6B19.
      accent: '#646F5E',
      accentStrong: '#646F5E',
      accentSoft: 'rgba(100, 111, 94, 0.14)',

      secondaryAccent: '#FF6B19',
      secondaryAccentStrong: '#FF6B19',
      secondaryAccentSoft: 'rgba(255, 107, 25, 0.14)',

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
      warning: '#FF6B19',
      warningSoft: 'rgba(255, 107, 25, 0.14)',
      error: '#FF6B19',
      errorSoft: 'rgba(255, 107, 25, 0.14)',

      warningBorder: 'rgba(255, 107, 25, 0.30)',
      warningIconBackground: 'rgba(255, 107, 25, 0.08)',
      logoutBorder: 'rgba(255, 107, 25, 0.34)',
      logoutPressed: 'rgba(255, 107, 25, 0.20)',
      shadow: '#000000',
    },
  },
};

export function getUgerodTheme(mode) {
  return ugerodThemes[mode] ?? ugerodThemes.dark;
}
