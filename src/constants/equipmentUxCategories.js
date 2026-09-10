const CATEGORY_DEFINITIONS = {
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
