import ExerciseName from '../exercises/ExerciseName';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useUgerodTheme } from '../../contexts/UgerodThemeContext';
import { fontFamilies } from '../../constants/typography';
import { skillElapsed, skillExecutionUnits, skillExecutionUpdates } from '../../utils/composerSkillExecution';

export default function ComposerSkillPlayer({ exercises, runtime, onRuntimeChange, onComplete, onActiveExerciseChange, executionEnabled, blockType = 'skill', blockSets = null, blockRestSeconds = null }) {
  const { colors } = useUgerodTheme();
  const [now, setNow] = useState(Date.now());
  const [details, setDetails] = useState(false);
  const plan = useMemo(() => { try { return { units: skillExecutionUnits(exercises, { sets: blockSets, restSeconds: blockRestSeconds, rounds: blockType === 'warmup' }) }; } catch (error) { return { error: error.message, units: [] }; } }, [exercises, blockSets, blockRestSeconds, blockType]);
  const state = { index: 0, results: {}, elapsedSeconds: 0, runningSince: null, restUntil: null, ...(runtime ?? {}) };
  const unit = plan.units[state.index ?? 0];
  const confirmation = useRef(null);
  const completion = useRef(false);
  const elapsed = unit?.seconds ? Math.min(unit.seconds, skillElapsed(state, now)) : skillElapsed(state, now);
  const resting = state.restUntil && now < state.restUntil;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (unit) onActiveExerciseChange?.(unit.exercise, exercises.findIndex((e) => e.sessionExerciseId === unit.sessionExerciseId));
  }, [unit?.key, onActiveExerciseChange]);
  function change(patch) { onRuntimeChange({ ...state, ...patch }); }
  useEffect(() => {
    if (unit?.seconds && state.runningSince && elapsed >= unit.seconds) {
      change({ elapsedSeconds: unit.seconds, runningSince: null });
    }
  }, [unit?.key, unit?.seconds, state.runningSince, elapsed >= (unit?.seconds ?? Infinity)]);

  function confirm() {
    if (!executionEnabled || !unit || completion.current || confirmation.current === unit.key || (state.restUntil && Date.now() < state.restUntil)) return;
    const parse = (value) => value == null || String(value).trim() === '' ? null : Number(String(value).replace(',', '.'));
    const actual = parse(state.actual ?? (unit.reps || unit.distance || unit.count || (unit.test ? '' : Math.floor(Math.min(unit.seconds ?? Infinity, skillElapsed(state))))));
    const load = parse(state.load);
    if (actual == null || !Number.isFinite(actual) || actual <= 0 || ((unit.count || unit.reps) && !Number.isInteger(actual)) || (load != null && (!Number.isFinite(load) || load < 0))) {
      Alert.alert('Résultat manquant', 'Indique le réalisé avant de confirmer.'); return;
    }
    const row = { reps: unit.reps ? actual : null, duration_seconds: unit.seconds ? actual : null,
      distance_meters: unit.distance ? actual : null, load_kg: load, rest_shortened_before_set: state.restShortened === true,
      ...(unit.count?{count_actual:actual,count_unit:unit.countUnit}:{}),
      ...(unit.tempoDown||unit.tempoPause?{tempo:[unit.tempoDown?'descente '+unit.tempoDown+' s':null,unit.tempoPause?'pause '+unit.tempoPause+' s':null].filter(Boolean).join(' · ')}:{}),
      ...(unit.test ? { score: actual, test_metric: unit.metric } : {}) };
    confirmation.current = unit.key;
    const results = { ...state.results, [unit.key]: row };
    const index = state.index + 1;
    const next = { index, results, round: plan.units[index]?.setIndex ?? unit.setIndex, elapsedSeconds: 0, runningSince: null, actual: null, load: '', restShortened: false,
      restUntil: index < plan.units.length && unit.restSeconds > 0 ? Date.now() + unit.restSeconds * 1000 : null };
    onRuntimeChange(next);
    if (index >= plan.units.length) finish(results, true);
  }
  async function finish(results, finished) {
    if (!executionEnabled || completion.current) return;
    completion.current = true;
    try { await onComplete(skillExecutionUpdates(exercises, plan.units, results, finished, blockType)); }
    finally { completion.current = false; }
  }
  const box = { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 20, gap: 16 };
  const text = { color: colors.text, fontFamily: fontFamilies.regular, fontSize: 17 };
  function button(label, action, disabled = false) {
    return <Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{ padding: 16, borderRadius: 14, backgroundColor: colors.accent, opacity: disabled ? .45 : 1 }}><Text style={{ color: colors.textOnAccent, textAlign: 'center', fontWeight: '700' }}>{label}</Text></Pressable>;
  }
  if (plan.error) return <View style={box}><Text style={text}>{plan.error} Reviens à la préparation pour vérifier la séance.</Text></View>;
  if (!unit) return <View style={box}>{button('Continuer', () => finish(state.results ?? {}, true), !executionEnabled)}</View>;
  return <View style={box}>
    <Text style={{ ...text, color: colors.textSecondary }}>{blockType === 'skill' ? 'Skill' : blockType === 'warmup' ? 'Échauffement' : 'Renforcement'} · série {unit.setIndex} / {unit.sets}{unit.side ? ` · côté ${unit.side === 'left' ? 'gauche' : 'droit'}` : ''}</Text>
    <ExerciseName style={{ ...text, fontSize: 28, fontWeight: '700' }} exercise={unit.exercise}/>
    <Text style={text}>{unit.test ? 'Tentative · renseigne ton résultat' : unit.reps ? `${unit.reps} répétitions` : unit.seconds ? `${unit.seconds} secondes` : unit.count ? `${unit.count} ${unit.countUnit}` : `${unit.distance} mètres`}</Text>
    {unit.instruction?<Text style={text}>{unit.instruction}</Text>:null}
    {unit.tempoDown||unit.tempoPause?<Text style={text}>{unit.tempoDown?'Descente '+unit.tempoDown+' s. ':''}{unit.tempoPause?'Pause '+unit.tempoPause+' s.':''}</Text>:null}
    {unit.rangeMin!=null?<Text style={text}>Fourchette : {unit.rangeMin}–{unit.rangeMax}</Text>:null}
    {resting ? <>
      <Text style={{ ...text, fontSize: 32 }}>Repos · {Math.ceil((state.restUntil - now) / 1000)} s</Text>
      {button('Écourter le repos', () => change({ restUntil: null, restShortened: true }), !executionEnabled)}
    </> : <>
      {unit.seconds ? <>
        <Text accessibilityLiveRegion="polite" style={{ ...text, fontSize: 44 }}>{Math.floor(elapsed)} / {unit.seconds} s</Text>
        {button(state.runningSince ? 'Pause' : elapsed ? 'Reprendre le chrono' : 'Lancer le chrono', () => change({ elapsedSeconds: Math.min(unit.seconds, skillElapsed(state)), runningSince: state.runningSince || skillElapsed(state) >= unit.seconds ? null : Date.now() }), !executionEnabled)}
      </> : null}
      <Text style={text}>Réalisé{unit.reps ? ' · répétitions' : unit.seconds ? ' · secondes' : unit.distance ? ' · mètres' : unit.count ? ' · '+unit.countUnit : ' · score'}</Text>
      <TextInput accessibilityLabel="Résultat de la série" keyboardType="decimal-pad" value={String(state.actual ?? (unit.reps || unit.distance || unit.count || (unit.test ? '' : Math.floor(elapsed))))} onChangeText={(actual) => change({ actual })} style={{ ...text, borderColor: colors.border, borderWidth: 1, padding: 12, borderRadius: 10 }} editable={executionEnabled} />
      {(unit.exercise.trackingModes ?? unit.exercise.prescriptionJson?.tracking_modes ?? []).includes('load') ? <TextInput accessibilityLabel="Charge facultative en kilogrammes" placeholder="Charge (kg) · facultatif" placeholderTextColor={colors.textSecondary} keyboardType="decimal-pad" value={state.load ?? ''} onChangeText={(load) => change({ load })} editable={executionEnabled} style={{ ...text, padding: 12, borderColor: colors.border, borderWidth: 1, borderRadius: 10 }} /> : null}
      {button('Confirmer la série réalisée', confirm, !executionEnabled)}
    </>}
    <Pressable onPress={() => setDetails(!details)}><Text style={{ ...text, color: colors.accent }}>{details ? 'Masquer les consignes' : 'Voir les consignes'}</Text></Pressable>
    {details ? <Text style={text}>{unit.exercise.instructions ?? unit.exercise.description ?? unit.exercise.prescription}</Text> : null}
    {button(blockType === 'skill' ? 'Arrêter le Skill ici' : blockType === 'warmup' ? 'Arrêter l’échauffement ici' : 'Arrêter le renforcement ici', () => Alert.alert('Terminer ce bloc ?', 'Seules les séries confirmées seront enregistrées.', [{ text: 'Continuer', style: 'cancel' }, { text: 'Arrêter', onPress: () => finish(state.results ?? {}, false) }]), !executionEnabled)}
  </View>;
}
