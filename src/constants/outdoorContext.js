// Shared with Today: a place is a feasibility context, never inferred equipment.
export const OUTDOOR_PLACES = [
  {
    code: 'CITY_URBAN',
    label: 'Ville',
    surface: null,
    terrainCodes: ['ROAD', 'GRASS', 'MIXED'],
  },
  {
    code: 'PARK',
    label: 'Parc',
    surface: null,
    terrainCodes: ['GRASS', 'ROAD', 'TRAIL', 'MIXED'],
  },
  {
    code: 'ATHLETICS_TRACK',
    label: 'Piste d’athlétisme',
    surface: 'TRACK',
  },
  {
    // Conservé pour les anciennes préparations, mais ce n’est plus présenté
    // comme un "lieu" : l’herbe appartient désormais à l’étape Terrain.
    code: 'GRASS_FIELD',
    label: 'Pelouse / terrain en herbe',
    surface: 'GRASS',
    selectable: false,
  },
  {
    code: 'FOREST_PATH',
    label: 'Forêt',
    surface: null,
    terrainCodes: ['TRAIL', 'GRASS', 'MIXED'],
  },
  {
    code: 'MOUNTAIN',
    label: 'Montagne',
    surface: null,
    terrainCodes: ['TRAIL', 'GRASS', 'MIXED'],
  },
  {
    code: 'BEACH',
    label: 'Plage',
    surface: 'SAND',
  },
  {
    code: 'STREET_WORKOUT',
    label: 'Street workout',
    surface: null,
    terrainCodes: ['ROAD', 'GRASS', 'MIXED'],
  },
  {
    code: 'OTHER',
    label: 'Autre',
    surface: null,
    terrainCodes: ['GRASS', 'ROAD', 'TRAIL', 'SAND', 'MIXED'],
  },
];

export const TERRAIN_OPTIONS = [
  { code: 'GRASS', label: 'Herbe / sol souple' },
  { code: 'ROAD', label: 'Sol dur / bitume' },
  { code: 'TRAIL', label: 'Sentier / irrégulier' },
  { code: 'SAND', label: 'Sable' },
  { code: 'MIXED', label: 'Mixte' },
];

export function selectableOutdoorPlaces() {
  return OUTDOOR_PLACES.filter((item) => item.selectable !== false);
}

export function terrainOptionsForPlace(place) {
  if (!place || place.surface) return [];

  const allowed = Array.isArray(place.terrainCodes)
    ? new Set(place.terrainCodes)
    : null;

  return allowed
    ? TERRAIN_OPTIONS.filter((item) => allowed.has(item.code))
    : TERRAIN_OPTIONS;
}
