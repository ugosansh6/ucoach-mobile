from pathlib import Path

path = Path('app/workout/generating-themed.js')
text = path.read_text(encoding='utf-8')

old = """        const nextWorkout = await generateWorkoutSession(preparation, {\n          forceRecalculateStarted,\n          protectedSessionExerciseIds,\n        });\n"""
new = """        const nextWorkout = await generateWorkoutSession(preparation, {\n          forceRecalculateStarted,\n          protectedSessionExerciseIds: newSessionRequested ? [] : protectedSessionExerciseIds,\n        });\n"""
if old not in text:
    raise SystemExit('initial generation protected ids marker not found')
text = text.replace(old, new, 1)

old = """      const nextWorkout = await generateWorkoutSession(preparation, { protectedSessionExerciseIds });\n      applyGenerationResult(nextWorkout);\n"""
new = """      const nextWorkout = await generateWorkoutSession(preparation, { protectedSessionExerciseIds: [] });\n      applyGenerationResult(nextWorkout);\n"""
count = text.count(old)
if count < 2:
    raise SystemExit(f'expected two replacement generation markers, found {count}')
text = text.replace(old, new, 2)

path.write_text(text, encoding='utf-8')
