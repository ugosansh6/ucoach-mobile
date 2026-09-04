import fs from 'node:fs';

function mustReplace(text, label, search, replacement) {
  const next = text.replace(search, replacement);
  if (next === text) {
    throw new Error(`PLAY-003/004 patch failed: ${label}`);
  }
  return next;
}

function patchFocusedCore() {
  const path = 'app/workout/session-focused-core.js';
  let text = fs.readFileSync(path, 'utf8');

  if (!text.includes('function normalizeDetailText(value)')) {
    text = mustReplace(
      text,
      'insert short instruction helpers',
      '\nfunction buildBlockStructure(blockId, source, exercises) {',
      `\nfunction normalizeDetailText(value) {\n  if (value == null) return '';\n  return String(value)\n    .replace(/\\\\r\\\\n|\\\\n|\\\\r/g, '\\n')\n    .replace(/\\r\\n?/g, '\\n')\n    .replace(/(^|\\n)\\s*(\\d+)[.)-]?\\s+/g, (_, prefix, number) => \\`${'${prefix}'}${'${number}'}. \\`)\n    .replace(/\\n{3,}/g, '\\n\\n')\n    .trim();\n}\n\nfunction shortCue(exercise) {\n  const value = normalizeDetailText(\n    exercise?.tips ?? exercise?.instructions ?? exercise?.description ?? ''\n  );\n  if (!value) return null;\n\n  const line = value.split(/\\n+/)[0].replace(/^\\d+\\.\\s*/, '').trim();\n  const sentence = line.match(/^(.{1,150}?[.!?])(?:\\s|$)/)?.[1] ?? line;\n  return sentence.length > 150 ? \\`${'${sentence.slice(0, 147).trim()}'}…\\` : sentence;\n}\n\nfunction buildBlockStructure(blockId, source, exercises) {`
    );
  }

  text = mustReplace(
    text,
    'accept player shell callbacks',
    'export default function SessionFocusedCore() {',
    `export default function SessionFocusedCore({\n  onOpenOverview,\n  onOpenPlanB,\n  showPlanB = false,\n} = {}) {`
  );

  text = mustReplace(
    text,
    'derive short cue',
    '  const imageUri = exerciseImageUri(activeExercise);\n',
    '  const imageUri = exerciseImageUri(activeExercise);\n  const cue = shortCue(activeExercise);\n'
  );

  if (!text.includes('async function refuseCurrentExercise()')) {
    text = mustReplace(
      text,
      'insert refuse action',
      '\n  const wodUnlocked = useMemo(() => {',
      `\n  async function refuseCurrentExercise() {\n    if (!activeBlock || !activeExercise) return;\n\n    try {\n      await ensureSessionStarted();\n    } catch (error) {\n      Alert.alert('Impossible de démarrer la séance', error?.message ?? 'Réessaie.');\n      return;\n    }\n\n    if (activeExerciseIndex >= activeBlock.exercises.length - 1) {\n      finalizeBlock(activeBlock, {\n        exercise: activeExercise,\n        values: { status: 'not_completed' },\n      });\n      return;\n    }\n\n    patchExercise(activeExercise, { status: 'not_completed' });\n    moveExercise(1);\n  }\n\n  const wodUnlocked = useMemo(() => {`
    );
  }

  text = mustReplace(
    text,
    'compact header meta',
    '          <Text style={styles.headerTitle}>{activeBlock.title}</Text>\n',
    `          <Text style={styles.headerTitle}>{activeBlock.title}</Text>\n          {activeBlock.structure ? (\n            <Text numberOfLines={1} style={styles.headerMeta}>{activeBlock.structure}</Text>\n          ) : null}\n`
  );

  text = mustReplace(
    text,
    'header actions and overview access',
    `        <View style={styles.durationPill}>\n          <Text style={styles.durationValue}>{activeBlock.durationLabel ?? '—'}</Text>\n        </View>`,
    `        <View style={styles.headerActions}>\n          <View style={styles.durationPill}>\n            <Text style={styles.durationValue}>{activeBlock.durationLabel ?? '—'}</Text>\n          </View>\n          {typeof onOpenOverview === 'function' ? (\n            <Pressable\n              onPress={onOpenOverview}\n              accessibilityRole="button"\n              accessibilityLabel="Voir ma séance"\n              style={styles.overviewButton}\n            >\n              <Ionicons name="clipboard-outline" size={17} color={colors.text} />\n              <Text style={styles.overviewButtonText}>Séance</Text>\n            </Pressable>\n          ) : null}\n          {showPlanB && typeof onOpenPlanB === 'function' ? (\n            <Pressable\n              onPress={onOpenPlanB}\n              accessibilityRole="button"\n              accessibilityLabel="Plan B"\n              style={styles.planBHeaderButton}\n            >\n              <Ionicons name="shuffle-outline" size={18} color={colors.secondaryAccent} />\n            </Pressable>\n          ) : null}\n        </View>`
  );

  text = mustReplace(
    text,
    'remove duplicated block intro',
    `        <View style={styles.blockIntro}>\n          <View style={styles.blockIntroCopy}>\n            <Text style={styles.blockKicker}>Bloc actif</Text>\n            <Text style={styles.blockTitle}>{activeBlock.title}</Text>\n            {activeBlock.structure ? <Text style={styles.blockStructure}>{activeBlock.structure}</Text> : null}\n          </View>\n          <Text style={styles.blockCounter}>{activeBlockIndex + 1}/{blocks.length}</Text>\n        </View>\n\n`,
    ''
  );

  text = mustReplace(
    text,
    'always visible essential cue',
    `              {activeExercise?.prescription ? (\n                <Text style={styles.exercisePrescription}>{String(activeExercise.prescription)}</Text>\n              ) : null}\n\n              {activeBlock.objective ? (`,
    `              {activeExercise?.prescription ? (\n                <Text style={styles.exercisePrescription}>{String(activeExercise.prescription)}</Text>\n              ) : null}\n\n              {cue ? (\n                <View style={styles.cueBox}>\n                  <View style={styles.cueIcon}>\n                    <Ionicons name="flash-outline" size={15} color={colors.secondaryAccent} />\n                  </View>\n                  <View style={styles.cueCopy}>\n                    <Text style={styles.cueLabel}>L’essentiel</Text>\n                    <Text style={styles.cueText}>{cue}</Text>\n                  </View>\n                </View>\n              ) : null}\n\n              {activeBlock.objective ? (`
  );

  text = mustReplace(
    text,
    'normalize instruction line breaks',
    '{String(activeExercise.instructions)}',
    '{normalizeDetailText(activeExercise.instructions)}'
  );
  text = mustReplace(
    text,
    'normalize tip line breaks',
    '{String(activeExercise.tips)}',
    '{normalizeDetailText(activeExercise.tips)}'
  );

  text = mustReplace(
    text,
    'replace hidden status menu with visible refuse',
    `                <Pressable onPress={() => setStatusExercise(activeExercise)} style={styles.secondaryActionCompact}>\n                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />\n                </Pressable>`,
    `                <Pressable onPress={refuseCurrentExercise} style={styles.refuseAction}>\n                  <Ionicons name="close-circle-outline" size={18} color={colors.secondaryAccent} />\n                  <Text style={styles.refuseActionText}>Refuser</Text>\n                </Pressable>`
  );

  text = mustReplace(
    text,
    'make completed action explicit',
    `            <Pressable onPress={completeCurrentExercise} style={styles.primaryButtonLarge}>\n              <Text style={styles.primaryButtonTextLarge}>\n                {activeExerciseIndex >= activeBlock.exercises.length - 1\n                  ? activeBlock.id === 'skill'\n                    ? 'Terminer le Skill'\n                    : \\`Terminer le ${'${activeBlock.title}'}\\`\n                  : 'Exercice terminé'}\n              </Text>\n              <Ionicons name="arrow-forward" size={19} color={colors.textOnAccent} />\n            </Pressable>`,
    `            <Pressable onPress={completeCurrentExercise} style={styles.primaryButtonLarge}>\n              <Ionicons name="checkmark-circle-outline" size={20} color={colors.textOnAccent} />\n              <Text style={styles.primaryButtonTextLarge}>\n                {activeExerciseIndex >= activeBlock.exercises.length - 1\n                  ? activeBlock.id === 'skill'\n                    ? 'Réalisé · terminer le Skill'\n                    : 'Réalisé · terminer le bloc'\n                  : 'Réalisé · suivant'}\n              </Text>\n            </Pressable>`
  );

  text = mustReplace(text, 'compact player header height', '      minHeight: 72,', '      minHeight: 76,');
  text = mustReplace(text, 'header copy shrink', '    headerCopy: { flex: 1 },', '    headerCopy: { flex: 1, minWidth: 0 },');
  text = mustReplace(
    text,
    'insert header meta style',
    `    headerTitle: {\n      marginTop: 1,\n      fontFamily: 'Manrope_800ExtraBold',\n      fontSize: 21,\n      lineHeight: 27,\n      color: colors.text,\n    },`,
    `    headerTitle: {\n      marginTop: 1,\n      fontFamily: 'Manrope_800ExtraBold',\n      fontSize: 21,\n      lineHeight: 27,\n      color: colors.text,\n    },\n    headerMeta: {\n      marginTop: 1,\n      fontFamily: 'Manrope_500Medium',\n      fontSize: 10,\n      lineHeight: 14,\n      color: colors.textSecondary,\n    },`
  );

  text = mustReplace(
    text,
    'insert header action styles',
    `    durationValue: {\n      fontFamily: 'Manrope_700Bold',\n      fontSize: 11,\n      color: colors.textSecondary,\n    },\n    progressTrack:`,
    `    durationValue: {\n      fontFamily: 'Manrope_700Bold',\n      fontSize: 11,\n      color: colors.textSecondary,\n    },\n    headerActions: {\n      flexDirection: 'row',\n      alignItems: 'center',\n      gap: 6,\n    },\n    overviewButton: {\n      minHeight: 36,\n      paddingHorizontal: 10,\n      borderRadius: 12,\n      borderWidth: 1,\n      borderColor: colors.border,\n      backgroundColor: colors.surface,\n      flexDirection: 'row',\n      alignItems: 'center',\n      gap: 5,\n    },\n    overviewButtonText: {\n      fontFamily: 'Manrope_700Bold',\n      fontSize: 10,\n      color: colors.text,\n    },\n    planBHeaderButton: {\n      width: 36,\n      height: 36,\n      borderRadius: 12,\n      borderWidth: 1,\n      borderColor: colors.secondaryAccent,\n      backgroundColor: colors.surface,\n      alignItems: 'center',\n      justifyContent: 'center',\n    },\n    progressTrack:`
  );

  text = mustReplace(text, 'reduce bottom spacing', '    content: { padding: spacing.lg, paddingBottom: 150 },', '    content: { padding: spacing.lg, paddingBottom: 64 },');
  text = mustReplace(text, 'reduce media height', '      height: 235,', '      height: 210,');

  text = mustReplace(
    text,
    'insert cue styles',
    `    objectiveBox: {`,
    `    cueBox: {\n      marginTop: 13,\n      padding: 12,\n      borderRadius: 14,\n      borderWidth: 1,\n      borderColor: colors.secondaryAccent,\n      backgroundColor: colors.secondaryAccentSoft,\n      flexDirection: 'row',\n      alignItems: 'flex-start',\n      gap: 10,\n    },\n    cueIcon: {\n      width: 28,\n      height: 28,\n      borderRadius: 14,\n      alignItems: 'center',\n      justifyContent: 'center',\n      backgroundColor: colors.surface,\n    },\n    cueCopy: { flex: 1 },\n    cueLabel: {\n      fontFamily: 'Manrope_800ExtraBold',\n      fontSize: 9,\n      letterSpacing: 0.5,\n      textTransform: 'uppercase',\n      color: colors.secondaryAccent,\n    },\n    cueText: {\n      marginTop: 3,\n      fontFamily: 'Manrope_600SemiBold',\n      fontSize: 12,\n      lineHeight: 18,\n      color: colors.text,\n    },\n    objectiveBox: {`
  );

  text = mustReplace(
    text,
    'allow three visible exercise actions',
    "    inlineActions: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },",
    "    inlineActions: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },"
  );

  text = mustReplace(
    text,
    'let secondary actions share width',
    `      justifyContent: 'center',\n      gap: 7,\n    },\n    secondaryActionCompact:`,
    `      justifyContent: 'center',\n      gap: 7,\n      flexGrow: 1,\n    },\n    refuseAction: {\n      minHeight: 42,\n      paddingHorizontal: 12,\n      borderRadius: 12,\n      borderWidth: 1,\n      borderColor: colors.secondaryAccent,\n      backgroundColor: colors.background,\n      flexDirection: 'row',\n      alignItems: 'center',\n      justifyContent: 'center',\n      gap: 7,\n      flexGrow: 1,\n    },\n    refuseActionText: {\n      fontFamily: 'Manrope_700Bold',\n      fontSize: 11,\n      color: colors.secondaryAccent,\n    },\n    secondaryActionCompact:`
  );

  fs.writeFileSync(path, text);
}

function patchSessionWrapper() {
  const path = 'app/workout/session.js';
  let text = fs.readFileSync(path, 'utf8');

  text = mustReplace(
    text,
    'pass overview and plan B controls into focused player',
    '        <SessionCore />',
    `        <SessionCore\n          onOpenOverview={() => setOverviewOpen(true)}\n          onOpenPlanB={() => setPlanBOpen(true)}\n          showPlanB={showPlanBEntry}\n        />`
  );

  text = mustReplace(
    text,
    'remove floating tools from HOME BOX player',
    `      <View style={styles.sessionTools} pointerEvents="box-none">\n        <Pressable\n          onPress={() => setOverviewOpen(true)}\n          style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]}\n        >\n          <Ionicons name="clipboard-outline" size={18} color={colors.text} />\n          <Text style={styles.toolButtonText}>Ma séance</Text>\n        </Pressable>\n\n        {showPlanBEntry ? (\n          <Pressable\n            onPress={() => setPlanBOpen(true)}\n            style={({ pressed }) => [styles.toolButton, styles.planBTool, pressed && styles.pressed]}\n          >\n            <Ionicons name="shuffle-outline" size={18} color={colors.secondaryAccent} />\n            <Text style={[styles.toolButtonText, { color: colors.secondaryAccent }]}>Plan B</Text>\n          </Pressable>\n        ) : null}\n      </View>`,
    `      {isEnvironmentSession ? (\n        <View style={styles.sessionTools} pointerEvents="box-none">\n          <Pressable\n            onPress={() => setOverviewOpen(true)}\n            style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]}\n          >\n            <Ionicons name="clipboard-outline" size={18} color={colors.text} />\n            <Text style={styles.toolButtonText}>Ma séance</Text>\n          </Pressable>\n        </View>\n      ) : null}`
  );

  fs.writeFileSync(path, text);
}

patchFocusedCore();
patchSessionWrapper();
console.log('PLAY-003/004 focused player patch applied.');
