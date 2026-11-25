import fs from 'node:fs';

function mustReplace(text, label, search, replacement) {
  const next = text.replace(search, replacement);
  if (next === text) throw new Error(`PLAY-011 patch failed: ${label}`);
  return next;
}

function lines(items) {
  return items.join('\n');
}

function patchLayout() {
  const path = 'app/_layout.js';
  let text = fs.readFileSync(path, 'utf8');
  text = mustReplace(
    text,
    'remove legacy global overlays imports',
    "import SessionAdaptationOverlay from '../src/components/workout/SessionAdaptationOverlayThemed';\nimport SessionWhyOverlay from '../src/components/workout/SessionWhyOverlay';\n",
    ''
  );
  text = mustReplace(
    text,
    'remove legacy global overlays mounts',
    "\n            <SessionWhyOverlay />\n            <SessionAdaptationOverlay />",
    ''
  );
  fs.writeFileSync(path, text);
}

function patchOverview() {
  const path = 'src/components/workout/SessionOverviewSheet.js';
  let text = fs.readFileSync(path, 'utf8');

  if (!text.includes("import SessionPlanBPanel from './SessionPlanBPanel';")) {
    text = mustReplace(
      text,
      'Plan B panel import',
      'const LABELS = {',
      "import SessionPlanBPanel from './SessionPlanBPanel';\n\nconst LABELS = {"
    );
  }

  text = mustReplace(
    text,
    'overview props',
    lines([
      'export default function SessionOverviewSheet({',
      '  visible,',
      '  onClose,',
      '  onPlanB,',
      '  showPlanB = false,',
      '}) {'
    ]),
    lines([
      'export default function SessionOverviewSheet({',
      '  visible,',
      '  onClose,',
      '  onPlanB,',
      '  showPlanB = false,',
      '  planBOpen = false,',
      '  canRegeneratePlanB = false,',
      '  canChangeSkill = false,',
      '  hasSkill = false,',
      '  progressRecorded = false,',
      '  devTestReload = false,',
      '  busyAction = null,',
      '  onClosePlanB,',
      '  onAlternateSkill,',
      '  onSkipSkill,',
      '  onAlternateSession,',
      '}) {'
    ])
  );

  if (!text.includes('<SessionPlanBPanel')) {
    text = mustReplace(
      text,
      'render integrated Plan B panel',
      /        <\/SafeAreaView>\n      <\/Modal>\n\n\n      <ExerciseDetailModal/,
      lines([
        '        </SafeAreaView>',
        '        <SessionPlanBPanel',
        '          visible={planBOpen}',
        '          canRegeneratePlanB={canRegeneratePlanB}',
        '          canChangeSkill={canChangeSkill}',
        '          hasSkill={hasSkill}',
        '          progressRecorded={progressRecorded}',
        '          devTestReload={devTestReload}',
        '          busyAction={busyAction}',
        '          onClose={onClosePlanB}',
        '          onAlternateSkill={onAlternateSkill}',
        '          onSkipSkill={onSkipSkill}',
        '          onAlternateSession={onAlternateSession}',
        '        />',
        '      </Modal>',
        '',
        '',
        '      <ExerciseDetailModal'
      ])
    );
  }

  fs.writeFileSync(path, text);
}

function patchSessionScreen() {
  const path = 'app/workout/session.js';
  let text = fs.readFileSync(path, 'utf8');

  if (!text.includes("import SessionWhySheet from '../../src/components/workout/SessionWhySheet';")) {
    text = mustReplace(
      text,
      'controlled coach sheet imports',
      "import SessionOverviewSheet from '../../src/components/workout/SessionOverviewSheet';",
      lines([
        "import SessionOverviewSheet from '../../src/components/workout/SessionOverviewSheet';",
        "import SessionWhySheet from '../../src/components/workout/SessionWhySheet';",
        "import SessionAdaptationSheet from '../../src/components/workout/SessionAdaptationSheet';"
      ])
    );
  }

  text = mustReplace(
    text,
    'coach sheet states',
    "  const [overviewOpen, setOverviewOpen] = useState(false);\n  const overviewShownForSessionRef = useRef(null);",
    lines([
      '  const [overviewOpen, setOverviewOpen] = useState(false);',
      '  const [whyOpen, setWhyOpen] = useState(false);',
      '  const [adaptationOpen, setAdaptationOpen] = useState(false);',
      '  const overviewShownForSessionRef = useRef(null);'
    ])
  );

  text = mustReplace(
    text,
    'keep overview visible behind Plan B',
    /  function openPlanBFromOverview\(\) \{[\s\S]*?\n  \}\n\n  async function applySkillPlanB/,
    lines([
      '  function openPlanBFromOverview() {',
      '    if (busyAction) return;',
      '    setPlanBOpen(true);',
      '  }',
      '',
      '  async function applySkillPlanB'
    ])
  );

  text = mustReplace(
    text,
    'focused core callbacks',
    lines([
      '        <SessionCore',
      '          onOpenOverview={() => setOverviewOpen(true)}',
      '          onOpenPlanB={() => setPlanBOpen(true)}',
      '          showPlanB={showPlanBEntry}',
      '        />'
    ]),
    lines([
      '        <SessionCore',
      '          onOpenOverview={() => {',
      '            setPlanBOpen(false);',
      '            setOverviewOpen(true);',
      '          }}',
      '          onOpenPlanB={() => {',
      '            setOverviewOpen(true);',
      '            setPlanBOpen(true);',
      '          }}',
      '          onOpenWhy={() => setWhyOpen(true)}',
      '          onOpenAdjust={() => setAdaptationOpen(true)}',
      '          showPlanB={showPlanBEntry}',
      '        />'
    ])
  );

  text = mustReplace(
    text,
    'overview integrated Plan B props',
    lines([
      '      <SessionOverviewSheet',
      '        visible={overviewOpen}',
      '        onClose={() => setOverviewOpen(false)}',
      '        showPlanB={canRegeneratePlanB}',
      '        onPlanB={openPlanBFromOverview}',
      '      />'
    ]),
    lines([
      '      <SessionOverviewSheet',
      '        visible={overviewOpen}',
      '        onClose={() => {',
      '          setPlanBOpen(false);',
      '          setOverviewOpen(false);',
      '        }}',
      '        showPlanB={canRegeneratePlanB}',
      '        onPlanB={openPlanBFromOverview}',
      '        planBOpen={planBOpen}',
      '        canRegeneratePlanB={canRegeneratePlanB}',
      '        canChangeSkill={canChangeSkill}',
      '        hasSkill={hasSkill}',
      '        progressRecorded={progressRecorded}',
      '        devTestReload={DEV_TEST_RELOAD}',
      '        busyAction={busyAction}',
      '        onClosePlanB={() => setPlanBOpen(false)}',
      "        onAlternateSkill={() => applySkillPlanB('ALTERNATE_SKILL')}",
      "        onSkipSkill={() => applySkillPlanB('SKIP_SKILL')}",
      '        onAlternateSession={applyWholePlanB}',
      '      />',
      '',
      '      <SessionWhySheet visible={whyOpen} onClose={() => setWhyOpen(false)} />',
      '      <SessionAdaptationSheet',
      '        visible={adaptationOpen}',
      '        onClose={() => setAdaptationOpen(false)}',
      '      />'
    ])
  );

  // The legacy Plan B Modal remains inert for now; the active Plan B surface lives inside the overview.
  text = mustReplace(
    text,
    'disable legacy Plan B modal',
    '          visible={planBOpen}\n          transparent\n          animationType="slide"',
    '          visible={false}\n          transparent\n          animationType="slide"'
  );

  fs.writeFileSync(path, text);
}

function patchFocusedCore() {
  const path = 'app/workout/session-focused-core.js';
  let text = fs.readFileSync(path, 'utf8');

  text = mustReplace(
    text,
    'focused core callback props',
    lines([
      'export default function SessionFocusedCore({',
      '  onOpenOverview,',
      '  onOpenPlanB,',
      '  showPlanB = false,',
      '} = {}) {'
    ]),
    lines([
      'export default function SessionFocusedCore({',
      '  onOpenOverview,',
      '  onOpenPlanB,',
      '  onOpenWhy,',
      '  onOpenAdjust,',
      '  showPlanB = false,',
      '} = {}) {'
    ])
  );

  const newHeader = lines([
    '      <View style={styles.header}>',
    '        <View style={styles.headerTop}>',
    '          <Pressable onPress={() => router.replace(\'/workout/preparation\')} hitSlop={12} style={styles.iconButton}>',
    '            <Ionicons name="arrow-back" size={21} color={colors.text} />',
    '          </Pressable>',
    '',
    '          <View style={styles.headerCopy}>',
    '            <Text style={styles.headerEyebrow}>Bloc {activeBlockIndex + 1}/{blocks.length}</Text>',
    '            <Text style={styles.headerTitle}>{activeBlock.title}</Text>',
    '            <Text numberOfLines={1} style={styles.headerMeta}>',
    '              {[activeBlock.structure, activeBlock.durationLabel].filter(Boolean).join(\' · \')}',
    '            </Text>',
    '          </View>',
    '',
    '          {typeof onOpenOverview === \'function\' ? (',
    '            <Pressable',
    '              onPress={onOpenOverview}',
    '              accessibilityRole="button"',
    '              accessibilityLabel="Voir ma séance"',
    '              style={styles.overviewButton}',
    '            >',
    '              <Ionicons name="clipboard-outline" size={17} color={colors.text} />',
    '              <Text style={styles.overviewButtonText}>Ma séance</Text>',
    '            </Pressable>',
    '          ) : null}',
    '        </View>',
    '',
    '        <View style={styles.coachTools}>',
    '          {typeof onOpenWhy === \'function\' ? (',
    '            <Pressable onPress={onOpenWhy} style={[styles.coachTool, styles.coachToolWhy]}>',
    '              <Ionicons name="help-circle-outline" size={17} color={colors.textSecondary} />',
    '              <Text style={styles.coachToolText}>Pourquoi ?</Text>',
    '            </Pressable>',
    '          ) : null}',
    '          {typeof onOpenAdjust === \'function\' ? (',
    '            <Pressable onPress={onOpenAdjust} style={[styles.coachTool, styles.coachToolAdjust]}>',
    '              <Ionicons name="options-outline" size={17} color={colors.accent} />',
    '              <Text style={styles.coachToolText}>Ajuster</Text>',
    '            </Pressable>',
    '          ) : null}',
    '          {showPlanB && typeof onOpenPlanB === \'function\' ? (',
    '            <Pressable onPress={onOpenPlanB} style={[styles.coachTool, styles.coachToolPlanB]}>',
    '              <Ionicons name="shuffle-outline" size={17} color={colors.secondaryAccent} />',
    '              <Text style={styles.coachToolText}>Plan B</Text>',
    '            </Pressable>',
    '          ) : null}',
    '        </View>',
    '      </View>',
    '',
    '      <View style={styles.progressTrack}>'
  ]);

  text = mustReplace(
    text,
    'player header hierarchy',
    /      <View style=\{styles\.header\}>[\s\S]*?      <View style=\{styles\.progressTrack\}>/,
    newHeader
  );

  text = mustReplace(
    text,
    'exact session progress',
    '<View style={[styles.progressFill, { width: `${Math.max(4, Math.round(progress * 100))}%` }]} />',
    '<View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />'
  );

  const headerStyles = lines([
    '    header: {',
    '      paddingHorizontal: spacing.lg,',
    '      paddingTop: 12,',
    '      paddingBottom: 12,',
    '      borderBottomWidth: 1,',
    '      borderBottomColor: colors.border,',
    '      backgroundColor: colors.background,',
    '    },',
    '    headerTop: {',
    '      flexDirection: \'row\',',
    '      alignItems: \'center\',',
    '      gap: 12,',
    '    },',
    '    iconButton: {',
    '      width: 44,',
    '      height: 44,',
    '      borderRadius: 22,',
    '      alignItems: \'center\',',
    '      justifyContent: \'center\',',
    '      backgroundColor: colors.surface,',
    '      borderWidth: 1,',
    '      borderColor: colors.border,',
    '    },',
    '    headerCopy: { flex: 1, minWidth: 0 },',
    '    headerEyebrow: {',
    '      fontFamily: \'Manrope_600SemiBold\',',
    '      fontSize: 11,',
    '      color: colors.textSecondary,',
    '    },',
    '    headerTitle: {',
    '      marginTop: 1,',
    '      fontFamily: \'Manrope_800ExtraBold\',',
    '      fontSize: 22,',
    '      lineHeight: 28,',
    '      color: colors.text,',
    '    },',
    '    headerMeta: {',
    '      marginTop: 1,',
    '      fontFamily: \'Manrope_500Medium\',',
    '      fontSize: 11,',
    '      lineHeight: 15,',
    '      color: colors.textSecondary,',
    '    },',
    '    overviewButton: {',
    '      minHeight: 42,',
    '      paddingHorizontal: 11,',
    '      borderRadius: 13,',
    '      borderWidth: 1,',
    '      borderColor: colors.border,',
    '      backgroundColor: colors.surface,',
    '      flexDirection: \'row\',',
    '      alignItems: \'center\',',
    '      gap: 6,',
    '    },',
    '    overviewButtonText: {',
    '      fontFamily: \'Manrope_700Bold\',',
    '      fontSize: 11,',
    '      color: colors.text,',
    '    },',
    '    coachTools: {',
    '      marginTop: 10,',
    '      flexDirection: \'row\',',
    '      alignItems: \'center\',',
    '      gap: 8,',
    '    },',
    '    coachTool: {',
    '      flex: 1,',
    '      minHeight: 40,',
    '      paddingHorizontal: 9,',
    '      borderRadius: 12,',
    '      borderWidth: 1,',
    '      flexDirection: \'row\',',
    '      alignItems: \'center\',',
    '      justifyContent: \'center\',',
    '      gap: 6,',
    '    },',
    '    coachToolWhy: {',
    '      borderColor: colors.border,',
    '      backgroundColor: colors.surface,',
    '    },',
    '    coachToolAdjust: {',
    '      borderColor: colors.accent,',
    '      backgroundColor: colors.accentSoft,',
    '    },',
    '    coachToolPlanB: {',
    '      borderColor: colors.secondaryAccent,',
    '      backgroundColor: colors.secondaryAccentSoft,',
    '    },',
    '    coachToolText: {',
    '      fontFamily: \'Manrope_700Bold\',',
    '      fontSize: 11,',
    '      color: colors.text,',
    '    },',
    '    progressTrack:'
  ]);

  text = mustReplace(
    text,
    'player header styles',
    /    header: \{[\s\S]*?    progressTrack:/,
    headerStyles
  );

  fs.writeFileSync(path, text);
}

patchLayout();
patchOverview();
patchSessionScreen();
patchFocusedCore();
console.log('PLAY-011 session shell + integrated Plan B patch applied.');
