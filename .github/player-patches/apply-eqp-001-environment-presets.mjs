import fs from 'node:fs';

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`Missing patch anchor: ${label}`);
  }
  return source.replace(from, to);
}

function replaceRegex(source, regex, to, label) {
  if (!regex.test(source)) {
    throw new Error(`Missing regex patch anchor: ${label}`);
  }
  return source.replace(regex, to);
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
    "function normalizeInventoryRow(row) {",
    `function normalizeEnvironmentCode(value) {\n  const code = String(value ?? 'HOME').trim().toUpperCase();\n  return ['HOME', 'BOX', 'GYM', 'OUTDOOR'].includes(code) ? code : 'HOME';\n}\n\nexport async function getUserEnvironmentEquipmentPreset(environmentCode = 'HOME') {\n  const environment = normalizeEnvironmentCode(environmentCode);\n\n  // HOME reste l'inventaire personnel historique, avec quantité/charges.\n  if (environment === 'HOME') {\n    return getUserEquipmentInventory();\n  }\n\n  const user = await getAuthenticatedUser();\n  const data = await runSupabaseRequestWithAuthRetry(() =>\n    supabase\n      .from('user_environment_equipment_presets')\n      .select('equipment_id, created_at, updated_at')\n      .eq('user_id', user.id)\n      .eq('environment_code', environment)\n      .order('equipment_id', { ascending: true })\n  );\n\n  return (data ?? []).map((row) => ({\n    ...row,\n    inventory_mode: 'non_load',\n    quantity: 1,\n    active: true,\n  }));\n}\n\nexport async function replaceUserEnvironmentEquipmentPreset(environmentCode, equipmentIds) {\n  await getAuthenticatedUser();\n  const environment = normalizeEnvironmentCode(environmentCode);\n  const ids = Array.from(\n    new Set(\n      (Array.isArray(equipmentIds) ? equipmentIds : [])\n        .map((value) => String(value ?? '').trim())\n        .filter((value) => value && value !== 'E00')\n    )\n  );\n\n  const data = await runSupabaseRequestWithAuthRetry(() =>\n    supabase.rpc('replace_user_environment_equipment_preset', {\n      p_environment_code: environment,\n      p_equipment_ids: ids,\n    })\n  );\n\n  return Array.isArray(data) ? data : [];\n}\n\nfunction normalizeInventoryRow(row) {`,
    'environment preset service functions'
  );
  return source;
});

patchFile('src/workout/PreparationCheckinV4.js', (source) => {
  source = replaceOnce(
    source,
    `import {\n  getEquipmentCatalog,\n  getUserEquipmentInventory,\n} from '../services/equipmentService';`,
    `import {\n  getEquipmentCatalog,\n  getUserEnvironmentEquipmentPreset,\n} from '../services/equipmentService';`,
    'Preparation equipment service import'
  );

  source = replaceOnce(
    source,
    `  const painScreenOpenedRef = useRef(false);\n  const equipmentRef = useRef(preparation?.equipment ?? []);\n  equipmentRef.current = preparation?.equipment ?? [];`,
    `  const painScreenOpenedRef = useRef(false);\n  const equipmentRef = useRef(preparation?.equipment ?? []);\n  const preparationRef = useRef(preparation);\n  const equipmentRequestRef = useRef(0);\n  equipmentRef.current = preparation?.equipment ?? [];\n  preparationRef.current = preparation;`,
    'Preparation equipment refs'
  );

  source = replaceRegex(
    source,
    /  const loadEquipment = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[updatePreparation\]\);/,
    `  const loadEquipment = useCallback(async (targetEnvironment = 'HOME') => {\n    const environment = String(targetEnvironment ?? 'HOME').toUpperCase();\n    const requestId = ++equipmentRequestRef.current;\n\n    setEquipmentLoading(true);\n    setEquipmentError('');\n    setEquipmentNeedsLogin(false);\n\n    try {\n      const [catalog, presetRows] = await Promise.all([\n        getEquipmentCatalog(),\n        getUserEnvironmentEquipmentPreset(environment),\n      ]);\n\n      if (requestId !== equipmentRequestRef.current) return;\n\n      const reference = buildReferenceEquipment(catalog, presetRows);\n      setReferenceEquipment(reference);\n\n      const current = Array.isArray(equipmentRef.current) ? equipmentRef.current : [];\n      const allowedNames = new Set((catalog ?? []).map((item) => item.name));\n      const storedEnvironment = String(\n        preparationRef.current?.equipmentEnvironmentCode ?? ''\n      ).toUpperCase();\n      const selectionSource = preparationRef.current?.equipmentSelectionSource ?? null;\n      const shouldLoadPreset =\n        storedEnvironment !== environment ||\n        current.length === 0 ||\n        selectionSource !== 'session_override';\n\n      let normalized;\n      if (shouldLoadPreset) {\n        normalized =\n          reference.length > 0\n            ? reference.map((item) => item.name)\n            : ['Poids du corps'];\n      } else {\n        const sanitized = current.filter(\n          (name) => name === 'Poids du corps' || allowedNames.has(name)\n        );\n        normalized = sanitized.length > 0 ? sanitized : ['Poids du corps'];\n      }\n\n      if (requestId !== equipmentRequestRef.current) return;\n\n      if (\n        shouldLoadPreset ||\n        normalized.join('|') !== current.join('|') ||\n        storedEnvironment !== environment\n      ) {\n        equipmentRef.current = normalized;\n        updatePreparation({\n          equipment: normalized,\n          equipmentEnvironmentCode: environment,\n          equipmentSelectionSource: shouldLoadPreset ? 'preset' : selectionSource,\n        });\n      }\n    } catch (error) {\n      if (requestId !== equipmentRequestRef.current) return;\n      if (isAuthSessionError(error)) {\n        setEquipmentNeedsLogin(true);\n      } else {\n        setEquipmentError('Impossible de charger ton matériel pour le moment.');\n      }\n    } finally {\n      if (requestId === equipmentRequestRef.current) {\n        setEquipmentLoading(false);\n      }\n    }\n  }, [updatePreparation]);`,
    'Preparation environment-aware loader'
  );

  source = replaceOnce(
    source,
    `  useFocusEffect(\n    useCallback(() => {\n      loadEquipment();\n    }, [loadEquipment])\n  );`,
    `  useFocusEffect(\n    useCallback(() => {\n      loadEquipment(environmentCode);\n    }, [environmentCode, loadEquipment])\n  );`,
    'Preparation focus loader'
  );

  source = replaceOnce(
    source,
    `    updatePreparation({ equipment: next });`,
    `    updatePreparation({\n      equipment: next,\n      equipmentEnvironmentCode: environmentCode,\n      equipmentSelectionSource: 'session_override',\n    });`,
    'Preparation manual equipment override'
  );

  source = replaceOnce(
    source,
    `    updatePreparation({\n      equipment:\n        referenceEquipment.length > 0\n          ? referenceEquipment.map((item) => item.name)\n          : ['Poids du corps'],\n    });`,
    `    updatePreparation({\n      equipment:\n        referenceEquipment.length > 0\n          ? referenceEquipment.map((item) => item.name)\n          : ['Poids du corps'],\n      equipmentEnvironmentCode: environmentCode,\n      equipmentSelectionSource: 'session_override',\n    });`,
    'Preparation select all profile equipment'
  );

  return source;
});

patchFile('app/profile/equipment.js', (source) => {
  source = replaceOnce(
    source,
    `import {\n  getEquipmentCatalog,\n  getUserEquipmentInventory,\n  replaceUserEquipmentInventory,\n} from '../../src/services/equipmentService';`,
    `import {\n  getEquipmentCatalog,\n  getUserEnvironmentEquipmentPreset,\n  replaceUserEnvironmentEquipmentPreset,\n  replaceUserEquipmentInventory,\n} from '../../src/services/equipmentService';`,
    'Profile equipment service import'
  );

  source = replaceRegex(
    source,
    /const EQUIPMENT_LOCATIONS = \[[\s\S]*?\n\];/,
    `const PROFILE_ENVIRONMENTS = [\n  { key: 'HOME', label: 'MAISON', icon: 'home-outline' },\n  { key: 'BOX', label: 'BOX', icon: 'fitness-outline' },\n  { key: 'GYM', label: 'SALLE', icon: 'barbell-outline' },\n  { key: 'OUTDOOR', label: 'EXTÉRIEUR', icon: 'leaf-outline' },\n];`,
    'Profile environment tabs constant'
  );

  source = replaceOnce(
    source,
    `  const [activeLocation, setActiveLocation] =\n    useState('ALL');`,
    `  const [activeEnvironment, setActiveEnvironment] =\n    useState('HOME');`,
    'Profile active environment state'
  );

  source = replaceOnce(
    source,
    `          getEquipmentCatalog(),\n          getUserEquipmentInventory(),`,
    `          getEquipmentCatalog(),\n          getUserEnvironmentEquipmentPreset('HOME'),`,
    'Profile initial HOME load'
  );

  source = replaceRegex(
    source,
    /  const visibleCatalog = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[catalog, activeLocation, searchQuery\]\);/,
    `  const activeEnvironmentLabel =\n    PROFILE_ENVIRONMENTS.find((item) => item.key === activeEnvironment)?.label ?? 'MAISON';\n\n  async function selectProfileEnvironment(code) {\n    const environment = String(code ?? 'HOME').toUpperCase();\n    if (environment === activeEnvironment || isSaving) return;\n\n    try {\n      setIsLoading(true);\n      setErrorMessage('');\n      setSaved(false);\n      setActiveEnvironment(environment);\n      setExpandedEquipmentIds(new Set());\n\n      const rows = await getUserEnvironmentEquipmentPreset(environment);\n      setDraftInventory((rows ?? []).map(normalizeLoadedRow));\n    } catch (error) {\n      setErrorMessage(\n        error?.message ?? 'Impossible de charger le matériel de cet environnement.'\n      );\n    } finally {\n      setIsLoading(false);\n    }\n  }\n\n  const visibleCatalog = useMemo(() => {\n    const normalizedQuery =\n      normalizeSearchValue(searchQuery.trim());\n\n    return catalog.filter((equipment) => {\n      if (equipment.id === 'E00') return false;\n      if (!normalizedQuery) return true;\n\n      return normalizeSearchValue(\n        [equipment.name, equipment.category, equipment.description]\n          .filter(Boolean)\n          .join(' ')\n      ).includes(normalizedQuery);\n    });\n  }, [catalog, searchQuery]);`,
    'Profile visible catalog and environment loader'
  );

  source = replaceOnce(
    source,
    `  const canSave =\n    !isLoading &&\n    !isSaving &&\n    draftInventory.every(validateRow);`,
    `  const canSave =\n    !isLoading &&\n    !isSaving &&\n    (activeEnvironment !== 'HOME' || draftInventory.every(validateRow));`,
    'Profile canSave by environment'
  );

  source = replaceOnce(
    source,
    `    const defaultMode = isBarbell\n      ? 'adjustable_load'\n      : FIXED_LOAD_CAPABLE_IDS.has(\n          equipment.id\n        )\n        ? 'load_unknown'\n        : 'non_load';`,
    `    const defaultMode = activeEnvironment !== 'HOME'\n      ? 'non_load'\n      : isBarbell\n        ? 'adjustable_load'\n        : FIXED_LOAD_CAPABLE_IDS.has(\n            equipment.id\n          )\n          ? 'load_unknown'\n          : 'non_load';`,
    'Profile non-HOME simple equipment rows'
  );

  source = replaceOnce(
    source,
    `    const configurable =\n      isBarbell ||\n      FIXED_LOAD_CAPABLE_IDS.has(\n        equipment.id\n      ) ||\n      equipment.id ===\n        RESISTANCE_EQUIPMENT_ID;`,
    `    const configurable =\n      activeEnvironment === 'HOME' &&\n      (isBarbell ||\n        FIXED_LOAD_CAPABLE_IDS.has(\n          equipment.id\n        ) ||\n        equipment.id ===\n          RESISTANCE_EQUIPMENT_ID);`,
    'Profile expand only HOME inventory'
  );

  source = replaceRegex(
    source,
    /      const payload =\n        sanitizeInventory\(\n          draftInventory\n        \);\n\n      const savedRows =\n        await replaceUserEquipmentInventory\(\n          payload\n        \);\n\n      setDraftInventory\(\n        \(savedRows \?\? \[\]\)\.map\(\n          normalizeLoadedRow\n        \)\n      \);/,
    `      if (activeEnvironment === 'HOME') {\n        const payload = sanitizeInventory(draftInventory);\n        const savedRows = await replaceUserEquipmentInventory(payload);\n        setDraftInventory((savedRows ?? []).map(normalizeLoadedRow));\n      } else {\n        const equipmentIds = Array.from(\n          new Set(draftInventory.map((row) => row.equipment_id).filter(Boolean))\n        );\n        const savedIds = await replaceUserEnvironmentEquipmentPreset(\n          activeEnvironment,\n          equipmentIds\n        );\n        setDraftInventory(\n          (savedIds ?? []).map((equipmentId) =>\n            normalizeLoadedRow(createInventoryRow(equipmentId, 'non_load'))\n          )\n        );\n      }`,
    'Profile save by environment'
  );

  source = replaceOnce(
    source,
    `                TON INVENTAIRE HABITUEL`,
    `                {activeEnvironment === 'HOME'\n                  ? 'TON MATÉRIEL À LA MAISON'\n                  : \`TON MATÉRIEL HABITUEL — \${activeEnvironmentLabel}\`}`,
    'Profile intro title'
  );

  source = replaceOnce(
    source,
    `                Ici, tu peux mettre à jour le matériel que tu possèdes et renseigner les charges associées.`,
    `                {activeEnvironment === 'HOME'\n                  ? 'Ici, tu peux mettre à jour le matériel que tu possèdes et renseigner les charges associées.'\n                  : \`Sélectionne le matériel que tu as habituellement à disposition quand tu t’entraînes en \${activeEnvironmentLabel.toLowerCase()}.\`}`,
    'Profile intro text'
  );

  source = replaceOnce(
    source,
    `                Renseigner les charges permet à UGEROD d’adapter plus précisément tes entraînements. Tu peux enregistrer un matériel même si tu ne connais pas sa charge.`,
    `                {activeEnvironment === 'HOME'\n                  ? 'Renseigner les charges permet à UGEROD d’adapter plus précisément tes entraînements. Tu peux enregistrer un matériel même si tu ne connais pas sa charge.'\n                  : 'Ce preset est utilisé automatiquement dans la préparation quand tu choisis cet environnement. Les changements faits pendant une préparation restent ponctuels.'}`,
    'Profile info copy'
  );

  source = replaceOnce(
    source,
    `{EQUIPMENT_LOCATIONS.map((location) => {`,
    `{PROFILE_ENVIRONMENTS.map((location) => {`,
    'Profile environment tabs render'
  );
  source = source.replaceAll('activeLocation === location.key', 'activeEnvironment === location.key');
  source = replaceOnce(
    source,
    `setActiveLocation(location.key)`,
    `selectProfileEnvironment(location.key)`,
    'Profile environment tab action'
  );

  source = replaceOnce(
    source,
    `                  const hasConfiguration =\n                    isBarbell ||\n                    supportsFixed ||\n                    supportsResistance;`,
    `                  const hasConfiguration =\n                    activeEnvironment === 'HOME' &&\n                    (isBarbell ||\n                      supportsFixed ||\n                      supportsResistance);`,
    'Profile render config only HOME'
  );

  source = replaceOnce(
    source,
    `                          {(isBarbell ||\n                            supportsFixed ||\n                            supportsResistance) && (`,
    `                          {hasConfiguration && (`,
    'Profile hints only HOME'
  );

  return source;
});

patchFile('src/contexts/WorkoutContext.js', (source) => {
  source = replaceOnce(
    source,
    `  equipment: [],\n  readiness: null,`,
    `  equipment: [],\n  environmentCode: 'HOME',\n  equipmentEnvironmentCode: null,\n  equipmentSelectionSource: null,\n  readiness: null,`,
    'WorkoutContext environment equipment defaults'
  );
  return source;
});

console.log('EQP-001 environment preset patch applied');