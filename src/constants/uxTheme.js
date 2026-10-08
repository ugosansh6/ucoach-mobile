export const UGEROD_THEME_MODES = {
  DARK: 'dark',
  LIGHT: 'light',
};

export const UGEROD_BRAND_COLORS = {
  khaki: '#646F5E',
  orange: '#FF6B19',
};

const KHAKI_SOFT = 'rgba(100, 111, 94, 0.14)';
const KHAKI_SOFT_LIGHT = 'rgba(100, 111, 94, 0.12)';
const ORANGE_SOFT = 'rgba(255, 107, 25, 0.14)';

export const ugerodThemes = {
  dark: {
    mode: UGEROD_THEME_MODES.DARK,
    isDark: true,
    accentName: 'kaki',
    secondaryAccentName: 'orange',
    colors: {
      background: '#07090C',
      surface: '#11151A',
      surfaceElevated: '#171C22',
      surfacePressed: '#1E252D',

      // Identité UGEROD commune aux deux thèmes : kaki + orange.
      accent: UGEROD_BRAND_COLORS.khaki,
      accentStrong: UGEROD_BRAND_COLORS.khaki,
      accentSoft: KHAKI_SOFT,

      secondaryAccent: UGEROD_BRAND_COLORS.orange,
      secondaryAccentStrong: UGEROD_BRAND_COLORS.orange,
      secondaryAccentSoft: ORANGE_SOFT,

      text: '#F7F9FC',
      textSecondary: '#AEB7AD',
      textMuted: '#7E897D',
      textDisabled: '#566056',
      textOnAccent: '#FFFFFF',

      border: '#29312B',
      borderStrong: '#3D473E',
      inputDisabled: '#0B0E0C',

      success: UGEROD_BRAND_COLORS.khaki,
      successSoft: KHAKI_SOFT_LIGHT,
      warning: UGEROD_BRAND_COLORS.orange,
      warningSoft: ORANGE_SOFT,
      error: UGEROD_BRAND_COLORS.orange,
      errorSoft: ORANGE_SOFT,

      warningBorder: 'rgba(255, 107, 25, 0.30)',
      warningIconBackground: 'rgba(255, 107, 25, 0.08)',
      logoutBorder: 'rgba(255, 107, 25, 0.34)',
      logoutPressed: 'rgba(255, 107, 25, 0.20)',
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

      // Même identité de marque que le thème sombre.
      accent: UGEROD_BRAND_COLORS.khaki,
      accentStrong: UGEROD_BRAND_COLORS.khaki,
      accentSoft: KHAKI_SOFT,

      secondaryAccent: UGEROD_BRAND_COLORS.orange,
      secondaryAccentStrong: UGEROD_BRAND_COLORS.orange,
      secondaryAccentSoft: ORANGE_SOFT,

      text: '#171A15',
      textSecondary: '#50584B',
      textMuted: '#747C70',
      textDisabled: '#9AA095',
      textOnAccent: '#FFFFFF',

      border: '#D9DED3',
      borderStrong: '#C7CDBF',
      inputDisabled: '#F1F2EE',

      success: UGEROD_BRAND_COLORS.khaki,
      successSoft: KHAKI_SOFT_LIGHT,
      warning: UGEROD_BRAND_COLORS.orange,
      warningSoft: ORANGE_SOFT,
      error: UGEROD_BRAND_COLORS.orange,
      errorSoft: ORANGE_SOFT,

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
