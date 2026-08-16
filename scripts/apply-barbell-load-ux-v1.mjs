import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const target = 'app/profile/equipment.js';
const targetPath = path.join(root, target);

if (!fs.existsSync(targetPath)) {
  throw new Error(`Fichier introuvable: ${target}`);
}

let source = fs.readFileSync(targetPath, 'utf8');
const original = source;

function replaceOnce(before, after, label) {
  if (source.includes(after)) {
    return;
  }

  const index = source.indexOf(before);
  if (index < 0) {
    throw new Error(`Patch impossible (${label}) : bloc attendu introuvable.`);
  }

  source =
    source.slice(0, index) +
    after +
    source.slice(index + before.length);
}

replaceOnce(
  `  ImageBackground,\n  Pressable,`,
  `  ImageBackground,\n  Keyboard,\n  Pressable,`,
  'import Keyboard'
);

replaceOnce(
  `const RESISTANCE_EQUIPMENT_ID = 'E05';`,
  `const RESISTANCE_EQUIPMENT_ID = 'E05';\nconst BARBELL_EQUIPMENT_ID = 'E14';`,
  'barbell id'
);

replaceOnce(
  `  const [saved, setSaved] =\n    useState(false);`,
  `  const [saved, setSaved] =\n    useState(false);\n\n  const [\n    expandedEquipmentIds,\n    setExpandedEquipmentIds,\n  ] = useState(() => new Set());`,
  'expanded equipment state'
);

const oldToggle = `  function toggleEquipment(equipment) {\n    setSaved(false);\n\n    const selectedRows =\n      rowsForEquipment(equipment.id);\n\n    if (selectedRows.length > 0) {\n      setDraftInventory((current) =>\n        current.filter(\n          (row) =>\n            row.equipment_id !==\n            equipment.id\n        )\n      );\n      return;\n    }\n\n    const defaultMode =\n      FIXED_LOAD_CAPABLE_IDS.has(\n        equipment.id\n      )\n        ? 'load_unknown'\n        : 'non_load';\n\n    setDraftInventory((current) => [\n      ...current,\n      createInventoryRow(\n        equipment.id,\n        defaultMode\n      ),\n    ]);\n  }`;

const newToggle = `  function setEquipmentExpanded(\n    equipmentId,\n    expanded\n  ) {\n    setExpandedEquipmentIds((current) => {\n      const next = new Set(current);\n\n      if (expanded) {\n        next.add(equipmentId);\n      } else {\n        next.delete(equipmentId);\n      }\n\n      return next;\n    });\n  }\n\n  function toggleEquipmentExpanded(\n    equipmentId\n  ) {\n    setExpandedEquipmentIds((current) => {\n      const next = new Set(current);\n\n      if (next.has(equipmentId)) {\n        next.delete(equipmentId);\n      } else {\n        next.add(equipmentId);\n      }\n\n      return next;\n    });\n  }\n\n  function validateAndCollapseBarbell(row) {\n    if (!validateRow(row)) {\n      return;\n    }\n\n    Keyboard.dismiss();\n    setEquipmentExpanded(\n      BARBELL_EQUIPMENT_ID,\n      false\n    );\n  }\n\n  function toggleEquipment(equipment) {\n    setSaved(false);\n\n    const selectedRows =\n      rowsForEquipment(equipment.id);\n\n    if (selectedRows.length > 0) {\n      setDraftInventory((current) =>\n        current.filter(\n          (row) =>\n            row.equipment_id !==\n            equipment.id\n        )\n      );\n      setEquipmentExpanded(\n        equipment.id,\n        false\n      );\n      return;\n    }\n\n    const isBarbell =\n      equipment.id ===\n      BARBELL_EQUIPMENT_ID;\n\n    const defaultMode = isBarbell\n      ? 'adjustable_load'\n      : FIXED_LOAD_CAPABLE_IDS.has(\n          equipment.id\n        )\n        ? 'load_unknown'\n        : 'non_load';\n\n    const nextRow = createInventoryRow(\n      equipment.id,\n      defaultMode\n    );\n\n    if (isBarbell) {\n      nextRow.min_load_kg = '20';\n      nextRow.increment_kg = '2.5';\n    }\n\n    setDraftInventory((current) => [\n      ...current,\n      nextRow,\n    ]);\n\n    const configurable =\n      isBarbell ||\n      FIXED_LOAD_CAPABLE_IDS.has(\n        equipment.id\n      ) ||\n      equipment.id ===\n        RESISTANCE_EQUIPMENT_ID;\n\n    if (configurable) {\n      setEquipmentExpanded(\n        equipment.id,\n        true\n      );\n    }\n  }`;

replaceOnce(
  oldToggle,
  newToggle,
  'toggle equipment behavior'
);

replaceOnce(
  `                  const selected =\n                    rows.length > 0;\n\n                  const supportsFixed =\n                    FIXED_LOAD_CAPABLE_IDS.has(\n                      equipment.id\n                    );\n\n                  const supportsAdjustable =\n                    ADJUSTABLE_LOAD_CAPABLE_IDS.has(\n                      equipment.id\n                    );`,
  `                  const selected =\n                    rows.length > 0;\n\n                  const isBarbell =\n                    equipment.id ===\n                    BARBELL_EQUIPMENT_ID;\n\n                  const expanded =\n                    expandedEquipmentIds.has(\n                      equipment.id\n                    );\n\n                  const supportsFixed =\n                    !isBarbell &&\n                    FIXED_LOAD_CAPABLE_IDS.has(\n                      equipment.id\n                    );\n\n                  const supportsAdjustable =\n                    !isBarbell &&\n                    ADJUSTABLE_LOAD_CAPABLE_IDS.has(\n                      equipment.id\n                    );`,
  'barbell render flags'
);

replaceOnce(
  `                  const hasConfiguration =\n                    supportsFixed ||\n                    supportsResistance;`,
  `                  const hasConfiguration =\n                    isBarbell ||\n                    supportsFixed ||\n                    supportsResistance;`,
  'barbell configuration flag'
);

replaceOnce(
  `                        onPress={() =>\n                          toggleEquipment(\n                            equipment\n                          )\n                        }`,
  `                        onPress={() => {\n                          if (\n                            selected &&\n                            hasConfiguration\n                          ) {\n                            toggleEquipmentExpanded(\n                              equipment.id\n                            );\n                            return;\n                          }\n\n                          toggleEquipment(\n                            equipment\n                          );\n                        }}`,
  'header expand behavior'
);

replaceOnce(
  `                        <View\n                          style={[\n                            styles.checkbox,\n                            selected &&\n                              styles.checkboxSelected,\n                          ]}\n                        >\n                          {selected && (\n                            <Ionicons\n                              name="checkmark"\n                              size={17}\n                              color={\n                                colors.brandWhite\n                              }\n                            />\n                          )}\n                        </View>`,
  `                        <Pressable\n                          onPress={(event) => {\n                            event.stopPropagation();\n                            toggleEquipment(\n                              equipment\n                            );\n                          }}\n                          hitSlop={8}\n                          style={[\n                            styles.checkbox,\n                            selected &&\n                              styles.checkboxSelected,\n                          ]}\n                        >\n                          {selected && (\n                            <Ionicons\n                              name="checkmark"\n                              size={17}\n                              color={\n                                colors.brandWhite\n                              }\n                            />\n                          )}\n                        </Pressable>`,
  'checkbox deselection behavior'
);

replaceOnce(
  `                          {(supportsFixed ||\n                            supportsResistance) && (`,
  `                          {(isBarbell ||\n                            supportsFixed ||\n                            supportsResistance) && (`,
  'barbell metadata visibility'
);

replaceOnce(
  `                              {supportsFixed && (\n                                <Ionicons`,
  `                              {(isBarbell || supportsFixed) && (\n                                <Ionicons`,
  'barbell metadata icon'
);

replaceOnce(
  `                                {supportsResistance\n                                  ? 'Résistance facultative.'\n                                  : 'Charge facultative.'}`,
  `                                {isBarbell\n                                  ? 'Poids total, barre comprise.'\n                                  : supportsResistance\n                                    ? 'Résistance facultative.'\n                                    : 'Charge facultative.'}`,
  'barbell metadata text'
);

replaceOnce(
  `                              selected\n                                ? 'chevron-up'\n                                : 'chevron-down'`,
  `                              expanded\n                                ? 'chevron-up'\n                                : 'chevron-down'`,
  'chevron state'
);

replaceOnce(
  `                      {selected &&\n                        hasConfiguration && (`,
  `                      {selected &&\n                        hasConfiguration &&\n                        expanded && (`,
  'configuration collapsed state'
);

replaceOnce(
  `                          {supportsFixed && (\n                            <View\n                              style={\n                                styles.modeTabs\n                              }`,
  `                          {isBarbell &&\n                            rows[0] && (\n                              <View\n                                style={\n                                  styles.adjustableArea\n                                }\n                              >\n                                <Text\n                                  style={\n                                    styles.fieldLabel\n                                  }\n                                >\n                                  CHARGE DE TA BARRE\n                                </Text>\n\n                                <Text\n                                  style={\n                                    styles.resistanceHelp\n                                  }\n                                >\n                                  Renseigne toujours le poids total déplacé. La barre est préremplie à 20 kg mais reste modifiable.\n                                </Text>\n\n                                <View\n                                  style={\n                                    styles.adjustableGrid\n                                  }\n                                >\n                                  <LoadInput\n                                    label="POIDS BARRE (KG)"\n                                    value={\n                                      rows[0]\n                                        .min_load_kg\n                                    }\n                                    placeholder="20"\n                                    onChange={(\n                                      value\n                                    ) =>\n                                      updateRow(\n                                        rows[0]\n                                          ._localKey,\n                                        {\n                                          min_load_kg:\n                                            value,\n                                          inventory_mode:\n                                            'adjustable_load',\n                                        }\n                                      )\n                                    }\n                                  />\n\n                                  <LoadInput\n                                    label="CHARGE TOTALE MAX (KG)"\n                                    value={\n                                      rows[0]\n                                        .max_load_kg\n                                    }\n                                    placeholder="100"\n                                    onChange={(\n                                      value\n                                    ) =>\n                                      updateRow(\n                                        rows[0]\n                                          ._localKey,\n                                        {\n                                          max_load_kg:\n                                            value,\n                                          inventory_mode:\n                                            'adjustable_load',\n                                        }\n                                      )\n                                    }\n                                  />\n\n                                  <LoadInput\n                                    label="PALIER TOTAL (KG)"\n                                    value={\n                                      rows[0]\n                                        .increment_kg\n                                    }\n                                    placeholder="2.5"\n                                    onChange={(\n                                      value\n                                    ) =>\n                                      updateRow(\n                                        rows[0]\n                                          ._localKey,\n                                        {\n                                          increment_kg:\n                                            value,\n                                          inventory_mode:\n                                            'adjustable_load',\n                                        }\n                                      )\n                                    }\n                                  />\n                                </View>\n\n                                <Text\n                                  style={\n                                    styles.unknownLoadText\n                                  }\n                                >\n                                  Exemple : barre 20 kg + 20 kg de chaque côté = 60 kg au total. Avec des disques de 1,25 kg par côté, le palier total est 2,5 kg.\n                                </Text>\n\n                                <Pressable\n                                  onPress={() =>\n                                    validateAndCollapseBarbell(\n                                      rows[0]\n                                    )\n                                  }\n                                  disabled={\n                                    !validateRow(\n                                      rows[0]\n                                    )\n                                  }\n                                  style={({\n                                    pressed,\n                                  }) => [\n                                    styles.addLoadButton,\n                                    !validateRow(\n                                      rows[0]\n                                    ) &&\n                                      styles.saveButtonDisabled,\n                                    pressed &&\n                                      validateRow(\n                                        rows[0]\n                                      ) &&\n                                      styles.pressed,\n                                  ]}\n                                >\n                                  <Ionicons\n                                    name="checkmark-circle-outline"\n                                    size={18}\n                                    color={\n                                      colors.primaryLight\n                                    }\n                                  />\n\n                                  <Text\n                                    style={\n                                      styles.addLoadText\n                                    }\n                                  >\n                                    VALIDER LES CHARGES\n                                  </Text>\n                                </Pressable>\n                              </View>\n                            )}\n\n                          {supportsFixed && (\n                            <View\n                              style={\n                                styles.modeTabs\n                              }`,
  'barbell custom configuration'
);

if (source === original) {
  console.log('ℹ️ Patch barre déjà appliqué, aucun changement.');
  process.exit(0);
}

const backup = `${targetPath}.barbell-ux.bak`;
fs.copyFileSync(targetPath, backup);

try {
  fs.writeFileSync(targetPath, source, 'utf8');

  const finalSource = fs.readFileSync(targetPath, 'utf8');
  const requiredMarkers = [
    `const BARBELL_EQUIPMENT_ID = 'E14';`,
    'VALIDER LES CHARGES',
    'CHARGE TOTALE MAX (KG)',
    'POIDS BARRE (KG)',
    'PALIER TOTAL (KG)',
    'Keyboard.dismiss();',
    'expandedEquipmentIds',
  ];

  for (const marker of requiredMarkers) {
    if (!finalSource.includes(marker)) {
      throw new Error(`Contrôle final KO : ${marker}`);
    }
  }

  fs.unlinkSync(backup);
} catch (error) {
  fs.copyFileSync(backup, targetPath);
  fs.unlinkSync(backup);
  throw error;
}

console.log('✅ Patch UX barre olympique appliqué.');
console.log(' - chevron = ouvrir / replier sans désélectionner');
console.log(' - checkbox = sélectionner / désélectionner');
console.log(' - poids barre prérempli à 20 kg et modifiable');
console.log(' - charge max = poids total barre + disques');
console.log(' - palier = variation totale sur la barre');
console.log(' - bouton VALIDER LES CHARGES = ferme le clavier et replie la brique');
console.log(' - les valeurs restent dans le draft jusqu’à ENREGISTRER MON MATÉRIEL');
