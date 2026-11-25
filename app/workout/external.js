import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../src/constants';
import {
  saveStructuredExternalSession,
  searchExternalSessionExercises,
} from '../../src/services/externalSessionService';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(value) {
  const [year, month, day] = String(value ?? '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export default function ExternalSessionScreen() {
  const [dateKey, setDateKey] = useState(localDateKey());
  const [duration, setDuration] = useState('45');
  const [globalRpe, setGlobalRpe] = useState('');
  const [feeling, setFeeling] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  function addExercise(exercise) {
    setItems((current) => [
      ...current,
      {
        key: `${exercise.id}-${Date.now()}-${current.length}`,
        exercise,
        reps: '',
        loadKg: '',
        durationSeconds: '',
        distanceMeters: '',
        rpe: '',
      },
    ]);
    setSearchOpen(false);
  }

  function updateItem(key, patch) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function removeItem(key) {
    setItems((current) => current.filter((item) => item.key !== key));
  }

  async function save() {
    const performedAt = dateFromKey(dateKey);
    if (!performedAt) {
      Alert.alert('Date invalide', 'Utilise le format AAAA-MM-JJ.');
      return;
    }

    if (items.length === 0) {
      Alert.alert('Séance vide', 'Ajoute au moins un exercice.');
      return;
    }

    try {
      setSaving(true);
      const result = await saveStructuredExternalSession({
        durationMinutes: duration,
        performedAt,
        globalRpe,
        postWorkoutFeeling: feeling,
        notes,
        exercises: items,
      });

      Alert.alert(
        'Séance ajoutée',
        'La séance est intégrée à ton historique et pourra alimenter le Coach Engine.',
        [
          {
            text: 'Voir ma progression',
            onPress: () => router.replace('/(tabs)/progression'),
          },
        ]
      );

      return result;
    } catch (error) {
      Alert.alert('Enregistrement impossible', error?.message ?? 'Réessaie plus tard.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ImageBackground source={backgroundImage} style={styles.background} resizeMode="cover">
        <View style={styles.darkOverlay} />
        <LinearGradient
          colors={['rgba(7,9,12,0.42)', 'rgba(7,9,12,0.84)', 'rgba(7,9,12,0.99)']}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <Pressable onPress={() => router.back()} style={styles.backButton}>
                <Ionicons name="arrow-back" size={21} color={colors.textPrimary} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>AJOUTER</Text>
                <Text style={styles.title}>
                  SÉANCE EXTERNE<Text style={styles.blueDot}>.</Text>
                </Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <Ionicons name="person-add-outline" size={20} color={colors.primaryLight} />
              <Text style={styles.infoText}>
                Pour une séance faite en box, avec un coach ou seul. Tu sélectionnes les mouvements réellement effectués : UGEROD les intègre à ton historique sans les confondre avec une séance générée par l’app.
              </Text>
            </View>

            <SectionTitle title="LA SÉANCE" />
            <View style={styles.metaGrid}>
              <Field label="DATE" value={dateKey} onChangeText={setDateKey} placeholder="AAAA-MM-JJ" />
              <Field label="DURÉE (MIN)" value={duration} onChangeText={setDuration} keyboardType="number-pad" placeholder="45" />
            </View>

            <View style={styles.metaGrid}>
              <Field label="RPE GLOBAL" value={globalRpe} onChangeText={setGlobalRpe} keyboardType="number-pad" placeholder="Optionnel" />
              <Field label="RESSENTI /10" value={feeling} onChangeText={setFeeling} keyboardType="number-pad" placeholder="Optionnel" />
            </View>

            <SectionTitle title="MOUVEMENTS" meta={`${items.length} AJOUTÉ${items.length > 1 ? 'S' : ''}`} />

            {items.length > 0 ? (
              <View style={styles.exerciseList}>
                {items.map((item, index) => (
                  <ExternalExerciseRow
                    key={item.key}
                    item={item}
                    index={index}
                    onChange={(patch) => updateItem(item.key, patch)}
                    onRemove={() => removeItem(item.key)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Ionicons name="barbell-outline" size={22} color={colors.textMuted} />
                <Text style={styles.emptyText}>Ajoute les exercices que tu as réellement faits.</Text>
              </View>
            )}

            <Pressable onPress={() => setSearchOpen(true)} style={styles.addExerciseButton}>
              <Ionicons name="add" size={19} color={colors.primaryLight} />
              <Text style={styles.addExerciseText}>AJOUTER UN MOUVEMENT</Text>
            </Pressable>

            <SectionTitle title="NOTE" meta="OPTIONNEL" />
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Contexte, coach, box, ressenti..."
              placeholderTextColor={colors.textMuted}
              multiline
              style={styles.notesInput}
            />

            <Pressable disabled={saving || items.length === 0} onPress={save} style={[styles.saveButton, (saving || items.length === 0) && styles.saveButtonDisabled]}>
              {saving ? (
                <ActivityIndicator size="small" color={colors.brandWhite} />
              ) : (
                <>
                  <Text style={styles.saveText}>ENREGISTRER LA SÉANCE</Text>
                  <Ionicons name="checkmark-circle-outline" size={19} color={colors.brandWhite} />
                </>
              )}
            </Pressable>

            <Text style={styles.futureHint}>
              Import texte et photo viendront ensuite comme raccourcis de saisie. La validation utilisateur restera l’autorité avant intégration à l’historique.
            </Text>

            <View style={{ height: 35 }} />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>

      <ExerciseSearchModal
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={addExercise}
      />
    </View>
  );
}

function ExternalExerciseRow({ item, index, onChange, onRemove }) {
  const modes = Array.isArray(item.exercise?.tracking_modes) ? item.exercise.tracking_modes : [];

  return (
    <View style={styles.exerciseCard}>
      <View style={styles.exerciseHeader}>
        <View style={styles.exerciseNumber}>
          <Text style={styles.exerciseNumberText}>{index + 1}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.exerciseName}>{item.exercise.name.toUpperCase()}</Text>
          <Text style={styles.exerciseModes}>{modes.join(' · ').toUpperCase() || 'PERFORMANCE'}</Text>
        </View>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.exerciseFields}>
        {modes.includes('reps') ? (
          <MiniField label="REPS" value={item.reps} onChangeText={(value) => onChange({ reps: value })} />
        ) : null}
        {modes.includes('load') ? (
          <MiniField label="KG" value={item.loadKg} onChangeText={(value) => onChange({ loadKg: value })} decimal />
        ) : null}
        {modes.includes('time') ? (
          <MiniField label="SEC" value={item.durationSeconds} onChangeText={(value) => onChange({ durationSeconds: value })} />
        ) : null}
        {modes.includes('distance') ? (
          <MiniField label="MÈTRES" value={item.distanceMeters} onChangeText={(value) => onChange({ distanceMeters: value })} decimal />
        ) : null}
        <MiniField label="RPE" value={item.rpe} onChangeText={(value) => onChange({ rpe: value })} />
      </View>
    </View>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput {...props} placeholderTextColor={colors.textMuted} style={styles.input} />
    </View>
  );
}

function MiniField({ label, value, onChangeText, decimal }) {
  return (
    <View style={styles.miniField}>
      <Text style={styles.miniLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        placeholder="—"
        placeholderTextColor={colors.textMuted}
        style={styles.miniInput}
      />
    </View>
  );
}

function SectionTitle({ title, meta }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

function ExerciseSearchModal({ visible, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return undefined;

    const timeout = setTimeout(async () => {
      try {
        setLoading(true);
        setResults(await searchExternalSessionExercises(query));
      } catch (error) {
        console.warn('External exercise search', error);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => clearTimeout(timeout);
  }, [visible, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>AJOUTER UN MOUVEMENT</Text>
            <Pressable onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher..."
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            autoFocus
          />
          {loading ? <ActivityIndicator color={colors.primaryLight} style={{ marginVertical: 15 }} /> : null}
          <ScrollView keyboardShouldPersistTaps="handled">
            {results.map((exercise) => (
              <Pressable key={exercise.id} onPress={() => onSelect(exercise)} style={styles.searchRow}>
                <View>
                  <Text style={styles.searchName}>{exercise.name}</Text>
                  <Text style={styles.searchMeta}>{(exercise.tracking_modes ?? []).join(' · ').toUpperCase()}</Text>
                </View>
                <Ionicons name="add-circle-outline" size={19} color={colors.primaryLight} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  background: { flex: 1 },
  darkOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,6,9,0.58)' },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 65 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  backButton: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  eyebrow: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 1.4 },
  title: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 34 },
  blueDot: { color: colors.primaryLight },
  infoCard: { flexDirection: 'row', gap: 12, padding: 15, borderRadius: 16, backgroundColor: 'rgba(73,157,255,0.10)', borderWidth: 1, borderColor: 'rgba(73,157,255,0.16)' },
  infoText: { flex: 1, color: colors.textSecondary, fontFamily: 'Oswald_400Regular', fontSize: 12, lineHeight: 18 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 24, marginBottom: 9 },
  sectionTitle: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 14, letterSpacing: 0.7 },
  sectionMeta: { color: colors.textMuted, fontFamily: 'Oswald_500Medium', fontSize: 9 },
  metaGrid: { flexDirection: 'row', gap: 10 },
  fieldWrap: { flex: 1 },
  fieldLabel: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 8, letterSpacing: 0.5, marginBottom: 5 },
  input: { minHeight: 46, borderRadius: 12, paddingHorizontal: 13, color: colors.textPrimary, fontFamily: 'Oswald_400Regular', fontSize: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 10 },
  exerciseList: { gap: 9 },
  exerciseCard: { padding: 14, borderRadius: 17, backgroundColor: 'rgba(12,15,20,0.91)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  exerciseHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exerciseNumber: { width: 27, height: 27, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(73,157,255,0.13)' },
  exerciseNumberText: { color: colors.primaryLight, fontFamily: 'Oswald_600SemiBold', fontSize: 11 },
  exerciseName: { color: colors.textPrimary, fontFamily: 'Oswald_600SemiBold', fontSize: 12 },
  exerciseModes: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 8, marginTop: 2 },
  exerciseFields: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 },
  miniField: { minWidth: 66, flexGrow: 1 },
  miniLabel: { color: colors.textMuted, fontFamily: 'Oswald_600SemiBold', fontSize: 7, marginBottom: 4 },
  miniInput: { height: 39, borderRadius: 10, paddingHorizontal: 10, color: colors.textPrimary, fontFamily: 'Oswald_500Medium', fontSize: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 17, borderRadius: 16, backgroundColor: 'rgba(12,15,20,0.75)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  emptyText: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 12 },
  addExerciseButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 12, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(73,157,255,0.22)', backgroundColor: 'rgba(73,157,255,0.08)' },
  addExerciseText: { color: colors.primaryLight, fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 0.5 },
  notesInput: { minHeight: 82, textAlignVertical: 'top', borderRadius: 13, padding: 13, color: colors.textPrimary, fontFamily: 'Oswald_400Regular', fontSize: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 50, borderRadius: 14, backgroundColor: colors.primaryLight, marginTop: 24 },
  saveButtonDisabled: { opacity: 0.35 },
  saveText: { color: colors.brandWhite, fontFamily: 'Oswald_600SemiBold', fontSize: 11, letterSpacing: 0.7 },
  futureHint: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 10, lineHeight: 15, marginTop: 11, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.68)' },
  modalSheet: { height: '78%', backgroundColor: '#0B0F14', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
  modalHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 15 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { color: colors.textPrimary, fontFamily: 'BebasNeue_400Regular', fontSize: 27 },
  searchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  searchName: { color: colors.textSecondary, fontFamily: 'Oswald_500Medium', fontSize: 12 },
  searchMeta: { color: colors.textMuted, fontFamily: 'Oswald_400Regular', fontSize: 8, marginTop: 2 },
});
