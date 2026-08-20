import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
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
  colors,
  spacing,
  typography,
} from '../../src/constants';

import {
  getEquipmentCatalog,
  getUserEquipmentInventory,
  replaceUserEquipmentInventory,
} from '../../src/services/equipmentService';

const backgroundImage = require(
  '../../assets/backgrounds/welcome-default.jpg'
);

const brandIcon = require(
  '../../assets/branding/ugerod-icon.png'
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

const EQUIPMENT_LOCATIONS = [
  {
    key: 'ALL',
    label: 'TOUT',
    icon: 'grid-outline',
  },
  {
    key: 'HOME',
    label: 'MAISON',
    icon: 'home-outline',
  },
  {
    key: 'OUTDOOR',
    label: 'EXTÉRIEUR',
    icon: 'leaf-outline',
  },
  {
    key: 'GYM_BOX',
    label: 'SALLE / BOX',
    icon: 'barbell-outline',
  },
  {
    key: 'GARAGE',
    label: 'GARAGE',
    icon: 'construct-outline',
  },
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
  const { returnTo } = useLocalSearchParams();
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

  const [activeLocation, setActiveLocation] =
    useState('ALL');

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
          getUserEquipmentInventory(),
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
  }, []);

  const visibleCatalog = useMemo(() => {
    const normalizedQuery =
      normalizeSearchValue(searchQuery.trim());

    return catalog.filter((equipment) => {
      if (equipment.id === 'E00') {
        return false;
      }

      const locations = Array.isArray(
        equipment.locations
      )
        ? equipment.locations
        : [];

      if (
        activeLocation !== 'ALL' &&
        !locations.includes(activeLocation)
      ) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return normalizeSearchValue(
        [
          equipment.name,
          equipment.category,
          equipment.description,
        ]
          .filter(Boolean)
          .join(' ')
      ).includes(normalizedQuery);
    });
  }, [catalog, activeLocation, searchQuery]);

  const selectedEquipmentCount = useMemo(
    () =>
      new Set(
        draftInventory.map(
          (row) => row.equipment_id
        )
      ).size,
    [draftInventory]
  );

  const canSave =
    !isLoading &&
    !isSaving &&
    draftInventory.every(validateRow);

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

    const defaultMode = isBarbell
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
      isBarbell ||
      FIXED_LOAD_CAPABLE_IDS.has(
        equipment.id
      ) ||
      equipment.id ===
        RESISTANCE_EQUIPMENT_ID;

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

      const payload =
        sanitizeInventory(
          draftInventory
        );

      const savedRows =
        await replaceUserEquipmentInventory(
          payload
        );

      setDraftInventory(
        (savedRows ?? []).map(
          normalizeLoadedRow
        )
      );

      setSaved(true);

      setTimeout(() => {
        if (
          typeof returnTo === 'string' &&
          returnTo.length > 0
        ) {
          router.replace(returnTo);
          return;
        }

        router.back();
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
    router.back();
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
          color={colors.primary}
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
        source={backgroundImage}
        resizeMode="cover"
        style={styles.background}
      >
        <View
          style={styles.darkOverlay}
        />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.45)',
            'rgba(7,9,12,0.72)',
            'rgba(7,9,12,0.95)',
            'rgba(7,9,12,1)',
          ]}
          locations={[
            0,
            0.26,
            0.68,
            1,
          ]}
          style={
            StyleSheet.absoluteFill
          }
        />

        <SafeAreaView
          style={styles.safeArea}
        >
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
                TON INVENTAIRE HABITUEL
              </Text>

              <Text
                style={
                  styles.introText
                }
              >
                Ici, tu peux mettre à jour le matériel que tu possèdes et renseigner les charges associées.
              </Text>
            </View>

            {/* INFO */}
            <View
              style={styles.infoCard}
            >
              <Ionicons
                name="information-circle-outline"
                size={21}
                color={
                  colors.primaryLight
                }
              />

              <Text
                style={styles.infoText}
              >
                Renseigner les charges permet à UGEROD d’adapter plus précisément tes entraînements. Tu peux enregistrer un matériel même si tu ne connais pas sa charge.
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
                    colors.brandRed
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
              <View style={styles.searchShell}>
                <Ionicons
                  name="search-outline"
                  size={19}
                  color={colors.textMuted}
                />

                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Rechercher un équipement…"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  style={styles.searchInput}
                />

                {searchQuery.length > 0 && (
                  <Pressable
                    onPress={() => setSearchQuery('')}
                    hitSlop={8}
                  >
                    <Ionicons
                      name="close-circle"
                      size={19}
                      color={colors.textMuted}
                    />
                  </Pressable>
                )}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.locationTabs}
              >
                {EQUIPMENT_LOCATIONS.map((location) => {
                  const selected =
                    activeLocation === location.key;

                  return (
                    <Pressable
                      key={location.key}
                      onPress={() =>
                        setActiveLocation(location.key)
                      }
                      style={[
                        styles.locationTab,
                        selected &&
                          styles.locationTabSelected,
                      ]}
                    >
                      <Ionicons
                        name={location.icon}
                        size={16}
                        color={
                          selected
                            ? colors.brandWhite
                            : colors.textSecondary
                        }
                      />

                      <Text
                        style={[
                          styles.locationTabText,
                          selected &&
                            styles.locationTabTextSelected,
                        ]}
                      >
                        {location.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.catalogSummaryRow}>
                <Text style={styles.catalogSummaryText}>
                  {visibleCatalog.length} MATÉRIEL{visibleCatalog.length > 1 ? 'S' : ''}
                </Text>
                <Text style={styles.catalogSummarySelected}>
                  {selectedEquipmentCount} SÉLECTIONNÉ{selectedEquipmentCount > 1 ? 'S' : ''}
                </Text>
              </View>
            </View>

            {/* INVENTAIRE */}
            <View
              style={
                styles.equipmentList
              }
            >
              <View
                style={[
                  styles.equipmentCard,
                  styles.bodyweightCard,
                ]}
              >
                <View style={styles.equipmentHeader}>
                  <View style={styles.bodyweightIcon}>
                    <Ionicons
                      name="body-outline"
                      size={20}
                      color={colors.textPrimary}
                    />
                  </View>

                  <Text style={styles.equipmentName}>
                    POIDS DU CORPS
                  </Text>
                </View>
              </View>

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
                    isBarbell ||
                    supportsFixed ||
                    supportsResistance;

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
                              equipment.name ??
                                ''
                            ).toUpperCase()}
                          </Text>

                          {Number.isFinite(
                            Number(equipment.exercise_count)
                          ) && (
                            <Text style={styles.equipmentCoverage}>
                              {Number(equipment.exercise_count)} EXERCICE{Number(equipment.exercise_count) > 1 ? 'S' : ''} COMPATIBLE{Number(equipment.exercise_count) > 1 ? 'S' : ''}
                            </Text>
                          )}

                          {(isBarbell ||
                            supportsFixed ||
                            supportsResistance) && (
                            <View style={styles.equipmentMetaRow}>
                              {(isBarbell || supportsFixed) && (
                                <Ionicons
                                  name="barbell-outline"
                                  size={14}
                                  color={colors.primaryLight}
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
                                      colors.primaryLight
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
                                            colors.brandRed
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
                                    colors.primaryLight
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
                                            color={colors.primaryLight}
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

              {visibleCatalog.length === 0 && (
                <View style={styles.noResultCard}>
                  <Ionicons
                    name="search-outline"
                    size={22}
                    color={colors.primaryLight}
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
                    colors.primaryLight
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

function QuantityControl({
  row,
  onMinus,
  onPlus,
  compact = false,
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

function LoadInput({
  label,
  value,
  placeholder,
  onChange,
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor:
      colors.background,
  },

  background: {
    flex: 1,
  },

  safeArea: {
    flex: 1,
  },

  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor:
      'rgba(0,0,0,0.30)',
  },

  content: {
    paddingHorizontal:
      spacing.xl,
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
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor:
      'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.10)',
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
    color: colors.primary,
  },

  brandIcon: {
    width: 45,
    height: 45,
  },

  intro: {
    marginTop: 25,
  },

  introTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 31,
    lineHeight: 34,
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
    marginTop: 22,
    borderRadius: 16,
    padding: 14,
    backgroundColor:
      'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.20)',
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
    backgroundColor:
      'rgba(255,59,59,0.08)',
    borderWidth: 1,
    borderColor:
      'rgba(255,59,59,0.28)',
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
    color: colors.brandRed,
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
    borderColor: 'rgba(255,255,255,0.11)',
    backgroundColor: 'rgba(17,21,26,0.92)',
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
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(17,21,26,0.82)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  locationTabSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
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
    color: colors.primaryLight,
  },

  equipmentList: {
    marginTop: 18,
    gap: 10,
  },

  equipmentCard: {
    borderRadius: 17,
    backgroundColor:
      'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.09)',
    overflow: 'hidden',
  },

  equipmentCardSelected: {
    borderColor:
      'rgba(8,104,255,0.42)',
  },

  bodyweightCard: {
    borderColor:
      'rgba(255,255,255,0.08)',
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

  equipmentCoverage: {
    marginTop: 2,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.55,
    color: colors.textMuted,
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
    borderColor:
      'rgba(255,255,255,0.20)',
    backgroundColor:
      'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  checkboxSelected: {
    backgroundColor:
      colors.primary,
    borderColor:
      colors.primary,
  },

  configurationArea: {
    borderTopWidth: 1,
    borderTopColor:
      'rgba(255,255,255,0.07)',
    padding: 14,
    gap: 12,
  },

  modeTabs: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    backgroundColor:
      'rgba(255,255,255,0.04)',
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
      colors.primary,
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
    borderColor:
      'rgba(255,255,255,0.10)',
    backgroundColor:
      'rgba(255,255,255,0.03)',
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
    backgroundColor:
      'rgba(255,255,255,0.025)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.07)',
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
    borderColor:
      'rgba(255,255,255,0.11)',
    backgroundColor:
      'rgba(255,255,255,0.035)',
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
      'rgba(8,104,255,0.35)',
    backgroundColor:
      'rgba(8,104,255,0.05)',
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
      colors.primaryLight,
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
    borderColor: 'rgba(255,255,255,0.11)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },

  resistanceChipSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(8,104,255,0.12)',
  },

  resistanceChipText: {
    flexShrink: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    letterSpacing: 0.45,
    color: colors.textSecondary,
  },

  resistanceChipTextSelected: {
    color: colors.primaryLight,
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
    backgroundColor: 'rgba(8,104,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.18)',
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
    backgroundColor:
      'rgba(8,104,255,0.06)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.18)',
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
      colors.brandRed,
    marginTop: 12,
  },

  saveButton: {
    minHeight: 56,
    marginTop: 22,
    borderRadius: 16,
    backgroundColor:
      colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  saveButtonDone: {
    backgroundColor:
      colors.primary,
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