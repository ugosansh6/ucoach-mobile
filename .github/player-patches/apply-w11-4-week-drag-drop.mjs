import fs from 'node:fs';

const path = 'app/(tabs)/planning.js';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`W11.4 patch anchor missing: ${label}`);
  }
  source = source.replace(from, to);
}

replaceOnce(
  "import React, { useCallback, useEffect, useMemo, useState } from 'react';",
  "import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';",
  'React useRef import'
);

replaceOnce(
`import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';`,
`import {
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
} from 'react-native';`,
  'react-native gesture imports'
);

replaceOnce(
  "import { getWeekReadContract } from '../../src/services/weeklyPlanService';",
`import {
  getWeekReadContract,
  moveWeekPlanItem,
} from '../../src/services/weeklyPlanService';`,
  'weekly plan service import'
);

const interactionStart = source.indexOf('function WeekIndex({ days, items, palette }) {');
const interactionEnd = source.indexOf('\nexport default function PlanningScreen() {', interactionStart);
if (interactionStart < 0 || interactionEnd < 0) {
  throw new Error('W11.4 interaction block anchors missing');
}

const interactionBlock = `function canMoveWeekItem(item) {
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
        accessibilityLabel={\`${'${'}getItemDateLabel(item?.recommendedDate)}, ${'${'}getItemTitle(
          item
        )}, ${'${'}getStateLabel(item?.displayState)}\`}
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
`;

source = source.slice(0, interactionStart) + interactionBlock + source.slice(interactionEnd);

replaceOnce(
`  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);`,
`  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [draggingItem, setDraggingItem] = useState(null);
  const [dropTargetDate, setDropTargetDate] = useState(null);
  const [movingItemId, setMovingItemId] = useState(null);
  const [moveFeedback, setMoveFeedback] = useState(null);
  const dropTrayRef = useRef(null);
  const dropTrayRectRef = useRef(null);
  const feedbackTimerRef = useRef(null);`,
  'planning interaction state'
);

replaceOnce(
`  useEffect(() => {
    if (action === 'new') {
      router.replace('/workout/builder');
    }
  }, [action]);`,
`  useEffect(() => {
    if (action === 'new') {
      router.replace('/workout/builder');
    }
  }, [action]);

  useEffect(
    () => () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    },
    []
  );`,
  'feedback timer cleanup'
);

replaceOnce(
`  const visibleItems = contract?.visibleItems ?? [];
  const weekDays = useMemo(
    () => buildWeekDays(contract?.weekStart),
    [contract?.weekStart]
  );`,
`  const visibleItems = useMemo(
    () => sortWeekItemsForDisplay(contract?.visibleItems ?? []),
    [contract?.visibleItems]
  );
  const weekDays = useMemo(
    () => buildWeekDays(contract?.weekStart),
    [contract?.weekStart]
  );`,
  'sorted visible week items'
);

replaceOnce(
`  const weekRange = useMemo(
    () => formatWeekRange(contract?.weekStart, contract?.weekEnd),
    [contract?.weekStart, contract?.weekEnd]
  );

  if (action === 'new') {`,
`  const weekRange = useMemo(
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
            \`Séance déplacée vers ${'${'}getItemDateLabel(targetDate)}. Ce jour reste un repère.\`
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

  if (action === 'new') {`,
  'W11.4 move handlers'
);

replaceOnce(
`      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}`,
`      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!draggingItem}`,
  'disable scroll during drag'
);

replaceOnce(
`          <WeekIndex days={weekDays} items={visibleItems} palette={palette} />`,
`          <WeekIndex
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
          ) : null}`,
  'week index drag state and feedback'
);

replaceOnce(
`              {visibleItems.map((item, index) => (
                <WeekItem
                  key={item.planItemId ?? \`${'${'}item.sequenceIndex ?? index}-${'${'}index}\`}
                  item={item}
                  palette={palette}
                  isLast={index === visibleItems.length - 1}
                />
              ))}`,
`              {visibleItems.map((item, index) => (
                <DraggableWeekItem
                  key={item.planItemId ?? \`${'${'}item.sequenceIndex ?? index}-${'${'}index}\`}
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
              ))}`,
  'draggable editorial stack'
);

replaceOnce(
`          <Text style={[styles.readOnlyHint, { color: palette.textMuted }]}>Lecture seule · W11.2</Text>`,
`          <Text style={[styles.readOnlyHint, { color: palette.textMuted }]}>
            Appui long sur une séance pour ajuster son jour · les dates restent des repères.
          </Text>`,
  'W11.4 interaction hint'
);

replaceOnce(
`        </View>
      </ScrollView>
    </SafeAreaView>`,
`        </View>
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
    </SafeAreaView>`,
  'drag target tray mount'
);

replaceOnce(
`  weekDayCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: 2,
  },`,
`  weekDayCell: {
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
  },`,
  'drop target day styles'
);

replaceOnce(
`  editorialStack: {
    width: '100%',
  },`,
`  editorialStack: {
    width: '100%',
  },
  draggableWeekItem: {
    width: '100%',
    borderRadius: 18,
  },
  draggableWeekItemMoving: {
    opacity: 0.62,
  },`,
  'draggable item styles'
);

replaceOnce(
`  feedbackBlock: {
    minHeight: 180,`,
`  moveFeedback: {
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
    minHeight: 180,`,
  'move feedback styles'
);

replaceOnce(
`  readOnlyHint: {
    fontFamily: fontFamilies.medium,`,
`  dragTargetTray: {
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
    fontFamily: fontFamilies.medium,`,
  'drag target tray styles'
);

fs.writeFileSync(path, source);
console.log('W11.4 drag & drop patch applied to Ma semaine.');
