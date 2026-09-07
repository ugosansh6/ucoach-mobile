import fs from 'node:fs';

function mustReplace(text, label, search, replacement) {
  const next = typeof search === 'string' ? text.replace(search, replacement) : text.replace(search, replacement);
  if (next === text) throw new Error(`PLAY-009 patch failed: ${label}`);
  return next;
}

const path = 'src/components/workout/SessionOverviewSheet.js';
let text = fs.readFileSync(path, 'utf8');

if (!text.includes('  Image,\n  Modal,')) {
  text = mustReplace(
    text,
    'Image import',
    '  ActivityIndicator,\n  Modal,',
    '  ActivityIndicator,\n  Image,\n  Modal,'
  );
}

if (!text.includes('function prescriptionParts(value)')) {
  const helpers = `
const PRESCRIPTION_METRIC_PATTERN = /(\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?(?:\\s*[x×]\\s*\\d+(?:[.,]\\d+)?)?\\s*(?:reps?|rép(?:s|étitions)?|secondes?|secs?|sec|s|minutes?|mins?|min|tours?|rounds?|séries?|series|sets?|mètres?|metres?|km|kg|%|rpe|rir|m))/gi;
const PRESCRIPTION_METRIC_FULL = /^\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?(?:\\s*[x×]\\s*\\d+(?:[.,]\\d+)?)?\\s*(?:reps?|rép(?:s|étitions)?|secondes?|secs?|sec|s|minutes?|mins?|min|tours?|rounds?|séries?|series|sets?|mètres?|metres?|km|kg|%|rpe|rir|m)$/i;

function prescriptionParts(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(PRESCRIPTION_METRIC_PATTERN).filter(Boolean);
}

function isPrescriptionMetric(value) {
  return PRESCRIPTION_METRIC_FULL.test(String(value ?? '').trim());
}

function exerciseImageUri(exercise) {
  const value =
    exercise?.imagePath ??
    exercise?.image_path ??
    exercise?.imageUrl ??
    exercise?.image_url ??
    null;
  return typeof value === 'string' && /^https?:\\/\\//i.test(value) ? value : null;
}
`;
  text = mustReplace(
    text,
    'prescription helpers',
    /function normalizeText\(value\) \{[\s\S]*?\n\}\n\n(?=function exerciseStatus)/,
    (match) => `${match}${helpers}\n`
  );
}

if (!text.includes('const [detailExercise, setDetailExercise]')) {
  text = mustReplace(
    text,
    'detail state',
    "  const [swapError, setSwapError] = useState('');",
    "  const [swapError, setSwapError] = useState('');\n  const [detailExercise, setDetailExercise] = useState(null);"
  );
}

if (!text.includes('setDetailExercise(null);\n    }\n  }, [visible]);')) {
  text = mustReplace(
    text,
    'detail reset',
    "    if (!visible) {\n      setSwapExercise(null);\n      setSwapError('');\n    }",
    "    if (!visible) {\n      setSwapExercise(null);\n      setSwapError('');\n      setDetailExercise(null);\n    }"
  );
}

const oldExerciseContent = `                              <View style={styles.exerciseCopy}>
                                <Text style={[styles.exerciseName, current && styles.exerciseNameCurrent]}>
                                  {exercise.name ?? 'Exercice'}
                                </Text>
                                {exercise.prescription ? (
                                  <Text style={styles.exercisePrescription}>{normalizeText(exercise.prescription)}</Text>
                                ) : null}
                              </View>

                              {canSwap ? (
                                <Pressable
                                  disabled={loadingAvailability}
                                  onPress={() => {
                                    setSwapError('');
                                    setSwapExercise(exercise);
                                  }}
                                  style={({ pressed }) => [styles.swapButton, pressed && styles.pressed]}
                                >
                                  <Ionicons name="swap-horizontal-outline" size={17} color={colors.secondaryAccent} />
                                  <Text style={styles.swapText}>Swap</Text>
                                </Pressable>
                              ) : null}`;

const newExerciseContent = `                              <View style={styles.exerciseCopy}>
                                <View style={styles.exerciseTitleRow}>
                                  <Text style={[styles.exerciseName, current && styles.exerciseNameCurrent]}>
                                    {exercise.name ?? 'Exercice'}
                                  </Text>
                                  <Pressable
                                    onPress={() =>
                                      setDetailExercise({
                                        exercise,
                                        blockTitle: block.title,
                                        canSwap,
                                      })
                                    }
                                    hitSlop={6}
                                    accessibilityRole="button"
                                    accessibilityLabel={\`Détails de \${exercise.name ?? 'l’exercice'}\`}
                                    style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
                                  >
                                    <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
                                  </Pressable>
                                </View>
                                {exercise.prescription ? (
                                  <PrescriptionLine text={exercise.prescription} styles={styles} />
                                ) : null}
                              </View>`;

if (!text.includes('accessibilityLabel={`Détails de ${exercise.name')) {
  text = mustReplace(text, 'exercise row details', oldExerciseContent, newExerciseContent);
}

if (!text.includes('<ExerciseDetailModal')) {
  const detailInvocation = `
      <ExerciseDetailModal
        visible={Boolean(detailExercise)}
        exercise={detailExercise?.exercise ?? null}
        blockTitle={detailExercise?.blockTitle ?? null}
        canSwap={Boolean(detailExercise?.canSwap)}
        onClose={() => setDetailExercise(null)}
        onSwap={() => {
          const target = detailExercise?.exercise ?? null;
          setDetailExercise(null);
          if (target) {
            setSwapError('');
            setSwapExercise(target);
          }
        }}
        styles={styles}
        colors={colors}
      />

`;
  text = mustReplace(
    text,
    'detail modal invocation',
    '      <Modal\n        visible={Boolean(swapExercise)}',
    `${detailInvocation}      <Modal\n        visible={Boolean(swapExercise)}`
  );
}

if (!text.includes('function ExerciseDetailModal(')) {
  const components = `
function PrescriptionLine({ text, styles, large = false }) {
  const parts = prescriptionParts(text);
  if (parts.length === 0) return null;

  return (
    <Text style={[styles.exercisePrescription, large && styles.exercisePrescriptionLarge]}>
      {parts.map((part, index) => (
        <Text
          key={\`prescription-part-\${index}\`}
          style={isPrescriptionMetric(part) ? [styles.exercisePrescriptionStrong, large && styles.exercisePrescriptionStrongLarge] : null}
        >
          {part}
        </Text>
      ))}
    </Text>
  );
}

function ExerciseDetailModal({ visible, exercise, blockTitle, canSwap, onClose, onSwap, styles, colors }) {
  const imageUri = exerciseImageUri(exercise);
  const description = normalizeText(exercise?.description);
  const instructions = normalizeText(exercise?.instructions);
  const tips = normalizeText(exercise?.tips);
  const uniqueInstructions = instructions && instructions !== description ? instructions : '';
  const uniqueTips = tips && tips !== description && tips !== instructions ? tips : '';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.detailScreen}>
        <View style={styles.detailHeader}>
          <View style={styles.detailHeaderCopy}>
            <Text style={styles.detailEyebrow}>{blockTitle ?? 'EXERCICE'}</Text>
            <Text style={styles.detailTitle}>{exercise?.name ?? 'Exercice'}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
          <View style={styles.detailPrescriptionCard}>
            <Text style={styles.detailSectionLabel}>À FAIRE AUJOURD’HUI</Text>
            {exercise?.prescription ? (
              <PrescriptionLine text={exercise.prescription} styles={styles} large />
            ) : (
              <Text style={styles.detailBody}>Suis la prescription affichée dans ta séance.</Text>
            )}
          </View>

          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.detailImage} resizeMode="cover" />
          ) : (
            <View style={styles.detailImageFallback}>
              <View style={styles.detailImageFallbackIcon}>
                <Ionicons name="barbell-outline" size={34} color={colors.accent} />
              </View>
              <Text style={styles.detailImageFallbackText}>Visuel non disponible pour cet exercice</Text>
            </View>
          )}

          {description ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionLabel}>DESCRIPTION</Text>
              <Text style={styles.detailBody}>{description}</Text>
            </View>
          ) : null}

          {uniqueInstructions ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionLabel}>EXÉCUTION</Text>
              <Text style={styles.detailBody}>{uniqueInstructions}</Text>
            </View>
          ) : null}

          {uniqueTips ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionLabel}>CONSEIL UGEROD</Text>
              <Text style={styles.detailBody}>{uniqueTips}</Text>
            </View>
          ) : null}

          {!description && !uniqueInstructions && !uniqueTips ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionLabel}>DESCRIPTION</Text>
              <Text style={styles.detailBody}>Aucune consigne détaillée supplémentaire n’est disponible pour cet exercice.</Text>
            </View>
          ) : null}

          {canSwap ? (
            <Pressable onPress={onSwap} style={({ pressed }) => [styles.detailSwapButton, pressed && styles.pressed]}>
              <Ionicons name="swap-horizontal-outline" size={18} color={colors.secondaryAccent} />
              <Text style={styles.detailSwapText}>Adapter / remplacer l’exercice</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

`;
  text = mustReplace(text, 'detail components', '\nfunction createStyles(colors, isDark) {', `\n${components}function createStyles(colors, isDark) {`);
}

if (!text.includes('exercisePrescriptionStrong:')) {
  const stylePatch = `    exerciseCopy: { flex: 1 },
    exerciseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    exerciseName: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 13, color: colors.text },
    exerciseNameCurrent: { color: colors.secondaryAccent },
    exercisePrescription: { marginTop: 3, fontFamily: 'Manrope_500Medium', fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    exercisePrescriptionStrong: { fontFamily: 'Manrope_800ExtraBold', fontSize: 13, color: colors.accent },
    exercisePrescriptionLarge: { marginTop: 7, fontSize: 16, lineHeight: 23, color: colors.text },
    exercisePrescriptionStrongLarge: { fontSize: 18, color: colors.text },
    moreButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },`;
  text = mustReplace(
    text,
    'exercise prescription styles',
    "    exerciseCopy: { flex: 1 },\n    exerciseName: { fontFamily: 'Manrope_700Bold', fontSize: 13, color: colors.text },\n    exerciseNameCurrent: { color: colors.secondaryAccent },\n    exercisePrescription: { marginTop: 2, fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 16, color: colors.textSecondary },",
    stylePatch
  );
}

if (!text.includes('detailScreen:')) {
  const detailStyles = `    detailScreen: { flex: 1, backgroundColor: colors.background },
    detailHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    detailHeaderCopy: { flex: 1 },
    detailEyebrow: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: colors.accent },
    detailTitle: { marginTop: 4, fontFamily: 'Manrope_800ExtraBold', fontSize: 28, lineHeight: 34, color: colors.text },
    detailContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 36 },
    detailPrescriptionCard: { padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    detailImage: { width: '100%', height: 240, marginTop: 16, borderRadius: 18, backgroundColor: colors.surface },
    detailImageFallback: { minHeight: 210, marginTop: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
    detailImageFallbackIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    detailImageFallbackText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
    detailSection: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border },
    detailSectionLabel: { fontFamily: 'Manrope_800ExtraBold', fontSize: 10, letterSpacing: 0.8, color: colors.textSecondary },
    detailBody: { marginTop: 7, fontFamily: 'Manrope_500Medium', fontSize: 14, lineHeight: 22, color: colors.text },
    detailSwapButton: { minHeight: 52, marginTop: 22, borderRadius: 15, borderWidth: 1, borderColor: colors.secondaryAccent, backgroundColor: colors.secondaryAccentSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
    detailSwapText: { fontFamily: 'Manrope_800ExtraBold', fontSize: 13, color: colors.text },
`;
  text = mustReplace(text, 'detail styles', '    pressed: { opacity: 0.78 },', `${detailStyles}    pressed: { opacity: 0.78 },`);
}

if (!text.includes('function PrescriptionLine')) throw new Error('PLAY-009 verification failed: missing PrescriptionLine');
if (!text.includes('function ExerciseDetailModal')) throw new Error('PLAY-009 verification failed: missing ExerciseDetailModal');
if (!text.includes('ellipsis-horizontal')) throw new Error('PLAY-009 verification failed: missing ellipsis action');
if (!text.includes('exercisePrescriptionStrong')) throw new Error('PLAY-009 verification failed: missing metric emphasis');

fs.writeFileSync(path, text);
console.log('PLAY-009 overview prescription + exercise detail patch applied.');
