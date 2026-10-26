
/**
 * UGEROD Composer: an interactive intention map, NOT a physiological/fatigue heatmap.
 * Existing muscle IDs M01..M14. Visual palette: orange = primary target,
 * khaki = complementary target, gray = not targeted.
 * Paths are original schematic anatomy inspired by the user's visual reference.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { G, Ellipse, Path, Line } from 'react-native-svg';

const ORANGE = '#FF6B19';
const KHAKI = '#646F5E';
const GRAY = '#E4E7E2';
const STROKE = '#AEB5AB';

export const MUSCLE_NAMES = {
  M01: 'Pectoraux', M02: 'Grands dorsaux', M03: 'Épaules', M04: 'Biceps',
  M05: 'Triceps', M06: 'Quadriceps', M07: 'Ischio-jambiers',
  M08: 'Fessiers', M09: 'Mollets', M10: 'Grands droits',
  M11: 'Obliques', M12: 'Lombaires', M13: 'Trapèzes',
};
export const COMPOSER_TARGETS = [
  { value: null, label: 'UGEROD choisit' },
  { value: 'Upper', label: 'Haut du corps' },
  { value: 'Back', label: 'Dos' },
  { value: 'Lower', label: 'Jambes' },
  { value: 'Core', label: 'Abdos / gainage' },
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

// Symmetric paths use the LEFT anatomical side and mirror on x=110.
const FRONT = [
  ['M03', 'M72 78 C55 81 48 93 49 107 L60 126 L75 104 Z', true],
  ['M01', 'M103 87 C88 82 75 86 65 100 L69 125 C83 133 96 127 108 118 Z', true],
  ['M04', 'M48 122 C41 129 34 151 31 173 L44 180 L57 140 L61 128 Z', true],
  ['M10', 'M101 133 L119 133 L121 194 C120 202 115 210 110 214 C105 210 100 202 99 194 Z', false],
  ['M11', 'M96 137 L86 137 L76 151 L78 194 L92 211 L100 196 Z', true],
  ['M06', 'M78 239 Q87 228 106 241 L102 307 L91 340 Q75 329 73 305 Z', true],
  ['M09', 'M73 351 L91 347 L87 396 Q82 408 74 395 L70 374 Z', true],
];
const REAR = [
  ['M13', 'M108 68 L83 79 L68 94 L95 121 L108 111 Z', true],
  ['M03', 'M69 85 C55 85 47 97 49 113 L60 127 L76 104 Z', true],
  ['M05', 'M49 122 L61 132 L50 166 L35 182 L30 168 Z', true],
  ['M02', 'M82 117 L105 126 L103 175 L94 207 L75 188 L72 147 Z', true],
  ['M12', 'M101 179 L119 179 L126 217 L110 229 L94 217 Z', false],
  ['M08', 'M79 229 Q96 219 109 233 L106 267 Q87 285 75 263 Z', true],
  ['M07', 'M78 271 L104 280 L99 343 L80 347 L73 307 Z', true],
  ['M09', 'M78 350 L96 349 L88 400 L77 410 L68 387 Z', true],
];

const FLIP = 'translate(220 0) scale(-1 1)';

function MuscleBody({ side, colorsByMuscle, onTouch }) {
  const shapes = side === 'back' ? REAR : FRONT;
  return (
    <Svg viewBox="0 0 220 432" width="100%" height="100%">
      <Ellipse cx="110" cy="33" rx="22" ry="27" fill="#F0F2EE" stroke={STROKE} strokeWidth="1.6" />
      <Path d="M100 58 L98 70 L83 77 Q62 79 60 108 L67 146 L73 205 Q79 225 110 236 Q141 225 147 205 L153 146 L160 108 Q158 79 137 77 L122 70 L120 58 Z" fill="#F0F2EE" stroke={STROKE} strokeWidth="1.6" />
      {[false, true].map((mirror) => (
        <G key={mirror ? 'right-outline' : 'left-outline'} transform={mirror ? FLIP : undefined}>
          <Path d="M70 80 Q51 76 43 94 L28 156 L15 215 Q18 226 28 221 L38 185 L58 130 L68 117 Z" fill="#F0F2EE" stroke={STROKE} strokeWidth="1.6" />
          <Path d="M82 224 L108 235 L105 304 L93 348 L90 405 L81 425 Q66 429 63 418 L69 344 L71 293 Z" fill="#F0F2EE" stroke={STROKE} strokeWidth="1.6" />
        </G>
      ))}
      {shapes.map(([id, d, mirrored], i) => {
        const fill = colorsByMuscle[id] ?? GRAY;
        return (
          <G key={id + i}>
            <Path d={d} fill={fill} stroke={STROKE} strokeWidth="1.4" onPress={() => onTouch(id)} />
            {mirrored ? (
              <G transform={FLIP}>
                <Path d={d} fill={fill} stroke={STROKE} strokeWidth="1.4" onPress={() => onTouch(id)} />
              </G>
            ) : null}
          </G>
        );
      })}
      <Line x1="110" y1="82" x2="110" y2="229" stroke="#B4BAB1" strokeWidth="1" />
    </Svg>
  );
}

/**
 * Controlled target field. Values match the existing Composer target_region
 * contract (Upper / Lower / Core / Full Body), extending it with Back.
 */
export default function ComposerMuscleSelector({
  value, onChange, colors, fontFamilies,
}) {
  const [side, setSide] = useState('front');
  const [inspected, setInspected] = useState(null);
  const targets = INTENT_MUSCLES[value] ?? {};
  const colorsByMuscle = useMemo(() => {
    const mapped = {};
    (targets.secondary ?? []).forEach((id) => { mapped[id] = KHAKI; });
    (targets.primary ?? []).forEach((id) => { mapped[id] = ORANGE; });
    return mapped;
  }, [value]);

  function choose(next) {
    setInspected(null);
    onChange(next);
    if (next === 'Back') setSide('back');
    if (next === 'Core') setSide('front');
  }

  function selectMuscle(id) {
    setInspected(id);
    const category = ['M02', 'M12', 'M13'].includes(id) ? 'Back'
      : ['M06', 'M07', 'M08', 'M09'].includes(id) ? 'Lower'
        : ['M10', 'M11'].includes(id) ? 'Core' : 'Upper';
    onChange(category);
    if (category === 'Back' || ['M07', 'M08', 'M12', 'M13'].includes(id)) setSide('back');
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'stretch' }}>
        <View style={{ width: '43%', gap: 6, justifyContent: 'center' }}>
          {COMPOSER_TARGETS.map((option) => {
            const selected = value === option.value;
            return (
              <Pressable
                key={option.label}
                onPress={() => choose(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
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
            <MuscleBody side={side} colorsByMuscle={colorsByMuscle} onTouch={selectMuscle} />
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
