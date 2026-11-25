import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { colors } from '../../constants';
import { supabase } from '../../lib/supabase';

const brandIcon = require('../../../assets/branding/ugerod-icon.png');
const STORAGE_PREFIX = 'ugerod_product_onboarding_v1';

const SLIDES = [
  {
    key: 'welcome',
    eyebrow: 'BIENVENUE DANS UGEROD',
    title: 'DÉCOUVRE TON COACH UGEROD.',
    body: 'UGEROD construit tes séances, suit ce que tu fais réellement et affine progressivement le contexte utilisé pour la suite.',
    visual: 'welcome',
  },
  {
    key: 'adapt',
    eyebrow: 'AVANT CHAQUE SÉANCE',
    title: 'UNE SÉANCE QUI S’ADAPTE À TOI.',
    body: 'Temps, matériel, forme, gêne et préférence du jour : ton contexte réel sert à adapter la séance avant de la lancer.',
    visual: 'adapt',
  },
  {
    key: 'session',
    eyebrow: 'PENDANT L’ENTRAÎNEMENT',
    title: 'ENTRAÎNE-TOI. UGEROD S’OCCUPE DU RESTE.',
    body: 'Warm-up, Core, Skill & Force, WOD : suis chaque bloc, utilise les timers, valide ou remplace un mouvement si besoin.',
    visual: 'session',
  },
  {
    key: 'learning',
    eyebrow: 'APRÈS CHAQUE SÉANCE',
    title: 'CHAQUE SÉANCE ENRICHIT TON PROFIL.',
    body: 'Reps, charges, RPE, ressenti et mouvements réalisés donnent à UGEROD plus de contexte pour calibrer tes prochaines séances.',
    visual: 'learning',
  },
  {
    key: 'history',
    eyebrow: 'TON SUIVI',
    title: 'TOUT TON HISTORIQUE, AU MÊME ENDROIT.',
    body: 'Calendrier, séances réalisées, régularité et progression : retrouve ton activité et son évolution en un coup d’œil.',
    visual: 'history',
  },
  {
    key: 'records',
    eyebrow: 'TES VRAIES PERFORMANCES',
    title: 'TES PERFORMANCES RESTENT TES RÉFÉRENCES.',
    body: 'Ajoute un PR ou une séance faite ailleurs. UGEROD distingue toujours tes performances réelles de ses estimations.',
    visual: 'records',
  },
];

async function getStorageKey() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id
    ? `${STORAGE_PREFIX}:${user.id}`
    : STORAGE_PREFIX;
}

export default function ProductOnboardingModal() {
  const { width } = useWindowDimensions();
  const scrollRef = useRef(null);
  const storageKeyRef = useRef(STORAGE_PREFIX);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let active = true;

    async function checkFirstConnection() {
      try {
        const key = await getStorageKey();
        storageKeyRef.current = key;
        const completed = await AsyncStorage.getItem(key);

        if (active && completed !== '1') {
          setVisible(true);
        }
      } catch (error) {
        console.warn('Product onboarding check', error);
      }
    }

    checkFirstConnection();

    return () => {
      active = false;
    };
  }, []);

  async function completeOnboarding() {
    try {
      await AsyncStorage.setItem(storageKeyRef.current, '1');
    } catch (error) {
      console.warn('Product onboarding save', error);
    } finally {
      setVisible(false);
    }
  }

  function goNext() {
    if (index >= SLIDES.length - 1) {
      completeOnboarding();
      return;
    }

    const nextIndex = index + 1;
    setIndex(nextIndex);
    scrollRef.current?.scrollTo({
      x: width * nextIndex,
      animated: true,
    });
  }

  function handleScrollEnd(event) {
    const nextIndex = Math.round(
      event.nativeEvent.contentOffset.x / Math.max(width, 1)
    );
    setIndex(Math.max(0, Math.min(SLIDES.length - 1, nextIndex)));
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={completeOnboarding}
    >
      <View style={styles.screen}>
        <LinearGradient
          colors={['#080B0F', '#0B1016', '#080B0F']}
          locations={[0, 0.48, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.blueGlow} />
        <View style={styles.redGlow} />

        <SafeAreaView style={styles.safeArea}>
          <View style={styles.topBar}>
            <Image source={brandIcon} style={styles.logo} resizeMode="contain" />

            <Pressable
              onPress={completeOnboarding}
              hitSlop={10}
              style={({ pressed }) => [
                styles.skipButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.skipText}>PASSER</Text>
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onMomentumScrollEnd={handleScrollEnd}
          >
            {SLIDES.map((slide) => (
              <View key={slide.key} style={[styles.page, { width }]}>
                <View style={styles.visualArea}>
                  <OnboardingVisual type={slide.visual} />
                </View>

                <View style={styles.copyArea}>
                  <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
                  <Text style={styles.title}>{slide.title}</Text>
                  <Text style={styles.body}>{slide.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.dots}>
              {SLIDES.map((slide, dotIndex) => (
                <View
                  key={`dot-${slide.key}`}
                  style={[
                    styles.dot,
                    dotIndex === index && styles.dotActive,
                  ]}
                />
              ))}
            </View>

            <Pressable
              onPress={goNext}
              style={({ pressed }) => [
                styles.nextButton,
                pressed && styles.nextButtonPressed,
              ]}
            >
              <Text style={styles.nextText}>
                {index === SLIDES.length - 1
                  ? 'COMMENCER AVEC UGEROD'
                  : 'SUIVANT'}
              </Text>
              <Ionicons
                name={index === SLIDES.length - 1 ? 'checkmark' : 'arrow-forward'}
                size={19}
                color={colors.brandWhite}
              />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function OnboardingVisual({ type }) {
  if (type === 'adapt') return <AdaptVisual />;
  if (type === 'session') return <SessionVisual />;
  if (type === 'learning') return <LearningVisual />;
  if (type === 'history') return <HistoryVisual />;
  if (type === 'records') return <RecordsVisual />;
  return <WelcomeVisual />;
}

function VisualShell({ children }) {
  return (
    <View style={styles.visualShell}>
      <LinearGradient
        colors={['rgba(8,104,255,0.16)', 'rgba(8,104,255,0.02)']}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

function WelcomeVisual() {
  return (
    <VisualShell>
      <View style={styles.heroLogoCircle}>
        <Image source={brandIcon} style={styles.heroLogo} resizeMode="contain" />
      </View>

      <View style={styles.promiseGrid}>
        <MiniPromise icon="options-outline" label="S’ADAPTE" />
        <MiniPromise icon="analytics-outline" label="APPREND" />
        <MiniPromise icon="trending-up-outline" label="PROGRESSE" />
      </View>
    </VisualShell>
  );
}

function MiniPromise({ icon, label }) {
  return (
    <View style={styles.promiseItem}>
      <Ionicons name={icon} size={21} color={colors.primaryLight} />
      <Text style={styles.promiseLabel}>{label}</Text>
    </View>
  );
}

function AdaptVisual() {
  const items = [
    ['time-outline', '45 MIN'],
    ['barbell-outline', 'HALTÈRES'],
    ['pulse-outline', 'FORME 8/10'],
    ['body-outline', 'AUCUNE GÊNE'],
  ];

  return (
    <VisualShell>
      <View style={styles.mockHeader}>
        <Text style={styles.mockEyebrow}>CHECK-IN DU JOUR</Text>
        <View style={styles.mockStatusDot} />
      </View>

      <View style={styles.checkinGrid}>
        {items.map(([icon, label]) => (
          <View key={label} style={styles.checkinCard}>
            <Ionicons name={icon} size={22} color={colors.primaryLight} />
            <Text style={styles.checkinLabel}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.mockPrimaryBar}>
        <Text style={styles.mockPrimaryText}>ADAPTER MA SÉANCE</Text>
      </View>
    </VisualShell>
  );
}

function SessionVisual() {
  const blocks = [
    ['flame-outline', 'WARM-UP', '8 MIN'],
    ['timer-outline', 'CORE', '4 MIN'],
    ['barbell-outline', 'SKILL & FORCE', '15 MIN'],
    ['flash-outline', 'WOD', '18 MIN'],
  ];

  return (
    <VisualShell>
      <View style={styles.timerCircle}>
        <Text style={styles.timerValue}>12:36</Text>
        <Text style={styles.timerLabel}>SÉANCE EN COURS</Text>
      </View>

      <View style={styles.blockList}>
        {blocks.map(([icon, label, meta], blockIndex) => (
          <View key={label} style={styles.blockRow}>
            <View style={[styles.blockIcon, blockIndex === 2 && styles.blockIconActive]}>
              <Ionicons
                name={blockIndex < 2 ? 'checkmark' : icon}
                size={17}
                color={blockIndex < 2 ? colors.brandWhite : colors.primaryLight}
              />
            </View>
            <Text style={styles.blockLabel}>{label}</Text>
            <Text style={styles.blockMeta}>{meta}</Text>
          </View>
        ))}
      </View>
    </VisualShell>
  );
}

function LearningVisual() {
  return (
    <VisualShell>
      <View style={styles.learningTop}>
        <View>
          <Text style={styles.mockEyebrow}>PROFIL SPORTIF</Text>
          <Text style={styles.learningTitle}>UGEROD APPREND</Text>
        </View>
        <Ionicons name="sparkles-outline" size={28} color={colors.primaryLight} />
      </View>

      <View style={styles.signalList}>
        <SignalRow label="CHARGES & REPS" value="ENREGISTRÉ" progress={0.82} />
        <SignalRow label="RPE & RESSENTI" value="MIS À JOUR" progress={0.66} />
        <SignalRow label="MOUVEMENTS" value="OBSERVÉS" progress={0.74} />
      </View>

      <View style={styles.coachHint}>
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primaryLight} />
        <Text style={styles.coachHintText}>Plus de contexte pour la prochaine séance.</Text>
      </View>
    </VisualShell>
  );
}

function SignalRow({ label, value, progress }) {
  return (
    <View style={styles.signalRow}>
      <View style={styles.signalHeader}>
        <Text style={styles.signalLabel}>{label}</Text>
        <Text style={styles.signalValue}>{value}</Text>
      </View>
      <View style={styles.signalTrack}>
        <View style={[styles.signalFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

function HistoryVisual() {
  const days = [
    { day: 'L', done: true },
    { day: 'M', done: false },
    { day: 'M', done: true },
    { day: 'J', done: false },
    { day: 'V', done: true },
    { day: 'S', done: false },
    { day: 'D', done: false },
  ];

  return (
    <VisualShell>
      <View style={styles.mockHeader}>
        <View>
          <Text style={styles.mockEyebrow}>CETTE SEMAINE</Text>
          <Text style={styles.historyMonth}>AOÛT 2026</Text>
        </View>
        <Text style={styles.historyScore}>3/4</Text>
      </View>

      <View style={styles.historyWeek}>
        {days.map((item, dayIndex) => (
          <View key={`${item.day}-${dayIndex}`} style={styles.historyDay}>
            <Text style={styles.historyDayLabel}>{item.day}</Text>
            <View style={[styles.historyCircle, item.done && styles.historyCircleDone]}>
              {item.done ? (
                <Ionicons name="checkmark" size={16} color={colors.brandWhite} />
              ) : (
                <Text style={styles.historyDayNumber}>{11 + dayIndex}</Text>
              )}
            </View>
          </View>
        ))}
      </View>

      <View style={styles.historyStats}>
        <View style={styles.historyStat}>
          <Text style={styles.historyStatValue}>12</Text>
          <Text style={styles.historyStatLabel}>SÉANCES</Text>
        </View>
        <View style={styles.historyStatDivider} />
        <View style={styles.historyStat}>
          <Text style={styles.historyStatValue}>3</Text>
          <Text style={styles.historyStatLabel}>SEMAINES OBJECTIF</Text>
        </View>
      </View>
    </VisualShell>
  );
}

function RecordsVisual() {
  return (
    <VisualShell>
      <View style={styles.recordHero}>
        <View style={styles.trophyCircle}>
          <Ionicons name="trophy-outline" size={32} color={colors.brandRed} />
        </View>
        <View>
          <Text style={styles.mockEyebrow}>CARNET DE PR</Text>
          <Text style={styles.recordExercise}>BACK SQUAT</Text>
        </View>
      </View>

      <View style={styles.recordRows}>
        <RecordRow label="1RM" value="120 KG" source="CONFIRMÉ" />
        <RecordRow label="5RM" value="100 KG" source="OBSERVÉ" />
        <RecordRow label="10RM" value="~82 KG" source="ESTIMÉ" muted />
      </View>

      <View style={styles.externalRow}>
        <Ionicons name="add-circle-outline" size={20} color={colors.primaryLight} />
        <Text style={styles.externalText}>AJOUTER UNE SÉANCE RÉALISÉE AILLEURS</Text>
      </View>
    </VisualShell>
  );
}

function RecordRow({ label, value, source, muted = false }) {
  return (
    <View style={styles.recordRow}>
      <View>
        <Text style={styles.recordLabel}>{label}</Text>
        <Text style={[styles.recordSource, muted && styles.recordSourceMuted]}>{source}</Text>
      </View>
      <Text style={[styles.recordValue, muted && styles.recordValueMuted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#080B0F',
  },
  safeArea: {
    flex: 1,
  },
  blueGlow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    right: -120,
    top: 70,
    backgroundColor: 'rgba(8,104,255,0.10)',
  },
  redGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    left: -110,
    bottom: 80,
    backgroundColor: 'rgba(255,59,59,0.045)',
  },
  topBar: {
    minHeight: 66,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    width: 42,
    height: 42,
  },
  skipButton: {
    minHeight: 36,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  page: {
    flex: 1,
    paddingHorizontal: 20,
  },
  visualArea: {
    flex: 1.15,
    justifyContent: 'center',
    paddingTop: 8,
  },
  visualShell: {
    minHeight: 285,
    borderRadius: 28,
    overflow: 'hidden',
    padding: 22,
    backgroundColor: 'rgba(17,21,26,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    justifyContent: 'center',
  },
  copyArea: {
    flex: 0.78,
    justifyContent: 'center',
    paddingBottom: 8,
  },
  eyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.3,
    color: colors.primaryLight,
  },
  title: {
    marginTop: 9,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 35,
    lineHeight: 38,
    letterSpacing: 1.2,
    color: colors.textPrimary,
  },
  body: {
    marginTop: 12,
    maxWidth: 540,
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  footer: {
    minHeight: 112,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  dots: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  dotActive: {
    width: 20,
    backgroundColor: colors.primaryLight,
  },
  nextButton: {
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: 18,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  nextButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },
  nextText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 18,
    letterSpacing: 1,
    color: colors.brandWhite,
  },
  pressed: {
    opacity: 0.68,
  },
  heroLogoCircle: {
    width: 126,
    height: 126,
    borderRadius: 63,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,104,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.28)',
  },
  heroLogo: {
    width: 88,
    height: 88,
  },
  promiseGrid: {
    marginTop: 30,
    flexDirection: 'row',
    gap: 9,
  },
  promiseItem: {
    flex: 1,
    minHeight: 74,
    borderRadius: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  promiseLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.7,
    color: colors.textSecondary,
  },
  mockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mockEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.9,
    color: colors.textMuted,
  },
  mockStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.brandRed,
  },
  checkinGrid: {
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  checkinCard: {
    width: '48%',
    minHeight: 86,
    borderRadius: 17,
    padding: 13,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  checkinLabel: {
    marginTop: 10,
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.5,
    color: colors.textPrimary,
  },
  mockPrimaryBar: {
    minHeight: 42,
    marginTop: 17,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  mockPrimaryText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 14,
    letterSpacing: 0.9,
    color: colors.brandWhite,
  },
  timerCircle: {
    width: 118,
    height: 118,
    borderRadius: 59,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,104,255,0.10)',
    borderWidth: 2,
    borderColor: 'rgba(8,104,255,0.48)',
  },
  timerValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 30,
    letterSpacing: 1.5,
    color: colors.textPrimary,
  },
  timerLabel: {
    marginTop: 2,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 8,
    letterSpacing: 0.7,
    color: colors.textMuted,
  },
  blockList: {
    marginTop: 18,
    gap: 7,
  },
  blockRow: {
    minHeight: 38,
    borderRadius: 11,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  blockIcon: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,104,255,0.08)',
  },
  blockIconActive: {
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.28)',
  },
  blockLabel: {
    flex: 1,
    marginLeft: 9,
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.5,
    color: colors.textPrimary,
  },
  blockMeta: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 8,
    letterSpacing: 0.5,
    color: colors.textMuted,
  },
  learningTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  learningTitle: {
    marginTop: 4,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 25,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  signalList: {
    marginTop: 22,
    gap: 16,
  },
  signalRow: {
    gap: 7,
  },
  signalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  signalLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },
  signalValue: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.5,
    color: colors.primaryLight,
  },
  signalTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  signalFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  coachHint: {
    marginTop: 22,
    minHeight: 46,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(8,104,255,0.07)',
  },
  coachHintText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textSecondary,
  },
  historyMonth: {
    marginTop: 3,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  historyScore: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 27,
    color: colors.primaryLight,
  },
  historyWeek: {
    minHeight: 88,
    marginTop: 19,
    borderRadius: 16,
    paddingHorizontal: 5,
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  historyDay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  historyDayLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 8,
    color: colors.textMuted,
  },
  historyCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCircleDone: {
    backgroundColor: colors.primary,
  },
  historyDayNumber: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    color: colors.textSecondary,
  },
  historyStats: {
    minHeight: 72,
    marginTop: 18,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  historyStat: {
    flex: 1,
    alignItems: 'center',
  },
  historyStatValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 25,
    color: colors.textPrimary,
  },
  historyStatLabel: {
    marginTop: 1,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 7,
    letterSpacing: 0.4,
    color: colors.textMuted,
  },
  historyStatDivider: {
    width: 1,
    height: 38,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  recordHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  trophyCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,59,59,0.08)',
  },
  recordExercise: {
    marginTop: 3,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 25,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  recordRows: {
    marginTop: 18,
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  recordRow: {
    minHeight: 52,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  recordLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },
  recordSource: {
    marginTop: 2,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 7,
    letterSpacing: 0.5,
    color: colors.primaryLight,
  },
  recordSourceMuted: {
    color: colors.textMuted,
  },
  recordValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    letterSpacing: 0.8,
    color: colors.textPrimary,
  },
  recordValueMuted: {
    color: colors.textSecondary,
  },
  externalRow: {
    minHeight: 46,
    marginTop: 15,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(8,104,255,0.07)',
  },
  externalText: {
    flex: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.45,
    color: colors.textSecondary,
  },
});