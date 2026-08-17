import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing } from '../src/constants';

const backgroundImage = require('../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../assets/branding/ugerod-icon.png');

const PROGRAMS = [
  {
    id: 'first-pullup',
    category: 'SKILL',
    title: 'PREMIÈRE TRACTION',
    description: 'Construis la force et la technique nécessaires pour décrocher ta première traction stricte.',
    weeks: '6 SEMAINES',
    frequency: '3× / SEM.',
    level: 'DÉBUTANT',
    equipment: 'BARRE DE TRACTION',
    icon: 'body-outline',
    accent: 'blue',
    recommended: true,
    locked: true,
  },
  {
    id: 'kettlebell-foundations',
    category: 'FORCE',
    title: 'KETTLEBELL FOUNDATIONS',
    description: 'Maîtrise les mouvements essentiels et construis une base solide de force fonctionnelle.',
    weeks: '6 SEMAINES',
    frequency: '3× / SEM.',
    level: 'INTERMÉDIAIRE',
    equipment: 'KETTLEBELL',
    icon: 'barbell-outline',
    accent: 'red',
    recommended: true,
    locked: true,
  },
  {
    id: 'handstand',
    category: 'SKILL',
    title: 'HANDSTAND',
    description: 'Développe contrôle, gainage et confiance pour progresser vers un équilibre solide.',
    weeks: '8 SEMAINES',
    frequency: '3× / SEM.',
    level: 'INTERMÉDIAIRE',
    equipment: 'POIDS DU CORPS',
    icon: 'accessibility-outline',
    accent: 'blue',
    recommended: false,
    locked: true,
  },
  {
    id: 'engine-builder',
    category: 'CONDITIONING',
    title: 'ENGINE BUILDER',
    description: 'Améliore ta capacité à tenir l’effort et à mieux gérer les séances longues et intenses.',
    weeks: '6 SEMAINES',
    frequency: '3× / SEM.',
    level: 'TOUS NIVEAUX',
    equipment: 'MULTI-MATÉRIEL',
    icon: 'pulse-outline',
    accent: 'red',
    recommended: false,
    locked: true,
  },
  {
    id: 'shoulder-mobility',
    category: 'MOBILITÉ',
    title: 'ÉPAULES MOBILES',
    description: 'Travaille mobilité, contrôle et stabilité pour bouger plus librement au-dessus de la tête.',
    weeks: '4 SEMAINES',
    frequency: '4× / SEM.',
    level: 'TOUS NIVEAUX',
    equipment: 'ÉLASTIQUE',
    icon: 'fitness-outline',
    accent: 'blue',
    recommended: false,
    locked: true,
  },
];

function ProgramCard({ program }) {
  const isRed = program.accent === 'red';

  return (
    <Pressable
      disabled
      accessibilityRole="button"
      accessibilityState={{ disabled: true }}
      style={styles.programCard}
    >
      <View style={styles.visual}>
        <LinearGradient
          colors={
            isRed
              ? ['rgba(255,59,59,0.30)', 'rgba(20,13,15,0.70)', 'rgba(9,12,16,0.96)']
              : ['rgba(8,104,255,0.34)', 'rgba(10,19,34,0.72)', 'rgba(9,12,16,0.96)']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <View
          style={[
            styles.visualGlow,
            isRed ? styles.visualGlowRed : styles.visualGlowBlue,
          ]}
        />
        <View style={styles.visualRingLarge} />
        <View style={styles.visualRingSmall} />

        <Ionicons
          name={program.icon}
          size={108}
          color="rgba(247,249,252,0.92)"
          style={styles.heroIcon}
        />

        <View style={styles.categoryBadge}>
          <Text style={styles.categoryBadgeText}>{program.category}</Text>
        </View>

        {program.locked && (
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={13} color={colors.brandWhite} />
            <Text style={styles.lockBadgeText}>PREMIUM</Text>
          </View>
        )}
      </View>

      <View style={styles.programBody}>
        <Text style={styles.programTitle}>{program.title}</Text>
        <Text style={styles.programDescription}>{program.description}</Text>

        <View style={styles.metaGrid}>
          <Meta icon="calendar-outline" text={program.weeks} />
          <Meta icon="repeat-outline" text={program.frequency} />
          <Meta icon="speedometer-outline" text={program.level} />
          <Meta icon="barbell-outline" text={program.equipment} />
        </View>

        <View style={styles.lockedFooter}>
          <Text style={styles.lockedFooterText}>DÉCOUVRIR LE PROGRAMME</Text>
          <View style={styles.lockCircle}>
            <Ionicons name="lock-closed" size={14} color={colors.textSecondary} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function Meta({ icon, text }) {
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={14} color={colors.textMuted} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

function SectionTitle({ eyebrow, title }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

export default function ProgramsScreen() {
  const recommended = PROGRAMS.filter((program) => program.recommended);
  const catalog = PROGRAMS.filter((program) => !program.recommended);

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={backgroundImage}
        resizeMode="cover"
        style={styles.background}
      >
        <View style={styles.darkOverlay} />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.46)',
            'rgba(7,9,12,0.72)',
            'rgba(7,9,12,0.96)',
            'rgba(7,9,12,1)',
          ]}
          locations={[0, 0.22, 0.48, 1]}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <Pressable
                onPress={() => router.back()}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.backButton,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name="arrow-back"
                  size={21}
                  color={colors.textPrimary}
                />
              </Pressable>

              <View style={styles.headerText}>
                <Text style={styles.headerEyebrow}>BOOTCAMPS UGEROD</Text>
                <Text style={styles.headerTitle}>
                  PROGRAMMES
                  <Text style={styles.blueDot}>.</Text>
                </Text>
              </View>

              <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
            </View>

            <View style={styles.intro}>
              <Text style={styles.introTitle}>
                UN OBJECTIF.{`\n`}UN PROGRAMME DÉDIÉ.
              </Text>
              <Text style={styles.introText}>
                Choisis un parcours ciblé de plusieurs semaines pour développer une compétence, une qualité physique ou un mouvement précis.
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
            >
              {['POUR TOI', 'SKILLS', 'FORCE', 'CONDITIONING', 'MOBILITÉ'].map(
                (label, index) => (
                  <View
                    key={label}
                    style={[styles.filterChip, index === 0 && styles.filterChipActive]}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        index === 0 && styles.filterTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                )
              )}
            </ScrollView>

            <SectionTitle eyebrow="SÉLECTION UGEROD" title="POUR TOI" />
            <Text style={styles.sectionDescription}>
              À terme, cette sélection s’adaptera à ton niveau, ton matériel, tes objectifs et tes axes de progression.
            </Text>

            <View style={styles.programList}>
              {recommended.map((program) => (
                <ProgramCard key={program.id} program={program} />
              ))}
            </View>

            <SectionTitle eyebrow="EXPLORER" title="TOUS LES PROGRAMMES" />

            <View style={styles.programList}>
              {catalog.map((program) => (
                <ProgramCard key={program.id} program={program} />
              ))}
            </View>

            <View style={styles.comingSoonCard}>
              <View style={styles.comingSoonIcon}>
                <Ionicons name="add" size={22} color={colors.primaryLight} />
              </View>
              <View style={styles.comingSoonMain}>
                <Text style={styles.comingSoonTitle}>D’AUTRES PROGRAMMES ARRIVENT</Text>
                <Text style={styles.comingSoonText}>
                  Skills, force, mobilité, conditioning et parcours spécialisés.
                </Text>
              </View>
            </View>
          </ScrollView>
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
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4,6,9,0.60)',
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 8,
    paddingBottom: 48,
  },
  header: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,21,26,0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  pressed: {
    opacity: 0.74,
  },
  headerText: {
    flex: 1,
  },
  headerEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.2,
    color: colors.brandRed,
  },
  headerTitle: {
    marginTop: 1,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 30,
    lineHeight: 32,
    letterSpacing: 1.4,
    color: colors.textPrimary,
  },
  blueDot: {
    color: colors.primary,
  },
  brandIcon: {
    width: 34,
    height: 34,
    opacity: 0.94,
  },
  intro: {
    marginTop: 18,
    marginBottom: 22,
  },
  introTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 39,
    lineHeight: 41,
    letterSpacing: 1.5,
    color: colors.textPrimary,
  },
  introText: {
    marginTop: 9,
    maxWidth: 345,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  filters: {
    gap: 8,
    paddingRight: 18,
    paddingBottom: 4,
  },
  filterChip: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,21,26,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  filterChipActive: {
    backgroundColor: 'rgba(8,104,255,0.16)',
    borderColor: 'rgba(29,140,255,0.40)',
  },
  filterText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.7,
    color: colors.textMuted,
  },
  filterTextActive: {
    color: colors.primaryLight,
  },
  sectionHeading: {
    marginTop: 30,
    marginBottom: 2,
  },
  sectionEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 1.1,
    color: colors.brandRed,
  },
  sectionTitle: {
    marginTop: 2,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 28,
    lineHeight: 31,
    letterSpacing: 1.2,
    color: colors.textPrimary,
  },
  sectionDescription: {
    marginTop: 4,
    marginBottom: 12,
    maxWidth: 340,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  programList: {
    gap: 16,
    marginTop: 10,
  },
  programCard: {
    overflow: 'hidden',
    borderRadius: 20,
    backgroundColor: 'rgba(17,21,26,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  visual: {
    height: 205,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  visualGlow: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    opacity: 0.33,
    right: -58,
    bottom: -95,
  },
  visualGlowBlue: {
    backgroundColor: colors.primary,
  },
  visualGlowRed: {
    backgroundColor: colors.brandRed,
  },
  visualRingLarge: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    left: -56,
    top: -76,
  },
  visualRingSmall: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    right: 28,
    top: 20,
  },
  heroIcon: {
    transform: [{ rotate: '-8deg' }],
  },
  categoryBadge: {
    position: 'absolute',
    left: 15,
    top: 14,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(7,9,12,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.11)',
  },
  categoryBadgeText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1,
    color: colors.brandWhite,
  },
  lockBadge: {
    position: 'absolute',
    right: 14,
    top: 14,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(7,9,12,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  lockBadgeText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.9,
    color: colors.brandWhite,
  },
  programBody: {
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 16,
  },
  programTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 29,
    lineHeight: 31,
    letterSpacing: 1.2,
    color: colors.textPrimary,
  },
  programDescription: {
    marginTop: 5,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  metaGrid: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
    columnGap: 10,
  },
  metaItem: {
    minWidth: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    flexShrink: 1,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.45,
    color: colors.textSecondary,
  },
  lockedFooter: {
    marginTop: 17,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lockedFooterText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.75,
    color: colors.textMuted,
  },
  lockCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  comingSoonCard: {
    marginTop: 22,
    minHeight: 84,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: 'rgba(17,21,26,0.74)',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  comingSoonIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,104,255,0.10)',
  },
  comingSoonMain: {
    flex: 1,
  },
  comingSoonTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },
  comingSoonText: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textSecondary,
  },
});
