import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Keyboard,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  spacing,
  typography,
} from '../../src/constants';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';

import {
  getEquipmentCatalog,
  getUserEnvironmentEquipmentPreset,
  replaceUserEnvironmentEquipmentPreset,
  replaceUserEquipmentInventory,
} from '../../src/services/equipmentService';
import { getEquipmentUxSections } from '../../src/constants/equipmentUxCategories';

const BRAND_KAKI = '#5E6633';
const BRAND_ORANGE = '#FF6B19';

const backgroundImage = require(
  '../../assets/backgrounds/welcome-default.jpg'
);

const darkBrandIcon = require(
  '../../assets/branding/ugerod-icon.png'
);

const lightBrandIcon = require(
  '../../assets/branding/LOGO VERSION NOIR.png'
);

const FIXED_LOAD_CAPABLE_IDS = new Set([
  'E03', // Haltères
  'E04', // Kettlebell
  'E09', // Medball
  'E14', // Barre olympique + disques
]);

const ADJUSTABLE_LOAD_CAPABLE_IDS = new Set([
  'E03', // Haltères réglables
  'E14', // Barre olympique + disques
]);

const QUANTITY_RELEVANT_IDS = new Set([
  'E03', // Haltères
  'E04', // Kettlebell
]);

const RESISTANCE_EQUIPMENT_ID = 'E05';
const BARBELL_EQUIPMENT_ID = 'E14';

const RESISTANCE_OPTIONS = [
  { value: 'Légère', label: 'LÉGÈRE' },
  { value: 'Moyenne', label: 'MOYENNE' },
  { value: 'Forte', label: 'FORTE' },
];

const PROFILE_ENVIRONMENTS = [
  { key: 'HOME', label: 'MAISON', icon: 'home-outline' },
  { key: 'BOX', label: 'BOX', icon: 'fitness-outline' },
  { key: 'GYM', label: 'SALLE', icon: 'barbell-outline' },
  { key: 'OUTDOOR', label: 'EXTÉRIEUR', icon: 'leaf-outline' },
];

function normalizeSearchValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function makeLocalKey(equipmentId) {
  return `${equipmentId}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function createInventoryRow(
  equipmentId,
  mode = 'non_load'
) {
  return {
    _localKey: makeLocalKey(equipmentId),
    equipment_id: equipmentId,
    inventory_mode: mode,
    quantity: 1,
    load_kg: '',
    min_load_kg: '',
    max_load_kg: '',
    increment_kg: '',
    resistance_label: null,
    notes: null,
  };
}

function normalizeLoadedRow(row) {
  return {
    ...row,
    _localKey:
      row.id ??
      makeLocalKey(row.equipment_id),
    quantity: Number(row.quantity ?? 1),
    load_kg:
      row.load_kg !== null &&
      row.load_kg !== undefined
        ? String(row.load_kg)
        : '',
    min_load_kg:
      row.min_load_kg !== null &&
      row.min_load_kg !== undefined
        ? String(row.min_load_kg)
        : '',
    max_load_kg:
      row.max_load_kg !== null &&
      row.max_load_kg !== undefined
        ? String(row.max_load_kg)
        : '',
    increment_kg:
      row.increment_kg !== null &&
      row.increment_kg !== undefined
        ? String(row.increment_kg)
        : '',
    resistance_label:
      row.equipment_id ===
        RESISTANCE_EQUIPMENT_ID &&
      row.resistance_label ===
        'Plusieurs résistances'
        ? null
        : row.resistance_label ?? null,
  };
}

function positiveNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const normalized = String(value).replace(
    ',',
    '.'
  );

  const number = Number(normalized);

  return Number.isFinite(number) &&
    number > 0
    ? number
    : null;
}

function validateRow(row) {
  if (!row?.equipment_id) {
    return false;
  }

  const quantity = Number(row.quantity);

  if (
    !Number.isFinite(quantity) ||
    quantity < 1
  ) {
    return false;
  }

  if (
    row.inventory_mode === 'fixed_load'
  ) {
    return (
      positiveNumber(row.load_kg) !== null
    );
  }

  if (
    row.inventory_mode ===
    'adjustable_load'
  ) {
    const min = positiveNumber(
      row.min_load_kg
    );
    const max = positiveNumber(
      row.max_load_kg
    );
    const increment = positiveNumber(
      row.increment_kg
    );

    return (
      min !== null &&
      max !== null &&
      increment !== null &&
      max >= min
    );
  }

  return true;
}

function sanitizeInventory(rows) {
  return rows.map((row) => {
    const base = {
      equipment_id: row.equipment_id,
      inventory_mode:
        row.inventory_mode ??
        'non_load',
      quantity: Math.max(
        1,
        Math.round(
          Number(row.quantity) || 1
        )
      ),
      notes: row.notes ?? null,
    };

    if (
      base.inventory_mode ===
      'load_unknown'
    ) {
      return {
        ...base,
        inventory_mode:
          'load_unknown',
        load_kg: null,
        min_load_kg: null,
        max_load_kg: null,
        increment_kg: null,
        resistance_label: null,
      };
    }

    if (
      base.inventory_mode ===
      'fixed_load'
    ) {
      return {
        ...base,
        load_kg: positiveNumber(
          row.load_kg
        ),
        min_load_kg: null,
        max_load_kg: null,
        increment_kg: null,
        resistance_label: null,
      };
    }

    if (
      base.inventory_mode ===
      'adjustable_load'
    ) {
      return {
        ...base,
        load_kg: null,
        min_load_kg: positiveNumber(
          row.min_load_kg
        ),
        max_load_kg: positiveNumber(
          row.max_load_kg
        ),
        increment_kg: positiveNumber(
          row.increment_kg
        ),
        resistance_label: null,
      };
    }

    return {
      ...base,
      inventory_mode: 'non_load',
      load_kg: null,
      min_load_kg: null,
      max_load_kg: null,
      increment_kg: null,
      resistance_label:
        row.resistance_label ?? null,
    };
  });
}

export default function ProfileEquipmentScreen() {
  const { returnTo, environment } = useLocalSearchParams();
  const { colors: themeColors, isDark } = useUgerodTheme();

  const initialEnvironment = useMemo(() => {
    const rawEnvironment = Array.isArray(environment)
      ? environment[0]
      : environment;
    const code = String(rawEnvironment ?? 'HOME').trim().toUpperCase();

    return PROFILE_ENVIRONMENTS.some((item) => item.key === code)
      ? code
      : 'HOME';
  }, [environment]);

  const colors = useMemo(
    () => ({
      ...themeColors,
      // Cette page applique la nouvelle charte UGEROD dans les deux thèmes.
      accent: BRAND_KAKI,
      accentStrong: BRAND_KAKI,
      accentSoft: isDark
        ? 'rgba(94,102,51,0.22)'
        : 'rgba(94,102,51,0.12)',
      secondaryAccent: BRAND_ORANGE,
      secondaryAccentStrong: BRAND_ORANGE,
      secondaryAccentSoft: isDark
        ? 'rgba(255,107,25,0.18)'
        : 'rgba(255,107,25,0.12)',
      primary: BRAND_KAKI,
      primaryLight: isDark ? '#A8B09A' : BRAND_KAKI,
      textPrimary: themeColors.text,
      brandWhite: '#FFFFFF',
    }),
    [themeColors, isDark]
  );

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;

  const QuantityControl = (props) => (
    <EquipmentQuantityControl {...props} styles={styles} colors={colors} />
  );

  const LoadInput = (props) => (
    <EquipmentLoadInput {...props} styles={styles} colors={colors} />
  );
  const [catalog, setCatalog] =
    useState([]);

  const [draftInventory, setDraftInventory] =
    useState([]);

  const [isLoading, setIsLoading] =
    useState(true);

  const [isSaving, setIsSaving] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState('');

  const [saved, setSaved] =
    useState(false);

  const [searchQuery, setSearchQuery] =
    useState('');

  const [activeCategory, setActiveCategory] =
    useState(null);

  const [activeEnvironment, setActiveEnvironment] =
    useState(initialEnvironment);

  const [
    expandedEquipmentIds,
    setExpandedEquipmentIds,
  ] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setErrorMessage('');

        const [
          catalogData,
          inventoryData,
        ] = await Promise.all([
          getEquipmentCatalog(),
          getUserEnvironmentEquipmentPreset(initialEnvironment),
        ]);

        if (cancelled) {
          return;
        }

        setCatalog(catalogData ?? []);

        setDraftInventory(
          (inventoryData ?? []).map(
            normalizeLoadedRow
          )
        );
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error?.message ??
              'Impossible de charger ton matériel.'
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [initialEnvironment]);

  const activeEnvironmentLabel =
    PROFILE_ENVIRONMENTS.find((item) => item.key === activeEnvironment)?.label ?? 'MAISON';

  async function selectProfileEnvironment(code) {
    const environment = String(code ?? 'HOME').toUpperCase();
    if (environment === activeEnvironment || isSaving) return;

    try {
      setIsLoading(true);
      setErrorMessage('');
      setSaved(false);
      setActiveEnvironment(environment);
      setActiveCategory(null);
      setSearchQuery('');
      setExpandedEquipmentIds(new Set());

      const rows = await getUserEnvironmentEquipmentPreset(environment);
      setDraftInventory((rows ?? []).map(normalizeLoadedRow));
    } catch (error) {
      setErrorMessage(
        error?.message ?? 'Impossible de charger le matériel de cet environnement.'
      );
    } finally {
      setIsLoading(false);
    }
  }

  const selectedEquipmentIdList = useMemo(
    () => Array.from(new Set(draftInventory.map((row) => row.equipment_id).filter(Boolean))),
    [draftInventory]
  );

  const selectedEquipmentIds = useMemo(
    () => new Set(selectedEquipmentIdList),
    [selectedEquipmentIdList]
  );

  const equipmentSections = useMemo(
    () => getEquipmentUxSections(catalog, activeEnvironment, selectedEquipmentIdList),
    [catalog, activeEnvironment, selectedEquipmentIdList]
  );

  const categoryOptions = useMemo(
    () => equipmentSections.map((section) => ({
      ...section,
      selectedCount: section.items.filter((item) => selectedEquipmentIds.has(item.id)).length,
    })),
    [equipmentSections, selectedEquipmentIds]
  );

  const resolvedActiveCategory =
    categoryOptions.some((section) => section.key === activeCategory)
      ? activeCategory
      : null;

  const activeCategoryOption = useMemo(
    () => categoryOptions.find((section) => section.key === resolvedActiveCategory) ?? null,
    [categoryOptions, resolvedActiveCategory]
  );

  const visibleCatalog = useMemo(() => {
    const source = activeCategoryOption?.items ?? [];
    const normalizedQuery = normalizeSearchValue(searchQuery.trim());

    if (!normalizedQuery) return source;

    return source.filter((equipment) =>
      normalizeSearchValue(
        [
          equipment.displayName,
          equipment.name,
          equipment.category,
          equipment.description,
          equipment.uxGroup,
        ]
          .filter(Boolean)
          .join(' ')
      ).includes(normalizedQuery)
    );
  }, [activeCategoryOption, searchQuery]);

  const selectedEquipmentCount = selectedEquipmentIds.size;

  const canSave =
    !isLoading &&
    !isSaving &&
    (activeEnvironment !== 'HOME' || draftInventory.every(validateRow));

  function rowsForEquipment(
    equipmentId
  ) {
    return draftInventory.filter(
      (row) =>
        row.equipment_id === equipmentId
    );
  }

  function setEquipmentExpanded(
    equipmentId,
    expanded
  ) {
    setExpandedEquipmentIds((current) => {
      const next = new Set(current);

      if (expanded) {
        next.add(equipmentId);
      } else {
        next.delete(equipmentId);
      }

      return next;
    });
  }

  function toggleEquipmentExpanded(
    equipmentId
  ) {
    setExpandedEquipmentIds((current) => {
      const next = new Set(current);

      if (next.has(equipmentId)) {
        next.delete(equipmentId);
      } else {
        next.add(equipmentId);
      }

      return next;
    });
  }

  function validateAndCollapseBarbell(row) {
    if (!validateRow(row)) {
      return;
    }

    Keyboard.dismiss();
    setEquipmentExpanded(
      BARBELL_EQUIPMENT_ID,
      false
    );
  }

  function toggleEquipment(equipment) {
    setSaved(false);

    const selectedRows =
      rowsForEquipment(equipment.id);

    if (selectedRows.length > 0) {
      setDraftInventory((current) =>
        current.filter(
          (row) =>
            row.equipment_id !==
            equipment.id
        )
      );
      setEquipmentExpanded(
        equipment.id,
        false
      );
      return;
    }

    const isBarbell =
      equipment.id ===
      BARBELL_EQUIPMENT_ID;

    const defaultMode = activeEnvironment !== 'HOME'
      ? 'non_load'
      : isBarbell
        ? 'adjustable_load'
        : FIXED_LOAD_CAPABLE_IDS.has(
            equipment.id
          )
          ? 'load_unknown'
          : 'non_load';

    const nextRow = createInventoryRow(
      equipment.id,
      defaultMode
    );

    if (isBarbell) {
      nextRow.min_load_kg = '20';
      nextRow.increment_kg = '2.5';
    }

    setDraftInventory((current) => [
      ...current,
      nextRow,
    ]);

    const configurable =
      activeEnvironment === 'HOME' &&
      (isBarbell ||
        FIXED_LOAD_CAPABLE_IDS.has(
          equipment.id
        ) ||
        equipment.id ===
          RESISTANCE_EQUIPMENT_ID);

    if (configurable) {
      setEquipmentExpanded(
        equipment.id,
        true
      );
    }
  }

  function updateRow(
    localKey,
    patch
  ) {
    setSaved(false);

    setDraftInventory((current) =>
      current.map((row) =>
        row._localKey === localKey
          ? {
              ...row,
              ...patch,
            }
          : row
      )
    );
  }

  function toggleResistance(
    equipmentId,
    resistanceLabel
  ) {
    setSaved(false);

    setDraftInventory((current) => {
      const equipmentRows =
        current.filter(
          (row) =>
            row.equipment_id ===
            equipmentId
        );

      if (equipmentRows.length === 0) {
        return current;
      }

      const alreadySelected =
        equipmentRows.some(
          (row) =>
            row.resistance_label ===
            resistanceLabel
        );

      const otherEquipmentRows =
        current.filter(
          (row) =>
            row.equipment_id !==
            equipmentId
        );

      if (alreadySelected) {
        const remaining =
          equipmentRows.filter(
            (row) =>
              row.resistance_label !==
              resistanceLabel
          );

        return [
          ...otherEquipmentRows,
          ...(remaining.length > 0
            ? remaining
            : [
                {
                  ...createInventoryRow(
                    equipmentId,
                    'non_load'
                  ),
                  resistance_label:
                    null,
                },
              ]),
        ];
      }

      const definedRows =
        equipmentRows.filter(
          (row) =>
            row.resistance_label !==
            null &&
            row.resistance_label !==
            undefined &&
            row.resistance_label !== ''
        );

      return [
        ...otherEquipmentRows,
        ...definedRows,
        {
          ...createInventoryRow(
            equipmentId,
            'non_load'
          ),
          resistance_label:
            resistanceLabel,
        },
      ];
    });
  }

  function incrementQuantity(
    localKey,
    delta
  ) {
    setSaved(false);

    setDraftInventory((current) =>
      current.map((row) => {
        if (
          row._localKey !== localKey
        ) {
          return row;
        }

        const currentQuantity =
          Math.max(
            1,
            Number(row.quantity) || 1
          );

        return {
          ...row,
          quantity: Math.min(
            20,
            Math.max(
              1,
              currentQuantity + delta
            )
          ),
        };
      })
    );
  }

  function addFixedLoadGroup(
    equipmentId
  ) {
    setSaved(false);

    setDraftInventory((current) => [
      ...current,
      createInventoryRow(
        equipmentId,
        'fixed_load'
      ),
    ]);
  }

  function removeLoadGroup(
    localKey
  ) {
    setSaved(false);

    setDraftInventory((current) =>
      current.filter(
        (row) =>
          row._localKey !== localKey
      )
    );
  }

  function changeMode(
    equipmentId,
    mode
  ) {
    setSaved(false);

    setDraftInventory((current) => {
      const rows = current.filter(
        (row) =>
          row.equipment_id ===
          equipmentId
      );

      const firstRow = rows[0];

      if (!firstRow) {
        return current;
      }

      const withoutEquipment =
        current.filter(
          (row) =>
            row.equipment_id !==
            equipmentId
        );

      return [
        ...withoutEquipment,
        {
          ...createInventoryRow(
            equipmentId,
            mode
          ),
          quantity: Math.max(
            1,
            Number(
              firstRow.quantity
            ) || 1
          ),
        },
      ];
    });
  }

  async function handleSave() {
    if (!canSave) {
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage('');
      setSaved(false);

      if (activeEnvironment === 'HOME') {
        const payload = sanitizeInventory(draftInventory);
        const savedRows = await replaceUserEquipmentInventory(payload);
        setDraftInventory((savedRows ?? []).map(normalizeLoadedRow));
      } else {
        const equipmentIds = Array.from(
          new Set(draftInventory.map((row) => row.equipment_id).filter(Boolean))
        );
        const savedIds = await replaceUserEnvironmentEquipmentPreset(
          activeEnvironment,
          equipmentIds
        );
        setDraftInventory(
          (savedIds ?? []).map((equipmentId) =>
            normalizeLoadedRow(createInventoryRow(equipmentId, 'non_load'))
          )
        );
      }

      setSaved(true);

      setTimeout(() => {
        if (
          typeof returnTo === 'string' &&
          returnTo.length > 0
        ) {
          router.replace(returnTo);
          return;
        }

        router.replace('/profile');
      }, 450);
    } catch (error) {
      console.log(
        'EQUIPMENT SAVE ERROR',
        {
          message: error?.message,
          code: error?.code,
          details: error?.details,
          hint: error?.hint,
        }
      );

      setErrorMessage(
        error?.message ??
          'Impossible d’enregistrer ton matériel.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  function handleBack() {
    if (isSaving) {
      return;
    }

    if (activeCategory) {
      setSearchQuery('');
      setActiveCategory(null);
      return;
    }

    if (
      typeof returnTo === 'string' &&
      returnTo.length > 0
    ) {
      router.replace(returnTo);
      return;
    }

    router.replace('/profile');
  }

  if (isLoading) {
    return (
      <View
        style={
          styles.loadingScreen
        }
      >
        <ActivityIndicator
          size="large"
          color={BRAND_KAKI}
        />

        <Text
          style={styles.loadingText}
        >
          CHARGEMENT DU MATÉRIEL...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={isDark ? backgroundImage : undefined}
        resizeMode="cover"
        style={styles.background}
      >
        {isDark && (
          <>
            <View style={styles.darkOverlay} />
            <LinearGradient
              colors={[
                'rgba(7,9,12,0.42)',
                'rgba(7,9,12,0.62)',
                'rgba(7,9,12,0.90)',
                'rgba(7,9,12,0.99)',
              ]}
              locations={[0, 0.24, 0.62, 1]}
              style={StyleSheet.absoluteFill}
            />
          </>
        )}

        <SafeAreaView
          style={styles.safeArea}
        >
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <ScrollView
            showsVerticalScrollIndicator={
              false
            }
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={
              styles.content
            }
          >
            {/* HEADER */}
            <View
              style={styles.header}
            >
              <Pressable
                onPress={handleBack}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.backButton,
                  pressed &&
                    styles.pressed,
                ]}
              >
                <Ionicons
                  name="arrow-back"
                  size={22}
                  color={
                    colors.textPrimary
                  }
                />
              </Pressable>

              <View
                style={
                  styles.headerText
                }
              >
                <Text
                  style={
                    styles.headerEyebrow
                  }
                >
                  PROFIL SPORTIF
                </Text>

                <Text
                  style={
                    styles.headerTitle
                  }
                >
                  TON MATÉRIEL
                  <Text
                    style={styles.blueDot}
                  >
                    .
                  </Text>
                </Text>
              </View>

              <Image
                source={brandIcon}
                style={
                  styles.brandIcon
                }
                resizeMode="contain"
              />
            </View>

            {/* INTRO */}
            <View style={styles.intro}>
              <Text
                style={
                  styles.introTitle
                }
              >
                {activeEnvironment === 'HOME'
                  ? 'TON MATÉRIEL À LA MAISON'
                  : `TON MATÉRIEL HABITUEL — ${activeEnvironmentLabel}`}
              </Text>

              <Text
                style={
                  styles.introText
                }
              >
                {activeEnvironment === 'HOME'
                  ? 'Ici, tu peux mettre à jour le matériel que tu possèdes et renseigner les charges associées.'
                  : `Sélectionne le matériel que tu as habituellement à disposition quand tu t’entraînes en ${activeEnvironmentLabel.toLowerCase()}.`}
              </Text>
            </View>

            {!!errorMessage && (
              <View
                style={styles.errorCard}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={20}
                  color={
                    BRAND_ORANGE
                  }
                />

                <View
                  style={
                    styles.errorMain
                  }
                >
                  <Text
                    style={
                      styles.errorTitle
                    }
                  >
                    ERREUR
                  </Text>

                  <Text
                    style={
                      styles.errorText
                    }
                  >
                    {errorMessage}
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.catalogTools}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.locationTabs}
              >
                {PROFILE_ENVIRONMENTS.map((location) => {
                  const selected = activeEnvironment === location.key;

                  return (
                    <Pressable
                      key={location.key}
                      onPress={() => selectProfileEnvironment(location.key)}
                      style={[
                        styles.locationTab,
                        selected && styles.locationTabSelected,
                      ]}
                    >
                      <Ionicons
                        name={location.icon}
                        size={16}
                        color={selected ? colors.brandWhite : colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.locationTabText,
                          selected && styles.locationTabTextSelected,
                        ]}
                      >
                        {location.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {!resolvedActiveCategory ? (
                <>
                  <View style={styles.categoryIntroRow}>
                    <View style={styles.categoryIntroCopy}>
                      <Text style={styles.categoryIntroTitle}>CHOISIS UNE CATÉGORIE</Text>
                      <Text style={styles.categoryIntroText}>
                        {selectedEquipmentCount} équipement{selectedEquipmentCount > 1 ? 's' : ''} sélectionné{selectedEquipmentCount > 1 ? 's' : ''} pour {activeEnvironmentLabel.toLowerCase()}.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.categoryGrid}>
                    {categoryOptions.map((category) => (
                      <Pressable
                        key={category.key}
                        onPress={() => {
                          setSearchQuery('');
                          setActiveCategory(category.key);
                        }}
                        style={({ pressed }) => [
                          styles.categoryCard,
                          pressed && styles.categoryCardPressed,
                        ]}
                      >
                        <View style={styles.categoryHeroIcon}>
                          <Ionicons
                            name={category.icon}
                            size={32}
                            color={BRAND_KAKI}
                          />
                        </View>

                        <Text style={styles.categoryCardLabel}>
                          {category.label.toUpperCase()}
                        </Text>

                        <Text numberOfLines={2} style={styles.categoryCardDescription}>
                          {category.description}
                        </Text>

                        <View style={styles.categoryCardFooter}>
                          <Text style={styles.categoryCardCount}>
                            {category.selectedCount}/{category.items.length} sélectionné{category.selectedCount > 1 ? 's' : ''}
                          </Text>
                          <Ionicons
                            name="arrow-forward"
                            size={18}
                            color={BRAND_ORANGE}
                          />
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <Pressable
                    onPress={() => {
                      setSearchQuery('');
                      setActiveCategory(null);
                    }}
                    style={({ pressed }) => [
                      styles.categoryBackRow,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons name="arrow-back" size={18} color={BRAND_KAKI} />
                    <Text style={styles.categoryBackText}>TOUTES LES CATÉGORIES</Text>
                  </Pressable>

                  <View style={styles.activeCategoryHero}>
                    <View style={styles.activeCategoryIcon}>
                      <Ionicons
                        name={activeCategoryOption?.icon ?? 'grid-outline'}
                        size={28}
                        color={colors.brandWhite}
                      />
                    </View>
                    <View style={styles.activeCategoryCopy}>
                      <Text style={styles.activeCategoryTitle}>
                        {String(activeCategoryOption?.label ?? '').toUpperCase()}
                      </Text>
                      <Text style={styles.activeCategoryDescription}>
                        {activeCategoryOption?.description}
                      </Text>
                    </View>
                    <Text style={styles.activeCategoryCount}>
                      {activeCategoryOption?.selectedCount ?? 0}/{activeCategoryOption?.items?.length ?? 0}
                    </Text>
                  </View>

                  <View style={styles.searchShell}>
                    <Ionicons
                      name="search-outline"
                      size={19}
                      color={colors.textMuted}
                    />
                    <TextInput
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      placeholder={`Rechercher dans ${String(activeCategoryOption?.label ?? '').toLowerCase()}…`}
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      style={styles.searchInput}
                    />
                    {searchQuery.length > 0 && (
                      <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                        <Ionicons
                          name="close-circle"
                          size={19}
                          color={colors.textMuted}
                        />
                      </Pressable>
                    )}
                  </View>

                  <View style={styles.catalogSummaryRow}>
                    <Text style={styles.catalogSummaryText}>
                      {searchQuery.length > 0
                        ? `${visibleCatalog.length} RÉSULTAT${visibleCatalog.length > 1 ? 'S' : ''}`
                        : `${visibleCatalog.length} ÉQUIPEMENT${visibleCatalog.length > 1 ? 'S' : ''}`}
                    </Text>
                    <Text style={styles.catalogSummarySelected}>
                      {activeCategoryOption?.selectedCount ?? 0} SÉLECTIONNÉ{(activeCategoryOption?.selectedCount ?? 0) > 1 ? 'S' : ''}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* INVENTAIRE */}
            <View
              style={
                styles.equipmentList
              }
            >
              {visibleCatalog.map(
                (equipment) => {
                  const rows =
                    rowsForEquipment(
                      equipment.id
                    );

                  const selected =
                    rows.length > 0;

                  const isBarbell =
                    equipment.id ===
                    BARBELL_EQUIPMENT_ID;

                  const expanded =
                    expandedEquipmentIds.has(
                      equipment.id
                    );

                  const supportsFixed =
                    !isBarbell &&
                    FIXED_LOAD_CAPABLE_IDS.has(
                      equipment.id
                    );

                  const supportsAdjustable =
                    !isBarbell &&
                    ADJUSTABLE_LOAD_CAPABLE_IDS.has(
                      equipment.id
                    );

                  const quantityRelevant =
                    QUANTITY_RELEVANT_IDS.has(
                      equipment.id
                    );

                  const supportsResistance =
                    equipment.id ===
                    RESISTANCE_EQUIPMENT_ID;

                  const hasConfiguration =
                    activeEnvironment === 'HOME' &&
                    (isBarbell ||
                      supportsFixed ||
                      supportsResistance);

                  const mode =
                    rows[0]
                      ?.inventory_mode ??
                    'non_load';

                  return (
                    <View
                      key={equipment.id}
                      style={[
                        styles.equipmentCard,
                        selected &&
                          styles.equipmentCardSelected,
                      ]}
                    >
                      <Pressable
                        onPress={() => {
                          if (
                            selected &&
                            hasConfiguration
                          ) {
                            toggleEquipmentExpanded(
                              equipment.id
                            );
                            return;
                          }

                          toggleEquipment(
                            equipment
                          );
                        }}
                        style={({
                          pressed,
                        }) => [
                          styles.equipmentHeader,
                          pressed &&
                            styles.pressed,
                        ]}
                      >
                        <Pressable
                          onPress={(event) => {
                            event.stopPropagation();
                            toggleEquipment(
                              equipment
                            );
                          }}
                          hitSlop={8}
                          style={[
                            styles.checkbox,
                            selected &&
                              styles.checkboxSelected,
                          ]}
                        >
                          {selected && (
                            <Ionicons
                              name="checkmark"
                              size={17}
                              color={
                                colors.brandWhite
                              }
                            />
                          )}
                        </Pressable>

                        <View
                          style={
                            styles.equipmentHeaderText
                          }
                        >
                          <Text
                            style={
                              styles.equipmentName
                            }
                          >
                            {String(
                              equipment.displayName ??
                                equipment.name ??
                                ''
                            ).toUpperCase()}
                          </Text>

                          {hasConfiguration && (
                            <View style={styles.equipmentMetaRow}>
                              {(isBarbell || supportsFixed) && (
                                <Ionicons
                                  name="barbell-outline"
                                  size={14}
                                  color={BRAND_KAKI}
                                />
                              )}

                              <Text
                                style={styles.equipmentHint}
                              >
                                {isBarbell
                                  ? 'Poids total, barre comprise.'
                                  : supportsResistance
                                    ? 'Résistance facultative.'
                                    : 'Charge facultative.'}
                              </Text>
                            </View>
                          )}
                        </View>

                        {hasConfiguration && (
                          <Ionicons
                            name={
                              expanded
                                ? 'chevron-up'
                                : 'chevron-down'
                            }
                            size={18}
                            color={
                              colors.textMuted
                            }
                          />
                        )}
                      </Pressable>

                      {selected &&
                        hasConfiguration &&
                        expanded && (
                        <View
                          style={
                            styles.configurationArea
                          }
                        >
                          {isBarbell &&
                            rows[0] && (
                              <View
                                style={
                                  styles.adjustableArea
                                }
                              >
                                <Text
                                  style={
                                    styles.fieldLabel
                                  }
                                >
                                  CHARGE DE TA BARRE
                                </Text>

                                <Text
                                  style={
                                    styles.resistanceHelp
                                  }
                                >
                                  Renseigne toujours le poids total déplacé. La barre est préremplie à 20 kg mais reste modifiable.
                                </Text>

                                <View
                                  style={
                                    styles.adjustableGrid
                                  }
                                >
                                  <LoadInput
                                    label="POIDS BARRE (KG)"
                                    value={
                                      rows[0]
                                        .min_load_kg
                                    }
                                    placeholder="20"
                                    onChange={(
                                      value
                                    ) =>
                                      updateRow(
                                        rows[0]
                                          ._localKey,
                                        {
                                          min_load_kg:
                                            value,
                                          inventory_mode:
                                            'adjustable_load',
                                        }
                                      )
                                    }
                                  />

                                  <LoadInput
                                    label="CHARGE TOTALE MAX (KG)"
                                    value={
                                      rows[0]
                                        .max_load_kg
                                    }
                                    placeholder="100"
                                    onChange={(
                                      value
                                    ) =>
                                      updateRow(
                                        rows[0]
                                          ._localKey,
                                        {
                                          max_load_kg:
                                            value,
                                          inventory_mode:
                                            'adjustable_load',
                                        }
                                      )
                                    }
                                  />

                                  <LoadInput
                                    label="PALIER TOTAL (KG)"
                                    value={
                                      rows[0]
                                        .increment_kg
                                    }
                                    placeholder="2.5"
                                    onChange={(
                                      value
                                    ) =>
                                      updateRow(
                                        rows[0]
                                          ._localKey,
                                        {
                                          increment_kg:
                                            value,
                                          inventory_mode:
                                            'adjustable_load',
                                        }
                                      )
                                    }
                                  />
                                </View>

                                <Text
                                  style={
                                    styles.unknownLoadText
                                  }
                                >
                                  Exemple : barre 20 kg + 20 kg de chaque côté = 60 kg au total. Avec des disques de 1,25 kg par côté, le palier total est 2,5 kg.
                                </Text>

                                <Pressable
                                  onPress={() =>
                                    validateAndCollapseBarbell(
                                      rows[0]
                                    )
                                  }
                                  disabled={
                                    !validateRow(
                                      rows[0]
                                    )
                                  }
                                  style={({
                                    pressed,
                                  }) => [
                                    styles.addLoadButton,
                                    !validateRow(
                                      rows[0]
                                    ) &&
                                      styles.saveButtonDisabled,
                                    pressed &&
                                      validateRow(
                                        rows[0]
                                      ) &&
                                      styles.pressed,
                                  ]}
                                >
                                  <Ionicons
                                    name="checkmark-circle-outline"
                                    size={18}
                                    color={
                                      BRAND_KAKI
                                    }
                                  />

                                  <Text
                                    style={
                                      styles.addLoadText
                                    }
                                  >
                                    VALIDER LES CHARGES
                                  </Text>
                                </Pressable>
                              </View>
                            )}

                          {supportsFixed && (
                            <View
                              style={
                                styles.modeTabs
                              }
                            >
                              <Pressable
                                onPress={() =>
                                  changeMode(
                                    equipment.id,
                                    'load_unknown'
                                  )
                                }
                                style={[
                                  styles.modeTab,
                                  mode ===
                                    'load_unknown' &&
                                    styles.modeTabSelected,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.modeTabText,
                                    mode ===
                                      'load_unknown' &&
                                      styles.modeTabTextSelected,
                                  ]}
                                >
                                  NON RENSEIGNÉE
                                </Text>
                              </Pressable>

                              <Pressable
                                onPress={() =>
                                  changeMode(
                                    equipment.id,
                                    'fixed_load'
                                  )
                                }
                                style={[
                                  styles.modeTab,
                                  mode ===
                                    'fixed_load' &&
                                    styles.modeTabSelected,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.modeTabText,
                                    mode ===
                                      'fixed_load' &&
                                      styles.modeTabTextSelected,
                                  ]}
                                >
                                  {supportsAdjustable
                                    ? 'FIXES'
                                    : 'CHARGE FIXE'}
                                </Text>
                              </Pressable>

                              {supportsAdjustable && (
                                <Pressable
                                  onPress={() =>
                                    changeMode(
                                      equipment.id,
                                      'adjustable_load'
                                    )
                                  }
                                  style={[
                                    styles.modeTab,
                                    mode ===
                                      'adjustable_load' &&
                                      styles.modeTabSelected,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.modeTabText,
                                      mode ===
                                        'adjustable_load' &&
                                        styles.modeTabTextSelected,
                                    ]}
                                  >
                                    RÉGLABLES
                                  </Text>
                                </Pressable>
                              )}
                            </View>
                          )}

                          {supportsFixed &&
                            mode ===
                              'load_unknown' &&
                            rows[0] && (
                              <View style={styles.unknownLoadArea}>
                                {quantityRelevant && (
                                  <View>
                                    <Text
                                      style={styles.fieldLabel}
                                    >
                                      QUANTITÉ
                                    </Text>

                                    <QuantityControl
                                      row={rows[0]}
                                      onMinus={() =>
                                        incrementQuantity(
                                          rows[0]._localKey,
                                          -1
                                        )
                                      }
                                      onPlus={() =>
                                        incrementQuantity(
                                          rows[0]._localKey,
                                          1
                                        )
                                      }
                                    />
                                  </View>
                                )}

                                <Text style={styles.unknownLoadText}>
                                  Pas de charge renseignée ? Aucun problème, tu pourras la compléter plus tard.
                                </Text>
                              </View>
                            )}

                          {supportsFixed &&
                            mode ===
                              'fixed_load' &&
                            rows.map(
                              (
                                row,
                                index
                              ) => (
                                <View
                                  key={
                                    row._localKey
                                  }
                                  style={
                                    styles.loadGroup
                                  }
                                >
                                  <View
                                    style={
                                      styles.loadGroupTop
                                    }
                                  >
                                    <Text
                                      style={
                                        styles.loadGroupTitle
                                      }
                                    >
                                      CHARGE{' '}
                                      {index +
                                        1}
                                    </Text>

                                    {rows.length >
                                      1 && (
                                      <Pressable
                                        onPress={() =>
                                          removeLoadGroup(
                                            row._localKey
                                          )
                                        }
                                        hitSlop={
                                          8
                                        }
                                      >
                                        <Ionicons
                                          name="trash-outline"
                                          size={
                                            18
                                          }
                                          color={
                                            BRAND_ORANGE
                                          }
                                        />
                                      </Pressable>
                                    )}
                                  </View>

                                  <View
                                    style={
                                      styles.rowFields
                                    }
                                  >
                                    {quantityRelevant && (
                                      <View
                                        style={styles.quantityArea}
                                      >
                                        <Text
                                          style={styles.fieldLabel}
                                        >
                                          QUANTITÉ
                                        </Text>

                                        <QuantityControl
                                          row={row}
                                          compact
                                          onMinus={() =>
                                            incrementQuantity(
                                              row._localKey,
                                              -1
                                            )
                                          }
                                          onPlus={() =>
                                            incrementQuantity(
                                              row._localKey,
                                              1
                                            )
                                          }
                                        />
                                      </View>
                                    )}

                                    <View
                                      style={[
                                        styles.loadFieldArea,
                                        !quantityRelevant &&
                                          styles.loadFieldAreaFull,
                                      ]}
                                    >
                                      <Text
                                        style={
                                          styles.fieldLabel
                                        }
                                      >
                                        KG / UNITÉ
                                      </Text>

                                      <View
                                        style={
                                          styles.inputShell
                                        }
                                      >
                                        <TextInput
                                          value={String(
                                            row.load_kg ??
                                              ''
                                          )}
                                          onChangeText={(
                                            value
                                          ) =>
                                            updateRow(
                                              row._localKey,
                                              {
                                                load_kg:
                                                  value,
                                              }
                                            )
                                          }
                                          placeholder="10"
                                          placeholderTextColor={
                                            colors.textMuted
                                          }
                                          keyboardType="decimal-pad"
                                          style={
                                            styles.input
                                          }
                                        />

                                        <Text
                                          style={
                                            styles.inputSuffix
                                          }
                                        >
                                          KG
                                        </Text>
                                      </View>
                                    </View>
                                  </View>
                                </View>
                              )
                            )}

                          {supportsFixed &&
                            mode ===
                              'fixed_load' && (
                              <Pressable
                                onPress={() =>
                                  addFixedLoadGroup(
                                    equipment.id
                                  )
                                }
                                style={({
                                  pressed,
                                }) => [
                                  styles.addLoadButton,
                                  pressed &&
                                    styles.pressed,
                                ]}
                              >
                                <Ionicons
                                  name="add-circle-outline"
                                  size={18}
                                  color={
                                    BRAND_KAKI
                                  }
                                />

                                <Text
                                  style={
                                    styles.addLoadText
                                  }
                                >
                                  AJOUTER UNE AUTRE CHARGE
                                </Text>
                              </Pressable>
                            )}

                          {supportsAdjustable &&
                            mode ===
                              'adjustable_load' &&
                            rows[0] && (
                              <View
                                style={
                                  styles.adjustableArea
                                }
                              >
                                {quantityRelevant && (
                                  <View>
                                    <Text
                                      style={styles.fieldLabel}
                                    >
                                      QUANTITÉ
                                    </Text>

                                    <QuantityControl
                                      row={rows[0]}
                                      onMinus={() =>
                                        incrementQuantity(
                                          rows[0]._localKey,
                                          -1
                                        )
                                      }
                                      onPlus={() =>
                                        incrementQuantity(
                                          rows[0]._localKey,
                                          1
                                        )
                                      }
                                    />
                                  </View>
                                )}

                                <View
                                  style={
                                    styles.adjustableGrid
                                  }
                                >
                                  <LoadInput
                                    label="MIN KG"
                                    value={
                                      rows[0]
                                        .min_load_kg
                                    }
                                    placeholder="5"
                                    onChange={(
                                      value
                                    ) =>
                                      updateRow(
                                        rows[0]
                                          ._localKey,
                                        {
                                          min_load_kg:
                                            value,
                                        }
                                      )
                                    }
                                  />

                                  <LoadInput
                                    label="MAX KG"
                                    value={
                                      rows[0]
                                        .max_load_kg
                                    }
                                    placeholder="25"
                                    onChange={(
                                      value
                                    ) =>
                                      updateRow(
                                        rows[0]
                                          ._localKey,
                                        {
                                          max_load_kg:
                                            value,
                                        }
                                      )
                                    }
                                  />

                                  <LoadInput
                                    label="PALIER (KG)"
                                    value={
                                      rows[0]
                                        .increment_kg
                                    }
                                    placeholder="2.5"
                                    onChange={(
                                      value
                                    ) =>
                                      updateRow(
                                        rows[0]
                                          ._localKey,
                                        {
                                          increment_kg:
                                            value,
                                        }
                                      )
                                    }
                                  />
                                </View>
                              </View>
                            )}

                          {supportsResistance &&
                            rows[0] && (
                              <View style={styles.resistanceArea}>
                                <Text style={styles.fieldLabel}>
                                  RÉSISTANCES DISPONIBLES
                                </Text>

                                <Text style={styles.resistanceHelp}>
                                  Sélectionne une ou plusieurs résistances. Laisse vide si tu ne les connais pas.
                                </Text>

                                <View style={styles.resistanceGrid}>
                                  {RESISTANCE_OPTIONS.map((option) => {
                                    const selectedResistance =
                                      rows.some(
                                        (row) =>
                                          row.resistance_label ===
                                          option.value
                                      );

                                    return (
                                      <Pressable
                                        key={option.value}
                                        onPress={() =>
                                          toggleResistance(
                                            equipment.id,
                                            option.value
                                          )
                                        }
                                        style={[
                                          styles.resistanceChip,
                                          selectedResistance &&
                                            styles.resistanceChipSelected,
                                        ]}
                                      >
                                        <Text
                                          style={[
                                            styles.resistanceChipText,
                                            selectedResistance &&
                                              styles.resistanceChipTextSelected,
                                          ]}
                                        >
                                          {option.label}
                                        </Text>

                                        {selectedResistance && (
                                          <Ionicons
                                            name="checkmark-circle"
                                            size={17}
                                            color={BRAND_KAKI}
                                          />
                                        )}
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              </View>
                            )}
                        </View>
                      )}
                    </View>
                  );
                }
              )}

              {resolvedActiveCategory && visibleCatalog.length === 0 && (
                <View style={styles.noResultCard}>
                  <Ionicons
                    name="search-outline"
                    size={22}
                    color={BRAND_KAKI}
                  />
                  <View style={styles.noResultTextArea}>
                    <Text style={styles.noResultTitle}>
                      AUCUN MATÉRIEL TROUVÉ
                    </Text>
                    <Text style={styles.noResultText}>
                      Essaie un autre mot-clé ou change de lieu.
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {draftInventory.length ===
              0 && (
              <View
                style={
                  styles.emptyCard
                }
              >
                <Ionicons
                  name="body-outline"
                  size={22}
                  color={
                    BRAND_KAKI
                  }
                />

                <Text
                  style={
                    styles.emptyText
                  }
                >
                  Aucun matériel sélectionné : UGEROD considérera ton inventaire de référence comme « poids du corps ».
                </Text>
              </View>
            )}

            {!canSave &&
              draftInventory.length >
                0 &&
              !isSaving && (
                <Text
                  style={
                    styles.validationText
                  }
                >
                  Complète les valeurs du mode de charge choisi, ou sélectionne « Non renseignée ».
                </Text>
              )}

            <Pressable
              onPress={handleSave}
              disabled={!canSave}
              style={({ pressed }) => [
                styles.saveButton,
                saved &&
                  styles.saveButtonDone,
                !canSave &&
                  styles.saveButtonDisabled,
                pressed &&
                  canSave &&
                  styles.saveButtonPressed,
              ]}
            >
              {isSaving ? (
                <ActivityIndicator
                  size="small"
                  color={
                    colors.brandWhite
                  }
                />
              ) : (
                <>
                  <Text
                    style={
                      styles.saveButtonText
                    }
                  >
                    {saved
                      ? 'MATÉRIEL ENREGISTRÉ'
                      : 'ENREGISTRER MON MATÉRIEL'}
                  </Text>

                  <Ionicons
                    name={
                      saved
                        ? 'checkmark-circle'
                        : 'checkmark-circle-outline'
                    }
                    size={21}
                    color={
                      colors.brandWhite
                    }
                  />
                </>
              )}
            </Pressable>

            <View
              style={styles.bottomSpace}
            />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function EquipmentQuantityControl({
  row,
  onMinus,
  onPlus,
  compact = false,
  styles,
  colors,
}) {
  return (
    <View
      style={[
        styles.quantityControl,
        compact &&
          styles.quantityControlCompact,
      ]}
    >
      <Pressable
        onPress={onMinus}
        style={({ pressed }) => [
          styles.quantityButton,
          pressed &&
            styles.pressed,
        ]}
      >
        <Ionicons
          name="remove"
          size={17}
          color={
            colors.textPrimary
          }
        />
      </Pressable>

      <Text
        style={styles.quantityValue}
      >
        {Math.max(
          1,
          Number(row.quantity) || 1
        )}
      </Text>

      <Pressable
        onPress={onPlus}
        style={({ pressed }) => [
          styles.quantityButton,
          pressed &&
            styles.pressed,
        ]}
      >
        <Ionicons
          name="add"
          size={17}
          color={
            colors.textPrimary
          }
        />
      </Pressable>
    </View>
  );
}

function EquipmentLoadInput({
  label,
  value,
  placeholder,
  onChange,
  styles,
  colors,
}) {
  return (
    <View
      style={styles.adjustableField}
    >
      <Text
        style={styles.fieldLabel}
      >
        {label}
      </Text>

      <View
        style={styles.inputShell}
      >
        <TextInput
          value={String(value ?? '')}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={
            colors.textMuted
          }
          keyboardType="decimal-pad"
          style={styles.input}
        />

        <Text
          style={styles.inputSuffix}
        >
          KG
        </Text>
      </View>
    </View>
  );
}

function createStyles(colors, isDark) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor:
      colors.background,
  },

  background: {
    flex: 1,
    backgroundColor: colors.background,
  },

  safeArea: {
    flex: 1,
    backgroundColor: isDark ? 'transparent' : colors.background,
  },

  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor:
      'rgba(0,0,0,0.30)',
  },

  content: {
    paddingHorizontal:
      spacing.lg,
    paddingTop: 8,
  },

  loadingScreen: {
    flex: 1,
    backgroundColor:
      colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },

  loadingText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    color:
      colors.textSecondary,
  },

  header: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: isDark
      ? 'rgba(17,21,26,0.92)'
      : colors.surfaceElevated,
    borderWidth: 1,
    borderColor: isDark
      ? 'rgba(255,255,255,0.10)'
      : colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerText: {
    flex: 1,
  },

  headerEyebrow: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color:
      colors.textSecondary,
  },

  headerTitle: {
    ...typography.display,
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 1.7,
    color:
      colors.textPrimary,
  },

  blueDot: {
    color: BRAND_KAKI,
  },

  brandIcon: {
    width: 45,
    height: 45,
  },

  intro: {
    marginTop: 18,
  },

  introTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 29,
    lineHeight: 33,
    letterSpacing: 1.4,
    color:
      colors.textPrimary,
  },

  introText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color:
      colors.textSecondary,
    marginTop: 6,
    maxWidth: 355,
  },

  infoCard: {
    marginTop: 18,
    borderRadius: 16,
    padding: 14,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor:
      'rgba(94,102,51,0.20)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  infoText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
  },

  errorCard: {
    marginTop: 12,
    borderRadius: 16,
    padding: 14,
    backgroundColor: colors.secondaryAccentSoft,
    borderWidth: 1,
    borderColor:
      'rgba(255,107,25,0.28)',
    flexDirection: 'row',
    gap: 10,
  },

  errorMain: {
    flex: 1,
  },

  errorTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.7,
    color: BRAND_ORANGE,
  },

  errorText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
    marginTop: 3,
  },

  catalogTools: {
    marginTop: 18,
    gap: 12,
  },

  searchShell: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.11)' : colors.border,
    backgroundColor: isDark ? 'rgba(17,21,26,0.92)' : colors.surfaceElevated,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  searchInput: {
    flex: 1,
    paddingVertical: 0,
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    color: colors.textPrimary,
  },

  locationTabs: {
    gap: 8,
    paddingRight: 8,
  },

  locationTab: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.10)' : colors.border,
    backgroundColor: isDark ? 'rgba(17,21,26,0.82)' : colors.surfaceElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  locationTabSelected: {
    backgroundColor: BRAND_KAKI,
    borderColor: BRAND_KAKI,
  },

  locationTabText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.55,
    color: colors.textSecondary,
  },

  locationTabTextSelected: {
    color: colors.brandWhite,
  },

  categoryIntroRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  categoryIntroCopy: {
    flex: 1,
  },

  categoryIntroTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: 1.1,
    color: colors.textPrimary,
  },

  categoryIntroText: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },

  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },

  categoryCard: {
    width: '48%',
    minHeight: 168,
    padding: 15,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.10)' : colors.border,
    backgroundColor: isDark ? 'rgba(17,21,26,0.92)' : colors.surfaceElevated,
    shadowColor: colors.shadow,
    shadowOpacity: isDark ? 0.16 : 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },

  categoryCardPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.985 }],
  },

  categoryHeroIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    marginBottom: 13,
  },

  categoryCardLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: 0.45,
    color: colors.textPrimary,
  },

  categoryCardDescription: {
    marginTop: 4,
    minHeight: 34,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },

  categoryCardFooter: {
    marginTop: 'auto',
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  categoryCardCount: {
    flexShrink: 1,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    color: BRAND_ORANGE,
  },

  categoryBackRow: {
    alignSelf: 'flex-start',
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  categoryBackText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: BRAND_KAKI,
  },

  activeCategoryHero: {
    minHeight: 92,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(94,102,51,0.28)',
    backgroundColor: colors.accentSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  activeCategoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: BRAND_KAKI,
    alignItems: 'center',
    justifyContent: 'center',
  },

  activeCategoryCopy: {
    flex: 1,
  },

  activeCategoryTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 18,
    lineHeight: 23,
    color: colors.textPrimary,
  },

  activeCategoryDescription: {
    marginTop: 2,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },

  activeCategoryCount: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 25,
    lineHeight: 28,
    color: BRAND_ORANGE,
  },

  categoryTabs: {
    gap: 10,
    paddingRight: 8,
  },

  categoryTab: {
    width: 174,
    minHeight: 104,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.10)' : colors.border,
    backgroundColor: isDark ? 'rgba(17,21,26,0.88)' : colors.surfaceElevated,
    flexDirection: 'row',
    gap: 10,
  },

  categoryTabSelected: {
    borderColor: BRAND_KAKI,
    backgroundColor: colors.accentSoft,
  },

  categoryIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(94,102,51,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  categoryIconSelected: {
    backgroundColor: BRAND_KAKI,
  },

  categoryTabCopy: {
    flex: 1,
    minWidth: 0,
  },

  categoryTabLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },

  categoryTabMeta: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },

  categoryTabCount: {
    marginTop: 6,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    color: BRAND_ORANGE,
  },

  catalogSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },

  catalogSummaryText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: colors.textMuted,
  },

  catalogSummarySelected: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: BRAND_KAKI,
  },

  equipmentList: {
    marginTop: 18,
    gap: 10,
  },

  equipmentCard: {
    borderRadius: 17,
    backgroundColor: isDark
      ? 'rgba(17,21,26,0.92)'
      : colors.surfaceElevated,
    borderWidth: 1,
    borderColor: isDark
      ? 'rgba(255,255,255,0.09)'
      : colors.border,
    overflow: 'hidden',
  },

  equipmentCardSelected: {
    borderColor:
      'rgba(94,102,51,0.42)',
  },

  bodyweightCard: {
    borderColor: isDark
      ? 'rgba(255,255,255,0.08)'
      : colors.border,
  },

  bodyweightIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  equipmentHeader: {
    minHeight: 74,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  equipmentHeaderText: {
    flex: 1,
  },

  equipmentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },

  equipmentName: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: 0.35,
    color:
      colors.textPrimary,
  },

  equipmentHint: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color:
      colors.textMuted,
  },

  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: isDark
      ? 'rgba(255,255,255,0.20)'
      : colors.borderStrong,
    backgroundColor: isDark
      ? 'rgba(255,255,255,0.03)'
      : colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  checkboxSelected: {
    backgroundColor:
      BRAND_ORANGE,
    borderColor:
      BRAND_KAKI,
  },

  configurationArea: {
    borderTopWidth: 1,
    borderTopColor: isDark
      ? 'rgba(255,255,255,0.07)'
      : colors.border,
    padding: 14,
    gap: 12,
  },

  modeTabs: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    backgroundColor: isDark
      ? 'rgba(255,255,255,0.04)'
      : colors.surface,
    gap: 3,
  },

  modeTab: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modeTabSelected: {
    backgroundColor:
      BRAND_ORANGE,
  },

  modeTabText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color:
      colors.textMuted,
  },

  modeTabTextSelected: {
    color:
      colors.brandWhite,
  },

  fieldLabel: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.6,
    color:
      colors.textMuted,
    marginBottom: 6,
  },

  quantityControl: {
    height: 42,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: isDark
      ? 'rgba(255,255,255,0.10)'
      : colors.border,
    backgroundColor: isDark
      ? 'rgba(255,255,255,0.03)'
      : colors.surface,
    overflow: 'hidden',
  },

  quantityControlCompact: {
    height: 44,
  },

  quantityButton: {
    width: 40,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },

  quantityValue: {
    minWidth: 34,
    textAlign: 'center',
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 22,
    color:
      colors.textPrimary,
  },

  loadGroup: {
    borderRadius: 13,
    padding: 12,
    backgroundColor: isDark
      ? 'rgba(255,255,255,0.025)'
      : colors.surface,
    borderWidth: 1,
    borderColor: isDark
      ? 'rgba(255,255,255,0.07)'
      : colors.border,
  },

  loadGroupTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
    marginBottom: 10,
  },

  loadGroupTitle: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.7,
    color:
      colors.textSecondary,
  },

  rowFields: {
    flexDirection: 'row',
    gap: 12,
  },

  quantityArea: {
    flex: 1,
  },

  loadFieldArea: {
    flex: 1,
  },

  loadFieldAreaFull: {
    flex: 1,
  },

  inputShell: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: isDark
      ? 'rgba(255,255,255,0.11)'
      : colors.border,
    backgroundColor: isDark
      ? 'rgba(255,255,255,0.035)'
      : colors.surfaceElevated,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
  },

  input: {
    flex: 1,
    paddingVertical: 0,
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 15,
    color:
      colors.textPrimary,
  },

  inputSuffix: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    color:
      colors.textMuted,
  },

  addLoadButton: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor:
      'rgba(94,102,51,0.35)',
    backgroundColor:
      'rgba(94,102,51,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  addLoadText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color:
      BRAND_KAKI,
  },

  unknownLoadArea: {
    gap: 12,
  },

  unknownLoadText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  resistanceArea: {
    gap: 8,
  },

  resistanceHelp: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginBottom: 2,
  },

  resistanceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  resistanceChip: {
    flexBasis: '30%',
    flexGrow: 1,
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.11)' : colors.border,
    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : colors.surfaceElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },

  resistanceChipSelected: {
    borderColor: BRAND_KAKI,
    backgroundColor: 'rgba(94,102,51,0.12)',
  },

  resistanceChipText: {
    flexShrink: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    letterSpacing: 0.45,
    color: colors.textSecondary,
  },

  resistanceChipTextSelected: {
    color: BRAND_KAKI,
  },

  adjustableArea: {
    gap: 12,
  },

  adjustableGrid: {
    flexDirection: 'row',
    gap: 8,
  },

  adjustableField: {
    flex: 1,
  },

  noResultCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(94,102,51,0.18)',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },

  noResultTextArea: {
    flex: 1,
  },

  noResultTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.6,
    color: colors.textPrimary,
  },

  noResultText: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  emptyCard: {
    marginTop: 16,
    borderRadius: 16,
    padding: 14,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor:
      'rgba(94,102,51,0.18)',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },

  emptyText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
  },

  validationText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      BRAND_ORANGE,
    marginTop: 12,
  },

  saveButton: {
    minHeight: 56,
    marginTop: 22,
    borderRadius: 16,
    backgroundColor:
      BRAND_ORANGE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  saveButtonDone: {
    backgroundColor:
      BRAND_ORANGE,
  },

  saveButtonDisabled: {
    opacity: 0.35,
  },

  saveButtonPressed: {
    transform: [
      {
        scale: 0.985,
      },
    ],
  },

  saveButtonText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 13,
    letterSpacing: 0.8,
    color:
      colors.brandWhite,
  },

  footerText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },

  bottomSpace: {
    height: 42,
  },

  pressed: {
    opacity: 0.72,
  },
  });
}