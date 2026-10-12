import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
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

import {
  getWeekReadContract,
  moveWeekPlanItem,
} from '../../src/services/weeklyPlanService';
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

function canMoveWeekItem(item) {
  return Boolean(
    item?.planItemId &&
      item?.recommendedDate &&
      item?.recommendedDateIsSoft !== false &&
      (item?.displayState === 'PREVUE' || item?.displayState === 'PRETE')
  );
}

function sortWeekItemsForDisplay(items) {
  return [...items].sort((a, b) => {
    const dateCompare = String(a?.recommendedDate ?? '').localeCompare(
      String(b?.recommendedDate ?? '')
    );
    if (dateCompare !== 0) return dateCompare;
    return Number(a?.sequenceIndex ?? 999) - Number(b?.sequenceIndex ?? 999);
  });
}

function withOptimisticWeekDate(contract, planItemId, targetDate) {
  if (!contract) return contract;
  const move = (item) =>
    item?.planItemId === planItemId
      ? { ...item, recommendedDate: targetDate, recommendedDateIsSoft: true }
      : item;

  return {
    ...contract,
    items: Array.isArray(contract.items) ? contract.items.map(move) : [],
    visibleItems: Array.isArray(contract.visibleItems)
      ? contract.visibleItems.map(move)
      : [],
  };
}

function WeekIndex({
  days,
  items,
  palette,
  dragActive = false,
  dropTargetDate = null,
  compact = false,
}) {
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
    <View style={[styles.weekIndex, compact && styles.weekIndexCompact]}>
      {days.map((day) => {
        const state = statesByDate.get(day.key);
        const isToday = day.key === todayKey;
        const isDropTarget = dropTargetDate === day.key;
        const markerColor = state ? getStateTone(state, palette) : null;

        return (
          <View
            key={day.key}
            style={[
              styles.weekDayCell,
              dragActive && styles.weekDayCellDragReady,
              dragActive && {
                borderColor: isDropTarget ? palette.accent : palette.border,
                backgroundColor: isDropTarget ? palette.accentSoft : 'transparent',
              },
              isDropTarget && styles.weekDayCellDropTarget,
            ]}
          >
            <Text
              style={[
                styles.weekDayName,
                { color: isDropTarget ? palette.accent : palette.textMuted },
              ]}
            >
              {day.label}
            </Text>
            <View
              style={[
                styles.weekDayNumberWrap,
                isToday && !dragActive && {
                  backgroundColor: palette.accent,
                },
                isDropTarget && { backgroundColor: palette.accent },
              ]}
            >
              <Text
                style={[
                  styles.weekDayNumber,
                  {
                    color:
                      isDropTarget || (isToday && !dragActive)
                        ? palette.onAccent
                        : palette.text,
                  },
                ]}
              >
                {day.date.getDate()}
              </Text>
            </View>
            {!compact ? (
              <View
                style={[
                  styles.weekMarker,
                  markerColor
                    ? { backgroundColor: markerColor }
                    : { backgroundColor: 'transparent' },
                ]}
              />
            ) : null}
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

function DraggableWeekItem({
  item,
  palette,
  isLast,
  moving,
  onDragArm,
  onDragMove,
  onDragDrop,
  onDragCancel,
  onAccessibilityMove,
}) {
  const movable = canMoveWeekItem(item) && !moving;
  const translation = useRef(new Animated.ValueXY()).current;
  const armedRef = useRef(false);
  const panActiveRef = useRef(false);
  const [lifted, setLifted] = useState(false);

  const resetPosition = useCallback(() => {
    Animated.spring(translation, {
      toValue: { x: 0, y: 0 },
      speed: 24,
      bounciness: 4,
      useNativeDriver: false,
    }).start();
  }, [translation]);

  const releaseDrag = useCallback(() => {
    armedRef.current = false;
    panActiveRef.current = false;
    setLifted(false);
    resetPosition();
  }, [resetPosition]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: () => movable && armedRef.current,
        onPanResponderGrant: () => {
          panActiveRef.current = true;
          setLifted(true);
        },
        onPanResponderMove: (_event, gestureState) => {
          translation.setValue({ x: gestureState.dx, y: gestureState.dy });
          onDragMove?.(gestureState.moveX, gestureState.moveY);
        },
        onPanResponderRelease: (_event, gestureState) => {
          onDragDrop?.(item, gestureState.moveX, gestureState.moveY);
          releaseDrag();
        },
        onPanResponderTerminate: () => {
          onDragCancel?.(item);
          releaseDrag();
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [item, movable, onDragCancel, onDragDrop, onDragMove, releaseDrag, translation]
  );

  const handleLongPress = useCallback(() => {
    if (!movable) return;
    armedRef.current = true;
    setLifted(true);
    onDragArm?.(item);
  }, [item, movable, onDragArm]);

  const handlePressOut = useCallback(() => {
    setTimeout(() => {
      if (armedRef.current && !panActiveRef.current) {
        onDragCancel?.(item);
        releaseDrag();
      }
    }, 0);
  }, [item, onDragCancel, releaseDrag]);

  const accessibilityActions = movable
    ? [
        { name: 'decrement', label: 'Déplacer au jour précédent' },
        { name: 'increment', label: 'Déplacer au jour suivant' },
      ]
    : [];

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.draggableWeekItem,
        lifted && {
          zIndex: 80,
          elevation: 8,
          backgroundColor: palette.surfaceRaised,
          shadowColor: '#000000',
          shadowOpacity: 0.18,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
        },
        moving && styles.draggableWeekItemMoving,
        {
          transform: [
            { translateX: translation.x },
            { translateY: translation.y },
            { scale: lifted ? 1.018 : 1 },
          ],
        },
      ]}
    >
      <Pressable
        delayLongPress={360}
        disabled={!movable}
        onLongPress={handleLongPress}
        onPressOut={handlePressOut}
        accessible
        focusable={movable}
        accessibilityRole="summary"
        accessibilityLabel={`${getItemDateLabel(item?.recommendedDate)}, ${getItemTitle(
          item
        )}, ${getStateLabel(item?.displayState)}`}
        accessibilityHint={
          movable
            ? 'Appui long puis glisse vers un autre jour de cette semaine.'
            : undefined
        }
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={(event) => {
          const name = event?.nativeEvent?.actionName;
          if (name === 'decrement') onAccessibilityMove?.(item, -1);
          if (name === 'increment') onAccessibilityMove?.(item, 1);
        }}
      >
        <WeekItem item={item} palette={palette} isLast={isLast} />
      </Pressable>
    </Animated.View>
  );
}

function DragTargetTray({ days, items, palette, targetDate, trayRef, onLayout }) {
  return (
    <View
      ref={trayRef}
      collapsable={false}
      pointerEvents="none"
      onLayout={onLayout}
      style={[
        styles.dragTargetTray,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.dragTargetHeader}>
        <Ionicons name="move-outline" size={16} color={palette.accent} />
        <Text style={[styles.dragTargetLabel, { color: palette.text }]}>DÉPOSE SUR UN JOUR</Text>
      </View>
      <WeekIndex
        days={days}
        items={items}
        palette={palette}
        dragActive
        dropTargetDate={targetDate}
        compact
      />
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
  const [draggingItem, setDraggingItem] = useState(null);
  const [dropTargetDate, setDropTargetDate] = useState(null);
  const [movingItemId, setMovingItemId] = useState(null);
  const [moveFeedback, setMoveFeedback] = useState(null);
  const dropTrayRef = useRef(null);
  const dropTrayRectRef = useRef(null);
  const feedbackTimerRef = useRef(null);

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

  useEffect(
    () => () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    },
    []
  );

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

  const visibleItems = useMemo(
    () => sortWeekItemsForDisplay(contract?.visibleItems ?? []),
    [contract?.visibleItems]
  );
  const weekDays = useMemo(
    () => buildWeekDays(contract?.weekStart),
    [contract?.weekStart]
  );
  const weekRange = useMemo(
    () => formatWeekRange(contract?.weekStart, contract?.weekEnd),
    [contract?.weekStart, contract?.weekEnd]
  );

  const clearDragState = useCallback(() => {
    setDraggingItem(null);
    setDropTargetDate(null);
    dropTrayRectRef.current = null;
  }, []);

  const showMoveFeedback = useCallback((text, tone = 'neutral') => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setMoveFeedback({ text, tone });
    feedbackTimerRef.current = setTimeout(() => {
      setMoveFeedback(null);
      feedbackTimerRef.current = null;
    }, 3600);
  }, []);

  const measureDropTray = useCallback(() => {
    requestAnimationFrame(() => {
      dropTrayRef.current?.measureInWindow?.((x, y, width, height) => {
        if (width > 0 && height > 0) {
          dropTrayRectRef.current = { x, y, width, height };
        }
      });
    });
  }, []);

  const resolveDropTarget = useCallback(
    (pageX, pageY) => {
      const rect = dropTrayRectRef.current;
      if (!rect || !Number.isFinite(pageX) || !Number.isFinite(pageY)) return null;
      if (
        pageX < rect.x - 12 ||
        pageX > rect.x + rect.width + 12 ||
        pageY < rect.y - 24 ||
        pageY > rect.y + rect.height + 54
      ) {
        return null;
      }

      const relativeX = Math.max(0, Math.min(rect.width - 1, pageX - rect.x));
      const index = Math.max(
        0,
        Math.min(weekDays.length - 1, Math.floor(relativeX / (rect.width / weekDays.length)))
      );
      return weekDays[index]?.key ?? null;
    },
    [weekDays]
  );

  const handleDragArm = useCallback(
    (item) => {
      if (!canMoveWeekItem(item)) return;
      setDraggingItem(item);
      setDropTargetDate(item.recommendedDate);
      measureDropTray();
    },
    [measureDropTray]
  );

  const handleDragMove = useCallback(
    (pageX, pageY) => {
      const nextTarget = resolveDropTarget(pageX, pageY);
      setDropTargetDate(nextTarget);
    },
    [resolveDropTarget]
  );

  const performMove = useCallback(
    async (item, targetDate) => {
      if (!canMoveWeekItem(item) || !targetDate) {
        clearDragState();
        return;
      }
      if (item.recommendedDate === targetDate) {
        clearDragState();
        return;
      }

      const anchorDate = parseDateKey(contract?.weekStart) ?? new Date();
      setMovingItemId(item.planItemId);
      setContract((current) =>
        withOptimisticWeekDate(current, item.planItemId, targetDate)
      );
      clearDragState();

      try {
        const result = await moveWeekPlanItem({
          planItemId: item.planItemId,
          targetDate,
          anchorDate,
        });

        try {
          const refreshed = await getWeekReadContract({ anchorDate });
          setContract(refreshed);
        } catch (refreshError) {
          console.warn('[MaSemaine] refresh after W11.4 move failed', refreshError);
        }

        if (result.hasCollision) {
          showMoveFeedback(
            'Deux séances sont prévues ce jour-là. Je les garde toutes les deux et j’ajusterai si besoin.',
            'collision'
          );
        } else {
          showMoveFeedback(
            `Séance déplacée vers ${getItemDateLabel(targetDate)}. Ce jour reste un repère.`
          );
        }
      } catch (moveError) {
        console.warn('[MaSemaine] W11.4 move failed', moveError);
        try {
          const refreshed = await getWeekReadContract({ anchorDate });
          setContract(refreshed);
        } catch (refreshError) {
          console.warn('[MaSemaine] recovery refresh after failed move', refreshError);
        }
        showMoveFeedback(
          'Le déplacement n’a pas été enregistré. Ta semaine n’a pas changé.',
          'warning'
        );
      } finally {
        setMovingItemId(null);
      }
    },
    [clearDragState, contract?.weekStart, showMoveFeedback]
  );

  const handleDragDrop = useCallback(
    (item, pageX, pageY) => {
      const targetDate = resolveDropTarget(pageX, pageY);
      if (!targetDate) {
        clearDragState();
        return;
      }
      performMove(item, targetDate);
    },
    [clearDragState, performMove, resolveDropTarget]
  );

  const handleAccessibilityMove = useCallback(
    (item, delta) => {
      const currentIndex = weekDays.findIndex((day) => day.key === item?.recommendedDate);
      const nextIndex = currentIndex + delta;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= weekDays.length) {
        showMoveFeedback('Le déplacement doit rester dans cette semaine.');
        return;
      }
      performMove(item, weekDays[nextIndex].key);
    },
    [performMove, showMoveFeedback, weekDays]
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
        scrollEnabled={!draggingItem}
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

          <WeekIndex
            days={weekDays}
            items={visibleItems}
            palette={palette}
            dragActive={Boolean(draggingItem)}
            dropTargetDate={dropTargetDate}
          />

          {moveFeedback ? (
            <View
              style={[
                styles.moveFeedback,
                {
                  backgroundColor: palette.surface,
                  borderColor:
                    moveFeedback.tone === 'collision' ? palette.accent : palette.border,
                },
              ]}
              accessibilityLiveRegion="polite"
            >
              <Ionicons
                name={moveFeedback.tone === 'warning' ? 'information-circle-outline' : 'checkmark-circle-outline'}
                size={17}
                color={moveFeedback.tone === 'collision' ? palette.accent : palette.textMuted}
              />
              <Text style={[styles.moveFeedbackText, { color: palette.textMuted }]}>
                {moveFeedback.text}
              </Text>
            </View>
          ) : null}

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
                <DraggableWeekItem
                  key={item.planItemId ?? `${item.sequenceIndex ?? index}-${index}`}
                  item={item}
                  palette={palette}
                  isLast={index === visibleItems.length - 1}
                  moving={movingItemId === item.planItemId}
                  onDragArm={handleDragArm}
                  onDragMove={handleDragMove}
                  onDragDrop={handleDragDrop}
                  onDragCancel={clearDragState}
                  onAccessibilityMove={handleAccessibilityMove}
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

          <Text style={[styles.readOnlyHint, { color: palette.textMuted }]}>
            Appui long sur une séance pour ajuster son jour · les dates restent des repères.
          </Text>
        </View>
      </ScrollView>

      {draggingItem ? (
        <DragTargetTray
          days={weekDays}
          items={visibleItems}
          palette={palette}
          targetDate={dropTargetDate}
          trayRef={dropTrayRef}
          onLayout={measureDropTray}
        />
      ) : null}
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
  weekDayCellDragReady: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 13,
    justifyContent: 'center',
    paddingTop: 5,
    paddingBottom: 5,
    marginHorizontal: 1,
  },
  weekDayCellDropTarget: {
    transform: [{ scale: 1.035 }],
  },
  weekIndexCompact: {
    marginBottom: 0,
    marginHorizontal: -2,
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
  draggableWeekItem: {
    width: '100%',
    borderRadius: 18,
  },
  draggableWeekItemMoving: {
    opacity: 0.62,
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
  moveFeedback: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: -10,
    marginBottom: 12,
  },
  moveFeedbackText: {
    flex: 1,
    fontFamily: fontFamilies.medium,
    fontSize: 12,
    lineHeight: 18,
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
  dragTargetTray: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    zIndex: 200,
    elevation: 14,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  dragTargetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 7,
  },
  dragTargetLabel: {
    fontFamily: fontFamilies.bold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.05,
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
