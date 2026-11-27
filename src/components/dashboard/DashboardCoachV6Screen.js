import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect, useSegments } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useUgerodTheme } from '../../contexts/UgerodThemeContext';
import { useWorkout } from '../../contexts/WorkoutContext';
import dashboardDarkHero from '../../assets/dashboard-dark-hero';
import { getCurrentProfile } from '../../services/profileService';
import { getDashboardSnapshot, getLocalDateKey, getWeekReadContract, getTodayCompletedSessions } from '../../services/weeklyPlanService';
import { reloadWorkoutSession } from '../../services/workoutService';
import DashboardHistoryCalendarCoach from './DashboardHistoryCalendarCoach';
import { getRoutineDay } from '../../services/routineService';

const darkBrandIcon = require('../../../assets/branding/ugerod-icon.png');
const lightBrandIcon = require('../../../assets/branding/LOGO VERSION NOIR.png');

const lightCoachPhoto = require('../../../assets/branding/D63D5DFF-3FC3-4338-8B37-0394114880F6.jpeg');
const lightBuildPhoto = require('../../../assets/branding/F5F16BEB-9979-4D87-B8E1-4D40B66EB361.jpeg');
const lightActivityPhoto = require('../../../assets/branding/mohamed-fareed-rbSNsoXk-3A-unsplash.jpg');
const darkBuildPhoto = require('../../../assets/branding/nexa-black-gu4bdVTq0CU-unsplash.jpg');
const darkActivityPhoto = require('../../../assets/branding/victor-freitas-WvDYdXDzkhs-unsplash.jpg');

const DAY_LABELS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];

const DARK_PALETTE = {
  background: '#0A0E0C',
  surface: '#111713',
  surfaceElevated: '#151D17',
  text: '#F4F5F1',
  textSecondary: '#C9D0C6',
  textMuted: '#8F998E',
  textOnAccent: '#FFFFFF',
  border: 'rgba(173,184,170,0.16)',
  accent: '#646F5E',
  accentSoft: 'rgba(100,111,94,0.15)',
  accentBorder: 'rgba(144,156,137,0.34)',
  orange: '#FF6B19',
  orangeSoft: 'rgba(255,107,25,0.08)',
  heroFade: '#0A0E0C',
};

const LIGHT_PALETTE = {
  background: '#F4F2ED',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  text: '#1D211C',
  textSecondary: '#5F655C',
  textMuted: '#81877E',
  textOnAccent: '#FFFFFF',
  border: 'rgba(54,61,52,0.13)',
  accent: '#646F5E',
  accentSoft: 'rgba(100,111,94,0.11)',
  accentBorder: 'rgba(100,111,94,0.28)',
  orange: '#FF6B19',
  orangeSoft: 'rgba(255,107,25,0.08)',
  heroFade: '#F4F2ED',
};

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey ?? '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getMonday(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  return result;
}

function createFallbackWeek() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = getMonday(today);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    date.setHours(0, 0, 0, 0);

    return {
      key: formatDateKey(date),
      day: DAY_LABELS[date.getDay()],
      date: String(date.getDate()).padStart(2, '0'),
      completed: false,
      sessionId: null,
      today: formatDateKey(date) === formatDateKey(today),
    };
  });
}

function createCurrentWeek(weekDays) {
  if (!Array.isArray(weekDays) || weekDays.length !== 7) return createFallbackWeek();
  const todayKey = formatDateKey(new Date());

  return weekDays.map((item) => {
    const date = parseDateKey(item?.date);
    return {
      key: item?.date ?? `day-${Math.random()}`,
      day: date ? DAY_LABELS[date.getDay()] : '',
      date: date ? String(date.getDate()).padStart(2, '0') : '--',
      completed: Boolean(item?.completed),
      sessionId: item?.session_id ?? null,
      today: item?.date === todayKey,
    };
  });
}

function CoachMessage({ headline, note, styles, palette }) {
  return (
    <View style={styles.coachMessage}>
      <View style={styles.coachRail} />
      <View style={styles.coachCopy}>
        <View style={styles.coachLabelRow}>
          <Ionicons name="chatbubble-ellipses-outline" size={14} color={palette.accent} />
          <Text style={styles.coachLabel}>{headline}</Text>
        </View>
        <Text style={styles.coachText}>{note}</Text>
      </View>
    </View>
  );
}

function ContextualSlot({ learning, styles, palette }) {
  if (!learning?.visible) return null;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/(tabs)/progression')}
      style={({ pressed }) => [styles.contextSlot, pressed && styles.pressed]}
    >
      <View style={styles.contextIcon}>
        <Ionicons name="sparkles-outline" size={19} color={palette.accent} />
      </View>
      <View style={styles.contextCopy}>
        <Text style={styles.contextEyebrow}>CE QUI COMPTE EN CE MOMENT</Text>
        <Text style={styles.contextTitle}>
          {learning?.title ?? 'UGEROD APPREND À TE CONNAÎTRE'}
        </Text>
        <Text style={styles.contextText} numberOfLines={2}>
          {learning?.text ?? 'Chaque séance affine les prochaines décisions du Coach.'}
        </Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={palette.textMuted} />
    </Pressable>
  );
}

function PagerTrack({ activeIndex, onSelect, styles }) {
  return (
    <View style={styles.track} accessibilityRole="tablist" accessibilityLabel="Choisir une action">
      {[0, 1, 2].map((index) => (
        <Pressable
          key={index}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeIndex === index }}
          accessibilityLabel={
            index === 0
              ? 'Séance du Coach'
              : index === 1
                ? 'Ma semaine'
                : 'Ajouter une séance réalisée'
          }
          onPress={() => onSelect(index)}
          hitSlop={10}
          style={[
            styles.trackSegment,
            activeIndex === index ? styles.trackSegmentActive : styles.trackSegmentInactive,
          ]}
        />
      ))}
    </View>
  );
}

function HeroPhoto({ source, imageStyle, isDark, palette, styles }) {
  return (
    <View pointerEvents="none" style={styles.heroPhotoWrap}>
      <Image source={source} resizeMode="cover" style={[styles.heroPhoto, imageStyle]} />
      <LinearGradient
        colors={
          isDark
            ? ['rgba(10,14,12,0.95)', 'rgba(10,14,12,0.57)', 'rgba(10,14,12,0.06)']
            : ['rgba(244,242,237,0.985)', 'rgba(244,242,237,0.58)', 'rgba(244,242,237,0.025)']
        }
        locations={[0, 0.46, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(0,0,0,0)', palette.heroFade]}
        locations={[0.64, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function HeroPanel({
  width,
  photo,
  photoStyle,
  title,
  firstName,
  headline,
  note,
  ctaLabel,
  onPress,
  loading = false,
  showPrAction = false,
  isDark,
  palette,
  styles,
}) {
  const hasTitle = Boolean(title);

  return (
    <View style={[styles.heroPanel, { width }]}>
      <HeroPhoto
        source={photo}
        imageStyle={photoStyle}
        isDark={isDark}
        palette={palette}
        styles={styles}
      />

      <View
        style={[
          styles.heroPanelContent,
          hasTitle ? styles.heroPanelContentWithTitle : styles.heroPanelContentWithoutTitle,
        ]}
      >
        {hasTitle ? <Text style={styles.heroTitle}>{title}</Text> : null}

        <Text style={styles.greeting}>
          {firstName ? `Bonjour ${firstName}.` : 'Bonjour.'}
        </Text>

        <CoachMessage headline={headline} note={note} styles={styles} palette={palette} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          onPress={onPress}
          disabled={loading}
          style={({ pressed }) => [
            styles.primaryCta,
            pressed && !loading && styles.primaryCtaPressed,
            loading && styles.primaryCtaDisabled,
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={palette.textOnAccent} />
          ) : (
            <>
              <Text style={styles.primaryCtaText}>{ctaLabel}</Text>
              <Ionicons name="arrow-forward" size={22} color={palette.textOnAccent} />
            </>
          )}
        </Pressable>

        {showPrAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ajouter seulement un record ou PR"
            onPress={() => router.push('/progression/records?add=1')}
            style={({ pressed }) => [styles.prAction, pressed && styles.pressed]}
          >
            <Ionicons name="trophy-outline" size={17} color={palette.orange} />
            <Text style={styles.prActionText}>AJOUTER SEULEMENT UN PR</Text>
            <Ionicons name="arrow-forward" size={16} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function todaySessionLabel(value) {
  const labels={Strength:'Force',Conditioning:'Conditioning','General Fitness':'Entraînement',Upper:'Haut du corps',Lower:'Jambes',Back:'Dos',Core:'Abdos / gainage','Full Body':'Full body',HOME:'Maison',BOX:'Box',GYM:'Salle',OUTDOOR:'Extérieur'};
  return labels[value]??(value&&value!=='UNKNOWN'?String(value):null);
}

function buildTodaySessionRows(dateKey, items, completed) {
  const rows=[];
  const seenSessions=new Set();
  const seenPlans=new Set();
  const meta=(duration,environment)=>[Number(duration)>0?Number(duration)+' min':null,todaySessionLabel(environment)].filter(Boolean).join(' · ');
  for(const item of items??[]){
    if(item.recommendedDate!==dateKey||item.surfaceVisibility==='CONTEXT_ONLY'||!['PREVUE','PRETE','ACTIVE'].includes(item.displayState)||!item.planItemId||seenPlans.has(item.planItemId))continue;
    if(item.sessionId&&seenSessions.has(item.sessionId))continue;
    seenPlans.add(item.planItemId);
    if(item.sessionId)seenSessions.add(item.sessionId);
    const context=item.sessionSummary??item.plannedContext??{};
    rows.push({key:'plan:'+item.planItemId,planItemId:item.planItemId,sessionId:item.sessionId??null,
      state:item.displayState==='ACTIVE'?'active':'planned',hasComposerDraft:item.hasComposerDraft===true,
      title:item.composerTitle??item.coachProjection?.presentation?.title??[todaySessionLabel(context.focus),todaySessionLabel(context.targetRegion)].filter(Boolean).join(' · '),
      meta:meta(context.durationMinutes,context.plannedEnvironmentCode??context.environmentCode)});
  }
  const actualIds=new Set();
  const actual=[];
  for(const session of completed??[]){
    if(!session.id||actualIds.has(session.id))continue;
    actualIds.add(session.id);
    actual.push({key:'session:'+session.id,sessionId:session.id,state:'completed',
      title:[todaySessionLabel(session.focus),todaySessionLabel(session.target_region)].filter(Boolean).join(' · '),
      meta:meta(session.duration_minutes,session.actual_environment_code??session.planned_environment_code),
      time:session.completed_at??null});
  }
  // Actuals win over stale plan projections; never deduplicate by date or title.
  return [...actual,...rows.filter(row=>!row.sessionId||!actualIds.has(row.sessionId))];
}

export default function DashboardCoachV6Screen() {
  const segments = useSegments();
  const insideTabs = segments?.[0] === '(tabs)';
  const { width: viewportWidth } = useWindowDimensions();
  const pagerRef = useRef(null);
  const activePanelRef = useRef(0);

  const { isDark } = useUgerodTheme();
  const { setGeneratedWorkout } = useWorkout();

  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
  const panelWidth = Math.max(viewportWidth, 280);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;

  const [snapshot, setSnapshot] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [resuming, setResuming] = useState(false);
  const [activePanel, setActivePanel] = useState(0);
  const [todayRows, setTodayRows] = useState([]);
  const [routineRows,setRoutineRows]=useState([]);
  const [routineError,setRoutineError]=useState(false);
  const routineSequence=useRef(0);
  const todayReadSequence = useRef(0);
  const openingTodayRef = useRef(false);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const [data, profile] = await Promise.all([
        getDashboardSnapshot(),
        getCurrentProfile().catch(() => null),
      ]);
      setSnapshot(data);
      setFirstName(profile?.firstname?.trim() ?? '');
    } catch (loadError) {
      console.warn('Coach dashboard v6', loadError);
      setError(
        loadError instanceof Error ? loadError.message : 'Impossible de charger le dashboard.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTodayRows = useCallback(async () => {
    const sequence=++todayReadSequence.current;
    const anchorDate=new Date();
    const dateKey=getLocalDateKey(anchorDate);
    setTodayRows([]);
    const [plan,actual]=await Promise.allSettled([
      getWeekReadContract({anchorDate}),
      getTodayCompletedSessions(anchorDate),
    ]);
    if(sequence!==todayReadSequence.current||dateKey!==getLocalDateKey())return;
    if(plan.status==='rejected')console.warn('[Today] plan read',plan.reason);
    if(actual.status==='rejected')console.warn('[Today] actuals read',actual.reason);
    setTodayRows(buildTodaySessionRows(dateKey,plan.status==='fulfilled'?plan.value?.visibleItems:[],actual.status==='fulfilled'?actual.value:[]));
  }, []);

  const loadRoutineRows=useCallback(async()=>{
    const request=++routineSequence.current;const date=new Date();
    try{const rows=await getRoutineDay(date);if(request===routineSequence.current&&getLocalDateKey(date)===getLocalDateKey()){setRoutineRows(rows);setRoutineError(false);}}
    catch{if(request===routineSequence.current){setRoutineRows([]);setRoutineError(true);}}
  },[]);

  useFocusEffect(
    useCallback(() => {
      activePanelRef.current = 0;
      setActivePanel(0);
      pagerRef.current?.scrollTo?.({ x: 0, animated: false });
      loadDashboard();
      void loadTodayRows();
      void loadRoutineRows();
      return ()=>{todayReadSequence.current+=1;routineSequence.current+=1;};
    }, [loadDashboard,loadTodayRows,loadRoutineRows])
  );

  const week = useMemo(() => createCurrentWeek(snapshot?.weekDays), [snapshot?.weekDays]);
  const completedSessions = snapshot?.completedThisWeek ?? 0;
  const weeklyTarget = snapshot?.weeklyTarget ?? 0;
  const goalReached = weeklyTarget > 0 && completedSessions >= weeklyTarget;
  const learning = snapshot?.profileLearning ?? null;
  const activeSessionId = snapshot?.activeSessionToday?.sessionId ?? null;
  const hasActiveSessionToday = Boolean(activeSessionId);

  const coachNote =
    snapshot?.coachNote?.text ?? 'J’ai préparé quelque chose pour toi aujourd’hui.';
  const coachHeadline = snapshot?.coachNote?.headline ?? 'LE MOT DU COACH';
  const primaryLabel = hasActiveSessionToday ? 'REPRENDRE MA SÉANCE' : 'PRÉPARER MA SÉANCE';
  const heroTitle = hasActiveSessionToday ? 'ON CONTINUE ?' : 'PRÊT À\nT’ENTRAÎNER ?';

  const coachPhoto = isDark ? dashboardDarkHero : lightCoachPhoto;
  const buildPhoto = isDark ? darkBuildPhoto : lightBuildPhoto;
  const activityPhoto = isDark ? darkActivityPhoto : lightActivityPhoto;

  async function handlePrimaryAction() {
    if (!activeSessionId) {
      router.push('/workout/preparation');
      return;
    }

    try {
      setResuming(true);
      const restored = await reloadWorkoutSession({ sessionId: activeSessionId });
      setGeneratedWorkout(restored);
      router.push('/workout/session');
    } catch (resumeError) {
      console.warn('Coach dashboard resume session', resumeError);
      router.push('/workout/preparation');
    } finally {
      setResuming(false);
    }
  }

  async function handleTodayRowPress(item) {
    if(item.state==='completed'){router.push('/workout/'+item.sessionId);return;}
    if(openingTodayRef.current||resuming)return;
    // The existing active session has priority, including when another plan is selected.
    if(activeSessionId&&activeSessionId!==item.sessionId)return;
    if(item.sessionId){
      openingTodayRef.current=true;
      setResuming(true);
      try{
        const restored=await reloadWorkoutSession({sessionId:item.sessionId});
        setGeneratedWorkout(restored);
        router.push({pathname:'/workout/session',params:{sessionId:item.sessionId}});
      }catch(openError){console.warn('[Today] open session',openError);setError('Impossible d’ouvrir cette séance.');}
      finally{openingTodayRef.current=false;setResuming(false);}
      return;
    }
    const date=getLocalDateKey();
    router.push({pathname:'/workout/preparation',params:item.hasComposerDraft
      ?{date,planItemId:item.planItemId}
      :{entry:'week_assisted',date,origin:'week_edit',planItemId:item.planItemId}});
  }

  function handleCompletedDayPress(item) {
    if (!item.completed || !item.sessionId) return;
    router.push(`/workout/${item.sessionId}`);
  }

  function setPanelFromOffset(offsetX) {
    const nextIndex = Math.max(0, Math.min(2, Math.round(offsetX / panelWidth)));
    if (activePanelRef.current === nextIndex) return;
    activePanelRef.current = nextIndex;
    setActivePanel(nextIndex);
  }

  function goToPanel(index) {
    const safeIndex = Math.max(0, Math.min(2, index));
    activePanelRef.current = safeIndex;
    setActivePanel(safeIndex);
    pagerRef.current?.scrollTo?.({ x: safeIndex * panelWidth, animated: true });
  }

  function handlePagerScroll(event) {
    setPanelFromOffset(event?.nativeEvent?.contentOffset?.x ?? 0);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([loadDashboard(),loadTodayRows(),loadRoutineRows()]);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !snapshot) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color={palette.accent} />
        <Text style={styles.loadingText}>UGEROD PRÉPARE TON COACHING</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, insideTabs && styles.contentInsideTabs]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={palette.accent}
              colors={[palette.accent]}
              progressBackgroundColor={palette.surface}
            />
          }
        >
          <View style={styles.heroShell}>
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              bounces={false}
              snapToInterval={panelWidth}
              snapToAlignment="start"
              decelerationRate="fast"
              scrollEventThrottle={16}
              onScroll={handlePagerScroll}
              onScrollEndDrag={handlePagerScroll}
              onMomentumScrollEnd={handlePagerScroll}
              style={styles.heroPager}
            >
              <HeroPanel
                width={panelWidth}
                photo={coachPhoto}
                photoStyle={isDark ? styles.photoCoachDark : styles.photoCoachLight}
                title={heroTitle}
                firstName={firstName}
                headline={coachHeadline}
                note={coachNote}
                ctaLabel={primaryLabel}
                onPress={handlePrimaryAction}
                loading={resuming}
                isDark={isDark}
                palette={palette}
                styles={styles}
              />

              <HeroPanel
                width={panelWidth}
                photo={buildPhoto}
                photoStyle={isDark ? styles.photoBuildDark : styles.photoBuildLight}
                title={'TU VEUX PRENDRE\nLA MAIN ?'}
                firstName={firstName}
                headline="TA SEMAINE, D’UN COUP D’ŒIL"
                note="Vois ce qu’UGEROD envisage pour la semaine. Interviens seulement là où tu en as envie."
                ctaLabel="MA SEMAINE"
                onPress={() => router.push('/(tabs)/planning')}
                isDark={isDark}
                palette={palette}
                styles={styles}
              />

              <HeroPanel
                width={panelWidth}
                photo={activityPhoto}
                photoStyle={isDark ? styles.photoActivityDark : styles.photoActivityLight}
                title={'TU T’ES ENTRAÎNÉ\nAILLEURS ?'}
                firstName={firstName}
                headline="LE MOT DU COACH"
                note="Tu t’es entraîné ailleurs ? Enregistre ce que tu as réellement fait pour que je garde ton parcours et tes prochaines décisions à jour."
                ctaLabel="J’AI FAIT UNE SÉANCE"
                onPress={() => router.push('/workout/external')}
                showPrAction
                isDark={isDark}
                palette={palette}
                styles={styles}
              />
            </ScrollView>

            <View style={styles.heroTopRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ouvrir mon profil"
                onPress={() => router.push('/profile')}
                style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
              >
                <Ionicons name="person-outline" size={20} color={palette.text} />
              </Pressable>
              <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
            </View>

            <PagerTrack activeIndex={activePanel} onSelect={goToPanel} styles={styles} />
          </View>

          {todayRows.length>0 || routineRows.length>0 ? (
            <View style={styles.todaySessions}>
              <Text style={styles.todaySessionsTitle}>MON PROGRAMME DU JOUR</Text>
              <Text style={styles.todaySessionMeta}>{[todayRows.length?todayRows.filter(r=>r.state==='completed').length+'/'+todayRows.length+' séances':null,routineRows.length?routineRows.filter(r=>r.completed).length+'/'+routineRows.length+' routines':null].filter(Boolean).join(' · ')} · réalisées</Text>
              {todayRows.map(item=>{
                const done=item.state==='completed';
                const active=item.state==='active'||(!done&&Boolean(activeSessionId&&item.sessionId===activeSessionId));
                const disabled=!done&&(resuming||Boolean(activeSessionId&&activeSessionId!==item.sessionId));
                const time=done&&item.time?new Date(item.time).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):null;
                return (
                  <Pressable key={item.key} accessibilityRole="button" accessibilityState={{disabled}}
                    disabled={disabled} onPress={()=>handleTodayRowPress(item)}
                    style={({pressed})=>[styles.todaySessionRow,pressed&&styles.pressed]}>
                    <Ionicons name={done?'checkmark-circle-outline':active?'play-circle-outline':'calendar-outline'} size={22} color={done?palette.accent:palette.orange}/>
                    <View style={styles.todaySessionCopy}>
                      <Text style={styles.todaySessionName}>{item.title||'Séance'}</Text>
                      {item.meta?<Text style={styles.todaySessionMeta}>{item.meta}</Text>:null}
                    </View>
                    <Text style={[styles.todaySessionStatus,{color:done?palette.textMuted:palette.textSecondary}]}>{done?(time?'Réalisée · '+time:'Réalisée'):active?'En cours':'À venir'}</Text>
                    <Ionicons name="chevron-forward" size={16} color={palette.textMuted}/>
                  </Pressable>
                );
              })}
              {routineRows.map(item=>(
                <Pressable key={'routine:'+item.id} accessibilityRole="button" disabled={item.archived||Boolean(activeSessionId)} onPress={()=>router.push({pathname:'/routines',params:{routineId:item.id}})} style={({pressed})=>[styles.todaySessionRow,pressed&&styles.pressed]}>
                  <Ionicons name={item.completed?'checkmark-circle-outline':'repeat-outline'} size={22} color={item.completed?palette.accent:palette.orange}/>
                  <View style={styles.todaySessionCopy}><Text style={styles.todaySessionName}>{item.name}</Text><Text style={styles.todaySessionMeta}>Routine · {item.plannedMinutes} min prévues</Text></View>
                  <Text style={[styles.todaySessionStatus,{color:palette.textSecondary}]}>{item.active?'À reprendre':item.completed?'Réalisée':'À faire'}</Text>
                  <Ionicons name="chevron-forward" size={16} color={palette.textMuted}/>
                </Pressable>))}
            </View>
          ) : null}
          {routineError?<Pressable onPress={loadRoutineRows} style={styles.todaySessionRow}><Text style={styles.todaySessionMeta}>Routines non synchronisées · Réessayer</Text></Pressable>:null}

          <DashboardHistoryCalendarCoach
            week={week}
            completed={completedSessions}
            target={weeklyTarget}
            reached={goalReached}
            initialMonthSessions={snapshot?.monthSessions ?? []}
            onCompletedDayPress={handleCompletedDayPress}
            palette={palette}
          />

          <View style={styles.trainingSpace}>
            <Text style={styles.trainingSpaceTitle}>MON ESPACE D’ENTRAÎNEMENT</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Mes routines" onPress={()=>router.push('/routines')} style={({pressed})=>[styles.trainingCard,styles.trainingWide,pressed&&styles.pressed]}>
              <Image source={activityPhoto} resizeMode="cover" style={styles.trainingPhoto} accessible={false}/>
              <LinearGradient colors={['rgba(8,13,10,0.12)','rgba(8,13,10,0.62)','rgba(8,13,10,0.95)']} style={StyleSheet.absoluteFillObject}/>
              <View style={styles.trainingTop}><View style={styles.trainingIcon}><Ionicons name="repeat-outline" size={22} color="#FFFFFF"/></View><Ionicons name="arrow-up-outline" style={styles.trainingArrow} size={22} color={palette.orange}/></View>
              <View style={styles.trainingCardCopy}><Text style={styles.trainingEyebrow}>MES HABITUDES</Text><Text style={styles.trainingTitle}>Mes routines</Text><Text style={styles.trainingSubtitle}>Créer, répéter, entretenir.</Text></View>
            </Pressable>
            <View style={styles.trainingGrid}>
              <Pressable accessibilityRole="button" accessibilityLabel="Mes modèles" onPress={()=>router.push({pathname:'/(tabs)/library',params:{section:'models',importDate:'',group:''}})} style={({pressed})=>[styles.trainingCard,styles.trainingSmall,pressed&&styles.pressed]}>
                <Image source={buildPhoto} resizeMode="cover" style={styles.trainingPhoto} accessible={false}/>
                <LinearGradient colors={['rgba(8,13,10,0.16)','rgba(8,13,10,0.80)','rgba(8,13,10,0.98)']} style={StyleSheet.absoluteFillObject}/>
                <View style={styles.trainingTop}><View style={styles.trainingIcon}><Ionicons name="albums-outline" size={18} color="#FFFFFF"/></View><Ionicons name="arrow-up-outline" style={styles.trainingArrow} size={20} color={palette.orange}/></View>
                <View style={styles.trainingCardCopy}><Text style={styles.trainingTitleSmall}>Mes modèles</Text><Text style={styles.trainingSubtitle}>Mes séances à réutiliser</Text></View>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Programmes" onPress={()=>router.push('/(tabs)/programmes')} style={({pressed})=>[styles.trainingCard,styles.trainingSmall,pressed&&styles.pressed]}>
                <Image source={coachPhoto} resizeMode="cover" style={styles.trainingPhoto} accessible={false}/>
                <LinearGradient colors={['rgba(8,13,10,0.16)','rgba(8,13,10,0.80)','rgba(8,13,10,0.98)']} style={StyleSheet.absoluteFillObject}/>
                <View style={styles.trainingTop}><View style={styles.trainingIcon}><Ionicons name="trophy-outline" size={18} color="#FFFFFF"/></View><Ionicons name="arrow-up-outline" style={styles.trainingArrow} size={20} color={palette.orange}/></View>
                <View style={styles.trainingCardCopy}><Text style={styles.trainingTitleSmall}>Programmes</Text><Text style={styles.trainingSubtitle}>Mes objectifs sportifs</Text></View>
              </Pressable>
            </View>
          </View>
          <ContextualSlot learning={learning} styles={styles} palette={palette} />

          {error ? (
            <Pressable
              onPress={loadDashboard}
              style={({ pressed }) => [styles.inlineError, pressed && styles.pressed]}
            >
              <Ionicons name="cloud-offline-outline" size={17} color={palette.orange} />
              <Text style={styles.inlineErrorText}>
                Certaines données n’ont pas été synchronisées. Réessayer.
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function createStyles(p, isDark) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.background },
    safeArea: { flex: 1 },
    content: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 118 },
    contentInsideTabs: { paddingBottom: 34 },

    trainingSpace:{marginTop:20,marginBottom:20,gap:10},
    trainingSpaceTitle:{fontFamily:'BebasNeue_400Regular',fontSize:25,letterSpacing:0.8,color:p.text},
    trainingCard:{backgroundColor:'#151D17',borderRadius:16,overflow:'hidden',padding:14,justifyContent:'space-between',borderWidth:1,borderColor:p.border},
    trainingWide:{minHeight:172},
    trainingSmall:{flex:1,minWidth:0,minHeight:158,padding:12},
    trainingGrid:{flexDirection:'row',gap:10},
    trainingPhoto:{...StyleSheet.absoluteFillObject,width:'100%',height:'100%'},
    trainingTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
    trainingIcon:{width:38,height:38,borderRadius:12,backgroundColor:'rgba(15,23,17,0.72)',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'rgba(255,255,255,0.16)'},
    trainingArrow:{transform:[{rotate:'45deg'}]},
    trainingCardCopy:{gap:2,marginTop:10},
    trainingEyebrow:{fontFamily:'Manrope_700Bold',fontSize:10,letterSpacing:1.6,color:'#B6C5AE'},
    trainingTitle:{fontFamily:'BebasNeue_400Regular',fontSize:36,lineHeight:39,color:'#F4F5F1'},
    trainingTitleSmall:{fontFamily:'BebasNeue_400Regular',fontSize:25,lineHeight:28,color:'#F4F5F1'},
    trainingSubtitle:{fontFamily:'Manrope_500Medium',fontSize:12,lineHeight:17,color:'#D2D9CE'},
    todaySessions:{marginBottom:12},
    todaySessionsTitle:{fontFamily:'BebasNeue_400Regular',fontSize:25,letterSpacing:0.8,color:p.text,marginBottom:4},
    todaySessionRow:{minHeight:56,flexDirection:'row',alignItems:'center',gap:8,borderBottomWidth:1,borderBottomColor:p.border,paddingVertical:8},
    todaySessionCopy:{flex:1,gap:2},
    todaySessionName:{fontFamily:'Manrope_600SemiBold',fontSize:14,color:p.text},
    todaySessionMeta:{fontFamily:'Manrope_400Regular',fontSize:12,color:p.textMuted},
    todaySessionStatus:{fontFamily:'Manrope_600SemiBold',fontSize:10,textAlign:'right'},
    loadingScreen: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      backgroundColor: p.background,
    },
    loadingText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      letterSpacing: 1.1,
      color: p.textMuted,
    },

    heroShell: {
      marginHorizontal: -18,
      overflow: 'hidden',
      minHeight: 448,
      position: 'relative',
    },
    heroTopRow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 78,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      zIndex: 30,
    },
    profileButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(10,14,12,0.52)' : 'rgba(244,242,237,0.82)',
      borderWidth: 1,
      borderColor: p.accentBorder,
    },
    brandIcon: { width: 46, height: 46 },

    track: {
      position: 'absolute',
      top: 92,
      left: 38,
      zIndex: 30,
      height: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    trackSegment: { height: 3, borderRadius: 2 },
    trackSegmentActive: { width: 50, backgroundColor: p.orange },
    trackSegmentInactive: {
      width: 28,
      backgroundColor: isDark ? 'rgba(144,156,137,0.28)' : 'rgba(100,111,94,0.22)',
    },

    heroPager: { minHeight: 448 },
    heroPanel: {
      minHeight: 448,
      position: 'relative',
      overflow: 'hidden',
      paddingHorizontal: 38,
      paddingBottom: 14,
    },
    heroPhotoWrap: {
      position: 'absolute',
      top: 0,
      right: -6,
      width: '66%',
      height: 418,
      overflow: 'hidden',
    },
    heroPhoto: { width: '100%', height: '100%' },

    photoCoachLight: { transform: [{ scale: 1.03 }, { translateX: 4 }, { translateY: 1 }] },
    photoCoachDark: { transform: [{ scale: 1.06 }, { translateX: 2 }, { translateY: 0 }] },
    photoBuildLight: { transform: [{ scale: 1.08 }, { translateX: 8 }, { translateY: -6 }] },
    photoBuildDark: { transform: [{ scale: 1.04 }, { translateX: 5 }, { translateY: -2 }] },
    photoActivityLight: { transform: [{ scale: 1.05 }, { translateX: 8 }, { translateY: -2 }] },
    photoActivityDark: { transform: [{ scale: 1.08 }, { translateX: 4 }, { translateY: -4 }] },

    heroPanelContent: {
      width: '80%',
      zIndex: 2,
    },
    heroPanelContentWithTitle: { paddingTop: 118 },
    heroPanelContentWithoutTitle: { paddingTop: 150 },
    heroTitle: {
      maxWidth: '82%',
      marginBottom: 14,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 40,
      lineHeight: 41,
      letterSpacing: 0.7,
      color: p.text,
    },
    greeting: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 15,
      lineHeight: 21,
      color: p.text,
      marginBottom: 12,
    },

    coachMessage: {
      minHeight: 100,
      flexDirection: 'row',
      alignItems: 'stretch',
      paddingVertical: 6,
      marginBottom: 14,
    },
    coachRail: {
      width: 2,
      marginRight: 13,
      borderRadius: 1,
      backgroundColor: p.accent,
    },
    coachCopy: { flex: 1 },
    coachLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    coachLabel: {
      flex: 1,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      lineHeight: 13,
      letterSpacing: 1.15,
      color: p.accent,
      textTransform: 'uppercase',
    },
    coachText: {
      marginTop: 7,
      fontFamily: 'Manrope_500Medium',
      fontSize: 15,
      lineHeight: 22,
      color: p.text,
    },

    primaryCta: {
      minHeight: 62,
      paddingHorizontal: 22,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: 17,
      backgroundColor: p.accent,
      shadowColor: '#000000',
      shadowOpacity: isDark ? 0.14 : 0.1,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    primaryCtaPressed: { transform: [{ scale: 0.992 }], opacity: 0.94 },
    primaryCtaDisabled: { opacity: 0.65 },
    primaryCtaText: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 23,
      lineHeight: 27,
      letterSpacing: 1.05,
      color: p.textOnAccent,
    },

    prAction: {
      minHeight: 38,
      marginTop: 7,
      paddingHorizontal: 5,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    prActionText: {
      flex: 1,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      letterSpacing: 0.8,
      color: p.textSecondary,
    },

    contextSlot: {
      minHeight: 96,
      marginTop: 14,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: p.border,
    },
    contextIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.accentSoft,
    },
    contextCopy: { flex: 1 },
    contextEyebrow: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 8,
      lineHeight: 12,
      letterSpacing: 1.15,
      color: p.textMuted,
    },
    contextTitle: {
      marginTop: 4,
      fontFamily: 'Manrope_700Bold',
      fontSize: 13,
      lineHeight: 18,
      color: p.text,
    },
    contextText: {
      marginTop: 4,
      fontFamily: 'Manrope_400Regular',
      fontSize: 12,
      lineHeight: 17,
      color: p.textMuted,
    },

    inlineError: {
      marginTop: 18,
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: p.orangeSoft,
      borderWidth: 1,
      borderColor: 'rgba(255,107,25,0.25)',
    },
    inlineErrorText: {
      flex: 1,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      color: p.textSecondary,
    },
    pressed: { opacity: 0.72 },
  });
}
