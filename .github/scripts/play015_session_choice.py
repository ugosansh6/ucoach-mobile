from pathlib import Path

# --- Preparation: distinguish prepared vs truly started and always show the two choices ---
prep = Path('src/workout/PreparationCheckinV4.js')
text = prep.read_text(encoding='utf-8')

old = """  ActivityIndicator,\n  Image,\n"""
new = """  ActivityIndicator,\n  Alert,\n  Image,\n"""
if old not in text:
    raise SystemExit('Preparation Alert import marker not found')
text = text.replace(old, new, 1)

old = """  const normalizedStatus = String(workout?.status ?? '').toLowerCase();\n  const hasActiveSession =\n    Boolean(workout?.sessionId) && !['completed', 'abandoned'].includes(normalizedStatus);\n"""
new = """  const normalizedStatus = String(workout?.status ?? '').toLowerCase();\n  const hasExistingSession =\n    Boolean(workout?.sessionId) && !['completed', 'abandoned'].includes(normalizedStatus);\n  const hasStartedSession = Boolean(\n    hasExistingSession &&\n      (workout?.sessionStarted ||\n        workout?.startedAt ||\n        workout?.startedLocalDate ||\n        workout?.wodStarted ||\n        workout?.wodStartedAt ||\n        workout?.wodRuntime?.started ||\n        normalizedStatus === 'in_progress' ||\n        (workout?.validatedBlocks ?? []).length > 0 ||\n        (workout?.exercises ?? []).some((exercise) => {\n          const status = String(exercise?.userExecutionStatus ?? exercise?.status ?? 'pending')\n            .trim()\n            .toLowerCase();\n          return ['completed', 'adapted', 'not_completed', 'skipped'].includes(status);\n        }))\n  );\n"""
if old not in text:
    raise SystemExit('Preparation active session marker not found')
text = text.replace(old, new, 1)

old = """  function handleGenerate() {\n    if (!painConfirmedToday) {\n      setSheet('pain');\n      return;\n    }\n\n    if (\n      environmentCode === 'OUTDOOR' &&\n      (!preparation?.outdoorPlaceCode || !preparation?.surfaceCode)\n    ) {\n      setSheet('location');\n      return;\n    }\n\n    updatePreparation({\n      duration,\n      readiness: readinessOption.value,\n      equipment,\n      region: focus,\n      environmentCode,\n    });\n    router.push('/workout/generating');\n  }\n"""
new = """  function handleGenerate({ replaceExisting = false } = {}) {\n    if (!painConfirmedToday) {\n      setSheet('pain');\n      return;\n    }\n\n    if (\n      environmentCode === 'OUTDOOR' &&\n      (!preparation?.outdoorPlaceCode || !preparation?.surfaceCode)\n    ) {\n      setSheet('location');\n      return;\n    }\n\n    updatePreparation({\n      duration,\n      readiness: readinessOption.value,\n      equipment,\n      region: focus,\n      environmentCode,\n    });\n\n    const navigate = () => {\n      if (replaceExisting) {\n        router.push({ pathname: '/workout/generating', params: { mode: 'new' } });\n      } else {\n        router.push('/workout/generating');\n      }\n    };\n\n    if (replaceExisting && hasStartedSession) {\n      Alert.alert(\n        'Générer une nouvelle séance ?',\n        'Cette séance contient déjà du travail enregistré. Elle sera conservée comme abandonnée et UGEROD préparera une nouvelle séance avec ton check-in actuel.',\n        [\n          { text: 'Annuler', style: 'cancel' },\n          { text: 'Nouvelle séance', style: 'destructive', onPress: navigate },\n        ]\n      );\n      return;\n    }\n\n    navigate();\n  }\n"""
if old not in text:
    raise SystemExit('Preparation handleGenerate marker not found')
text = text.replace(old, new, 1)

old = """        <Pressable\n          onPress={() => {\n            if (hasActiveSession) {\n              router.replace('/workout/session');\n              return;\n            }\n            handleGenerate();\n          }}\n          disabled={!hasActiveSession && equipmentLoading}\n          style={({ pressed }) => [\n            styles.primaryButton,\n            !hasActiveSession && !canGenerate && styles.primaryButtonPending,\n            pressed && (hasActiveSession || !equipmentLoading) && styles.pressed,\n          ]}\n        >\n          <Text style={styles.primaryButtonText}>\n            {hasActiveSession ? 'Reprendre sa séance' : 'Voir ma séance'}\n          </Text>\n          <Ionicons\n            name={hasActiveSession ? 'play' : 'arrow-forward'}\n            size={21}\n            color={colors.textOnAccent}\n          />\n        </Pressable>\n"""
new = """        <View style={styles.sessionActions}>\n          {hasExistingSession ? (\n            <>\n              <Pressable\n                onPress={() => router.replace('/workout/session')}\n                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}\n              >\n                <Text style={styles.primaryButtonText}>Reprendre ma séance</Text>\n                <Ionicons name=\"play\" size={21} color={colors.textOnAccent} />\n              </Pressable>\n\n              <Pressable\n                onPress={() => handleGenerate({ replaceExisting: true })}\n                disabled={equipmentLoading}\n                style={({ pressed }) => [\n                  styles.newSessionButton,\n                  !canGenerate && styles.primaryButtonPending,\n                  pressed && !equipmentLoading && styles.pressed,\n                ]}\n              >\n                <Text style={styles.newSessionButtonText}>Générer une nouvelle séance</Text>\n                <Ionicons name=\"refresh-outline\" size={20} color={colors.accent} />\n              </Pressable>\n            </>\n          ) : (\n            <Pressable\n              onPress={() => handleGenerate()}\n              disabled={equipmentLoading}\n              style={({ pressed }) => [\n                styles.primaryButton,\n                !canGenerate && styles.primaryButtonPending,\n                pressed && !equipmentLoading && styles.pressed,\n              ]}\n            >\n              <Text style={styles.primaryButtonText}>Voir ma séance</Text>\n              <Ionicons name=\"arrow-forward\" size={21} color={colors.textOnAccent} />\n            </Pressable>\n          )}\n        </View>\n"""
if old not in text:
    raise SystemExit('Preparation CTA marker not found')
text = text.replace(old, new, 1)

old = """    primaryButton: {\n      marginTop: 20,\n      minHeight: 58,\n"""
new = """    sessionActions: {\n      marginTop: 20,\n      gap: 10,\n    },\n    primaryButton: {\n      minHeight: 58,\n"""
if old not in text:
    raise SystemExit('Preparation primary style marker not found')
text = text.replace(old, new, 1)

old = """    primaryButtonText: {\n      fontFamily: MANROPE.bold,\n      fontSize: 17,\n      lineHeight: 22,\n      letterSpacing: -0.1,\n      color: colors.textOnAccent,\n    },\n\n\n    modalRoot: {\n"""
new = """    primaryButtonText: {\n      fontFamily: MANROPE.bold,\n      fontSize: 17,\n      lineHeight: 22,\n      letterSpacing: -0.1,\n      color: colors.textOnAccent,\n    },\n    newSessionButton: {\n      minHeight: 54,\n      borderRadius: 16,\n      borderWidth: 1,\n      borderColor: colors.accent,\n      backgroundColor: colors.surface,\n      flexDirection: 'row',\n      alignItems: 'center',\n      justifyContent: 'center',\n      gap: 9,\n    },\n    newSessionButtonText: {\n      fontFamily: MANROPE.bold,\n      fontSize: 15,\n      lineHeight: 20,\n      letterSpacing: -0.1,\n      color: colors.accent,\n    },\n\n\n    modalRoot: {\n"""
if old not in text:
    raise SystemExit('Preparation new session style marker not found')
text = text.replace(old, new, 1)
prep.write_text(text, encoding='utf-8')

# --- Generation service: explicit user-driven replacement lifecycle ---
service = Path('src/services/workoutGenerationService.js')
text = service.read_text(encoding='utf-8')
marker = """export async function discardUnstartedWorkoutSession(sessionId) {\n"""
insert = """export async function replaceWorkoutSessionByUser(sessionId, { allowStarted = false } = {}) {\n  if (!sessionId) {\n    throw new Error('Aucune séance à remplacer.');\n  }\n\n  const data = await runSupabaseRequestWithAuthRetry(() =>\n    supabase.rpc('replace_workout_session_by_user_v1', {\n      p_session_id: sessionId,\n      p_allow_started: Boolean(allowStarted),\n    })\n  );\n\n  if (data?.status === 'STARTED_SESSION_CONFIRM_REQUIRED') {\n    const error = new Error('Cette séance a réellement commencé. Confirme la création d’une nouvelle séance.');\n    error.code = 'STARTED_SESSION_CONFIRM_REQUIRED';\n    throw error;\n  }\n\n  if (!data?.replaced) {\n    throw new Error('La séance actuelle ne peut pas être remplacée.');\n  }\n\n  return data;\n}\n\n"""
if insert not in text:
    if marker not in text:
        raise SystemExit('workoutGenerationService insertion marker not found')
    text = text.replace(marker, insert + marker, 1)
service.write_text(text, encoding='utf-8')

# --- Generating screen: honor explicit new-session mode for every environment ---
gen = Path('app/workout/generating-themed.js')
text = gen.read_text(encoding='utf-8')

old = """import { router } from 'expo-router';\n"""
new = """import { router, useLocalSearchParams } from 'expo-router';\n"""
if old not in text:
    raise SystemExit('generating router import marker not found')
text = text.replace(old, new, 1)

old = """  discardUnstartedWorkoutSession,\n  generateWorkoutSession,\n"""
new = """  discardUnstartedWorkoutSession,\n  generateWorkoutSession,\n  replaceWorkoutSessionByUser,\n"""
if old not in text:
    raise SystemExit('generating service import marker not found')
text = text.replace(old, new, 1)

old = """export default function GeneratingThemedScreen() {\n  const { colors, isDark } = useUgerodTheme();\n"""
new = """export default function GeneratingThemedScreen() {\n  const searchParams = useLocalSearchParams();\n  const newSessionRequested = String(searchParams?.mode ?? '').toLowerCase() === 'new';\n  const { colors, isDark } = useUgerodTheme();\n"""
if old not in text:
    raise SystemExit('generating component marker not found')
text = text.replace(old, new, 1)

old = """  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState('');\n"""
new = """  const normalizedWorkoutStatus = String(workout?.status ?? '').toLowerCase();\n  const existingWorkoutActive =\n    Boolean(workout?.sessionId) && !['completed', 'abandoned'].includes(normalizedWorkoutStatus);\n  const existingWorkoutStarted = Boolean(\n    existingWorkoutActive &&\n      (workout?.sessionStarted ||\n        workout?.startedAt ||\n        workout?.startedLocalDate ||\n        workout?.wodStarted ||\n        workout?.wodStartedAt ||\n        workout?.wodRuntime?.started ||\n        normalizedWorkoutStatus === 'in_progress' ||\n        (workout?.validatedBlocks ?? []).length > 0)\n  );\n\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState('');\n"""
if old not in text:
    raise SystemExit('generating state marker not found')
text = text.replace(old, new, 1)

old = """      try {\n        const nextWorkout = await generateWorkoutSession(preparation, {\n          forceRecalculateStarted,\n          protectedSessionExerciseIds,\n        });\n        applyGenerationResult(nextWorkout);\n"""
new = """      try {\n        if (newSessionRequested && existingWorkoutActive && workout?.sessionId) {\n          await replaceWorkoutSessionByUser(workout.sessionId, {\n            allowStarted: existingWorkoutStarted,\n          });\n        }\n\n        const nextWorkout = await generateWorkoutSession(preparation, {\n          forceRecalculateStarted,\n          protectedSessionExerciseIds,\n        });\n        applyGenerationResult(nextWorkout);\n"""
if old not in text:
    raise SystemExit('generating generation call marker not found')
text = text.replace(old, new, 1)

old = """    }, [applyGenerationResult, label, missingOutdoorContext, preparation, protectedSessionExerciseIds]\n  );\n"""
new = """    }, [\n      applyGenerationResult,\n      existingWorkoutActive,\n      existingWorkoutStarted,\n      label,\n      missingOutdoorContext,\n      newSessionRequested,\n      preparation,\n      protectedSessionExerciseIds,\n      workout?.sessionId,\n    ]\n  );\n"""
if old not in text:
    raise SystemExit('generating callback deps marker not found')
text = text.replace(old, new, 1)

old = """  const canForceRecalculate =\n    !control?.environmentControlStatus &&\n    ['STARTED_SESSION_CONFIRM_REQUIRED', 'SAFETY_ADAPT_PARTIAL_RECALC_REQUIRED'].includes(controlStatus);\n\n  async function replaceExisting() {\n"""
new = """  const canReplaceStarted =\n    controlStatus === 'STARTED_SESSION_CONFIRM_REQUIRED' && Boolean(control?.sessionId);\n  const canForceRecalculate =\n    controlStatus === 'SAFETY_ADAPT_PARTIAL_RECALC_REQUIRED';\n\n  async function replaceExisting() {\n"""
if old not in text:
    raise SystemExit('generating control flags marker not found')
text = text.replace(old, new, 1)

marker = """  const controlCopy = useMemo(() => {\n"""
insert = """  async function replaceStartedAndGenerate() {\n    if (!canReplaceStarted || busyRef.current) return;\n    busyRef.current = true;\n    setBusy(true);\n    setError('');\n    setControl(null);\n    try {\n      await replaceWorkoutSessionByUser(control.sessionId, { allowStarted: true });\n      const nextWorkout = await generateWorkoutSession(preparation, { protectedSessionExerciseIds });\n      applyGenerationResult(nextWorkout);\n    } catch (replaceError) {\n      setError(replaceError?.message ?? 'Impossible de remplacer la séance commencée.');\n    } finally {\n      busyRef.current = false;\n      setBusy(false);\n    }\n  }\n\n"""
if insert not in text:
    if marker not in text:
        raise SystemExit('generating controlCopy marker not found')
    text = text.replace(marker, insert + marker, 1)

old = """    return {\n      eyebrow: 'SÉANCE EN COURS',\n      title: 'UNE SÉANCE A DÉJÀ COMMENCÉ.',\n      body: canForceRecalculate\n        ? 'Tu peux la reprendre. Un recalcul complet effacera la progression enregistrée sur cette séance.'\n        : 'UGEROD protège cette séance : reprends-la ou retourne au check-in.',\n    };\n  }, [canForceRecalculate, canReplaceExisting, controlStatus]);\n"""
new = """    return {\n      eyebrow: 'SÉANCE EN COURS',\n      title: 'UNE SÉANCE A DÉJÀ COMMENCÉ.',\n      body: canReplaceStarted\n        ? 'Tu peux la reprendre ou choisir une nouvelle séance. Le travail déjà enregistré restera attaché à la séance abandonnée.'\n        : canForceRecalculate\n          ? 'Tu peux la reprendre ou recalculer les éléments restants.'\n          : 'UGEROD protège cette séance : reprends-la ou retourne au check-in.',\n    };\n  }, [canForceRecalculate, canReplaceExisting, canReplaceStarted, controlStatus]);\n"""
if old not in text:
    raise SystemExit('generating control copy marker not found')
text = text.replace(old, new, 1)

old = """          {canForceRecalculate ? (\n            <Pressable\n              onPress={() => generate({ forceRecalculateStarted: true })}\n              disabled={busy}\n              style={styles.dangerButton}\n            >\n              <Text style={styles.dangerButtonText}>TOUT RECALCULER</Text>\n            </Pressable>\n          ) : null}\n"""
new = """          {canReplaceStarted ? (\n            <Pressable\n              onPress={replaceStartedAndGenerate}\n              disabled={busy}\n              style={styles.dangerButton}\n            >\n              <Text style={styles.dangerButtonText}>GÉNÉRER UNE NOUVELLE SÉANCE</Text>\n            </Pressable>\n          ) : null}\n          {canForceRecalculate ? (\n            <Pressable\n              onPress={() => generate({ forceRecalculateStarted: true })}\n              disabled={busy}\n              style={styles.dangerButton}\n            >\n              <Text style={styles.dangerButtonText}>RECALCULER LES ÉLÉMENTS RESTANTS</Text>\n            </Pressable>\n          ) : null}\n"""
if old not in text:
    raise SystemExit('generating recalc button marker not found')
text = text.replace(old, new, 1)
gen.write_text(text, encoding='utf-8')
