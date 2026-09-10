import fs from 'node:fs';

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return source.replace(from, to);
}

function replaceRegex(source, regex, to, label) {
  if (!regex.test(source)) throw new Error(`Missing regex patch anchor: ${label}`);
  return source.replace(regex, to);
}

function patchFile(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (before === after) throw new Error(`No changes produced for ${path}`);
  fs.writeFileSync(path, after);
}

const helper = `const CATEGORY_DEFINITIONS = {
  MUSCULATION: { key: 'MUSCULATION', label: 'Musculation', icon: 'barbell-outline' },
  GYM: { key: 'GYM', label: 'Gym', icon: 'body-outline' },
  CARDIO: { key: 'CARDIO', label: 'Cardio', icon: 'heart-outline' },
  EXPLOSIVITE: { key: 'EXPLOSIVITE', label: 'Explosivité', icon: 'flash-outline' },
  ACCESSOIRES: { key: 'ACCESSOIRES', label: 'Accessoires', icon: 'construct-outline' },
};

const EQUIPMENT_UX = {
  E01: ['ACCESSOIRES', 'Sol & récupération'],
  E02: ['CARDIO', 'Corde'],
  E03: ['MUSCULATION', 'Poids libres'],
  E04: ['MUSCULATION', 'Poids libres'],
  E05: ['ACCESSOIRES', 'Résistance & lest'],
  E06: ['GYM', 'Traction & suspension'],
  E07: ['GYM', 'Traction & suspension'],
  E08: ['MUSCULATION', 'Supports'],
  E09: ['EXPLOSIVITE', 'Lancers & ballons'],
  E10: ['EXPLOSIVITE', 'Plyométrie'],
  E11: ['EXPLOSIVITE', 'Plyométrie'],
  E12: ['ACCESSOIRES', 'Sol & récupération'],
  E13: ['GYM', 'Appuis & structures'],
  E14: ['MUSCULATION', 'Barres & charges'],
  E15: ['CARDIO', 'Ergomètres'],
  E16: ['CARDIO', 'Ergomètres'],
  E17: ['CARDIO', 'Ergomètres'],
  E18: ['GYM', 'Appuis & structures'],
  E19: ['GYM', 'Appuis & structures'],
  E20: ['ACCESSOIRES', 'Supports'],
  E21: ['EXPLOSIVITE', 'Plyométrie'],
  E22: ['GYM', 'Traction & suspension'],
  E23: ['CARDIO', 'Ergomètres'],
  E24: ['EXPLOSIVITE', 'Conditioning'],
  E25: ['MUSCULATION', 'Poids libres'],
  E26: ['EXPLOSIVITE', 'Conditioning'],
  E27: ['CARDIO', 'Ergomètres'],
  E28: ['MUSCULATION', 'Machines & poulies'],
  E29: ['ACCESSOIRES', 'Résistance & lest'],
  E30: ['EXPLOSIVITE', 'Lancers & ballons'],
  E31: ['MUSCULATION', 'Machines & poulies'],
  E32: ['MUSCULATION', 'Machines & poulies'],
  E33: ['MUSCULATION', 'Machines & poulies'],
  E34: ['MUSCULATION', 'Machines & poulies'],
  E35: ['MUSCULATION', 'Machines & poulies'],
  E36: ['MUSCULATION', 'Machines & poulies'],
  E37: ['MUSCULATION', 'Machines & poulies'],
  E38: ['MUSCULATION', 'Machines & poulies'],
  E39: ['MUSCULATION', 'Machines & poulies'],
  E40: ['MUSCULATION', 'Machines & poulies'],
  E41: ['MUSCULATION', 'Machines & poulies'],
  E42: ['MUSCULATION', 'Machines & poulies'],
  E43: ['MUSCULATION', 'Supports'],
  E44: ['GYM', 'Traction & suspension'],
  E45: ['ACCESSOIRES', 'Renforcement'],
  E46: ['MUSCULATION', 'Machines & poulies'],
  E47: ['MUSCULATION', 'Machines & poulies'],
  E48: ['MUSCULATION', 'Supports'],
  E49: ['GYM', 'Appuis & structures'],
};

const TECHNICAL_CATEGORY_FALLBACK = {
  'Poids libre': ['MUSCULATION', 'Poids libres'],
  Machine: ['MUSCULATION', 'Machines & poulies'],
  Gym: ['GYM', 'Gym'],
  Suspension: ['GYM', 'Traction & suspension'],
  Cardio: ['CARDIO', 'Cardio'],
  Plyométrie: ['EXPLOSIVITE', 'Plyométrie'],
  Conditioning: ['EXPLOSIVITE', 'Conditioning'],
  Résistance: ['ACCESSOIRES', 'Résistance & lest'],
  Lest: ['ACCESSOIRES', 'Résistance & lest'],
  Récupération: ['ACCESSOIRES', 'Sol & récupération'],
  Accessoire: ['ACCESSOIRES', 'Accessoires'],
  Support: ['ACCESSOIRES', 'Supports'],
};

const CATEGORY_ORDER = {
  HOME: ['MUSCULATION', 'GYM', 'CARDIO', 'ACCESSOIRES', 'EXPLOSIVITE'],
  BOX: ['MUSCULATION', 'GYM', 'CARDIO', 'EXPLOSIVITE', 'ACCESSOIRES'],
  GYM: ['MUSCULATION', 'CARDIO', 'GYM', 'ACCESSOIRES', 'EXPLOSIVITE'],
  OUTDOOR: ['GYM', 'CARDIO', 'EXPLOSIVITE', 'ACCESSOIRES', 'MUSCULATION'],
};

const LOCATION_TAGS = {
  HOME: ['HOME', 'GARAGE'],
  BOX: ['GYM_BOX', 'GARAGE'],
  GYM: ['GYM_BOX', 'GARAGE'],
  OUTDOOR: ['OUTDOOR'],
};

const GROUP_ORDER = {
  MUSCULATION: ['Poids libres', 'Barres & charges', 'Machines & poulies', 'Supports'],
  GYM: ['Traction & suspension', 'Appuis & structures', 'Gym'],
  CARDIO: ['Ergomètres', 'Corde', 'Cardio'],
  EXPLOSIVITE: ['Plyométrie', 'Conditioning', 'Lancers & ballons'],
  ACCESSOIRES: ['Résistance & lest', 'Sol & récupération', 'Renforcement', 'Supports', 'Accessoires'],
};

function normalizeEnvironment(value) {
  const code = String(value ?? 'HOME').trim().toUpperCase();
  return CATEGORY_ORDER[code] ? code : 'HOME';
}

function hasExerciseBacking(item) {
  if (item?.exercise_count === null || item?.exercise_count === undefined) return true;
  return Number(item.exercise_count) > 0;
}

function matchesEnvironment(item, environment) {
  const locations = Array.isArray(item?.locations) ? item.locations : [];
  if (locations.length === 0) return true;
  const allowed = LOCATION_TAGS[environment] ?? LOCATION_TAGS.HOME;
  return allowed.some((tag) => locations.includes(tag));
}

export function getEquipmentUxMeta(item) {
  const explicit = EQUIPMENT_UX[String(item?.id ?? '')];
  const fallback = TECHNICAL_CATEGORY_FALLBACK[String(item?.category ?? '')];
  const [category, group] = explicit ?? fallback ?? ['ACCESSOIRES', 'Accessoires'];
  return { ...CATEGORY_DEFINITIONS[category], group };
}

export function getEquipmentUxSections(catalog, environmentCode = 'HOME', includeEquipmentIds = []) {
  const environment = normalizeEnvironment(environmentCode);
  const includeIds = new Set((includeEquipmentIds ?? []).map((value) => String(value)));
  const order = CATEGORY_ORDER[environment] ?? CATEGORY_ORDER.HOME;
  const sections = new Map(order.map((key) => [key, { ...CATEGORY_DEFINITIONS[key], items: [] }]));

  for (const item of catalog ?? []) {
    const id = String(item?.id ?? '');
    if (!id || id === 'E00' || !hasExerciseBacking(item)) continue;
    if (!includeIds.has(id) && !matchesEnvironment(item, environment)) continue;

    const meta = getEquipmentUxMeta(item);
    if (!sections.has(meta.key)) {
      sections.set(meta.key, { ...meta, items: [] });
    }
    sections.get(meta.key).items.push({ ...item, uxGroup: meta.group });
  }

  return Array.from(sections.values())
    .map((section) => {
      const groupOrder = GROUP_ORDER[section.key] ?? [];
      const groupRank = new Map(groupOrder.map((label, index) => [label, index]));
      const items = [...section.items].sort((a, b) => {
        const ar = groupRank.has(a.uxGroup) ? groupRank.get(a.uxGroup) : 999;
        const br = groupRank.has(b.uxGroup) ? groupRank.get(b.uxGroup) : 999;
        if (ar !== br) return ar - br;
        return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'fr');
      });
      const groups = Array.from(new Set(items.map((item) => item.uxGroup).filter(Boolean))).map((label) => ({ label }));
      return { ...section, items, groups };
    })
    .filter((section) => section.items.length > 0);
}

export function getEquipmentUxCategoryDefinitions() {
  return Object.values(CATEGORY_DEFINITIONS);
}
`;

fs.writeFileSync('src/constants/equipmentUxCategories.js', helper);

patchFile('src/services/equipmentService.js', (source) =>
  replaceOnce(
    source,
    "'id, name, category, description, locations'",
    "'id, name, category, description, locations, exercise_count'",
    'equipment catalog exercise_count'
  )
);

patchFile('app/profile/equipment.js', (source) => {
  source = replaceOnce(
    source,
    "} from '../../src/services/equipmentService';\n\nconst backgroundImage",
    "} from '../../src/services/equipmentService';\nimport { getEquipmentUxSections } from '../../src/constants/equipmentUxCategories';\n\nconst BRAND_KAKI = '#5E6633';\nconst BRAND_ORANGE = '#FF6B19';\n\nconst backgroundImage",
    'profile category import'
  );

  source = replaceOnce(
    source,
    "  const [searchQuery, setSearchQuery] =\n    useState('');\n\n  const [activeEnvironment, setActiveEnvironment] =",
    "  const [searchQuery, setSearchQuery] =\n    useState('');\n\n  const [activeCategory, setActiveCategory] =\n    useState(null);\n\n  const [activeEnvironment, setActiveEnvironment] =",
    'profile active category state'
  );

  source = replaceOnce(
    source,
    "      setActiveEnvironment(environment);\n      setExpandedEquipmentIds(new Set());",
    "      setActiveEnvironment(environment);\n      setActiveCategory(null);\n      setSearchQuery('');\n      setExpandedEquipmentIds(new Set());",
    'profile reset category on environment change'
  );

  source = replaceRegex(
    source,
    /  const visibleCatalog = useMemo\(\(\) => \{[\s\S]*?  const canSave =/,
    `  const selectedEquipmentIdList = useMemo(\n    () => Array.from(new Set(draftInventory.map((row) => row.equipment_id).filter(Boolean))),\n    [draftInventory]\n  );\n\n  const selectedEquipmentIds = useMemo(\n    () => new Set(selectedEquipmentIdList),\n    [selectedEquipmentIdList]\n  );\n\n  const equipmentSections = useMemo(\n    () => getEquipmentUxSections(catalog, activeEnvironment, selectedEquipmentIdList),\n    [catalog, activeEnvironment, selectedEquipmentIdList]\n  );\n\n  const categoryOptions = useMemo(\n    () => equipmentSections.map((section) => ({\n      ...section,\n      selectedCount: section.items.filter((item) => selectedEquipmentIds.has(item.id)).length,\n    })),\n    [equipmentSections, selectedEquipmentIds]\n  );\n\n  const resolvedActiveCategory =\n    categoryOptions.some((section) => section.key === activeCategory)\n      ? activeCategory\n      : categoryOptions[0]?.key ?? null;\n\n  const environmentCatalog = useMemo(\n    () => equipmentSections.flatMap((section) => section.items),\n    [equipmentSections]\n  );\n\n  const visibleCatalog = useMemo(() => {\n    const normalizedQuery = normalizeSearchValue(searchQuery.trim());\n    const source = normalizedQuery\n      ? environmentCatalog\n      : categoryOptions.find((section) => section.key === resolvedActiveCategory)?.items ?? [];\n\n    if (!normalizedQuery) return source;\n\n    return source.filter((equipment) =>\n      normalizeSearchValue(\n        [equipment.name, equipment.category, equipment.description, equipment.uxGroup]\n          .filter(Boolean)\n          .join(' ')\n      ).includes(normalizedQuery)\n    );\n  }, [categoryOptions, environmentCatalog, resolvedActiveCategory, searchQuery]);\n\n  const selectedEquipmentCount = selectedEquipmentIds.size;\n\n  const canSave =`,
    'profile category-aware catalog'
  );

  source = replaceOnce(
    source,
    "              </ScrollView>\n\n              <View style={styles.catalogSummaryRow}>",
    `              </ScrollView>\n\n              {categoryOptions.length > 0 && (\n                <ScrollView\n                  horizontal\n                  showsHorizontalScrollIndicator={false}\n                  contentContainerStyle={styles.categoryTabs}\n                >\n                  {categoryOptions.map((category) => {\n                    const selected =\n                      searchQuery.length === 0 && resolvedActiveCategory === category.key;\n                    const groups = category.groups.map((group) => group.label).join(' · ');\n\n                    return (\n                      <Pressable\n                        key={category.key}\n                        onPress={() => {\n                          setSearchQuery('');\n                          setActiveCategory(category.key);\n                        }}\n                        style={[\n                          styles.categoryTab,\n                          selected && styles.categoryTabSelected,\n                        ]}\n                      >\n                        <View\n                          style={[\n                            styles.categoryIcon,\n                            selected && styles.categoryIconSelected,\n                          ]}\n                        >\n                          <Ionicons\n                            name={category.icon}\n                            size={19}\n                            color={selected ? colors.brandWhite : BRAND_KAKI}\n                          />\n                        </View>\n                        <View style={styles.categoryTabCopy}>\n                          <Text style={styles.categoryTabLabel}>{category.label}</Text>\n                          <Text numberOfLines={1} style={styles.categoryTabMeta}>\n                            {groups}\n                          </Text>\n                          <Text style={styles.categoryTabCount}>\n                            {category.selectedCount}/{category.items.length} sélectionné{category.selectedCount > 1 ? 's' : ''}\n                          </Text>\n                        </View>\n                      </Pressable>\n                    );\n                  })}\n                </ScrollView>\n              )}\n\n              <View style={styles.catalogSummaryRow}>`,
    'profile category navigation'
  );

  source = replaceOnce(
    source,
    "                  {visibleCatalog.length} MATÉRIEL{visibleCatalog.length > 1 ? 'S' : ''}",
    "                  {searchQuery.length > 0 ? `${visibleCatalog.length} RÉSULTAT${visibleCatalog.length > 1 ? 'S' : ''}` : `${visibleCatalog.length} DANS LA CATÉGORIE`}",
    'profile summary copy'
  );

  source = replaceOnce(
    source,
    "  catalogSummaryRow: {",
    `  categoryTabs: {\n    gap: 10,\n    paddingRight: 8,\n  },\n\n  categoryTab: {\n    width: 174,\n    minHeight: 104,\n    padding: 12,\n    borderRadius: 16,\n    borderWidth: 1,\n    borderColor: 'rgba(255,255,255,0.10)',\n    backgroundColor: 'rgba(17,21,26,0.88)',\n    flexDirection: 'row',\n    gap: 10,\n  },\n\n  categoryTabSelected: {\n    borderColor: BRAND_KAKI,\n    backgroundColor: 'rgba(94,102,51,0.18)',\n  },\n\n  categoryIcon: {\n    width: 38,\n    height: 38,\n    borderRadius: 12,\n    backgroundColor: 'rgba(94,102,51,0.12)',\n    alignItems: 'center',\n    justifyContent: 'center',\n  },\n\n  categoryIconSelected: {\n    backgroundColor: BRAND_KAKI,\n  },\n\n  categoryTabCopy: {\n    flex: 1,\n    minWidth: 0,\n  },\n\n  categoryTabLabel: {\n    fontFamily: 'Oswald_700Bold',\n    fontSize: 14,\n    lineHeight: 18,\n    color: colors.textPrimary,\n  },\n\n  categoryTabMeta: {\n    marginTop: 3,\n    fontFamily: 'Oswald_400Regular',\n    fontSize: 10,\n    lineHeight: 14,\n    color: colors.textMuted,\n  },\n\n  categoryTabCount: {\n    marginTop: 6,\n    fontFamily: 'Oswald_600SemiBold',\n    fontSize: 9,\n    lineHeight: 13,\n    color: BRAND_ORANGE,\n  },\n\n  catalogSummaryRow: {`,
    'profile category styles'
  );

  source = source
    .replaceAll('colors.primaryLight', 'BRAND_KAKI')
    .replaceAll('colors.primary', 'BRAND_KAKI')
    .replaceAll('colors.brandRed', 'BRAND_ORANGE')
    .replaceAll('rgba(8,104,255,', 'rgba(94,102,51,')
    .replaceAll('rgba(255,59,59,', 'rgba(255,107,25,');

  return source;
});

patchFile('src/workout/PreparationCheckinV4.js', (source) => {
  source = replaceOnce(
    source,
    "} from '../services/equipmentService';\n\nconst darkBrandIcon",
    "} from '../services/equipmentService';\nimport { getEquipmentUxSections } from '../constants/equipmentUxCategories';\n\nconst BRAND_KAKI = '#5E6633';\nconst BRAND_ORANGE = '#FF6B19';\nconst BRAND_KAKI_SOFT = 'rgba(94, 102, 51, 0.14)';\n\nconst darkBrandIcon",
    'preparation category import'
  );

  source = replaceOnce(
    source,
    "      return { id: item.id, name: item.name, detail };",
    "      return { ...item, detail };",
    'reference equipment keeps catalog metadata'
  );

  source = replaceOnce(
    source,
    "  const [referenceEquipment, setReferenceEquipment] = useState([]);\n  const [equipmentLoading, setEquipmentLoading] = useState(true);",
    "  const [referenceEquipment, setReferenceEquipment] = useState([]);\n  const [equipmentCategory, setEquipmentCategory] = useState(null);\n  const [equipmentLoading, setEquipmentLoading] = useState(true);",
    'preparation equipment category state'
  );

  source = replaceOnce(
    source,
    "  const environmentCode = String(preparation?.environmentCode ?? 'HOME').toUpperCase();\n  const readiness =",
    `  const environmentCode = String(preparation?.environmentCode ?? 'HOME').toUpperCase();\n  const equipmentBrandColors = useMemo(\n    () => ({ ...colors, accent: BRAND_KAKI, accentSoft: BRAND_KAKI_SOFT }),\n    [colors]\n  );\n  const equipmentSections = useMemo(\n    () => getEquipmentUxSections(\n      referenceEquipment,\n      environmentCode,\n      referenceEquipment.map((item) => item.id)\n    ),\n    [environmentCode, referenceEquipment]\n  );\n  const resolvedEquipmentCategory =\n    equipmentSections.some((section) => section.key === equipmentCategory)\n      ? equipmentCategory\n      : equipmentSections[0]?.key ?? null;\n  const visibleReferenceEquipment =\n    equipmentSections.find((section) => section.key === resolvedEquipmentCategory)?.items ?? [];\n  const readiness =`,
    'preparation category derived state'
  );

  source = replaceOnce(
    source,
    "  function selectEnvironment(code) {\n    updatePreparation({",
    "  function selectEnvironment(code) {\n    setEquipmentCategory(null);\n    updatePreparation({",
    'preparation reset category on environment change'
  );

  source = replaceOnce(
    source,
    "          <Pressable onPress={() => setSheet(null)} style={styles.sheetDoneButton}>",
    "          <Pressable onPress={() => setSheet(null)} style={[styles.sheetDoneButton, { backgroundColor: BRAND_ORANGE }] }>",
    'preparation equipment done accent'
  );

  source = replaceRegex(
    source,
    /            <View style=\{styles\.equipmentGrid\}>[\s\S]*?            <\/View>\n\n            <Pressable\n              onPress=\{\(\) => \{\n                setSheet\(null\);/,
    `            {equipmentSections.length > 0 && (\n              <ScrollView\n                horizontal\n                showsHorizontalScrollIndicator={false}\n                contentContainerStyle={styles.equipmentCategoryTabs}\n              >\n                {equipmentSections.map((category) => {\n                  const selected = resolvedEquipmentCategory === category.key;\n                  const selectedCount = category.items.filter((item) =>\n                    equipment.includes(item.name)\n                  ).length;\n\n                  return (\n                    <Pressable\n                      key={category.key}\n                      onPress={() => setEquipmentCategory(category.key)}\n                      style={[\n                        styles.equipmentCategoryTab,\n                        selected && styles.equipmentCategoryTabSelected,\n                      ]}\n                    >\n                      <View\n                        style={[\n                          styles.equipmentCategoryIcon,\n                          selected && styles.equipmentCategoryIconSelected,\n                        ]}\n                      >\n                        <Ionicons\n                          name={category.icon}\n                          size={18}\n                          color={selected ? '#FFFFFF' : BRAND_KAKI}\n                        />\n                      </View>\n                      <View style={styles.flexOne}>\n                        <Text style={styles.equipmentCategoryLabel}>{category.label}</Text>\n                        <Text numberOfLines={1} style={styles.equipmentCategoryMeta}>\n                          {category.groups.map((group) => group.label).join(' · ')}\n                        </Text>\n                        <Text style={styles.equipmentCategoryCount}>\n                          {selectedCount}/{category.items.length}\n                        </Text>\n                      </View>\n                    </Pressable>\n                  );\n                })}\n              </ScrollView>\n            )}\n\n            <View style={styles.equipmentGrid}>\n              {visibleReferenceEquipment.map((item) => (\n                <EquipmentChoice\n                  key={item.id}\n                  item={item}\n                  selected={equipment.includes(item.name)}\n                  onPress={() => toggleEquipment(item.name)}\n                  colors={equipmentBrandColors}\n                  styles={styles}\n                />\n              ))}\n            </View>\n\n            <Pressable\n              onPress={() => {\n                setSheet(null);`,
    'preparation categorized equipment list'
  );

  source = replaceOnce(
    source,
    "              <Text style={styles.inlineLinkText}>Modifier mon matériel</Text>\n              <Ionicons name=\"chevron-forward\" size={18} color={colors.accent} />",
    "              <Text style={[styles.inlineLinkText, { color: BRAND_KAKI }]}>Modifier mon matériel</Text>\n              <Ionicons name=\"chevron-forward\" size={18} color={BRAND_KAKI} />",
    'preparation equipment profile link accent'
  );

  source = replaceOnce(
    source,
    "    equipmentGrid: {\n      marginTop: 10,",
    `    equipmentCategoryTabs: {\n      marginTop: 14,\n      gap: 9,\n      paddingRight: 18,\n    },\n    equipmentCategoryTab: {\n      width: 164,\n      minHeight: 94,\n      padding: 11,\n      borderRadius: 15,\n      borderWidth: 1,\n      borderColor: colors.border,\n      backgroundColor: colors.surfaceElevated,\n      flexDirection: 'row',\n      gap: 9,\n    },\n    equipmentCategoryTabSelected: {\n      borderColor: BRAND_KAKI,\n      backgroundColor: BRAND_KAKI_SOFT,\n    },\n    equipmentCategoryIcon: {\n      width: 36,\n      height: 36,\n      borderRadius: 11,\n      alignItems: 'center',\n      justifyContent: 'center',\n      backgroundColor: BRAND_KAKI_SOFT,\n    },\n    equipmentCategoryIconSelected: {\n      backgroundColor: BRAND_KAKI,\n    },\n    equipmentCategoryLabel: {\n      fontFamily: MANROPE.bold,\n      fontSize: 13,\n      lineHeight: 18,\n      color: colors.text,\n    },\n    equipmentCategoryMeta: {\n      marginTop: 2,\n      fontFamily: MANROPE.regular,\n      fontSize: 10,\n      lineHeight: 14,\n      color: colors.textMuted,\n    },\n    equipmentCategoryCount: {\n      marginTop: 4,\n      fontFamily: MANROPE.bold,\n      fontSize: 11,\n      lineHeight: 14,\n      color: BRAND_ORANGE,\n    },\n    equipmentGrid: {\n      marginTop: 10,`,
    'preparation category styles'
  );

  return source;
});

console.log('EQP-002 category UI patch applied');
