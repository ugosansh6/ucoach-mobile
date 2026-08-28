import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { colors, spacing, typography } from '../../src/constants';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import { generateWorkoutSession } from '../../src/services/workoutGenerationService';

const SURFACES = [
  ['GRASS', 'Herbe'],
  ['TRACK', 'Piste'],
  ['ROAD', 'Route / bitume'],
  ['TRAIL', 'Sentier'],
  ['SAND', 'Sable'],
  ['MIXED', 'Mixte'],
];

const OUTDOOR_PLACES = [
  ['PARK_GRASS_STADIUM', 'Parc / pelouse / stade'],
  ['ATHLETICS_TRACK', 'Piste athlétisme'],
  ['TRAIL_PATH', 'Trail / chemin'],
  ['STREET_WORKOUT', 'Street workout'],
  ['BEACH_SAND', 'Plage / sable'],
  ['URBAN_HARD', 'Urbain / bitume'],
  ['OTHER', 'Autre'],
];

function environmentLabel(code) {
  return code === 'GYM' ? 'SALLE' : 'EXTÉRIEUR';
}

export default function EnvironmentGeneratingScreen() {
  const {
    preparation,
    workout,
    updatePreparation,
    setGeneratedWorkout,
    setGeneratedWorkoutPreservingProgress,
  } = useWorkout();

  const environmentCode = String(preparation?.environmentCode ?? '')
    .trim()
    .toUpperCase();
  const needsOutdoorContext =
    environmentCode === 'OUTDOOR' && !preparation?.surfaceCode;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [control, setControl] = useState(null);
  const launchedRef = useRef(false);

  const label = useMemo(
    () => environmentLabel(environmentCode),
    [environmentCode]
  );

  const generate = useCallback(async () => {
    if (busy || (environmentCode === 'OUTDOOR' && !preparation?.surfaceCode)) {
      return;
    }

    setBusy(true);
    setError('');
    setControl(null);

    try {
      const nextWorkout = await generateWorkoutSession(preparation);

      if (nextWorkout?.controlStatus) {
        setControl(nextWorkout);
        return;
      }

      const sameSession =
        Boolean(workout.sessionId) &&
        workout.sessionId === nextWorkout?.sessionId;

      if (
        sameSession &&
        nextWorkout?.generationControlStatus === 'resume_existing'
      ) {
        setGeneratedWorkoutPreservingProgress(nextWorkout);
      } else {
        setGeneratedWorkout(nextWorkout);
      }

      router.replace('/workout/session');
    } catch (generationError) {
      setError(
        generationError?.message ??
          `Impossible de générer la séance ${label.toLowerCase()}.`
      );
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    environmentCode,
    label,
    preparation,
    setGeneratedWorkout,
    setGeneratedWorkoutPreservingProgress,
    workout.sessionId,
  ]);

  useEffect(() => {
    if (needsOutdoorContext || launchedRef.current) {
      return;
    }
    launchedRef.current = true;
    generate();
  }, [generate, needsOutdoorContext]);

  function selectSurface(surfaceCode) {
    updatePreparation({ surfaceCode });
  }

  function selectPlace(outdoorPlaceCode) {
    updatePreparation({ outdoorPlaceCode });
  }

  function continueOutdoor() {
    if (!preparation?.surfaceCode) {
      return;
    }
    launchedRef.current = true;
    generate();
  }

  function resumeExisting() {
    router.replace('/workout/session');
  }

  if (needsOutdoorContext && !busy) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={21} color={colors.textPrimary} />
          </Pressable>

          <Text style={styles.eyebrow}>CONTEXTE EXTÉRIEUR</Text>
          <Text style={styles.title}>
            SUR QUEL SOL ?<Text style={styles.dot}>.</Text>
          </Text>
          <Text style={styles.body}>
            La surface sert uniquement aux règles de faisabilité et de sécurité. Elle ne décide pas du contenu à la place de ta progression, de ta récupération ou du matériel réellement disponible.
          </Text>

          <View style={styles.grid}>
            {SURFACES.map(([code, text]) => {
              const selected = preparation?.surfaceCode === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => selectSurface(code)}
                  style={[styles.choice, selected && styles.choiceSelected]}
                >
                  <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                    {text.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>LIEU — OPTIONNEL</Text>
          <Text style={styles.caption}>
            Le lieu est un contexte faible : UGEROD n’en déduit jamais ton matériel.
          </Text>
          <View style={styles.grid}>
            {OUTDOOR_PLACES.map(([code, text]) => {
              const selected = preparation?.outdoorPlaceCode === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => selectPlace(code)}
                  style={[styles.choice, selected && styles.choiceSelected]}
                >
                  <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                    {text.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            disabled={!preparation?.surfaceCode}
            onPress={continueOutdoor}
            style={[styles.primaryButton, !preparation?.surfaceCode && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>CONTINUER</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.brandWhite} />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        {control ? (
          <>
            <Ionicons name="git-compare-outline" size={34} color={colors.primaryLight} />
            <Text style={styles.eyebrow}>SÉANCE EXISTANTE</Text>
            <Text style={styles.titleSmall}>UNE SÉANCE EST DÉJÀ ACTIVE.</Text>
            <Text style={styles.bodyCentered}>
              UGEROD ne remplace pas silencieusement une séance déjà générée ou commencée. Reprends-la, ou retourne au check-in pour décider explicitement quoi faire.
            </Text>
            <Pressable onPress={resumeExisting} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>REPRENDRE LA SÉANCE</Text>
            </Pressable>
            <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>RETOUR AU CHECK-IN</Text>
            </Pressable>
          </>
        ) : error ? (
          <>
            <Ionicons name="alert-circle-outline" size={34} color={colors.brandRed} />
            <Text style={styles.eyebrow}>GÉNÉRATION {label}</Text>
            <Text style={styles.titleSmall}>IMPOSSIBLE DE CONTINUER.</Text>
            <Text style={styles.bodyCentered}>{error}</Text>
            <Pressable onPress={generate} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>RÉESSAYER</Text>
            </Pressable>
            <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>RETOUR</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={colors.primaryLight} />
            <Text style={styles.eyebrow}>UGEROD PRÉPARE TA SÉANCE</Text>
            <Text style={styles.titleSmall}>GÉNÉRATION {label}.</Text>
            <Text style={styles.bodyCentered}>
              UGEROD applique ton contexte, tes garde-fous, ton matériel disponible et ta progression avant de construire les blocs.
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.xl, paddingBottom: 44 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 26 },
  eyebrow: { marginTop: 18, fontFamily: 'Oswald_600SemiBold', fontSize: 11, letterSpacing: 1.1, color: colors.textSecondary },
  title: { ...typography.display, marginTop: 6, fontSize: 42, lineHeight: 45, letterSpacing: 1.8, color: colors.textPrimary },
  titleSmall: { ...typography.display, marginTop: 6, fontSize: 32, lineHeight: 35, letterSpacing: 1.4, color: colors.textPrimary, textAlign: 'center' },
  dot: { color: colors.primaryLight },
  body: { marginTop: 10, fontFamily: 'Oswald_400Regular', fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  bodyCentered: { marginTop: 12, maxWidth: 520, fontFamily: 'Oswald_400Regular', fontSize: 12, lineHeight: 18, color: colors.textSecondary, textAlign: 'center' },
  sectionTitle: { marginTop: 24, fontFamily: 'Oswald_700Bold', fontSize: 12, letterSpacing: 0.7, color: colors.textPrimary },
  caption: { marginTop: 4, fontFamily: 'Oswald_400Regular', fontSize: 11, lineHeight: 16, color: colors.textMuted },
  grid: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 42, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  choiceSelected: { borderColor: colors.primaryLight, backgroundColor: colors.primary },
  choiceText: { fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 0.45, color: colors.textSecondary },
  choiceTextSelected: { color: colors.brandWhite },
  primaryButton: { minHeight: 50, marginTop: 24, paddingHorizontal: 20, borderRadius: 13, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryButtonText: { fontFamily: 'Oswald_700Bold', fontSize: 11, letterSpacing: 0.8, color: colors.brandWhite },
  secondaryButton: { minHeight: 44, marginTop: 8, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontFamily: 'Oswald_600SemiBold', fontSize: 10, letterSpacing: 0.6, color: colors.textMuted },
  disabled: { opacity: 0.45 },
});
