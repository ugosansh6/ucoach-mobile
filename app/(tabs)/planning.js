import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
} from 'expo-router';

import { getWeekReadContract } from '../../src/services/weeklyPlanService';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { fontFamilies } from '../../src/constants/typography';

const WEEKDAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const MONTH_LABELS = [
  'JANVIER',
  'FÉVRIER',
  'MARS',
  'AVRIL',
  'MAI',
  'JUIN',
  'JUILLET',
  'AOÛT',
  'SEPTEMBRE',
  'OCTOBRE',
  'NOVEMBRE',
  'DÉCEMBRE',
];

const HUMAN_LABELS = {
  push_vertical: 'Poussée verticale',
  'push vertical': 'Poussée verticale',
  pull_vertical: 'Tirage vertical',
  'pull vertical': 'Tirage vertical',
  push_horizontal: 'Poussée horizontale',
  'push horizontal': 'Poussée horizontale',
  pull_horizontal: 'Tirage horizontal',
  'pull horizontal': 'Tirage horizontal',
  strength: 'Force',
  force: 'Force',
  conditioning: 'Conditioning',
  cardio: 'Cardio',
  skill: 'Technique',
  technique: 'Technique',
  mobility: 'Mobilité',
  mobilite: 'Mobilité',
  hypertrophy: 'Hypertrophie',
  hypertrophie: 'Hypertrophie',
  recovery: 'Récupération',
  recuperation: 'Récupération',
  week_balance: 'Équilibre de la semaine',
  lower_body: 'Bas du corps',
  upper_body: 'Haut du corps',
  full_body: 'Full body',
  legs: 'Jambes',
  jambes: 'Jambes',
  back: 'Dos',
  dos: 'Dos',
  shoulders: 'Épaules',
  epaules: 'Épaules',
  chest: 'Pectoraux',
  pecs: 'Pectoraux',
  core: 'Tronc',
};

function parseDateKey(key) {
  if (!key) return null;
  const parts = String(key).split('-').map(Number);
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}

function toLocalDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfMonday(date = new Date()) {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  const day = copy.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + offset);
  return copy;
}

function buildWeekDays(weekStart) {
  const start = parseDateKey(weekStart) ?? startOfMonday();
  return WEEKDAY_LABELS.map((label, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      label,
      date,
      key: toLocalDateKey(date),
    };
  });
}

function formatWeekRange(weekStart, weekEnd) {
  const start = parseDateKey(weekStart);
  const end = parseDateKey(weekEnd);
  if (!start || !end) return 'CETTE SEMAINE';

  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ${MONTH_LABELS[end.getMonth()]}`;
  }

  return `${start.getDate()} ${MONTH_LABELS[start.getMonth()]} – ${end.getDate()} ${MONTH_LABELS[end.getMonth()]}`;
}

function getPriorityKey(priority) {
  if (!priority) return null;
  if (typeof priority === 'string') return priority;
  if (typeof priority !== 'object') return null;

  return (
    priority.key ??
    priority.priority_key ??
    priority.name ??
    priority.code ??
    priority.focus ??
    null
  );
}

function humanize(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/[àâä]/g, 'a')
    .replace(/[éèêë]/g, 'e')
    .replace(/[îï]/g, 'i')
    .replace(/[ôö]/g, 'o')
    .replace(/[ùûü]/g, 'u')
    .replace(/[-]+/g, '_')
    .replace(/\s+/g, ' ');

  if (HUMAN_LABELS[normalized]) return HUMAN_LABELS[normalized];
  if (HUMAN_LABELS[normalized.replace(/ /g, '_')]) {
    return HUMAN_LABELS[normalized.replace(/ /g, '_')];
  }

  const cleaned = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

function getItemTitle(item) {
  const summary = item?.sessionSummary ?? null;
  const focus = humanize(summary?.focus);
  const region = humanize(summary?.targetRegion);

  if (focus && region && focus.toLowerCase() !== region.toLowerCase()) {
    return `${focus} · ${region}`;
  }
  if (focus) return focus;
  if (region) return region;

  const priority = humanize(getPriorityKey(item?.coachProjection?.priority));
  if (priority) return priority;

  return 'Séance à préciser';
}

function getSourceLabel(code) {
  switch (code) {
    case 'ASSISTED_USER_SESSION':
      return 'COMPOSÉE AVEC UGEROD';
    case 'FREE_USER_SESSION':
      return 'TA SÉANCE';
    case 'SAVED_TEMPLATE_REUSE':
      return 'MES SÉANCES';
    case 'STRUCTURED_PROGRAM':
      return 'PROGRAMME';
    case 'EXTERNAL_ACTIVITY':
      return 'ACTIVITÉ';
    case 'UGEROD_GENERATED_SESSION':
      return 'UGEROD';
    default:
      return null;
  }
}

function getEnvironmentLabel(code) {
  if (!code) return null;
  const normalized = String(code).trim().toLowerCase();
  const labels = {
    home: 'Maison',
    maison: 'Maison',
    box: 'Box',
    gym: 'Salle',
    salle: 'Salle',
    outdoor: 'Extérieur',
    exterieur: 'Extérieur',
    extérieur: 'Extérieur',
  };
  return labels[normalized] ?? humanize(code);
}

function getStateLabel(state) {
  switch (state) {
    case 'PRETE':
      return 'PRÊTE';
    case 'ACTIVE':
      return 'EN COURS';
    case 'REALISEE':
      return 'RÉALISÉE';
    default:
      return 'PRÉVUE';
  }
}

function getStateDescription(state) {
  switch (state) {
    case 'PRETE':
      return 'Le contenu est prêt. UGEROD vérifiera simplement le contexte le jour J.';
    case 'ACTIVE':
      return 'Séance en cours.';
    case 'REALISEE':
      return 'Séance réalisée et prise en compte pour la suite.';
    default:
      return 'Le contenu précis s’ajustera lorsque tu prépareras cette séance.';
  }
}

function getStateTone(state, palette) {
  switch (state) {
    case 'ACTIVE':
      return palette.orange;
    case 'PRETE':
    case 'REALISEE':
      return palette.accent;
    default:
      return palette.textMuted;
  }
}

function buildMeta(item) {
  const duration =
    item?.plannedContext?.durationMinutes ?? item?.sessionSummary?.durationMinutes;
  const environment =
    item?.plannedContext?.environmentCode ??
    item?.sessionSummary?.plannedEnvironmentCode;

  const parts = [];
  if (Number.isFinite(duration) && duration > 0) parts.push(`${duration} min`);
  const environmentLabel = getEnvironmentLabel(environment);
  if (environmentLabel) parts.push(environmentLabel);
  return parts;
}

function getItemDateLabel(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return 'À VENIR';
  const jsDay = date.getDay();
  const weekdayIndex = jsDay === 0 ? 6 : jsDay - 1;
  return `${WEEKDAY_LABELS[weekdayIndex]} ${date.getDate()}`;
}

function WeekIndex({ days, items, palette }) {
  const todayKey = toLocalDateKey(new Date());
  const statesByDate = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      if (!item?.recommendedDate) continue;
      const previous = map.get(item.recommendedDate);
      if (item.displayState === 'ACTIVE') {
        map.set(item.recommendedDate, 'ACTIVE');
      } else if (!previous || previous === 'PREVUE') {
        map.set(item.recommendedDate, item.displayState ?? 'PREVUE');
      }
    }
    return map;
  }, [items]);

  return (
    <View style={styles.weekIndex}>
      {days.map((day) => {
        const state = statesByDate.get(day.key);
        const isToday = day.key === todayKey;
        const markerColor = state ? getStateTone(state, palette) : null;

        return (
          <View key={day.key} style={styles.weekDayCell}>
            <Text style={[styles.weekDayName, { color: palette.textMuted }]}>
              {day.label}
            </Text>
            <View
              style={[
                styles.weekDayNumberWrap,
                isToday && {
                  backgroundColor: palette.accent,
                },
              ]}
            >
              <Text
                style={[
                  styles.weekDayNumber,
                  { color: isToday ? palette.onAccent : palette.text },
                ]}
              >
                {day.date.getDate()}
              </Text>
            </View>
            <View
              style={[
                styles.weekMarker,
                markerColor
                  ? { backgroundColor: markerColor }
                  : { backgroundColor: 'transparent' },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function WeekItem({ item, palette, isLast }) {
  const sourceLabel = getSourceLabel(item?.provenance?.code);
  const meta = buildMeta(item);
  const stateTone = getStateTone(item?.displayState, palette);

  return (
    <View
      style={[
        styles.sessionRow,
        !isLast && { borderBottomColor: palette.border, borderBottomWidth: 1 },
      ]}
      accessibilityRole="summary"
      accessibilityLabel={`${getItemDateLabel(item?.recommendedDate)}, ${getItemTitle(
        item
      )}, ${getStateLabel(item?.displayState)}`}
    >
      <View style={styles.sessionDateColumn}>
        <Text style={[styles.sessionDate, { color: palette.text }]}>
          {getItemDateLabel(item?.recommendedDate)}
        </Text>
        {item?.recommendedDate && item?.recommendedDateIsSoft !== false ? (
          <Text style={[styles.softDateLabel, { color: palette.textMuted }]}>REPÈRE</Text>
        ) : null}
      </View>

      <View style={styles.sessionContent}>
        <View style={styles.sessionTopLine}>
          <View style={[styles.stateDot, { backgroundColor: stateTone }]} />
          <Text style={[styles.stateLabel, { color: stateTone }]}>
            {getStateLabel(item?.displayState)}
          </Text>
          {sourceLabel ? (
            <>
              <View style={[styles.metaSeparator, { backgroundColor: palette.border }]} />
              <Text
                style={[styles.sourceLabel, { color: palette.textMuted }]}
                numberOfLines={1}
              >
                {sourceLabel}
              </Text>
            </>
          ) : null}
        </View>

        <Text style={[styles.sessionTitle, { color: palette.text }]}>
          {getItemTitle(item)}
        </Text>

        {meta.length > 0 ? (
          <Text style={[styles.sessionMeta, { color: palette.textMuted }]}>
            {meta.join('  ·  ')}
          </Text>
        ) : null}

        <Text style={[styles.sessionDescription, { color: palette.textMuted }]}>
          {getStateDescription(item?.displayState)}
        </Text>
      </View>
    </View>
  );
}

export default function PlanningScreen() {
  const { isDark } = useUgerodTheme();
  const params = useLocalSearchParams();
  const action = Array.isArray(params?.action) ? params.action[0] : params?.action;

  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const palette = useMemo(
    () =>
      isDark
        ? {
            bg: '#0A0E0C',
            surface: '#121712',
            surfaceRaised: '#1A211B',
            border: '#273128',
            text: '#F4F2ED',
            textMuted: '#B0B9B0',
            accent: '#87977F',
            accentSoft: '#313B32',
            orange: '#FF6B19',
            onAccent: '#081009',
          }
        : {
            bg: '#F4F2ED',
            surface: '#FFFFFF',
            surfaceRaised: '#F8F7F2',
            border: '#D8D6CF',
            text: '#151B16',
            textMuted: '#697169',
            accent: '#646F5E',
            accentSoft: '#E6E9E2',
            orange: '#FF6B19',
            onAccent: '#FFFFFF',
          },
    [isDark]
  );

  useEffect(() => {
    if (action === 'new') {
      router.replace('/workout/builder');
    }
  }, [action]);

  const loadWeek = useCallback(async ({ refresh = false } = {}) => {
    if (action === 'new') return;

    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const result = await getWeekReadContract({ anchorDate: new Date() });
      setContract(result);
    } catch (loadError) {
      console.warn('[MaSemaine] week_read_contract_v1 failed', loadError);
      setError(loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [action]);

  useFocusEffect(
    useCallback(() => {
      loadWeek();
    }, [loadWeek])
  );

  const visibleItems = contract?.visibleItems ?? [];
  const weekDays = useMemo(
    () => buildWeekDays(contract?.weekStart),
    [contract?.weekStart]
  );
  const weekRange = useMemo(
    () => formatWeekRange(contract?.weekStart, contract?.weekEnd),
    [contract?.weekStart, contract?.weekEnd]
  );

  if (action === 'new') {
    return <View style={{ flex: 1, backgroundColor: palette.bg }} />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadWeek({ refresh: true })}
            tintColor={palette.accent}
          />
        }
      >
        <View style={styles.contentInner}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={[styles.eyebrow, { color: palette.accent }]}>COACH</Text>
              <Text style={[styles.title, { color: palette.text }]}>MA SEMAINE.</Text>
            </View>
            <TouchableOpacity
              style={[
                styles.profileButton,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
              onPress={() => router.push('/profile')}
              accessibilityRole="button"
              accessibilityLabel="Ouvrir mon profil"
            >
              <Ionicons name="person-outline" size={20} color={palette.text} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.intro, { color: palette.textMuted }]}>
            Ce qu’UGEROD envisage pour tes prochains entraînements. Les jours restent
            souples.
          </Text>

          <View style={styles.rangeLine}>
            <Text style={[styles.rangeLabel, { color: palette.text }]}>{weekRange}</Text>
            {contract?.completedActualCount > 0 ? (
              <Text style={[styles.actualLabel, { color: palette.textMuted }]}>
                {contract.completedActualCount}{' '}
                {contract.completedActualCount > 1 ? 'séances réalisées' : 'séance réalisée'}
              </Text>
            ) : null}
          </View>

          <WeekIndex days={weekDays} items={visibleItems} palette={palette} />

          {loading && !contract ? (
            <View style={styles.feedbackBlock}>
              <ActivityIndicator color={palette.accent} size="small" />
              <Text style={[styles.feedbackText, { color: palette.textMuted }]}>
                UGEROD prépare la lecture de ta semaine…
              </Text>
            </View>
          ) : error && !contract ? (
            <View style={styles.feedbackBlock}>
              <Text style={[styles.feedbackTitle, { color: palette.text }]}>
                Impossible de charger la semaine.
              </Text>
              <TouchableOpacity
                style={[styles.retryButton, { borderColor: palette.border }]}
                onPress={() => loadWeek()}
                accessibilityRole="button"
              >
                <Text style={[styles.retryText, { color: palette.text }]}>RÉESSAYER</Text>
              </TouchableOpacity>
            </View>
          ) : visibleItems.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Text style={[styles.emptyTitle, { color: palette.text }]}>RIEN À AFFICHER POUR L’INSTANT.</Text>
              <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                UGEROD ajustera la suite au fil de tes entraînements.
              </Text>
            </View>
          ) : (
            <View style={styles.editorialStack}>
              {visibleItems.map((item, index) => (
                <WeekItem
                  key={item.planItemId ?? `${item.sequenceIndex ?? index}-${index}`}
                  item={item}
                  palette={palette}
                  isLast={index === visibleItems.length - 1}
                />
              ))}
            </View>
          )}

          <View
            style={[
              styles.coachNote,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <View style={[styles.coachIcon, { backgroundColor: palette.accentSoft }]}>
              <Ionicons name="sparkles-outline" size={18} color={palette.accent} />
            </View>
            <View style={styles.coachNoteBody}>
              <Text style={[styles.coachNoteTitle, { color: palette.text }]}>À RETENIR</Text>
              <Text style={[styles.coachNoteText, { color: palette.textMuted }]}>
                Les jours sont des repères, pas des obligations. UGEROD réajuste la suite à
                partir de ce que tu fais réellement.
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.createButton, { borderColor: palette.accent }]}
            onPress={() => router.push('/workout/builder')}
            accessibilityRole="button"
            accessibilityLabel="Créer une séance"
          >
            <Ionicons name="add" size={19} color={palette.accent} />
            <Text style={[styles.createButtonText, { color: palette.accent }]}>CRÉER UNE SÉANCE</Text>
          </TouchableOpacity>

          <Text style={[styles.readOnlyHint, { color: palette.textMuted }]}>Lecture seule · W11.2</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 44,
  },
  contentInner: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    fontFamily: fontFamilies.bold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.8,
    marginBottom: 3,
  },
  title: {
    fontFamily: fontFamilies.display,
    fontSize: 38,
    lineHeight: 41,
    letterSpacing: 1.4,
  },
  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intro: {
    fontFamily: fontFamilies.regular,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 560,
    marginTop: 10,
  },
  rangeLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 30,
    marginBottom: 12,
  },
  rangeLabel: {
    fontFamily: fontFamilies.bold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.8,
  },
  actualLabel: {
    fontFamily: fontFamilies.medium,
    fontSize: 12,
    lineHeight: 17,
  },
  weekIndex: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginHorizontal: -3,
    marginBottom: 28,
  },
  weekDayCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  weekDayName: {
    fontFamily: fontFamilies.semiBold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  weekDayNumberWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekDayNumber: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
    lineHeight: 18,
  },
  weekMarker: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 7,
  },
  editorialStack: {
    width: '100%',
  },
  sessionRow: {
    flexDirection: 'row',
    paddingVertical: 20,
  },
  sessionDateColumn: {
    width: 74,
    paddingRight: 14,
  },
  sessionDate: {
    fontFamily: fontFamilies.bold,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.5,
  },
  softDateLabel: {
    fontFamily: fontFamilies.semiBold,
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 1.1,
    marginTop: 3,
  },
  sessionContent: {
    flex: 1,
    minWidth: 0,
  },
  sessionTopLine: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  stateDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 7,
  },
  stateLabel: {
    fontFamily: fontFamilies.bold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
  },
  metaSeparator: {
    width: 1,
    height: 10,
    marginHorizontal: 9,
  },
  sourceLabel: {
    flexShrink: 1,
    fontFamily: fontFamilies.semiBold,
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.8,
  },
  sessionTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: 0.7,
  },
  sessionMeta: {
    fontFamily: fontFamilies.semiBold,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  sessionDescription: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
    maxWidth: 520,
  },
  feedbackBlock: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 12,
  },
  feedbackTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  feedbackText: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontFamily: fontFamilies.bold,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.7,
  },
  emptyBlock: {
    minHeight: 170,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emptyTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 25,
    lineHeight: 29,
    letterSpacing: 0.7,
  },
  emptyText: {
    fontFamily: fontFamilies.regular,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
    maxWidth: 480,
  },
  coachNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginTop: 28,
  },
  coachIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  coachNoteBody: {
    flex: 1,
  },
  coachNoteTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1,
    marginBottom: 4,
  },
  coachNoteText: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 20,
  },
  createButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 18,
  },
  createButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.8,
  },
  readOnlyHint: {
    fontFamily: fontFamilies.medium,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 14,
    opacity: 0.65,
  },
});
