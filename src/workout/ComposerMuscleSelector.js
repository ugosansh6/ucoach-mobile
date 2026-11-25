
/**
 * UGEROD Composer: an interactive intention map, NOT a physiological/fatigue heatmap.
 * Existing muscle IDs M01..M14. Visual palette: orange = primary target,
 * khaki = complementary target, gray = not targeted.
 * Anatomy paths are kept in a reusable SVG surface; selection logic stays here.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import AthleticMuscleMap from '../components/body/AthleticMuscleMap';
import { normalizeComposerRegions, toggleComposerRegion } from '../utils/composerPreferences';

const ORANGE = '#FF6B19';
// Light secondary khaki, distinct from gray without competing with orange.
const KHAKI = '#A7B19F';
const GRAY = '#E4E7E2';
const STROKE = '#ABB5AA';

export const MUSCLE_NAMES = {
  M01: 'Pectoraux', M02: 'Grands dorsaux', M03: 'Épaules', M04: 'Biceps',
  M05: 'Triceps', M06: 'Quadriceps', M07: 'Ischio-jambiers',
  M08: 'Fessiers', M09: 'Mollets', M10: 'Grands droits',
  M11: 'Obliques', M12: 'Lombaires', M13: 'Trapèzes',
};
export const COMPOSER_TARGETS = [
  { value: null, label: 'UGEROD choisit' },
  { value: 'Upper', label: 'Haut du corps' },
  { value: 'Lower', label: 'Jambes' },
  { value: 'Core', label: 'Abdos / gainage' },
  { value: 'Back', label: 'Dos' },
  { value: 'Full Body', label: 'Corps entier' },
];

// This map represents the desired target only. It never estimates fatigue.
const INTENT_MUSCLES = {
  Upper: { primary: ['M01', 'M03', 'M04', 'M05'], secondary: ['M02', 'M13'] },
  Back: { primary: ['M02', 'M13', 'M12'], secondary: ['M04', 'M05'] },
  Lower: { primary: ['M06', 'M07', 'M08', 'M09'], secondary: ['M12'] },
  Core: { primary: ['M10', 'M11', 'M12'], secondary: ['M08'] },
  'Full Body': { primary: ['M01', 'M02', 'M06', 'M07', 'M08', 'M10'], secondary: ['M03', 'M04', 'M05', 'M09', 'M11', 'M12', 'M13'] },
};

/**
 * Controlled target field. Values match the existing Composer target_region
 * contract (Upper / Lower / Core / Full Body), extending it with Back.
 */
export default function ComposerMuscleSelector({
  value, values, onChange, colors, fontFamilies,
}) {
  const [side, setSide] = useState('front');
  const [inspected, setInspected] = useState(null);
  const multiple = Array.isArray(values);
  const selectedRegions = normalizeComposerRegions(multiple ? values : value);
  const colorsByMuscle = useMemo(() => {
    const mapped = {};
    for (const region of selectedRegions) {
      (INTENT_MUSCLES[region]?.secondary ?? []).forEach((id) => { mapped[id] = KHAKI; });
    }
    for (const region of selectedRegions) {
      (INTENT_MUSCLES[region]?.primary ?? []).forEach((id) => { mapped[id] = ORANGE; });
    }
    return mapped;
  }, [JSON.stringify(selectedRegions)]);

  function choose(next) {
    setInspected(null);
    onChange(multiple ? toggleComposerRegion(selectedRegions, next) : next);
    if (next === 'Back') setSide('back');
    if (next === 'Core') setSide('front');
  }

  function selectMuscle(id) {
    setInspected(id);
    const category = ['M02', 'M12', 'M13'].includes(id) ? 'Back'
      : ['M06', 'M07', 'M08', 'M09'].includes(id) ? 'Lower'
        : ['M10', 'M11'].includes(id) ? 'Core' : 'Upper';
    onChange(multiple ? toggleComposerRegion(selectedRegions, category) : category);
    if (category === 'Back' || ['M07', 'M08', 'M12', 'M13'].includes(id)) setSide('back');
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'stretch' }}>
        <View style={{ width: '43%', gap: 6, justifyContent: 'center' }}>
          {COMPOSER_TARGETS.map((option) => {
            const selected = option.value == null ? selectedRegions.length === 0
              : selectedRegions.includes(option.value);
            return (
              <Pressable
                key={option.label}
                onPress={() => choose(option.value)}
                accessibilityRole={multiple && option.value && option.value !== 'Full Body' ? 'checkbox' : 'radio'}
                accessibilityState={multiple && option.value && option.value !== 'Full Body' ? { checked: selected } : { selected }}
                aria-checked={selected}
                style={{
                  minHeight: 42, justifyContent: 'center',
                  borderWidth: 1, borderRadius: 12, paddingHorizontal: 10,
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? colors.accent : colors.surface,
                }}
              >
                <Text style={{
                  fontFamily: selected ? fontFamilies.bold : fontFamilies.medium,
                  fontSize: 12, lineHeight: 16,
                  color: selected ? colors.textOnAccent : colors.text,
                }}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flex: 1, minWidth: 0, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 7 }}>
          <View style={{ flexDirection: 'row', gap: 5, marginBottom: 6 }}>
            {[
              { id: 'front', label: 'FACE' },
              { id: 'back', label: 'DOS' },
            ].map((option) => {
              const selected = option.id === side;
              return (
                <Pressable key={option.id} onPress={() => setSide(option.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={{ flex: 1, borderRadius: 9, paddingVertical: 7, alignItems: 'center', backgroundColor: selected ? colors.accent : colors.background }}>
                  <Text style={{ color: selected ? colors.textOnAccent : colors.textSecondary, fontFamily: fontFamilies.bold, fontSize: 10 }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ height: 260, overflow: 'hidden' }}>
            <AthleticMuscleMap side={side} colorsByMuscle={colorsByMuscle} onTouch={selectMuscle} />
          </View>
          {inspected ? <Text style={{ fontFamily: fontFamilies.medium, fontSize: 10, textAlign: 'center', color: colors.accent }} numberOfLines={2}>{MUSCLE_NAMES[inspected]}</Text> : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10, alignItems: 'center' }}>
        {[
          [ORANGE, 'Principal'],
          [KHAKI, 'Secondaire'],
          [GRAY, 'Non ciblé'],
        ].map(([color, label]) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: color, borderWidth: color === GRAY ? 1 : 0, borderColor: STROKE }} />
            <Text style={{ fontFamily: fontFamilies.medium, fontSize: 10, color: colors.textSecondary }}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
