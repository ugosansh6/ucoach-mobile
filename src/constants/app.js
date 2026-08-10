export const APP_NAME = 'UGEROD';

export const APP_VERSION = '1.0.0';

export const APP_TAGLINE = {
  line1: 'TON OBJECTIF.',
  line2: 'TA SÉANCE.',
  line3: 'TON ÉVOLUTION.',
};

export const APP_DESCRIPTION =
  'Une séance adaptée à ton niveau, ton matériel et ta forme du jour.';

export const WEEKLY_SESSION_OPTIONS = [2, 3, 4, 5, 6];

export const DURATION_OPTIONS = [
  {
    label: '30 MIN',
    value: 30,
  },
  {
    label: '45 MIN',
    value: 45,
  },
  {
    label: '60 MIN',
    value: 60,
  },
  {
    label: '1 H 15',
    value: 75,
  },
  {
    label: '1 H 30',
    value: 90,
  },
];

export const EXPERIENCE_OPTIONS = [
  {
    label: 'DÉBUTANT',
    value: 'beginner',
    description:
      'Je découvre ou je reprends après une longue pause.',
  },
  {
    label: 'INTERMÉDIAIRE',
    value: 'intermediate',
    description:
      'Je m’entraîne régulièrement et je maîtrise les bases.',
  },
  {
    label: 'AVANCÉ',
    value: 'advanced',
    description:
      'Je maîtrise les mouvements techniques et les charges.',
  },
];

export const READINESS_OPTIONS = Array.from(
  { length: 10 },
  (_, index) => index + 1
);

export const INJURY_OPTIONS = [
  'Poignet',
  'Coude',
  'Épaule',
  'Genou',
  'Bas du dos',
];

export const REGION_PREFERENCES = [
  {
    label: 'HAUT DU CORPS',
    value: 'Upper',
  },
  {
    label: 'BAS DU CORPS',
    value: 'Lower',
  },
  {
    label: 'CORPS ENTIER',
    value: 'Full Body',
  },
  {
    label: 'CORE',
    value: 'Core',
  },
];

export const EXERCISE_STATUS = {
  PENDING: 'pending',
  SKIPPED: 'skipped',
  COMPLETED: 'completed',
};

export const WORKOUT_BLOCK_KEYS = {
  WARM_UP: 'warm_up',
  TABATA: 'tabata',
  SKILL: 'skill',
  WOD: 'wod',
};