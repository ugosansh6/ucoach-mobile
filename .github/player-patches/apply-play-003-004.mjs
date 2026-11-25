import fs from 'node:fs';

function mustReplace(text, label, search, replacement) {
  const next = text.replace(search, replacement);
  if (next === text) {
    throw new Error(`PLAY-003/004 patch failed: ${label}`);
  }
  return next;
}

function lines(items) {
  return items.join('\n');
}

function patchFocusedCore() {
  const path = 'app/workout/session-focused-core.js';
  let text = fs.readFileSync(path, 'utf8');

  if (!text.includes('function normalizeDetailText(value)')) {
    const helpers = lines([
      '',
      'function normalizeDetailText(value) {',
      "  if (value == null) return '';",
      '  return String(value)',
      "    .replace(/\\\\r\\\\n|\\\\n|\\\\r/g, '\\n')",
      "    .replace(/\\r\\n?/g, '\\n')",
      "    .replace(/(^|\\n)\\s*(\\d+)[.)-]?\\s+/g, (_, prefix, number) => `${prefix}${number}. `)",
      "    .replace(/\\n{3,}/g, '\\n\\n')",
      '    .trim();',
      '}',
      '',
      'function shortCue(exercise) {',
      '  const value = normalizeDetailText(',
      "    exercise?.tips ?? exercise?.instructions ?? exercise?.description ?? ''",
      '  );',
      '  if (!value) return null;',
      '',
      "  const line = value.split(/\\n+/)[0].replace(/^\\d+\\.\\s*/, '').trim();",
      "  const sentence = line.match(/^(.{1,150}?[.!?])(?:\\s|$)/)?.[1] ?? line;",
      '  return sentence.length > 150 ? `${sentence.slice(0, 147).trim()}…` : sentence;',
      '}',
      '',
      'function buildBlockStructure(blockId, source, exercises) {',
    ]);

    text = mustReplace(
      text,
      'insert short instruction helpers',
      '\nfunction buildBlockStructure(blockId, source, exercises) {',
      helpers
    );
  }

  text = mustReplace(
    text,
    'accept player shell callbacks',
    'export default function SessionFocusedCore() {',
    lines([
      'export default function SessionFocusedCore({',
      '  onOpenOverview,',
      '  onOpenPlanB,',
      '  showPlanB = false,',
      '} = {}) {',
    ])
  );

  text = mustReplace(
    text,
    'derive short cue',
    '  const imageUri = exerciseImageUri(activeExercise);\n',
    '  const imageUri = exerciseImageUri(activeExercise);\n  const cue = shortCue(activeExercise);\n'
  );

  if (!text.includes('async function refuseCurrentExercise()')) {
    const refusal = lines([
      '',
      '  async function refuseCurrentExercise() {',
      '    if (!activeBlock || !activeExercise) return;',
      '',
      '    try {',
      '      await ensureSessionStarted();',
      '    } catch (error) {',
      "      Alert.alert('Impossible de démarrer la séance', error?.message ?? 'Réessaie.');",
      '      return;',
      '    }',
      '',
      '    if (activeExerciseIndex >= activeBlock.exercises.length - 1) {',
      '      finalizeBlock(activeBlock, {',
      '        exercise: activeExercise,',
      "        values: { status: 'not_completed' },",
      '      });',
      '      return;',
      '    }',
      '',
      "    patchExercise(activeExercise, { status: 'not_completed' });",
      '    moveExercise(1);',
      '  }',
      '',
      '  const wodUnlocked = useMemo(() => {',
    ]);

    text = mustReplace(
      text,
      'insert refuse action',
      '\n  const wodUnlocked = useMemo(() => {',
      refusal
    );
  }

  text = mustReplace(
    text,
    'compact header meta',
    '          <Text style={styles.headerTitle}>{activeBlock.title}</Text>\n',
    lines([
      '          <Text style={styles.headerTitle}>{activeBlock.title}</Text>',
      '          {activeBlock.structure ? (',
      '            <Text numberOfLines={1} style={styles.headerMeta}>{activeBlock.structure}</Text>',
      '          ) : null}',
      '',
    ])
  );

  text = mustReplace(
    text,
    'header actions and overview access',
    lines([
      '        <View style={styles.durationPill}>',
      "          <Text style={styles.durationValue}>{activeBlock.durationLabel ?? '—'}</Text>",
      '        </View>',
    ]),
    lines([
      '        <View style={styles.headerActions}>',
      '          <View style={styles.durationPill}>',
      "            <Text style={styles.durationValue}>{activeBlock.durationLabel ?? '—'}</Text>",
      '          </View>',
      "          {typeof onOpenOverview === 'function' ? (",
      '            <Pressable',
      '              onPress={onOpenOverview}',
      '              accessibilityRole="button"',
      '              accessibilityLabel="Voir ma séance"',
      '              style={styles.overviewButton}',
      '            >',
      '              <Ionicons name="clipboard-outline" size={17} color={colors.text} />',
      '              <Text style={styles.overviewButtonText}>Séance</Text>',
      '            </Pressable>',
      '          ) : null}',
      "          {showPlanB && typeof onOpenPlanB === 'function' ? (",
      '            <Pressable',
      '              onPress={onOpenPlanB}',
      '              accessibilityRole="button"',
      '              accessibilityLabel="Plan B"',
      '              style={styles.planBHeaderButton}',
      '            >',
      '              <Ionicons name="shuffle-outline" size={18} color={colors.secondaryAccent} />',
      '            </Pressable>',
      '          ) : null}',
      '        </View>',
    ])
  );

  text = mustReplace(
    text,
    'remove duplicated block intro',
    lines([
      '        <View style={styles.blockIntro}>',
      '          <View style={styles.blockIntroCopy}>',
      '            <Text style={styles.blockKicker}>Bloc actif</Text>',
      '            <Text style={styles.blockTitle}>{activeBlock.title}</Text>',
      '            {activeBlock.structure ? <Text style={styles.blockStructure}>{activeBlock.structure}</Text> : null}',
      '          </View>',
      '          <Text style={styles.blockCounter}>{activeBlockIndex + 1}/{blocks.length}</Text>',
      '        </View>',
      '',
    ]),
    ''
  );

  text = mustReplace(
    text,
    'always visible essential cue',
    lines([
      '              {activeExercise?.prescription ? (',
      '                <Text style={styles.exercisePrescription}>{String(activeExercise.prescription)}</Text>',
      '              ) : null}',
      '',
      '              {activeBlock.objective ? (',
    ]),
    lines([
      '              {activeExercise?.prescription ? (',
      '                <Text style={styles.exercisePrescription}>{String(activeExercise.prescription)}</Text>',
      '              ) : null}',
      '',
      '              {cue ? (',
      '                <View style={styles.cueBox}>',
      '                  <View style={styles.cueIcon}>',
      '                    <Ionicons name="flash-outline" size={15} color={colors.secondaryAccent} />',
      '                  </View>',
      '                  <View style={styles.cueCopy}>',
      "                    <Text style={styles.cueLabel}>L’essentiel</Text>",
      '                    <Text style={styles.cueText}>{cue}</Text>',
      '                  </View>',
      '                </View>',
      '              ) : null}',
      '',
      '              {activeBlock.objective ? (',
    ])
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
    lines([
      '                <Pressable onPress={() => setStatusExercise(activeExercise)} style={styles.secondaryActionCompact}>',
      '                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />',
      '                </Pressable>',
    ]),
    lines([
      '                <Pressable onPress={refuseCurrentExercise} style={styles.refuseAction}>',
      '                  <Ionicons name="close-circle-outline" size={18} color={colors.secondaryAccent} />',
      '                  <Text style={styles.refuseActionText}>Refuser</Text>',
      '                </Pressable>',
    ])
  );

  const primaryPattern = /            <Pressable onPress=\{completeCurrentExercise\} style=\{styles\.primaryButtonLarge\}>[\s\S]*?            <\/Pressable>/;
  const primaryReplacement = lines([
    '            <Pressable onPress={completeCurrentExercise} style={styles.primaryButtonLarge}>',
    '              <Ionicons name="checkmark-circle-outline" size={20} color={colors.textOnAccent} />',
    '              <Text style={styles.primaryButtonTextLarge}>',
    '                {activeExerciseIndex >= activeBlock.exercises.length - 1',
    "                  ? activeBlock.id === 'skill'",
    "                    ? 'Réalisé · terminer le Skill'",
    "                    : 'Réalisé · terminer le bloc'",
    "                  : 'Réalisé · suivant'}",
    '              </Text>',
    '            </Pressable>',
  ]);
  text = mustReplace(text, 'make completed action explicit', primaryPattern, primaryReplacement);

  text = mustReplace(text, 'compact player header height', '      minHeight: 72,', '      minHeight: 76,');
  text = mustReplace(text, 'header copy shrink', '    headerCopy: { flex: 1 },', '    headerCopy: { flex: 1, minWidth: 0 },');

  text = mustReplace(
    text,
    'insert header meta style',
    lines([
      '    headerTitle: {',
      '      marginTop: 1,',
      "      fontFamily: 'Manrope_800ExtraBold',",
      '      fontSize: 21,',
      '      lineHeight: 27,',
      '      color: colors.text,',
      '    },',
    ]),
    lines([
      '    headerTitle: {',
      '      marginTop: 1,',
      "      fontFamily: 'Manrope_800ExtraBold',",
      '      fontSize: 21,',
      '      lineHeight: 27,',
      '      color: colors.text,',
      '    },',
      '    headerMeta: {',
      '      marginTop: 1,',
      "      fontFamily: 'Manrope_500Medium',",
      '      fontSize: 10,',
      '      lineHeight: 14,',
      '      color: colors.textSecondary,',
      '    },',
    ])
  );

  text = mustReplace(
    text,
    'insert header action styles',
    lines([
      '    durationValue: {',
      "      fontFamily: 'Manrope_700Bold',",
      '      fontSize: 11,',
      '      color: colors.textSecondary,',
      '    },',
      '    progressTrack:',
    ]),
    lines([
      '    durationValue: {',
      "      fontFamily: 'Manrope_700Bold',",
      '      fontSize: 11,',
      '      color: colors.textSecondary,',
      '    },',
      '    headerActions: {',
      "      flexDirection: 'row',",
      "      alignItems: 'center',",
      '      gap: 6,',
      '    },',
      '    overviewButton: {',
      '      minHeight: 36,',
      '      paddingHorizontal: 10,',
      '      borderRadius: 12,',
      '      borderWidth: 1,',
      '      borderColor: colors.border,',
      '      backgroundColor: colors.surface,',
      "      flexDirection: 'row',",
      "      alignItems: 'center',",
      '      gap: 5,',
      '    },',
      '    overviewButtonText: {',
      "      fontFamily: 'Manrope_700Bold',",
      '      fontSize: 10,',
      '      color: colors.text,',
      '    },',
      '    planBHeaderButton: {',
      '      width: 36,',
      '      height: 36,',
      '      borderRadius: 12,',
      '      borderWidth: 1,',
      '      borderColor: colors.secondaryAccent,',
      '      backgroundColor: colors.surface,',
      "      alignItems: 'center',",
      "      justifyContent: 'center',",
      '    },',
      '    progressTrack:',
    ])
  );

  text = mustReplace(
    text,
    'reduce bottom spacing',
    '    content: { padding: spacing.lg, paddingBottom: 150 },',
    '    content: { padding: spacing.lg, paddingBottom: 64 },'
  );
  text = mustReplace(text, 'reduce media height', '      height: 235,', '      height: 210,');

  text = mustReplace(
    text,
    'insert cue styles',
    '    objectiveBox: {',
    lines([
      '    cueBox: {',
      '      marginTop: 13,',
      '      padding: 12,',
      '      borderRadius: 14,',
      '      borderWidth: 1,',
      '      borderColor: colors.secondaryAccent,',
      '      backgroundColor: colors.secondaryAccentSoft,',
      "      flexDirection: 'row',",
      "      alignItems: 'flex-start',",
      '      gap: 10,',
      '    },',
      '    cueIcon: {',
      '      width: 28,',
      '      height: 28,',
      '      borderRadius: 14,',
      "      alignItems: 'center',",
      "      justifyContent: 'center',",
      '      backgroundColor: colors.surface,',
      '    },',
      '    cueCopy: { flex: 1 },',
      '    cueLabel: {',
      "      fontFamily: 'Manrope_800ExtraBold',",
      '      fontSize: 9,',
      '      letterSpacing: 0.5,',
      "      textTransform: 'uppercase',",
      '      color: colors.secondaryAccent,',
      '    },',
      '    cueText: {',
      '      marginTop: 3,',
      "      fontFamily: 'Manrope_600SemiBold',",
      '      fontSize: 12,',
      '      lineHeight: 18,',
      '      color: colors.text,',
      '    },',
      '    objectiveBox: {',
    ])
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
    lines([
      "      justifyContent: 'center',",
      '      gap: 7,',
      '    },',
      '    secondaryActionCompact:',
    ]),
    lines([
      "      justifyContent: 'center',",
      '      gap: 7,',
      '      flexGrow: 1,',
      '    },',
      '    refuseAction: {',
      '      minHeight: 42,',
      '      paddingHorizontal: 12,',
      '      borderRadius: 12,',
      '      borderWidth: 1,',
      '      borderColor: colors.secondaryAccent,',
      '      backgroundColor: colors.background,',
      "      flexDirection: 'row',",
      "      alignItems: 'center',",
      "      justifyContent: 'center',",
      '      gap: 7,',
      '      flexGrow: 1,',
      '    },',
      '    refuseActionText: {',
      "      fontFamily: 'Manrope_700Bold',",
      '      fontSize: 11,',
      '      color: colors.secondaryAccent,',
      '    },',
      '    secondaryActionCompact:',
    ])
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
    lines([
      '        <SessionCore',
      '          onOpenOverview={() => setOverviewOpen(true)}',
      '          onOpenPlanB={() => setPlanBOpen(true)}',
      '          showPlanB={showPlanBEntry}',
      '        />',
    ])
  );

  const toolsPattern = /      <View style=\{styles\.sessionTools\} pointerEvents="box-none">[\s\S]*?      <\/View>\n\n      <SessionOverviewSheet/;
  const toolsReplacement = lines([
    '      {isEnvironmentSession ? (',
    '        <View style={styles.sessionTools} pointerEvents="box-none">',
    '          <Pressable',
    '            onPress={() => setOverviewOpen(true)}',
    '            style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]}',
    '          >',
    '            <Ionicons name="clipboard-outline" size={18} color={colors.text} />',
    '            <Text style={styles.toolButtonText}>Ma séance</Text>',
    '          </Pressable>',
    '        </View>',
    '      ) : null}',
    '',
    '      <SessionOverviewSheet',
  ]);
  text = mustReplace(
    text,
    'remove floating tools from HOME BOX player',
    toolsPattern,
    toolsReplacement
  );

  fs.writeFileSync(path, text);
}

patchFocusedCore();
patchSessionWrapper();
console.log('PLAY-003/004 focused player patch applied.');
