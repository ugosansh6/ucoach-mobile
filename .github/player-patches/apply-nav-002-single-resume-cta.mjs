import fs from 'node:fs';

const path = 'src/workout/PreparationCheckinV4.js';
let source = fs.readFileSync(path, 'utf8');

const startedBlock = `  const sessionStarted = Boolean(\n    workout?.sessionStarted ||\n      workout?.startedAt ||\n      workout?.wodStarted ||\n      workout?.wodStartedAt ||\n      workout?.wodRuntime?.started ||\n      normalizedStatus === 'in_progress'\n  );\n`;
source = source.replace(startedBlock, '');

const oldCta = `        <Pressable\n          onPress={handleGenerate}\n          disabled={equipmentLoading}\n          style={({ pressed }) => [\n            styles.primaryButton,\n            !canGenerate && styles.primaryButtonPending,\n            pressed && !equipmentLoading && styles.pressed,\n          ]}\n        >\n          <Text style={styles.primaryButtonText}>Voir ma séance</Text>\n          <Ionicons name=\"arrow-forward\" size={21} color={colors.textOnAccent} />\n        </Pressable>\n\n        {hasActiveSession ? (\n          <View style={styles.resumePanel}>\n            <Ionicons name=\"play-circle-outline\" size={22} color={colors.accent} />\n            <View style={styles.flexOne}>\n              <Text style={styles.resumeTitle}>\n                {sessionStarted ? 'Séance en cours' : 'Séance déjà générée'}\n              </Text>\n              <Text style={styles.resumeText}>Reprends exactement là où tu t’es arrêté.</Text>\n            </View>\n            <Pressable\n              onPress={() => router.replace('/workout/session')}\n              style={styles.resumeButton}\n            >\n              <Text style={styles.resumeButtonText}>Continuer</Text>\n            </Pressable>\n          </View>\n        ) : null}\n`;

const newCta = `        <Pressable\n          onPress={() => {\n            if (hasActiveSession) {\n              router.replace('/workout/session');\n              return;\n            }\n            handleGenerate();\n          }}\n          disabled={!hasActiveSession && equipmentLoading}\n          style={({ pressed }) => [\n            styles.primaryButton,\n            !hasActiveSession && !canGenerate && styles.primaryButtonPending,\n            pressed && (hasActiveSession || !equipmentLoading) && styles.pressed,\n          ]}\n        >\n          <Text style={styles.primaryButtonText}>\n            {hasActiveSession ? 'Reprendre sa séance' : 'Voir ma séance'}\n          </Text>\n          <Ionicons\n            name={hasActiveSession ? 'play' : 'arrow-forward'}\n            size={21}\n            color={colors.textOnAccent}\n          />\n        </Pressable>\n`;

if (!source.includes(oldCta)) {
  throw new Error('NAV-002 target CTA/resume block not found');
}
source = source.replace(oldCta, newCta);

const resumeStyles = `\n    resumePanel: {\n      marginTop: 12,\n      padding: 12,\n      borderRadius: 14,\n      borderWidth: 1,\n      borderColor: colors.border,\n      backgroundColor: colors.surface,\n      flexDirection: 'row',\n      alignItems: 'center',\n      gap: 9,\n    },\n    resumeTitle: {\n      fontFamily: MANROPE.bold,\n      fontSize: 13,\n      color: colors.text,\n    },\n    resumeText: {\n      marginTop: 2,\n      fontFamily: MANROPE.regular,\n      fontSize: 13,\n      lineHeight: 18,\n      color: colors.textSecondary,\n    },\n    resumeButton: {\n      minHeight: 36,\n      paddingHorizontal: 12,\n      borderRadius: 10,\n      backgroundColor: colors.surfaceElevated,\n      alignItems: 'center',\n      justifyContent: 'center',\n    },\n    resumeButtonText: {\n      fontFamily: MANROPE.bold,\n      fontSize: 12,\n      color: colors.accent,\n    },\n`;
source = source.replace(resumeStyles, '\n');

if (!source.includes("hasActiveSession ? 'Reprendre sa séance' : 'Voir ma séance'")) {
  throw new Error('NAV-002 resume label missing after patch');
}
if (source.includes('Reprends exactement là où tu t’es arrêté.')) {
  throw new Error('NAV-002 duplicate resume copy still present');
}
if (source.includes('styles.resumePanel')) {
  throw new Error('NAV-002 duplicate resume panel still present');
}

fs.writeFileSync(path, source);
console.log('NAV-002 applied');
