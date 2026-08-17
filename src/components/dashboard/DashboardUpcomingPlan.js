import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../constants';

const REGION_LABELS = {
  Upper: 'HAUT DU CORPS',
  Lower: 'BAS DU CORPS',
  Core: 'CORE',
  'Full Body': 'CORPS ENTIER',
};

const INTENT_LABELS = {
  PROGRESS: 'PROGRESSER',
  CONSOLIDATE: 'CONSOLIDER',
  DELOAD: 'RÉCUPÉRER',
  RECALIBRATE: 'RECALIBRER',
  EXPLORE: 'VARIER / EXPLORER',
  MAINTAIN: 'ENTRETENIR',
};

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey ?? '')
    .split('-')
    .map(Number);

  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getTodayKey() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function humanize(value, fallback) {
  if (!value) {
    return fallback;
  }

  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function formatDate(dateKey) {
  const date = parseDateKey(dateKey);

  if (!date) {
    return {
      day: '—',
      number: '--',
    };
  }

  return {
    day: date
      .toLocaleDateString('fr-FR', { weekday: 'short' })
      .replace(/\./g, '')
      .toUpperCase(),
    number: String(date.getDate()).padStart(2, '0'),
  };
}

function normalizeUpcoming(weekDays) {
  if (!Array.isArray(weekDays)) {
    return [];
  }

  const todayKey = getTodayKey();

  return weekDays
    .filter((item) => {
      const status = String(item?.plan_status ?? '').toLowerCase();

      return (
        item?.planned === true &&
        item?.completed !== true &&
        String(item?.date ?? '') > todayKey &&
        (!status || status === 'available' || status === 'claimed')
      );
    })
    .sort((a, b) => String(a?.date ?? '').localeCompare(String(b?.date ?? '')));
}

export default function DashboardUpcomingPlan({ weekDays }) {
  const upcoming = normalizeUpcoming(weekDays);

  if (upcoming.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        LA SUITE DE TA SEMAINE
      </Text>

      <View style={styles.card}>
        {upcoming.map((item, index) => {
          const date = formatDate(item?.date);
          const region =
            REGION_LABELS[item?.planned_target_region] ??
            humanize(
              item?.planned_target_region ?? item?.planned_focus,
              'SÉANCE ADAPTATIVE'
            );
          const intent =
            INTENT_LABELS[String(item?.planned_progression_intent ?? '').toUpperCase()] ??
            humanize(item?.planned_progression_intent, 'CONSTRUIRE');

          return (
            <View key={item?.plan_item_id ?? item?.date ?? index}>
              <View style={styles.row}>
                <View style={styles.dateBadge}>
                  <Text style={styles.dateDay}>{date.day}</Text>
                  <Text style={styles.dateNumber}>{date.number}</Text>
                </View>

                <View style={styles.rowMain}>
                  <Text style={styles.region}>{region}</Text>
                  <View style={styles.intentRow}>
                    <View style={styles.intentDot} />
                    <Text style={styles.intent}>{intent}</Text>
                  </View>
                </View>

                <View style={styles.orientationIcon}>
                  <Ionicons
                    name="compass-outline"
                    size={19}
                    color={colors.primaryLight}
                  />
                </View>
              </View>

              {index < upcoming.length - 1 && (
                <View style={styles.divider} />
              )}
            </View>
          );
        })}

        <View style={styles.noteRow}>
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={colors.textMuted}
          />
          <Text style={styles.note}>
            Les jours sont indicatifs. UGEROD adapte ta séance au moment où tu t’entraînes.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 26,
  },
  sectionTitle: {
    marginBottom: 11,
    fontFamily: 'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  card: {
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  row: {
    minHeight: 78,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  dateBadge: {
    width: 48,
    height: 52,
    borderRadius: 13,
    backgroundColor: 'rgba(8,104,255,0.11)',
    borderWidth: 1,
    borderColor: 'rgba(29,140,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateDay: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.9,
    color: colors.primaryLight,
  },
  dateNumber: {
    marginTop: 1,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 23,
    lineHeight: 25,
    color: colors.textPrimary,
  },
  rowMain: {
    flex: 1,
  },
  region: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 23,
    lineHeight: 26,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  intentRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  intentDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.brandRed,
  },
  intent: {
    flexShrink: 1,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.65,
    color: colors.textSecondary,
  },
  orientationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(8,104,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    marginLeft: 77,
    marginRight: 16,
    backgroundColor: 'rgba(255,255,255,0.065)',
  },
  noteRow: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(7,9,12,0.22)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  note: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
  },
});
