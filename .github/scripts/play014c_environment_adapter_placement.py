from pathlib import Path

overlay_path = Path('src/components/workout/EnvironmentSwapOverlay.js')
overlay = overlay_path.read_text(encoding='utf-8')

old_sig = "export default function EnvironmentSwapOverlay({ variant = 'floating' } = {}) {"
new_sig = "export default function EnvironmentSwapOverlay({ variant = 'floating', targetExercise = null } = {}) {"
if old_sig not in overlay:
    raise SystemExit('overlay signature not found')
overlay = overlay.replace(old_sig, new_sig, 1)

old_target = "  const swapExercise = current?.pendingExercises?.[0] ?? null;"
new_target = "  const swapExercise = targetExercise ?? current?.pendingExercises?.[0] ?? null;"
if old_target not in overlay:
    raise SystemExit('swap target line not found')
overlay = overlay.replace(old_target, new_target, 1)
overlay_path.write_text(overlay, encoding='utf-8')

env_path = Path('app/workout/environment-session-core.js')
env = env_path.read_text(encoding='utf-8')

# Adapter belongs with the exercise, not in the global header.
header_overlay = '          <EnvironmentSwapOverlay variant="inline" />\n'
if header_overlay not in env:
    raise SystemExit('header overlay not found')
env = env.replace(header_overlay, '', 1)

simple_anchor = '''        {exercise.prescription ? (\n          <Text style={focusedStyles.exercisePrescription}>{exercise.prescription}</Text>\n        ) : null}\n      </View>'''
simple_replacement = '''        {exercise.prescription ? (\n          <Text style={focusedStyles.exercisePrescription}>{exercise.prescription}</Text>\n        ) : null}\n        <View style={{ marginTop: 12, alignItems: 'flex-start' }}>\n          <EnvironmentSwapOverlay variant="inline" targetExercise={exercise} />\n        </View>\n      </View>'''
if simple_anchor not in env:
    raise SystemExit('simple adapter anchor not found')
env = env.replace(simple_anchor, simple_replacement, 1)

# Structured strength: each listed exercise gets its own adapter.
strength_anchor = '''            <Text style={styles.exerciseName}>{exercise.name}</Text>\n            {exercise.prescription ? <Text style={styles.prescription}>{exercise.prescription}</Text> : null}\n\n            {rows.length === 0 ? ('''
strength_replacement = '''            <Text style={styles.exerciseName}>{exercise.name}</Text>\n            {exercise.prescription ? <Text style={styles.prescription}>{exercise.prescription}</Text> : null}\n            <View style={{ marginTop: 10, alignItems: 'flex-start' }}>\n              <EnvironmentSwapOverlay variant="inline" targetExercise={exercise} />\n            </View>\n\n            {rows.length === 0 ? ('''
if strength_anchor not in env:
    raise SystemExit('strength adapter anchor not found')
env = env.replace(strength_anchor, strength_replacement, 1)

# Manual gym: same placement.
manual_anchor = '''            <Text style={styles.exerciseName}>{exercise.name}</Text>\n            {exercise.prescription ? <Text style={styles.prescription}>{exercise.prescription}</Text> : null}\n            <View style={styles.setRow}>'''
manual_replacement = '''            <Text style={styles.exerciseName}>{exercise.name}</Text>\n            {exercise.prescription ? <Text style={styles.prescription}>{exercise.prescription}</Text> : null}\n            <View style={{ marginTop: 10, alignItems: 'flex-start' }}>\n              <EnvironmentSwapOverlay variant="inline" targetExercise={exercise} />\n            </View>\n            <View style={styles.setRow}>'''
if manual_anchor not in env:
    raise SystemExit('manual gym adapter anchor not found')
env = env.replace(manual_anchor, manual_replacement, 1)

# Tabata exposes adaptation only before the timer starts.
tabata_anchor = '''        {phase.label === 'EFFORT' && activeExercise ? (\n          <Text style={styles.exerciseName}>{activeExercise.name}</Text>\n        ) : null}\n      </View>'''
tabata_replacement = '''        {phase.label === 'EFFORT' && activeExercise ? (\n          <Text style={styles.exerciseName}>{activeExercise.name}</Text>\n        ) : null}\n        {!started && activeExercise ? (\n          <View style={{ marginTop: 10, alignItems: 'center' }}>\n            <EnvironmentSwapOverlay variant="inline" targetExercise={activeExercise} />\n          </View>\n        ) : null}\n      </View>'''
if tabata_anchor not in env:
    raise SystemExit('tabata adapter anchor not found')
env = env.replace(tabata_anchor, tabata_replacement, 1)

# Cardio/run has one active exercise; keep adapter next to the block identity before start.
run_anchor = '''      <Text style={styles.runEyebrow}>CONDITIONING COURSE</Text>\n      <Text style={styles.cardTitle}>{title}</Text>\n\n      <View style={styles.runBriefPanel}>'''
run_replacement = '''      <Text style={styles.runEyebrow}>CONDITIONING COURSE</Text>\n      <Text style={styles.cardTitle}>{title}</Text>\n      {!started && exercise ? (\n        <View style={{ marginTop: 10, alignItems: 'flex-start' }}>\n          <EnvironmentSwapOverlay variant="inline" targetExercise={exercise} />\n        </View>\n      ) : null}\n\n      <View style={styles.runBriefPanel}>'''
if run_anchor not in env:
    raise SystemExit('run adapter anchor not found')
env = env.replace(run_anchor, run_replacement, 1)

env_path.write_text(env, encoding='utf-8')
