import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  removeWeekPlanItem,
} from '../../src/services/weeklyPlanService';
import { getWeekSessionExercisePreviews } from '../../src/services/weekSessionPreviewService';
import { reloadWorkoutSession } from '../../src/services/workoutService';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import { fontFamilies } from '../../src/constants/typography';

const WEEKDAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const MONTH_LABELS = [
  'JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN',
  'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE',
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
  week_balance: 'Équilibre',
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
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return null;
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
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day));
  return copy;
}

function buildWeekDays(weekStart) {
  const start = parseDateKey(weekStart) ?? startOfMonday();
  return WEEKDAY_LABELS.map((label, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { label, date, key: toLocalDateKey(date) };
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
  return priority.key ?? priority.priority_key ?? priority.name ?? priority.code ?? priority.focus ?? null;
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
  if (HUMAN_LABELS[normalized.replace(/ /g, '_')]) return HUMAN_LABELS[normalized.replace(/ /g, '_')];
  const cleaned = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

function getEnvironmentLabel(code) {
  if (!code) return null;
  const normalized = String(code).trim().toLowerCase();
  const labels = {
    home: 'Maison', maison: 'Maison', box: 'Box', gym: 'Salle', salle: 'Salle',
    outdoor: 'Extérieur', exterieur: 'Extérieur', extérieur: 'Extérieur',
  };
  return labels[normalized] ?? humanize(code);
}

function getShortSummary(item) {
  if (!item?.sessionId) {
    const userFacingTitle = item?.coachProjection?.presentation?.title;
    if (userFacingTitle) return userFacingTitle;
  }

  const values = [];
  const summary = item?.sessionSummary ?? item?.plannedContext ?? {};
  const candidates = [
    humanize(summary.focus),
    humanize(getPriorityKey(item?.coachProjection?.priority)),
    humanize(summary.targetRegion),
    humanize(summary.progressionIntent),
  ];
  for (const value of candidates) {
    if (!value) continue;
    if (values.some((existing) => existing.toLowerCase() === value.toLowerCase())) continue;
    values.push(value);
    if (values.length === 3) break;
  }
  return values.length ? values.join(' · ') : 'Séance à préciser';
}

function getMeta(item) {
  const duration = item?.plannedContext?.durationMinutes ?? item?.sessionSummary?.durationMinutes;
  const environment = item?.plannedContext?.environmentCode ?? item?.sessionSummary?.plannedEnvironmentCode;
  const parts = [];
  if (Number.isFinite(duration) && duration > 0) parts.push(`${duration} min`);
  const environmentLabel = getEnvironmentLabel(environment);
  if (environmentLabel) parts.push(environmentLabel);
  return parts;
}

function isBuiltSession(item) {
  return Boolean(item?.sessionId);
}

function canMoveWeekItem(item) {
  return Boolean(
    item?.planItemId &&
    item?.recommendedDate &&
    item?.recommendedDateIsSoft !== false &&
    (item?.displayState === 'PREVUE' || item?.displayState === 'PRETE')
  );
}

function canRemoveWeekItem(item) {
  return Boolean(
    item?.planItemId &&
    (item?.displayState === 'PREVUE' || item?.displayState === 'PRETE')
  );
}

function getTone(item, palette) {
  if (item?.displayState === 'ACTIVE') return palette.orange;
  if (item?.displayState === 'REALISEE') return palette.done;
  if (isBuiltSession(item)) return palette.session;
  return palette.intent;
}

function getObjectKey(item, index = 0) {
  return item?.planItemId ?? item?.sessionId ?? `${item?.recommendedDate ?? 'item'}-${index}`;
}

function getIntentProfile(item) {
  const presentation = item?.coachProjection?.presentation ?? {};
  const description = presentation.description ?? null;
  const examples = Array.isArray(presentation.exerciseExamples)
    ? presentation.exerciseExamples.filter(Boolean)
    : [];
  const why = presentation?.why?.text
    ? {
        title: presentation.why.title ?? 'Pourquoi maintenant ?',
        text: presentation.why.text,
      }
    : null;
  const coachAdvice = presentation?.coachAdvice?.text
    ? presentation.coachAdvice
    : null;

  return {
    description,
    examples,
    why,
    coachAdvice,
  };
}

function buildDaysWithItems(days, items) {
  const map = new Map(days.map((day) => [day.key, []]));
  for (const item of items) {
    if (!item?.recommendedDate || !map.has(item.recommendedDate)) continue;
    map.get(item.recommendedDate).push(item);
  }
  for (const dayItems of map.values()) {
    dayItems.sort((a, b) => Number(a?.sequenceIndex ?? 999) - Number(b?.sequenceIndex ?? 999));
  }
  return days.map((day) => ({ ...day, items: map.get(day.key) ?? [] }));
}

function withOptimisticWeekDate(contract, planItemId, targetDate) {
  if (!contract) return contract;
  const move = (item) => item?.planItemId === planItemId
    ? { ...item, recommendedDate: targetDate, recommendedDateIsSoft: true }
    : item;
  return {
    ...contract,
    items: Array.isArray(contract.items) ? contract.items.map(move) : [],
    visibleItems: Array.isArray(contract.visibleItems) ? contract.visibleItems.map(move) : [],
  };
}

function DragDots({ color }) {
  return (
    <View style={styles.dragDots}>
      {Array.from({ length: 6 }).map((_, index) => (
        <View key={index} style={[styles.dragDot, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

function DragHandle({ item, palette, disabled, onStart, onMove, onDrop, onCancel }) {
  const movable = canMoveWeekItem(item) && !disabled;
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => movable,
    onMoveShouldSetPanResponder: () => movable,
    onPanResponderGrant: (event) => onStart?.(item, event?.nativeEvent?.pageY ?? null),
    onPanResponderMove: (event) => onMove?.(event?.nativeEvent?.pageY ?? null),
    onPanResponderRelease: (event) => onDrop?.(item, event?.nativeEvent?.pageY ?? null),
    onPanResponderTerminate: () => onCancel?.(),
    onPanResponderTerminationRequest: () => false,
  }), [item, movable, onCancel, onDrop, onMove, onStart]);

  if (!movable) return <View style={styles.dragHandleSpacer} />;
  return (
    <View
      {...panResponder.panHandlers}
      style={[styles.dragHandle, { borderColor: palette.border }]}
      accessibilityRole="adjustable"
      accessibilityLabel={`Déplacer ${getShortSummary(item)}`}
      accessibilityHint="Fais glisser vers un autre jour de la semaine."
    >
      <DragDots color={palette.textMuted} />
    </View>
  );
}

function RemoveButton({ item, palette, disabled, onPress }) {
  if (!canRemoveWeekItem(item)) return null;
  return (
    <TouchableOpacity
      style={styles.removeButton}
      onPress={() => !disabled && onPress?.(item)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Supprimer ${getShortSummary(item)}`}
      accessibilityHint="Retirer cette séance de la semaine sans créer de retard."
    >
      <Ionicons name="trash-outline" size={17} color={palette.textMuted} />
    </TouchableOpacity>
  );
}

function ActionButton({ label, icon, primary = false, palette, onPress }) {
  return (
    <TouchableOpacity
      style={[
        styles.actionButton,
        {
          borderColor: primary ? palette.accent : palette.border,
          backgroundColor: primary ? palette.accent : 'transparent',
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={17} color={primary ? palette.onAccent : palette.text} />
      <Text style={[styles.actionButtonText, { color: primary ? palette.onAccent : palette.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function CreationActions({ dateKey, planItemId = null, palette, onImport }) {
  return (
    <View style={styles.creationActions}>
      <ActionButton
        label="COMPOSER AVEC UGEROD"
        icon="sparkles-outline"
        primary
        palette={palette}
        onPress={() => router.push({
          pathname: '/workout/preparation',
          params: {
            date: dateKey,
            entry: 'week_assisted',
            ...(planItemId ? { planItemId } : {}),
          },
        })}
      />
      <ActionButton
        label="CRÉER LIBREMENT"
        icon="create-outline"
        palette={palette}
        onPress={() => router.push({ pathname: '/workout/builder', params: { date: dateKey, entry: 'week_free' } })}
      />
      <ActionButton
        label="IMPORTER UNE SÉANCE"
        icon="download-outline"
        palette={palette}
        onPress={() => onImport?.(dateKey)}
      />
    </View>
  );
}

function IntentDetails({ item, dateKey, palette, onImport }) {
  const profile = getIntentProfile(item);
  return (
    <View style={[styles.detailPanel, { borderColor: palette.border }]}> 
      {profile.description ? (
        <Text style={[styles.detailBody, { color: palette.textMuted }]}>{profile.description}</Text>
      ) : null}
      {profile.why?.text ? (
        <View style={styles.detailSection}>
          <Text style={[styles.detailLabel, { color: palette.textMuted }]}>{profile.why.title.toUpperCase()}</Text>
          <Text style={[styles.explanationText, { color: palette.text }]}>{profile.why.text}</Text>
        </View>
      ) : null}
      {profile.examples.length > 0 ? (
        <View style={styles.detailSection}>
          <Text style={[styles.detailLabel, { color: palette.textMuted }]}>EXERCICES QUI POURRAIENT APPARAÎTRE</Text>
          <Text style={[styles.exercisePreviewLine, { color: palette.text }]}>{profile.examples.join('  ·  ')}</Text>
        </View>
      ) : null}
      {profile.coachAdvice?.text ? (
        <View style={[styles.coachTip, { backgroundColor: palette.accentSoft, borderColor: palette.border }]}> 
          <Ionicons name="bulb-outline" size={18} color={palette.accent} />
          <View style={styles.coachTipText}>
            <Text style={[styles.coachTipTitle, { color: palette.text }]}>CONSEIL DU COACH</Text>
            <Text style={[styles.coachTipBody, { color: palette.textMuted }]}>{profile.coachAdvice.text}</Text>
          </View>
        </View>
      ) : null}
      <CreationActions
        dateKey={dateKey}
        planItemId={item?.planItemId ?? null}
        palette={palette}
        onImport={onImport}
      />
    </View>
  );
}

function SessionDetails({ item, exercises, palette, onOpen, opening }) {
  const meta = getMeta(item);
  const preview = Array.isArray(exercises) ? exercises.slice(0, 6) : [];
  return (
    <View style={[styles.detailPanel, { borderColor: palette.border }]}> 
      <Text style={[styles.detailTitle, { color: palette.text }]}>{getShortSummary(item)}</Text>
      {preview.length > 0 ? (
        <View style={styles.detailSection}>
          <Text style={[styles.detailLabel, { color: palette.textMuted }]}>DANS LA SÉANCE</Text>
          <Text style={[styles.exercisePreviewLine, { color: palette.text }]}>{preview.map((exercise) => exercise.name).join('  ·  ')}</Text>
        </View>
      ) : (
        <Text style={[styles.detailBody, { color: palette.textMuted }]}>Le contenu de cette séance est déjà construit.</Text>
      )}
      {meta.length > 0 ? <Text style={[styles.detailMeta, { color: palette.textMuted }]}>{meta.join('  ·  ')}</Text> : null}
      {item?.displayState !== 'REALISEE' ? (
        <View style={{ marginTop: 15 }}>
          <ActionButton
            label={opening ? 'OUVERTURE…' : item?.displayState === 'ACTIVE' ? 'REPRENDRE LA SÉANCE' : 'OUVRIR LA SÉANCE'}
            icon={item?.displayState === 'ACTIVE' ? 'play-outline' : 'arrow-forward-outline'}
            primary
            palette={palette}
            onPress={() => !opening && onOpen?.(item)}
          />
        </View>
      ) : null}
    </View>
  );
}

function WeekObject({
  item, index, expanded, moving, exercises, palette, onToggle, onImport,
  onDragStart, onDragMove, onDragDrop, onDragCancel, onOpenSession, openingSessionId,
  onRequestRemove, removingItemId,
}) {
  const built = isBuiltSession(item);
  const tone = getTone(item, palette);
  const meta = getMeta(item);
  return (
    <View style={[styles.objectWrap, moving && styles.objectMoving]}>
      <View
        style={[
          built ? styles.sessionObject : styles.intentObject,
          built
            ? { backgroundColor: palette.surface, borderColor: palette.border, borderLeftColor: tone }
            : { backgroundColor: palette.intentSoft, borderLeftColor: tone },
        ]}
      >
        <Pressable style={styles.objectPressArea} onPress={onToggle} accessibilityRole="button">
          <View style={styles.objectCopy}>
            <Text style={[built ? styles.sessionObjectTitle : styles.intentObjectTitle, { color: palette.text }]} numberOfLines={2}>
              {getShortSummary(item)}
            </Text>
            {built && exercises?.length ? (
              <Text style={[styles.objectSubline, { color: palette.textMuted }]} numberOfLines={1}>
                {exercises.slice(0, 3).map((exercise) => exercise.name).join(' · ')}
              </Text>
            ) : null}
            {meta.length > 0 ? <Text style={[styles.objectMeta, { color: palette.textMuted }]}>{meta.join('  ·  ')}</Text> : null}
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={palette.textMuted} />
        </Pressable>
        <RemoveButton
          item={item}
          palette={palette}
          disabled={moving || removingItemId === item?.planItemId}
          onPress={onRequestRemove}
        />
        <DragHandle
          item={item}
          palette={palette}
          disabled={moving || removingItemId === item?.planItemId}
          onStart={onDragStart}
          onMove={onDragMove}
          onDrop={onDragDrop}
          onCancel={onDragCancel}
        />
      </View>
      {expanded ? (
        built
          ? <SessionDetails
              item={item}
              exercises={exercises}
              palette={palette}
              onOpen={onOpenSession}
              opening={openingSessionId === item?.sessionId}
            />
          : <IntentDetails item={item} dateKey={item.recommendedDate} palette={palette} onImport={onImport} />
      ) : null}
    </View>
  );
}

function EmptyDay({ dateKey, expanded, isPast = false, palette, onToggle, onImport }) {
  if (isPast) {
    return (
      <View style={styles.emptyDayWrap}>
        <View style={styles.emptyDayPress}>
          <Text style={[styles.emptyDayText, { color: palette.textMuted }]}>Journée passée</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.emptyDayWrap}>
      <Pressable style={styles.emptyDayPress} onPress={onToggle} accessibilityRole="button">
        <Text style={[styles.emptyDayText, { color: palette.textMuted }]}>Rien de prévu</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={palette.textMuted} />
      </Pressable>
      {expanded ? (
        <View style={[styles.emptyActionsPanel, { borderColor: palette.border }]}> 
          <CreationActions dateKey={dateKey} palette={palette} onImport={onImport} />
        </View>
      ) : null}
    </View>
  );
}

function DaySection({
  day, palette, todayKey, expandedKey, movingItemId, exercisePreviews, dropTarget,
  registerDayRef, onToggleItem, onToggleEmpty, onImport,
  onDragStart, onDragMove, onDragDrop, onDragCancel, onOpenSession, openingSessionId,
  onRequestRemove, removingItemId,
}) {
  const isToday = day.key === todayKey;
  const isPast = day.key < todayKey;
  const isTarget = dropTarget === day.key;
  return (
    <View
      ref={(node) => registerDayRef(day.key, node)}
      collapsable={false}
      style={[
        styles.daySection,
        { borderBottomColor: palette.border },
        isTarget && { backgroundColor: palette.dropTarget, borderLeftColor: palette.accent, borderLeftWidth: 3 },
      ]}
    >
      <Pressable
        style={styles.dayDateColumn}
        onPress={() => {
          if (day.items.length > 0) onToggleItem(day.items[0], 0);
          else if (!isPast) onToggleEmpty(day.key);
        }}
        accessibilityRole="button"
      >
        <Text style={[styles.dayName, { color: isToday ? palette.accent : palette.textMuted }]}>{day.label}</Text>
        <View style={[styles.dayNumberWrap, isToday && { backgroundColor: palette.accent }]}> 
          <Text style={[styles.dayNumber, { color: isToday ? palette.onAccent : palette.text }]}>{day.date.getDate()}</Text>
        </View>
      </Pressable>
      <View style={styles.dayContent}>
        {day.items.length === 0 ? (
          <EmptyDay
            dateKey={day.key}
            expanded={expandedKey === `empty:${day.key}`}
            isPast={isPast}
            palette={palette}
            onToggle={() => onToggleEmpty(day.key)}
            onImport={onImport}
          />
        ) : day.items.map((item, index) => {
          const key = getObjectKey(item, index);
          return (
            <WeekObject
              key={key}
              item={item}
              index={index}
              expanded={expandedKey === `item:${key}`}
              moving={movingItemId === item.planItemId}
              exercises={exercisePreviews[item.sessionId] ?? []}
              palette={palette}
              onToggle={() => onToggleItem(item, index)}
              onImport={onImport}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragDrop={onDragDrop}
              onDragCancel={onDragCancel}
              onOpenSession={onOpenSession}
              openingSessionId={openingSessionId}
              onRequestRemove={onRequestRemove}
              removingItemId={removingItemId}
            />
          );
        })}
      </View>
    </View>
  );
}

function AddSessionModal({ visible, days, todayKey, palette, currentCount, onClose, onSelectDay }) {
  const atLimit = currentCount >= 5;
  const selectableDays = days.filter((day) => day.key >= todayKey);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={[styles.importSheet, { backgroundColor: palette.surfaceRaised, borderColor: palette.border }]} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: palette.text }]}>AJOUTER UNE SÉANCE</Text>
          <Text style={[styles.sheetIntro, { color: palette.textMuted }]}>
            Choisis un jour libre pour ajouter une 4e ou 5e séance. Les journées déjà programmées restent inchangées.
          </Text>
          <View style={styles.addDayList}>
            {selectableDays.map((day) => {
              const isToday = day.key === todayKey;
              const count = day.items?.length ?? 0;
              const occupied = count > 0;
              const disabled = atLimit || occupied;
              const title = occupied
                ? 'Séance déjà prévue'
                : isToday
                  ? 'Aujourd’hui · créneau disponible'
                  : 'Créneau disponible';
              const subtitle = atLimit
                ? 'Limite de 5 séances atteinte pour cette semaine.'
                : occupied
                  ? 'Cette journée est déjà programmée.'
                  : 'UGEROD préparera une intention cohérente avec le reste de ta semaine.';
              return (
                <TouchableOpacity
                  key={day.key}
                  style={[styles.addDayRow, { borderColor: palette.border }, disabled && styles.disabledRow]}
                  disabled={disabled}
                  onPress={() => onSelectDay?.(day.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ajouter une séance ${day.label} ${day.date.getDate()}`}
                >
                  <View style={styles.addDayDate}>
                    <Text style={[styles.addDayName, { color: disabled ? palette.textMuted : palette.text }]}>{day.label}</Text>
                    <Text style={[styles.addDayNumber, { color: disabled ? palette.textMuted : palette.text }]}>{day.date.getDate()}</Text>
                  </View>
                  <View style={styles.addDayCopy}>
                    <Text style={[styles.addDayTitle, { color: disabled ? palette.textMuted : palette.text }]}>{title}</Text>
                    <Text style={[styles.addDaySubtitle, { color: palette.textMuted }]}>{subtitle}</Text>
                  </View>
                  {!disabled ? <Ionicons name="chevron-forward" size={18} color={palette.textMuted} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
          {atLimit ? (
            <Text style={[styles.limitNote, { color: palette.textMuted }]}>5 séances sont déjà prévues cette semaine.</Text>
          ) : null}
          <TouchableOpacity style={[styles.sheetCloseButton, { borderColor: palette.border }]} onPress={onClose}>
            <Text style={[styles.sheetCloseText, { color: palette.text }]}>FERMER</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
function RemoveSessionModal({ item, visible, palette, removing, onClose, onConfirm }) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => !removing && onClose?.()}>
      <Pressable style={styles.modalBackdrop} onPress={() => !removing && onClose?.()}>
        <Pressable style={[styles.removeSheet, { backgroundColor: palette.surfaceRaised, borderColor: palette.border }]} onPress={() => {}}>
          <View style={[styles.removeIconWrap, { backgroundColor: palette.accentSoft }]}>
            <Ionicons name="trash-outline" size={21} color={palette.orange} />
          </View>
          <Text style={[styles.removeTitle, { color: palette.text }]}>RETIRER CETTE SÉANCE ?</Text>
          <Text style={[styles.removeText, { color: palette.textMuted }]}>
            {item ? getShortSummary(item) : 'Cette séance'} disparaîtra de ta semaine. Aucun retard ni dette d’entraînement ne sera créé.
          </Text>
          <View style={styles.removeActions}>
            <TouchableOpacity style={[styles.removeCancel, { borderColor: palette.border }]} disabled={removing} onPress={onClose}>
              <Text style={[styles.removeCancelText, { color: palette.text }]}>ANNULER</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.removeConfirm, { backgroundColor: palette.orange }]} disabled={removing} onPress={onConfirm}>
              <Text style={[styles.removeConfirmText, { color: '#FFFFFF' }]}>{removing ? 'RETRAIT…' : 'RETIRER'}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ImportModal({ visible, dateKey, palette, shareValue, onShareValueChange, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.importSheet, { backgroundColor: palette.surfaceRaised, borderColor: palette.border }]}
          onPress={() => {}}
        >
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: palette.text }]}>IMPORTER UNE SÉANCE</Text>
          <Text style={[styles.sheetIntro, { color: palette.textMuted }]}>Choisis une séance déjà enregistrée ou utilise un partage reçu.</Text>
          <TouchableOpacity
            style={[styles.importSourceButton, { borderColor: palette.border }]}
            onPress={() => {
              onClose();
              router.push({ pathname: '/(tabs)/library', params: { section: 'models', importDate: dateKey ?? '' } });
            }}
          >
            <View style={[styles.importSourceIcon, { backgroundColor: palette.accentSoft }]}> 
              <Ionicons name="bookmark-outline" size={19} color={palette.accent} />
            </View>
            <View style={styles.importSourceCopy}>
              <Text style={[styles.importSourceTitle, { color: palette.text }]}>Mes modèles</Text>
              <Text style={[styles.importSourceText, { color: palette.textMuted }]}>Reprendre une séance que tu as déjà enregistrée.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
          </TouchableOpacity>
          <View style={[styles.shareBlock, { borderColor: palette.border }]}> 
            <View style={styles.shareHeader}>
              <View style={[styles.importSourceIcon, { backgroundColor: palette.accentSoft }]}> 
                <Ionicons name="link-outline" size={19} color={palette.accent} />
              </View>
              <View style={styles.importSourceCopy}>
                <Text style={[styles.importSourceTitle, { color: palette.text }]}>Lien ou code de partage</Text>
                <Text style={[styles.importSourceText, { color: palette.textMuted }]}>Colle un lien UGEROD ou saisis un code reçu.</Text>
              </View>
            </View>
            <TextInput
              value={shareValue}
              onChangeText={onShareValueChange}
              placeholder="Lien ou code"
              placeholderTextColor={palette.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.shareInput, { color: palette.text, borderColor: palette.border, backgroundColor: palette.bg }]}
            />
            <Text style={[styles.shareFootnote, { color: palette.textMuted }]}>Import par lien ou code bientôt disponible.</Text>
          </View>
          <TouchableOpacity style={[styles.sheetCloseButton, { borderColor: palette.border }]} onPress={onClose}>
            <Text style={[styles.sheetCloseText, { color: palette.text }]}>FERMER</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function PlanningScreen() {
  const { isDark } = useUgerodTheme();
  const { setGeneratedWorkout } = useWorkout();
  const params = useLocalSearchParams();
  const action = Array.isArray(params?.action) ? params.action[0] : params?.action;
  const [contract, setContract] = useState(null);
  const [exercisePreviews, setExercisePreviews] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [expandedKey, setExpandedKey] = useState(null);
  const [draggingItem, setDraggingItem] = useState(null);
  const [dragY, setDragY] = useState(null);
  const [dropTargetDate, setDropTargetDate] = useState(null);
  const [movingItemId, setMovingItemId] = useState(null);
  const [openingSessionId, setOpeningSessionId] = useState(null);
  const [moveFeedback, setMoveFeedback] = useState(null);
  const [importDay, setImportDay] = useState(null);
  const [shareValue, setShareValue] = useState('');
  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [removeItem, setRemoveItem] = useState(null);
  const [removingItemId, setRemovingItemId] = useState(null);
  const dayRefs = useRef({});
  const dayRects = useRef({});
  const feedbackTimerRef = useRef(null);

  const palette = useMemo(() => isDark ? {
    bg: '#0A0E0C', surface: '#121712', surfaceRaised: '#181E19', border: '#2A332B',
    text: '#F4F2ED', textMuted: '#AEB6AE', accent: '#87977F', accentSoft: '#2A332B',
    orange: '#FF6B19', onAccent: '#081009', intent: '#7D8A77', intentSoft: '#141A15',
    session: '#A5B29E', done: '#778078', dropTarget: 'rgba(135,151,127,0.12)',
  } : {
    bg: '#F4F2ED', surface: '#FFFFFF', surfaceRaised: '#FAF9F5', border: '#D8D6CF',
    text: '#151B16', textMuted: '#697169', accent: '#646F5E', accentSoft: '#E6E9E2',
    orange: '#FF6B19', onAccent: '#FFFFFF', intent: '#8A9684', intentSoft: '#EEF0EA',
    session: '#646F5E', done: '#899087', dropTarget: 'rgba(100,111,94,0.08)',
  }, [isDark]);

  useEffect(() => {
    if (action === 'new') router.replace('/workout/builder');
  }, [action]);

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
  }, []);

  const loadWeek = useCallback(async ({ refresh = false } = {}) => {
    if (action === 'new') return;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const result = await getWeekReadContract({ anchorDate: new Date() });
      setContract(result);
      const sessionIds = (result?.visibleItems ?? []).map((item) => item?.sessionId).filter(Boolean);
      try {
        setExercisePreviews(await getWeekSessionExercisePreviews(sessionIds));
      } catch (previewError) {
        console.warn('[MaSemaine] exercise preview failed', previewError);
        setExercisePreviews({});
      }
    } catch (loadError) {
      console.warn('[MaSemaine] week_read_contract_v2 failed', loadError);
      setError(loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [action]);

  useFocusEffect(useCallback(() => { loadWeek(); }, [loadWeek]));

  const visibleItems = useMemo(
    () => (contract?.visibleItems ?? []).filter((item) =>
      item?.surfaceVisibility !== 'CONTEXT_ONLY' &&
      item?.displayState !== 'CLOSED_SILENT'
    ),
    [contract?.visibleItems]
  );
  const weekDays = useMemo(() => buildWeekDays(contract?.weekStart), [contract?.weekStart]);
  const daysWithItems = useMemo(() => buildDaysWithItems(weekDays, visibleItems), [visibleItems, weekDays]);
  const weekRange = useMemo(() => formatWeekRange(contract?.weekStart, contract?.weekEnd), [contract?.weekStart, contract?.weekEnd]);
  const todayKey = toLocalDateKey(new Date());
  const planningSlotCount = useMemo(
    () => (contract?.items ?? []).filter((item) =>
      !['skipped', 'unrealized'].includes(String(item?.lifecycleStatus ?? '').toLowerCase())
    ).length,
    [contract?.items]
  );

  const registerDayRef = useCallback((key, node) => { if (node) dayRefs.current[key] = node; }, []);

  const measureDays = useCallback(() => {
    const next = {};
    let remaining = weekDays.length;
    if (!remaining) return;
    for (const day of weekDays) {
      const node = dayRefs.current[day.key];
      if (!node?.measureInWindow) { remaining -= 1; continue; }
      node.measureInWindow((x, y, width, height) => {
        next[day.key] = { x, y, width, height };
        remaining -= 1;
        if (remaining <= 0) dayRects.current = next;
      });
    }
  }, [weekDays]);

  const resolveDropTarget = useCallback((pageY) => {
    if (!Number.isFinite(pageY)) return null;
    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const day of weekDays) {
      if (day.key < todayKey) continue;
      const rect = dayRects.current[day.key];
      if (!rect) continue;
      if (pageY >= rect.y && pageY <= rect.y + rect.height) return day.key;
      const distance = Math.abs(pageY - (rect.y + rect.height / 2));
      if (distance < nearestDistance) { nearest = day.key; nearestDistance = distance; }
    }
    return nearestDistance < 90 ? nearest : null;
  }, [todayKey, weekDays]);

  const clearDrag = useCallback(() => {
    setDraggingItem(null); setDragY(null); setDropTargetDate(null);
  }, []);

  const showMoveFeedback = useCallback((text) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setMoveFeedback(text);
    feedbackTimerRef.current = setTimeout(() => {
      setMoveFeedback(null); feedbackTimerRef.current = null;
    }, 3600);
  }, []);

  const handleToggleItem = useCallback((item, index = 0) => {
    const key = `item:${getObjectKey(item, index)}`;
    setExpandedKey((current) => current === key ? null : key);
  }, []);

  const handleToggleEmpty = useCallback((dateKey) => {
    const key = `empty:${dateKey}`;
    setExpandedKey((current) => current === key ? null : key);
  }, []);

  const handleDragStart = useCallback((item, pageY) => {
    if (!canMoveWeekItem(item)) return;
    measureDays();
    setDraggingItem(item);
    setDragY(pageY);
    setDropTargetDate(item.recommendedDate);
    setExpandedKey(null);
  }, [measureDays]);

  const handleDragMove = useCallback((pageY) => {
    setDragY(pageY);
    setDropTargetDate(resolveDropTarget(pageY));
  }, [resolveDropTarget]);

  const performMove = useCallback(async (item, targetDate) => {
    if (!canMoveWeekItem(item) || !targetDate) { clearDrag(); return; }
    if (targetDate < todayKey) {
      clearDrag();
      showMoveFeedback('Impossible de déplacer une séance sur une journée passée.');
      return;
    }
    if (item.recommendedDate === targetDate) { clearDrag(); return; }
    const anchorDate = parseDateKey(contract?.weekStart) ?? new Date();
    setMovingItemId(item.planItemId);
    setContract((current) => withOptimisticWeekDate(current, item.planItemId, targetDate));
    clearDrag();
    try {
      const result = await moveWeekPlanItem({ planItemId: item.planItemId, targetDate, anchorDate });
      const refreshed = await getWeekReadContract({ anchorDate });
      setContract(refreshed);
      const ids = (refreshed?.visibleItems ?? []).map((entry) => entry?.sessionId).filter(Boolean);
      setExercisePreviews(await getWeekSessionExercisePreviews(ids));
      showMoveFeedback(result.hasCollision
        ? 'Deux séances sont maintenant sur ce jour. UGEROD les garde toutes les deux et tiendra compte de la charge.'
        : 'Jour mis à jour.');
    } catch (moveError) {
      console.warn('[MaSemaine] move failed', moveError);
      try { setContract(await getWeekReadContract({ anchorDate })); } catch (refreshError) {
        console.warn('[MaSemaine] recovery refresh failed', refreshError);
      }
      showMoveFeedback('Le déplacement n’a pas été enregistré.');
    } finally {
      setMovingItemId(null);
    }
  }, [clearDrag, contract?.weekStart, showMoveFeedback, todayKey]);

  const handleDragDrop = useCallback((item, pageY) => {
    performMove(item, resolveDropTarget(pageY) ?? dropTargetDate);
  }, [dropTargetDate, performMove, resolveDropTarget]);

  const handleRemoveWeekItem = useCallback(async () => {
    if (!removeItem?.planItemId || removingItemId) return;
    const anchorDate = parseDateKey(contract?.weekStart) ?? new Date();
    try {
      setRemovingItemId(removeItem.planItemId);
      await removeWeekPlanItem({ planItemId: removeItem.planItemId, anchorDate });
      const refreshed = await getWeekReadContract({ anchorDate });
      setContract(refreshed);
      const ids = (refreshed?.visibleItems ?? []).map((entry) => entry?.sessionId).filter(Boolean);
      setExercisePreviews(await getWeekSessionExercisePreviews(ids));
      setExpandedKey(null);
      setRemoveItem(null);
      showMoveFeedback('Séance retirée de ta semaine.');
    } catch (removeError) {
      console.warn('[MaSemaine] remove failed', removeError);
      showMoveFeedback('Impossible de retirer cette séance pour le moment.');
    } finally {
      setRemovingItemId(null);
    }
  }, [contract?.weekStart, removeItem, removingItemId, showMoveFeedback]);

  const handleAddSessionDay = useCallback((dateKey) => {
    setAddSessionOpen(false);
    router.push({
      pathname: '/workout/preparation',
      params: { date: dateKey, entry: 'week_assisted', origin: 'week_additional' },
    });
  }, []);

  const handleOpenSession = useCallback(async (item) => {
    const sessionId = item?.sessionId ?? null;
    if (!sessionId || openingSessionId) return;

    try {
      setOpeningSessionId(sessionId);
      const restored = await reloadWorkoutSession({ sessionId });
      setGeneratedWorkout(restored);
      router.push('/workout/session');
    } catch (openError) {
      console.warn('[MaSemaine] open session failed', openError);
      showMoveFeedback('Impossible d’ouvrir cette séance pour le moment.');
    } finally {
      setOpeningSessionId(null);
    }
  }, [openingSessionId, setGeneratedWorkout, showMoveFeedback]);

  if (action === 'new') return <View style={{ flex: 1, backgroundColor: palette.bg }} />;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bg }]}> 
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!draggingItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadWeek({ refresh: true })} tintColor={palette.accent} />}
      >
        <View style={styles.contentInner}>
          <View style={styles.header}>
            <TouchableOpacity
              style={[styles.backButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
              onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}
              accessibilityRole="button"
              accessibilityLabel="Retour"
              accessibilityHint="Revenir à l’écran précédent."
            >
              <Ionicons name="arrow-back" size={20} color={palette.text} />
            </TouchableOpacity>
            <View style={styles.headerText}>
              <Text style={[styles.eyebrow, { color: palette.accent }]}>COACH</Text>
              <Text style={[styles.title, { color: palette.text }]}>MA SEMAINE.</Text>
            </View>
            <TouchableOpacity
              style={[styles.profileButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
              onPress={() => router.push('/profile')}
              accessibilityRole="button"
            >
              <Ionicons name="person-outline" size={20} color={palette.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.rangeLine}>
            <Text style={[styles.rangeLabel, { color: palette.text }]}>{weekRange}</Text>
            {contract?.completedActualCount > 0 ? (
              <Text style={[styles.actualLabel, { color: palette.textMuted }]}> 
                {contract.completedActualCount} {contract.completedActualCount > 1 ? 'séances réalisées' : 'séance réalisée'}
              </Text>
            ) : null}
          </View>

          {moveFeedback ? (
            <View style={[styles.moveFeedback, { backgroundColor: palette.surface, borderColor: palette.border }]} accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle-outline" size={17} color={palette.accent} />
              <Text style={[styles.moveFeedbackText, { color: palette.textMuted }]}>{moveFeedback}</Text>
            </View>
          ) : null}

          {loading && !contract ? (
            <View style={styles.feedbackBlock}>
              <ActivityIndicator color={palette.accent} size="small" />
              <Text style={[styles.feedbackText, { color: palette.textMuted }]}>UGEROD prépare ta semaine…</Text>
            </View>
          ) : error && !contract ? (
            <View style={styles.feedbackBlock}>
              <Text style={[styles.feedbackTitle, { color: palette.text }]}>Impossible de charger la semaine.</Text>
              <TouchableOpacity style={[styles.retryButton, { borderColor: palette.border }]} onPress={() => loadWeek()}>
                <Text style={[styles.retryText, { color: palette.text }]}>RÉESSAYER</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.weekList}>
              {daysWithItems.map((day) => (
                <DaySection
                  key={day.key}
                  day={day}
                  palette={palette}
                  todayKey={todayKey}
                  expandedKey={expandedKey}
                  movingItemId={movingItemId}
                  exercisePreviews={exercisePreviews}
                  dropTarget={dropTargetDate}
                  registerDayRef={registerDayRef}
                  onToggleItem={handleToggleItem}
                  onToggleEmpty={handleToggleEmpty}
                  onImport={(dateKey) => { setImportDay(dateKey); setShareValue(''); }}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  onDragDrop={handleDragDrop}
                  onDragCancel={clearDrag}
                  onOpenSession={handleOpenSession}
                  openingSessionId={openingSessionId}
                  onRequestRemove={setRemoveItem}
                  removingItemId={removingItemId}
                />
              ))}
            </View>
          )}

          {!loading && contract ? (
            <View style={styles.addSessionSection}>
              <TouchableOpacity
                style={[
                  styles.addSessionButton,
                  { borderColor: planningSlotCount >= 5 ? palette.border : palette.accent },
                  planningSlotCount >= 5 && styles.disabledRow,
                ]}
                disabled={planningSlotCount >= 5}
                onPress={() => setAddSessionOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Ajouter une séance à cette semaine"
              >
                <Ionicons name="add-circle-outline" size={20} color={planningSlotCount >= 5 ? palette.textMuted : palette.accent} />
                <Text style={[styles.addSessionButtonText, { color: planningSlotCount >= 5 ? palette.textMuted : palette.text }]}>AJOUTER UNE SÉANCE</Text>
              </TouchableOpacity>
              <Text style={[styles.addSessionHint, { color: palette.textMuted }]}>
                {planningSlotCount >= 5 ? '5 séances sont déjà prévues.' : 'Pré-programmer une 4e ou 5e séance potentielle cette semaine.'}
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {draggingItem ? (
        <View pointerEvents="none" style={[
          styles.dragGhost,
          { top: Math.max(72, Number(dragY ?? 120) - 38), backgroundColor: palette.surfaceRaised, borderColor: palette.accent },
        ]}> 
          <View style={styles.dragGhostCopy}>
            <Text style={[styles.dragGhostTitle, { color: palette.text }]} numberOfLines={1}>{getShortSummary(draggingItem)}</Text>
            <Text style={[styles.dragGhostMeta, { color: palette.textMuted }]}> 
              {dropTargetDate
                ? `Déplacer vers ${daysWithItems.find((day) => day.key === dropTargetDate)?.label ?? ''} ${daysWithItems.find((day) => day.key === dropTargetDate)?.date.getDate() ?? ''}`
                : 'Choisis un jour'}
            </Text>
          </View>
          <DragDots color={palette.textMuted} />
        </View>
      ) : null}

      <AddSessionModal
        visible={addSessionOpen}
        days={daysWithItems}
        todayKey={todayKey}
        palette={palette}
        currentCount={planningSlotCount}
        onClose={() => setAddSessionOpen(false)}
        onSelectDay={handleAddSessionDay}
      />

      <RemoveSessionModal
        visible={Boolean(removeItem)}
        item={removeItem}
        palette={palette}
        removing={Boolean(removingItemId)}
        onClose={() => !removingItemId && setRemoveItem(null)}
        onConfirm={handleRemoveWeekItem}
      />

      <ImportModal
        visible={Boolean(importDay)}
        dateKey={importDay}
        palette={palette}
        shareValue={shareValue}
        onShareValueChange={setShareValue}
        onClose={() => { setImportDay(null); setShareValue(''); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 46 },
  contentInner: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  backButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: fontFamilies.bold, fontSize: 11, lineHeight: 15, letterSpacing: 1.8, marginBottom: 3 },
  title: { fontFamily: fontFamilies.display, fontSize: 38, lineHeight: 41, letterSpacing: 1.4 },
  profileButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rangeLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginTop: 26, marginBottom: 8 },
  rangeLabel: { fontFamily: fontFamilies.bold, fontSize: 13, lineHeight: 18, letterSpacing: 0.8 },
  actualLabel: { fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 17 },
  weekList: { width: '100%' },
  daySection: { flexDirection: 'row', paddingVertical: 17, borderBottomWidth: 1, borderLeftColor: 'transparent', paddingLeft: 0 },
  dayDateColumn: { width: 58, alignItems: 'flex-start', paddingTop: 3 },
  dayName: { fontFamily: fontFamilies.bold, fontSize: 10, lineHeight: 14, letterSpacing: 1, marginBottom: 4 },
  dayNumberWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayNumber: { fontFamily: fontFamilies.bold, fontSize: 15, lineHeight: 19 },
  dayContent: { flex: 1, minWidth: 0, gap: 9 },
  objectWrap: { width: '100%' },
  objectMoving: { opacity: 0.48 },
  intentObject: { minHeight: 70, borderLeftWidth: 3, borderRadius: 12, flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden' },
  sessionObject: { minHeight: 82, borderWidth: 1, borderLeftWidth: 4, borderRadius: 16, flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden' },
  objectPressArea: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', paddingLeft: 13, paddingRight: 8, paddingVertical: 12, gap: 8 },
  objectCopy: { flex: 1, minWidth: 0 },
  intentObjectTitle: { fontFamily: fontFamilies.bold, fontSize: 14, lineHeight: 19 },
  sessionObjectTitle: { fontFamily: fontFamilies.display, fontSize: 23, lineHeight: 25, letterSpacing: 0.6 },
  objectSubline: { fontFamily: fontFamilies.regular, fontSize: 11, lineHeight: 16, marginTop: 4 },
  objectMeta: { fontFamily: fontFamilies.semiBold, fontSize: 10, lineHeight: 15, marginTop: 5 },
  dragHandle: { width: 40, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1 },
  dragHandleSpacer: { width: 10 },
  removeButton: { width: 34, alignItems: 'center', justifyContent: 'center' },
  dragDots: { width: 14, height: 22, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignContent: 'space-between' },
  dragDot: { width: 4, height: 4, borderRadius: 2, marginHorizontal: 1, marginVertical: 1.5 },
  emptyDayWrap: { minHeight: 52, justifyContent: 'center' },
  emptyDayPress: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 },
  emptyDayText: { fontFamily: fontFamilies.medium, fontSize: 13, lineHeight: 19 },
  detailPanel: { marginTop: 9, borderTopWidth: 1, paddingTop: 14, paddingHorizontal: 2, paddingBottom: 4 },
  detailTitle: { fontFamily: fontFamilies.display, fontSize: 25, lineHeight: 28, letterSpacing: 0.6 },
  detailBody: { fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20 },
  detailSection: { marginTop: 15 },
  detailLabel: { fontFamily: fontFamilies.bold, fontSize: 9, lineHeight: 13, letterSpacing: 1.05, marginBottom: 5 },
  explanationText: { fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20 },
  exercisePreviewLine: { fontFamily: fontFamilies.semiBold, fontSize: 13, lineHeight: 20 },
  detailMeta: { fontFamily: fontFamilies.semiBold, fontSize: 11, lineHeight: 16, marginTop: 13 },
  coachTip: { marginTop: 14, borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  coachTipText: { flex: 1 },
  coachTipTitle: { fontFamily: fontFamilies.bold, fontSize: 9, lineHeight: 13, letterSpacing: 0.9, marginBottom: 3 },
  coachTipBody: { fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 18 },
  creationActions: { gap: 8, marginTop: 15 },
  actionButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  actionButtonText: { fontFamily: fontFamilies.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.7 },
  emptyActionsPanel: { borderTopWidth: 1, marginTop: 2, paddingTop: 12, paddingBottom: 4 },
  moveFeedback: { minHeight: 46, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 10, marginBottom: 4 },
  moveFeedbackText: { flex: 1, fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 17 },
  feedbackBlock: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 12 },
  feedbackTitle: { fontFamily: fontFamilies.bold, fontSize: 15, lineHeight: 21 },
  feedbackText: { fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 19 },
  retryButton: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: fontFamilies.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.7 },
  dragGhost: { position: 'absolute', left: 78, right: 18, minHeight: 68, zIndex: 500, elevation: 18, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  dragGhostCopy: { flex: 1, minWidth: 0 },
  dragGhostTitle: { fontFamily: fontFamilies.bold, fontSize: 13, lineHeight: 18 },
  dragGhostMeta: { fontFamily: fontFamilies.medium, fontSize: 10, lineHeight: 15, marginTop: 3 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.46)', justifyContent: 'flex-end' },
  importSheet: { width: '100%', maxWidth: 760, alignSelf: 'center', borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#929A93', opacity: 0.55, alignSelf: 'center', marginBottom: 15 },
  sheetTitle: { fontFamily: fontFamilies.display, fontSize: 29, lineHeight: 32, letterSpacing: 0.8 },
  sheetIntro: { fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20, marginTop: 5, marginBottom: 16 },
  importSourceButton: { minHeight: 76, borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  importSourceIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  importSourceCopy: { flex: 1 },
  importSourceTitle: { fontFamily: fontFamilies.bold, fontSize: 13, lineHeight: 18 },
  importSourceText: { fontFamily: fontFamilies.regular, fontSize: 11, lineHeight: 16, marginTop: 2 },
  shareBlock: { borderWidth: 1, borderRadius: 15, padding: 12, marginTop: 10 },
  shareHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  shareInput: { minHeight: 44, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontFamily: fontFamilies.medium, fontSize: 13, marginTop: 12 },
  shareFootnote: { fontFamily: fontFamilies.regular, fontSize: 10, lineHeight: 15, marginTop: 7 },
  sheetCloseButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  sheetCloseText: { fontFamily: fontFamilies.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.8 },
  addSessionSection: { marginTop: 22, marginBottom: 6 },
  addSessionButton: { minHeight: 50, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16 },
  addSessionButtonText: { fontFamily: fontFamilies.bold, fontSize: 12, lineHeight: 16, letterSpacing: 0.8 },
  addSessionHint: { fontFamily: fontFamilies.regular, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 7 },
  disabledRow: { opacity: 0.46 },
  addDayList: { gap: 8, marginTop: 2 },
  addDayRow: { minHeight: 62, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 11 },
  addDayDate: { width: 43, alignItems: 'center' },
  addDayName: { fontFamily: fontFamilies.bold, fontSize: 9, lineHeight: 12, letterSpacing: 0.8 },
  addDayNumber: { fontFamily: fontFamilies.bold, fontSize: 17, lineHeight: 21, marginTop: 1 },
  addDayCopy: { flex: 1 },
  addDayTitle: { fontFamily: fontFamilies.semiBold, fontSize: 12, lineHeight: 17 },
  addDaySubtitle: { fontFamily: fontFamilies.regular, fontSize: 10, lineHeight: 15, marginTop: 2 },
  limitNote: { fontFamily: fontFamilies.regular, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 10 },
  removeSheet: { width: '90%', maxWidth: 520, alignSelf: 'center', borderWidth: 1, borderRadius: 22, padding: 20 },
  removeIconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  removeTitle: { fontFamily: fontFamilies.display, fontSize: 26, lineHeight: 29, letterSpacing: 0.6 },
  removeText: { fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20, marginTop: 7 },
  removeActions: { flexDirection: 'row', gap: 9, marginTop: 18 },
  removeCancel: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  removeConfirm: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  removeCancelText: { fontFamily: fontFamilies.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.7 },
  removeConfirmText: { fontFamily: fontFamilies.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.7 },
});
