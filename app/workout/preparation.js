import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  router,
  useFocusEffect,
} from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';
import {
  useWorkout,
} from '../../src/contexts/WorkoutContext';
import {
  getEquipmentCatalog,
  getUserEquipmentInventory,
} from '../../src/services/equipmentService';

const brandIcon = require('../../assets/branding/ugerod-icon.png');

const DURATIONS = [20, 30, 45, 60, 75, 90];


const REGIONS = [
  {
    id: null,
    label: 'UGEROD CHOISIT',
  },
  {
    id: 'Upper',
    label: 'HAUT DU CORPS',
  },
  {
    id: 'Lower',
    label: 'BAS DU CORPS',
  },
  {
    id: 'Full Body',
    label: 'CORPS ENTIER',
  },
  {
    id: 'Core',
    label: 'CENTRE DU CORPS',
  },
];

/*
 * Ces matériels peuvent avoir une charge numérique.
 * Une charge non renseignée n'empêche jamais de les sélectionner.
 * Le backend sait alors que le matériel existe mais n'invente aucun poids.
 */
const LOAD_CAPABLE_EQUIPMENT_IDS = new Set([
  'E03', // Haltères
  'E04', // Kettlebell
  'E09', // Medball
]);

function buildReferenceEquipment(
  catalog,
  inventory
) {
  const rowsByEquipment = new Map();

  for (const row of inventory ?? []) {
    const equipmentId =
      String(row.equipment_id ?? '');

    if (!equipmentId || equipmentId === 'E00') {
      continue;
    }

    if (!rowsByEquipment.has(equipmentId)) {
      rowsByEquipment.set(
        equipmentId,
        []
      );
    }

    rowsByEquipment
      .get(equipmentId)
      .push(row);
  }

  return (catalog ?? [])
    .filter(
      (item) =>
        item.id !== 'E00' &&
        rowsByEquipment.has(item.id)
    )
    .map((item) => {
      const rows =
        rowsByEquipment.get(item.id) ?? [];

      const supportsLoad =
        LOAD_CAPABLE_EQUIPMENT_IDS.has(
          item.id
        );

      const hasConfirmedLoad =
        rows.some((row) =>
          [
            'fixed_load',
            'adjustable_load',
          ].includes(
            row.inventory_mode
          )
        );

      const hasUnknownLoad =
        supportsLoad &&
        !hasConfirmedLoad &&
        rows.some(
          (row) =>
            row.inventory_mode ===
            'load_unknown'
        );

      const quantity = rows.reduce(
        (total, row) =>
          total +
          Math.max(
            1,
            Number(row.quantity ?? 1)
          ),
        0
      );

      const fixedLoads = rows
        .filter(
          (row) =>
            row.inventory_mode ===
              'fixed_load' &&
            row.load_kg != null
        )
        .map((row) => ({
          quantity: Math.max(
            1,
            Number(row.quantity ?? 1)
          ),
          load: Number(row.load_kg),
        }));

      const adjustable = rows.find(
        (row) =>
          row.inventory_mode ===
          'adjustable_load'
      );

      let detail = null;

      if (fixedLoads.length > 0) {
        detail = fixedLoads
          .map(
            (row) =>
              `${row.quantity}×${row.load} kg`
          )
          .join(' · ');
      } else if (adjustable) {
        detail = `${adjustable.min_load_kg}–${adjustable.max_load_kg} kg`;
      } else if (hasUnknownLoad) {
        detail = 'CHARGE NON RENSEIGNÉE';
      } else if (quantity > 1) {
        detail = `×${quantity}`;
      }

      return {
        id: item.id,
        name: item.name,
        rows,
        quantity,
        supportsLoad,
        hasConfirmedLoad,
        hasUnknownLoad,
        detail,
      };
    });
}

export default function PreparationScreen() {
  const {
    preparation,
    updatePreparation,
  } = useWorkout();

  const [
    referenceEquipment,
    setReferenceEquipment,
  ] = useState([]);
  const [
    equipmentLoading,
    setEquipmentLoading,
  ] = useState(true);
  const [
    equipmentError,
    setEquipmentError,
  ] = useState(null);

  const duration =
    preparation.duration ?? 45;

  const equipment =
    preparation.equipment?.length > 0
      ? preparation.equipment
      : ['Poids du corps'];

  const readiness =
    preparation.readiness ?? 6;

  const injuries =
    preparation.painZones?.length > 0
      ? preparation.painZones
      : ['Aucune'];

  const region =
    preparation.region ?? null;


  const loadReferenceEquipment =
    useCallback(async () => {
      setEquipmentLoading(true);
      setEquipmentError(null);

      try {
        const [catalog, inventory] =
          await Promise.all([
            getEquipmentCatalog(),
            getUserEquipmentInventory(),
          ]);

        const reference =
          buildReferenceEquipment(
            catalog,
            inventory
          );

        setReferenceEquipment(reference);

        const currentEquipment =
          Array.isArray(
            preparation.equipment
          )
            ? preparation.equipment
            : [];

        const allowedNames = new Set(
          reference.map(
            (item) => item.name
          )
        );

        if (currentEquipment.length === 0) {
          /*
           * Première ouverture du check-in :
           * on part du matériel de référence du profil.
           * L'utilisateur n'a plus qu'à décocher ce qui
           * n'est pas disponible aujourd'hui.
           */
          updatePreparation({
            equipment:
              reference.length > 0
                ? reference.map(
                    (item) => item.name
                  )
                : ['Poids du corps'],
          });
        } else {
          const sanitized =
            currentEquipment.filter(
              (name) =>
                name ===
                  'Poids du corps' ||
                allowedNames.has(name)
            );

          const normalized =
            sanitized.length > 0
              ? sanitized
              : ['Poids du corps'];

          if (
            normalized.join('|') !==
            currentEquipment.join('|')
          ) {
            updatePreparation({
              equipment: normalized,
            });
          }
        }
      } catch (error) {
        console.error(
          'F-C3 equipment loading error',
          error
        );

        setEquipmentError(
          error instanceof Error
            ? error.message
            : 'Impossible de charger ton matériel.'
        );
      } finally {
        setEquipmentLoading(false);
      }
    }, [
      preparation.equipment,
      updatePreparation,
    ]);

  /*
   * Recharge l'inventaire à chaque retour sur l'écran.
   * Si l'utilisateur ouvre "Mon matériel" puis revient,
   * les changements sont donc visibles immédiatement.
   */
  useFocusEffect(
    useCallback(() => {
      loadReferenceEquipment();
    }, [loadReferenceEquipment])
  );

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(tabs)');
  }

  function handleManageEquipment() {
    router.push({
      pathname: '/profile/equipment',
      params: {
        returnTo: '/workout/preparation',
      },
    });
  }

  function handleManageInjuries() {
    router.push('/workout/injuries');
  }

  function handleDuration(item) {
    updatePreparation({
      duration: item,
    });
  }

  function toggleEquipment(item) {
    let nextEquipment;
    const isAlreadySelected =
      equipment.includes(item);

    if (isAlreadySelected) {
      const filtered =
        equipment.filter(
          (value) => value !== item
        );

      nextEquipment =
        filtered.length === 0
          ? ['Poids du corps']
          : filtered;
    } else if (
      item !== 'Poids du corps'
    ) {
      nextEquipment = [
        ...equipment.filter(
          (value) =>
            value !== 'Poids du corps'
        ),
        item,
      ];
    } else {
      nextEquipment = [
        'Poids du corps',
      ];
    }

    updatePreparation({
      equipment: nextEquipment,
    });

  }

  function handleReadiness(value) {
    updatePreparation({
      readiness: value,
    });
  }

  function handleRegion(value) {
    updatePreparation({
      region:
        region === value
          ? null
          : value,
    });
  }

  function getReadinessLabel() {
    if (readiness <= 4) {
      return 'FAIBLE';
    }

    if (readiness <= 7) {
      return 'NORMALE';
    }

    return 'TRÈS EN FORME';
  }

  function handleGenerate() {
    updatePreparation({
      duration,
      equipment,
      readiness,
      painZones: injuries,
      region,
    });

    router.push(
      '/workout/generating'
    );
  }

  return (
    <SafeAreaView
      style={styles.screen}
    >
      <ScrollView
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={
          false
        }
      >
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
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
            style={styles.headerText}
          >
            <Text
              style={
                styles.headerEyebrow
              }
            >
              SÉANCE DU JOUR
            </Text>

            <Text
              style={styles.headerTitle}
            >
              PRÉPARATION
              <Text
                style={styles.blueDot}
              >
                .
              </Text>
            </Text>
          </View>

          <Image
            source={brandIcon}
            style={styles.brandIcon}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.intro}>
          Quelques infos avant de construire ta séance.
        </Text>

        <SectionTitle
          title="TEMPS DISPONIBLE"
          subtitle="Temps total de ta séance."
        />

        <DurationSlider
          value={duration}
          onChange={handleDuration}
        />

        <View
          style={styles.equipmentTitleRow}
        >
          <View style={styles.flexOne}>
            <SectionTitle
              title="MATÉRIEL DU JOUR"
            />
          </View>
        </View>

        {equipmentLoading ? (
          <View style={styles.infoCard}>
            <Ionicons
              name="sync-outline"
              size={20}
              color={colors.primaryLight}
            />
            <Text style={styles.infoText}>
              Chargement de ton matériel…
            </Text>
          </View>
        ) : equipmentError ? (
          <View style={styles.errorCard}>
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color={colors.brandRed}
            />

            <View style={styles.flexOne}>
              <Text style={styles.errorTitle}>
                MATÉRIEL INDISPONIBLE
              </Text>
              <Text style={styles.errorText}>
                {equipmentError}
              </Text>
            </View>

            <Pressable
              onPress={loadReferenceEquipment}
              style={styles.retryButton}
            >
              <Text
                style={styles.retryButtonText}
              >
                RÉESSAYER
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.chipGrid}>
              <EquipmentChip
                item={{
                  name: 'Poids du corps',
                  detail: null,
                  hasUnknownLoad: false,
                }}
                selected={equipment.includes(
                  'Poids du corps'
                )}
                onPress={() =>
                  toggleEquipment(
                    'Poids du corps'
                  )
                }
                fullWidth
              />

              {referenceEquipment.map(
                (item) => (
                  <EquipmentChip
                    key={item.id}
                    item={item}
                    selected={
                      equipment.includes(
                        item.name
                      )
                    }
                    onPress={() =>
                      toggleEquipment(
                        item.name
                      )
                    }
                  />
                )
              )}
            </View>

            <Pressable
              onPress={handleManageEquipment}
              style={({ pressed }) => [
                styles.inlineAction,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.inlineActionText}>
                MODIFIER MON MATÉRIEL
              </Text>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.primaryLight}
              />
            </Pressable>

            {referenceEquipment.length === 0 && (
              <Pressable
                onPress={handleManageEquipment}
                style={styles.emptyEquipmentCard}
              >
                <Ionicons
                  name="barbell-outline"
                  size={22}
                  color={colors.primaryLight}
                />

                <View style={styles.flexOne}>
                  <Text
                    style={styles.emptyEquipmentTitle}
                  >
                    MODIFIER MON MATÉRIEL
                  </Text>
                  <Text
                    style={styles.emptyEquipmentText}
                  >
                    Ajoute le matériel que tu possèdes pour le retrouver ici à chaque préparation.
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textMuted}
                />
              </Pressable>
            )}
          </>
        )}

        <SectionTitle
          title="FORME DU JOUR"
          subtitle="Comment tu te sens aujourd’hui ?"
        />

        <View
          style={styles.readinessCard}
        >
          <View
            style={styles.readinessHeader}
          >
            <View>
              <Text
                style={styles.readinessValue}
              >
                {readiness}
                <Text
                  style={styles.readinessTotal}
                >
                  /10
                </Text>
              </Text>

              <Text
                style={styles.readinessLabel}
              >
                {getReadinessLabel()}
              </Text>
            </View>

            <Ionicons
              name="pulse-outline"
              size={27}
              color={
                readiness >= 8
                  ? colors.primaryLight
                  : readiness <= 4
                    ? colors.brandRed
                    : colors.textPrimary
              }
            />
          </View>

          <View
            style={styles.readinessNumbers}
          >
            {Array.from(
              { length: 10 },
              (_, index) => {
                const value = index + 1;
                const selected =
                  readiness === value;

                return (
                  <Pressable
                    key={value}
                    onPress={() =>
                      handleReadiness(value)
                    }
                    style={[
                      styles.readinessNumber,
                      selected &&
                        styles.readinessNumberSelected,
                      selected &&
                        readiness <= 4 &&
                        styles.readinessNumberLow,
                    ]}
                  >
                    <Text
                      style={[
                        styles.readinessNumberText,
                        selected &&
                          styles.readinessNumberTextSelected,
                      ]}
                    >
                      {value}
                    </Text>
                  </Pressable>
                );
              }
            )}
          </View>

          <View
            style={styles.readinessScale}
          >
            <Text style={styles.scaleLow}>
              FAIBLE
            </Text>
            <Text
              style={styles.scaleNormal}
            >
              NORMAL
            </Text>
            <Text style={styles.scaleHigh}>
              TRÈS EN FORME
            </Text>
          </View>
        </View>

        <SectionTitle
          title="GÊNE OU BLESSURE"
        />

        <View style={styles.injurySummaryCard}>
          <View style={styles.injurySummaryMain}>
            <Ionicons
              name={
                injuries.length === 1 &&
                injuries[0] === 'Aucune'
                  ? 'shield-checkmark-outline'
                  : 'medical-outline'
              }
              size={21}
              color={
                injuries.length === 1 &&
                injuries[0] === 'Aucune'
                  ? colors.primaryLight
                  : colors.brandRed
              }
            />

            <View style={styles.flexOne}>
              <Text style={styles.injurySummaryTitle}>
                {injuries.length === 1 &&
                injuries[0] === 'Aucune'
                  ? 'AUCUNE GÊNE'
                  : `${injuries.length} ZONE${
                      injuries.length > 1 ? 'S' : ''
                    } À PROTÉGER`}
              </Text>

              {!(
                injuries.length === 1 &&
                injuries[0] === 'Aucune'
              ) && (
                <Text
                  numberOfLines={2}
                  style={styles.injurySummaryText}
                >
                  {injuries.join(' · ')}
                </Text>
              )}
            </View>
          </View>

          <Pressable
            onPress={handleManageInjuries}
            style={({ pressed }) => [
              styles.inlineAction,
              styles.injuryInlineAction,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.inlineActionText}>
              MODIFIER MES GÊNES
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.primaryLight}
            />
          </Pressable>
        </View>

        <SectionTitle
          title="ENVIE DU JOUR"
          subtitle="Optionnel. Par défaut, UGEROD choisit selon tes besoins."
        />

        <View style={styles.regionGrid}>
          {REGIONS.map((item) => {
            const selected =
              region === item.id;

            return (
              <Pressable
                key={
                  item.id ?? 'auto-region'
                }
                onPress={() =>
                  handleRegion(item.id)
                }
                style={[
                  styles.regionButton,
                  selected &&
                    styles.regionButtonSelected,
                ]}
              >
                <View style={styles.regionButtonContent}>
                  <Text
                    style={[
                      styles.regionText,
                      selected &&
                        styles.regionTextSelected,
                    ]}
                  >
                    {item.label}
                  </Text>

                  {selected && (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.primaryLight}
                    />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handleGenerate}
          disabled={equipmentLoading}
          style={({ pressed }) => [
            styles.generateButton,
            equipmentLoading &&
              styles.generateButtonDisabled,
            pressed &&
              !equipmentLoading &&
              styles.generateButtonPressed,
          ]}
        >
          <Text
            style={styles.generateButtonText}
          >
            GÉNÉRER MA SÉANCE
          </Text>

          <Ionicons
            name="flash-outline"
            size={20}
            color={colors.brandWhite}
          />
        </Pressable>

        <View style={styles.bottomSpace} />
      </ScrollView>
    </SafeAreaView>
  );
}

function EquipmentChip({
  item,
  selected,
  onPress,
  fullWidth = false,
  staticCard = false,
}) {
  const content = (
    <>
      <View
        style={styles.equipmentChipTop}
      >
        <Text
          style={[
            styles.equipmentChipText,
            selected &&
              styles.equipmentChipTextSelected,
          ]}
        >
          {item.name.toUpperCase()}
        </Text>

        {selected && (
          <Ionicons
            name="checkmark-circle"
            size={20}
            color={colors.primaryLight}
          />
        )}
      </View>

      {item.detail && (
        <Text
          numberOfLines={2}
          style={[
            styles.equipmentDetail,
            item.hasUnknownLoad &&
              styles.equipmentDetailUnknown,
          ]}
        >
          {item.detail}
        </Text>
      )}
    </>
  );

  if (staticCard) {
    return (
      <View
        style={[
          styles.equipmentChip,
          fullWidth &&
            styles.equipmentChipFullWidth,
          styles.bodyweightChip,
        ]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.equipmentChip,
        fullWidth &&
          styles.equipmentChipFullWidth,
        selected &&
          styles.equipmentChipSelected,
        item.hasUnknownLoad &&
          styles.equipmentChipUnknown,
        pressed && styles.pressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

function DurationSlider({
  value,
  onChange,
}) {
  const [trackWidth, setTrackWidth] =
    useState(0);

  const currentIndex = Math.max(
    0,
    DURATIONS.indexOf(value)
  );

  const step =
    trackWidth > 0
      ? trackWidth /
        (DURATIONS.length - 1)
      : 0;

  const dragOriginXRef = useRef(0);

  const updateFromX = useCallback(
    (x) => {
      if (!trackWidth || !step) {
        return;
      }

      const clampedX = Math.max(
        0,
        Math.min(trackWidth, x)
      );

      const nextIndex = Math.max(
        0,
        Math.min(
          DURATIONS.length - 1,
          Math.round(clampedX / step)
        )
      );

      const nextValue =
        DURATIONS[nextIndex];

      if (nextValue !== value) {
        onChange(nextValue);
      }
    },
    [onChange, step, trackWidth, value]
  );

  const knobPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder:
          () => true,
        onMoveShouldSetPanResponder:
          () => true,
        onPanResponderGrant: () => {
          dragOriginXRef.current =
            currentIndex * step;
        },
        onPanResponderMove: (
          _event,
          gestureState
        ) => {
          updateFromX(
            dragOriginXRef.current +
              gestureState.dx
          );
        },
        onPanResponderRelease: (
          _event,
          gestureState
        ) => {
          updateFromX(
            dragOriginXRef.current +
              gestureState.dx
          );
        },
        onPanResponderTerminationRequest:
          () => false,
      }),
    [
      currentIndex,
      step,
      updateFromX,
    ]
  );

  const knobLeft =
    currentIndex * step;

  const durationColor =
    value <= 30
      ? colors.primaryLight
      : value >= 75
        ? colors.brandRed
        : colors.textPrimary;

  return (
    <View style={styles.durationSliderCard}>
      <View style={styles.durationDigitalPanel}>
        <Text
          style={[
            styles.durationDigitalValue,
            {
              color: durationColor,
            },
          ]}
        >
          {value}
        </Text>

        <Text
          style={[
            styles.durationDigitalUnit,
            {
              color: durationColor,
            },
          ]}
        >
          MIN
        </Text>
      </View>

      <View style={styles.durationSliderRight}>
        <View
          onLayout={(event) =>
            setTrackWidth(
              event.nativeEvent.layout.width
            )
          }
          style={styles.durationTrackTouch}
        >
          <View style={styles.durationTrack}>
            <View
              style={[
                styles.durationTrackProgress,
                {
                  width: knobLeft,
                  backgroundColor:
                    durationColor,
                },
              ]}
            />

            <View
              style={styles.durationPressZones}
            >
              {DURATIONS.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityLabel={`${item} minutes`}
                  onPress={() =>
                    onChange(item)
                  }
                  style={styles.durationPressZone}
                />
              ))}
            </View>

            <View
              {...knobPanResponder.panHandlers}
              style={[
                styles.durationKnob,
                {
                  left: knobLeft,
                  borderColor:
                    durationColor,
                },
              ]}
            >
              <Ionicons
                name="stopwatch-outline"
                size={18}
                color={colors.textPrimary}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function SectionTitle({
  title,
  subtitle,
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>
        {title}
      </Text>
      {!!subtitle && (
        <Text
          style={styles.sectionSubtitle}
        >
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor:
      colors.background,
  },

  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },

  flexOne: {
    flex: 1,
  },

  header: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerText: {
    flex: 1,
  },

  headerEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color: colors.textSecondary,
  },

  headerTitle: {
    ...typography.display,
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.6,
    color: colors.textPrimary,
  },

  blueDot: {
    color: colors.primary,
  },

  brandIcon: {
    width: 45,
    height: 45,
  },

  intro: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
    marginTop: 6,
    marginBottom: 6,
  },

  sectionHeader: {
    marginTop: 26,
    marginBottom: 12,
  },

  sectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 15,
    lineHeight: 19,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },

  sectionSubtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginTop: 3,
  },

  durationSliderCard: {
    minHeight: 112,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },

  durationDigitalPanel: {
    width: 104,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },

  durationDigitalValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 62,
    lineHeight: 60,
    letterSpacing: 2.4,
    textAlign: 'center',
  },

  durationDigitalUnit: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 2.2,
    marginTop: -2,
    textAlign: 'center',
  },

  durationSliderRight: {
    flex: 1,
    justifyContent: 'center',
  },

  durationTrackTouch: {
    height: 60,
    justifyContent: 'center',
  },

  durationTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    position: 'relative',
  },

  durationTrackProgress: {
    height: 4,
    borderRadius: 2,
  },

  durationPressZones: {
    position: 'absolute',
    left: -18,
    right: -18,
    top: -24,
    bottom: -24,
    flexDirection: 'row',
    zIndex: 1,
  },

  durationPressZone: {
    flex: 1,
  },

  durationKnob: {
    position: 'absolute',
    top: -18,
    zIndex: 3,
    width: 40,
    height: 40,
    marginLeft: -20,
    borderRadius: 20,
    borderWidth: 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 5,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    elevation: 3,
  },

  equipmentTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },


  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },

  chip: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  chipSelected: {
    backgroundColor:
      'rgba(8,104,255,0.12)',
    borderColor: colors.primary,
  },

  chipText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },

  chipTextSelected: {
    color: colors.primaryLight,
  },

  injurySelected: {
    backgroundColor:
      'rgba(255,59,59,0.10)',
    borderColor: colors.brandRed,
  },

  injuryTextSelected: {
    color: colors.brandRed,
  },

  equipmentChip: {
    width: '48%',
    minHeight: 48,
    borderRadius: 13,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },

  equipmentChipFullWidth: {
    width: '100%',
    minWidth: '100%',
  },

  bodyweightChip: {
    minHeight: 48,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: colors.surface,
  },

  equipmentChipSelected: {
    backgroundColor:
      'rgba(8,104,255,0.12)',
    borderColor: colors.primary,
  },

  equipmentChipUnknown: {
    borderStyle: 'dashed',
  },

  equipmentChipTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },

  equipmentChipText: {
    flexShrink: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },

  equipmentChipTextSelected: {
    color: colors.primaryLight,
  },

  equipmentDetail: {
    marginTop: 4,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.25,
    color: colors.textMuted,
  },

  equipmentDetailUnknown: {
    color: colors.textSecondary,
  },

  infoCard: {
    minHeight: 58,
    paddingHorizontal: 14,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  infoText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
  },

  errorCard: {
    minHeight: 72,
    padding: 13,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.brandRed,
    backgroundColor:
      'rgba(255,59,59,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  errorTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    color: colors.brandRed,
  },

  errorText: {
    marginTop: 2,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 15,
    color: colors.textSecondary,
  },

  retryButton: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },

  retryButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    color: colors.textPrimary,
  },

  inlineAction: {
    minHeight: 44,
    marginTop: 14,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  inlineActionText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: 0.6,
    color: colors.primaryLight,
  },

  injurySummaryCard: {
    borderRadius: 16,
    padding: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  injurySummaryMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  injurySummaryTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    letterSpacing: 0.5,
    color: colors.textPrimary,
  },

  injurySummaryText: {
    marginTop: 4,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },

  injuryInlineAction: {
    marginTop: 8,
  },

  emptyEquipmentCard: {
    marginTop: 12,
    minHeight: 82,
    padding: 14,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  emptyEquipmentTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    color: colors.textPrimary,
  },

  emptyEquipmentText: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },

  readinessCard: {
    borderRadius: 17,
    padding: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  readinessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  readinessValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 34,
    lineHeight: 36,
    color: colors.textPrimary,
  },

  readinessTotal: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 14,
    color: colors.textSecondary,
  },

  readinessLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.8,
    color: colors.primaryLight,
    marginTop: 2,
  },

  readinessNumbers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    gap: 4,
  },

  readinessNumber: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor:
      colors.backgroundSoft,
  },

  readinessNumberSelected: {
    backgroundColor: colors.primary,
  },

  readinessNumberLow: {
    backgroundColor: colors.brandRed,
  },

  readinessNumberText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    color: colors.textSecondary,
  },

  readinessNumberTextSelected: {
    color: colors.brandWhite,
  },

  readinessScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },

  scaleLow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.4,
    color: colors.brandRed,
  },

  scaleNormal: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.4,
    color: colors.textMuted,
  },

  scaleHigh: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.4,
    color: colors.primaryLight,
  },

  regionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },

  regionButton: {
    width: '48%',
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },

  regionButtonSelected: {
    backgroundColor:
      'rgba(8,104,255,0.12)',
    borderColor: colors.primary,
  },

  regionButtonContent: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },

  regionText: {
    flexShrink: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: 0.5,
    color: colors.textSecondary,
    textAlign: 'left',
  },

  regionTextSelected: {
    color: colors.primaryLight,
  },

  generateButton: {
    minHeight: 58,
    marginTop: 32,
    borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  generateButtonDisabled: {
    opacity: 0.45,
  },

  generateButtonPressed: {
    backgroundColor:
      colors.primaryDark,
    transform: [
      {
        scale: 0.985,
      },
    ],
  },

  generateButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 21,
    lineHeight: 24,
    letterSpacing: 1.2,
    color: colors.brandWhite,
  },

  bottomSpace: {
    height: 36,
  },

  pressed: {
    opacity: 0.65,
  },
});