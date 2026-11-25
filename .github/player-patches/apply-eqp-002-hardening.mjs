import fs from 'node:fs';

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return source.replace(from, to);
}

function patchFile(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (before === after) throw new Error(`No changes produced for ${path}`);
  fs.writeFileSync(path, after);
}

patchFile('src/services/equipmentService.js', (source) => {
  source = replaceOnce(
    source,
    `  if (!categorizedError) {\n    return (categorizedData ?? []).map((item) => ({\n      ...item,\n      locations: Array.isArray(item.locations)\n        ? item.locations\n        : [],\n    }));\n  }`,
    `  if (!categorizedError) {\n    return (categorizedData ?? [])\n      .filter(\n        (item) =>\n          item.id === 'E00' ||\n          item.exercise_count === null ||\n          item.exercise_count === undefined ||\n          Number(item.exercise_count) > 0\n      )\n      .map((item) => ({\n        ...item,\n        locations: Array.isArray(item.locations)\n          ? item.locations\n          : [],\n      }));\n  }`,
    'filter exercise-orphan equipment from catalog'
  );
  return source;
});

patchFile('src/workout/PreparationCheckinV4.js', (source) => {
  source = replaceOnce(
    source,
    `              <Pressable\n                onPress={() => updatePreparation({ equipment: ['Poids du corps'] })}\n                style={styles.quickButton}\n              >`,
    `              <Pressable\n                onPress={() =>\n                  updatePreparation({\n                    equipment: ['Poids du corps'],\n                    equipmentEnvironmentCode: environmentCode,\n                    equipmentSelectionSource: 'session_override',\n                  })\n                }\n                style={styles.quickButton}\n              >`,
    'bodyweight quick action remains session-only override'
  );
  return source;
});

console.log('EQP-002 hardening applied');
