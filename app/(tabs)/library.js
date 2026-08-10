import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import {
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

const EXERCISES = [
  {
    id: 'air-squat',
    name: 'AIR SQUAT',
    region: 'BAS DU CORPS',
    equipment: 'POIDS DU CORPS',
  },
  {
    id: 'goblet-squat',
    name: 'GOBLET SQUAT',
    region: 'BAS DU CORPS',
    equipment: 'KETTLEBELL / HALTÈRE',
  },
  {
    id: 'push-up',
    name: 'PUSH-UP',
    region: 'HAUT DU CORPS',
    equipment: 'POIDS DU CORPS',
  },
  {
    id: 'burpee',
    name: 'BURPEE',
    region: 'CORPS ENTIER',
    equipment: 'POIDS DU CORPS',
  },
  {
    id: 'dead-bug',
    name: 'DEAD BUG',
    region: 'CORE',
    equipment: 'POIDS DU CORPS',
  },
  {
    id: 'hollow-hold',
    name: 'HOLLOW HOLD',
    region: 'CORE',
    equipment: 'POIDS DU CORPS',
  },
  {
    id: 'dumbbell-row',
    name: 'DUMBBELL ROW',
    region: 'HAUT DU CORPS',
    equipment: 'HALTÈRES',
  },
  {
    id: 'thruster',
    name: 'DUMBBELL THRUSTER',
    region: 'CORPS ENTIER',
    equipment: 'HALTÈRES',
  },
  {
    id: 'romanian-deadlift',
    name: 'ROMANIAN DEADLIFT',
    region: 'BAS DU CORPS',
    equipment: 'BARRE / HALTÈRES',
  },
  {
    id: 'plank',
    name: 'PLANK',
    region: 'CORE',
    equipment: 'POIDS DU CORPS',
  },
  {
    id: 'shoulder-press',
    name: 'SHOULDER PRESS',
    region: 'HAUT DU CORPS',
    equipment: 'HALTÈRES',
  },
  {
    id: 'box-step-up',
    name: 'BOX STEP-UP',
    region: 'BAS DU CORPS',
    equipment: 'BOX',
  },
];

export default function LibraryScreen() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const [favorites, setFavorites] = useState([
    'goblet-squat',
    'dead-bug',
    'dumbbell-row',
  ]);

  const filteredExercises = useMemo(() => {
    const normalizedSearch =
      search.trim().toLowerCase();

    return EXERCISES.filter((exercise) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        exercise.name
          .toLowerCase()
          .includes(normalizedSearch) ||
        exercise.region
          .toLowerCase()
          .includes(normalizedSearch) ||
        exercise.equipment
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesTab =
        activeTab === 'all' ||
        favorites.includes(exercise.id);

      return matchesSearch && matchesTab;
    });
  }, [search, activeTab, favorites]);

  function handleProfile() {
    router.push('/profile');
  }

  function toggleFavorite(exerciseId) {
    setFavorites((current) => {
      if (current.includes(exerciseId)) {
        return current.filter(
          (id) => id !== exerciseId
        );
      }

      return [...current, exerciseId];
    });
  }

  function handleExercisePress(exercise) {
    router.push(`/exercise/${exercise.id}`);

    /*
     * Plus tard :
     * router.push(`/exercise/${exercise.id}`);
     */
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={backgroundImage}
        resizeMode="cover"
        style={styles.background}
      >
        {/* VOILE NOIR */}
        <View style={styles.darkOverlay} />

        {/* DÉGRADÉ VERTICAL */}
        <LinearGradient
          colors={[
            'rgba(7,9,12,0.34)',
            'rgba(7,9,12,0.50)',
            'rgba(7,9,12,0.84)',
            'rgba(7,9,12,0.98)',
          ]}
          locations={[0, 0.22, 0.58, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* DÉGRADÉ LATÉRAL */}
        <LinearGradient
          colors={[
            'rgba(7,9,12,0.48)',
            'rgba(7,9,12,0.05)',
            'rgba(7,9,12,0.30)',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <View style={styles.content}>
            {/* HEADER */}
            <View style={styles.header}>
              <Pressable
                onPress={handleProfile}
                style={({ pressed }) => [
                  styles.profileButton,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name="person-outline"
                  size={21}
                  color={colors.textPrimary}
                />
              </Pressable>

              <View style={styles.headerText}>
                <Text style={styles.headerEyebrow}>
                  TES MOUVEMENTS
                </Text>

                <Text style={styles.headerTitle}>
                  BIBLIOTHÈQUE
                  <Text style={styles.blueDot}>.</Text>
                </Text>
              </View>

              <Image
                source={brandIcon}
                style={styles.brandIcon}
                resizeMode="contain"
              />
            </View>

            {/* RECHERCHE */}
            <View style={styles.searchWrapper}>
              <Ionicons
                name="search-outline"
                size={20}
                color={colors.textMuted}
              />

              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Rechercher un exercice..."
                placeholderTextColor={colors.textMuted}
                style={styles.searchInput}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {search.length > 0 && (
                <Pressable
                  onPress={() => setSearch('')}
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

            {/* TABS */}
            <View style={styles.tabs}>
              <Pressable
                onPress={() => setActiveTab('all')}
                style={[
                  styles.tab,
                  activeTab === 'all' &&
                    styles.tabActive,
                ]}
              >
                <Text
                  style={[
                    styles.tabText,
                    activeTab === 'all' &&
                      styles.tabTextActive,
                  ]}
                >
                  TOUS
                </Text>
              </Pressable>

              <Pressable
                onPress={() =>
                  setActiveTab('favorites')
                }
                style={[
                  styles.tab,
                  activeTab === 'favorites' &&
                    styles.tabActive,
                ]}
              >
                <Ionicons
                  name={
                    activeTab === 'favorites'
                      ? 'heart'
                      : 'heart-outline'
                  }
                  size={15}
                  color={
                    activeTab === 'favorites'
                      ? colors.primaryLight
                      : colors.textMuted
                  }
                />

                <Text
                  style={[
                    styles.tabText,
                    activeTab === 'favorites' &&
                      styles.tabTextActive,
                  ]}
                >
                  FAVORIS
                </Text>
              </Pressable>
            </View>

            {/* TITRE LISTE */}
            <View style={styles.listHeader}>
              <Text style={styles.sectionTitle}>
                {activeTab === 'all'
                  ? 'TOUS LES EXERCICES'
                  : 'TES FAVORIS'}
              </Text>

              <Text style={styles.exerciseCount}>
                {filteredExercises.length}
              </Text>
            </View>

            {/* LISTE */}
            <ScrollView
              style={styles.list}
              contentContainerStyle={
                styles.listContent
              }
              showsVerticalScrollIndicator={false}
            >
              {filteredExercises.length > 0 ? (
                filteredExercises.map((exercise) => {
                  const favorite =
                    favorites.includes(exercise.id);

                  return (
                    <Pressable
                      key={exercise.id}
                      onPress={() =>
                        handleExercisePress(exercise)
                      }
                      style={({ pressed }) => [
                        styles.exerciseCard,
                        pressed &&
                          styles.exerciseCardPressed,
                      ]}
                    >
                      <View style={styles.exerciseAccent} />

                      <View style={styles.exerciseMain}>
                        <Text
                          style={styles.exerciseName}
                        >
                          {exercise.name}
                        </Text>

                        <View style={styles.exerciseMeta}>
                          <Text
                            style={
                              styles.exerciseRegion
                            }
                          >
                            {exercise.region}
                          </Text>

                          <View style={styles.metaDot} />

                          <Text
                            style={
                              styles.exerciseEquipment
                            }
                            numberOfLines={1}
                          >
                            {exercise.equipment}
                          </Text>
                        </View>
                      </View>

                      <Pressable
                        onPress={(event) => {
                          event.stopPropagation();
                          toggleFavorite(exercise.id);
                        }}
                        hitSlop={10}
                        style={({ pressed }) => [
                          styles.favoriteButton,
                          pressed &&
                            styles.pressed,
                        ]}
                      >
                        <Ionicons
                          name={
                            favorite
                              ? 'heart'
                              : 'heart-outline'
                          }
                          size={21}
                          color={
                            favorite
                              ? colors.primaryLight
                              : colors.textMuted
                          }
                        />
                      </Pressable>

                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  );
                })
              ) : (
                <View style={styles.emptyState}>
                  <View style={styles.emptyIcon}>
                    <Ionicons
                      name={
                        activeTab === 'favorites'
                          ? 'heart-outline'
                          : 'search-outline'
                      }
                      size={28}
                      color={colors.textMuted}
                    />
                  </View>

                  <Text style={styles.emptyTitle}>
                    {activeTab === 'favorites'
                      ? 'AUCUN FAVORI'
                      : 'AUCUN RÉSULTAT'}
                  </Text>

                  <Text style={styles.emptyDescription}>
                    {activeTab === 'favorites'
                      ? 'Ajoute des exercices à tes favoris avec le cœur.'
                      : 'Essaie avec un autre nom, une zone ou un matériel.'}
                  </Text>
                </View>
              )}

              <View style={styles.bottomSpace} />
            </ScrollView>
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  background: {
    flex: 1,
  },

  safeArea: {
    flex: 1,
  },

  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },

  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 8,
  },

  /* HEADER */

  header: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
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
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 1.7,
    color: colors.textPrimary,
  },

  blueDot: {
    color: colors.primary,
  },

  brandIcon: {
    width: 46,
    height: 46,
  },

  /* RECHERCHE */

  searchWrapper: {
    minHeight: 52,
    marginTop: 9,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  searchInput: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    color: colors.textPrimary,
    paddingVertical: 0,
  },

  /* TABS */

  tabs: {
    height: 46,
    marginTop: 14,
    padding: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(17,21,26,0.91)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    gap: 4,
  },

  tab: {
    flex: 1,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  tabActive: {
    backgroundColor: 'rgba(8,104,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.35)',
  },

  tabText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.7,
    color: colors.textMuted,
  },

  tabTextActive: {
    color: colors.primaryLight,
  },

  /* HEADER LISTE */

  listHeader: {
    marginTop: 22,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  sectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },

  exerciseCount: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    lineHeight: 24,
    color: colors.textSecondary,
  },

  /* LISTE */

  list: {
    flex: 1,
  },

  listContent: {
    gap: 9,
  },

  exerciseCard: {
    minHeight: 72,
    borderRadius: 15,
    paddingHorizontal: 13,
    backgroundColor: 'rgba(17,21,26,0.91)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    overflow: 'hidden',
  },

  exerciseCardPressed: {
    backgroundColor: 'rgba(23,28,34,0.95)',
    transform: [{ scale: 0.99 }],
  },

  exerciseAccent: {
    width: 3,
    height: 34,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },

  exerciseMain: {
    flex: 1,
  },

  exerciseName: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.3,
    color: colors.textPrimary,
  },

  exerciseMeta: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  exerciseRegion: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.5,
    color: colors.primaryLight,
  },

  exerciseEquipment: {
    flexShrink: 1,
    fontFamily: 'Oswald_500Medium',
    fontSize: 9,
    lineHeight: 13,
    color: colors.textMuted,
  },

  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
  },

  favoriteButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* EMPTY */

  emptyState: {
    minHeight: 240,
    borderRadius: 18,
    padding: 24,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(7,9,12,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: 1.2,
    color: colors.textPrimary,
    marginTop: 14,
  },

  emptyDescription: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
    marginTop: 5,
  },

  bottomSpace: {
    height: 34,
  },

  pressed: {
    opacity: 0.65,
  },
});