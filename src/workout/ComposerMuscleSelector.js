
/**
 * UGEROD Composer: an interactive intention map, NOT a physiological/fatigue heatmap.
 * Existing muscle IDs M01..M14. Visual palette: orange = primary target,
 * khaki = complementary target, gray = not targeted.
 * Paths are original schematic anatomy inspired by the user's visual reference.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

const ORANGE = '#FF6B19';
// Blended with the neutral anatomy surface (~36% brand khaki), not fully opaque.
const KHAKI = '#BDC6BA';
const GRAY = '#E4E7E2';
const STROKE = '#ABB5AA';
const BODY = '#F2F3F0';
const MUSCLE_STROKE = '#9EAA9F';

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

// Anatomical SVG V2. The left-side paths mirror around x=110 so muscles
// remain symmetric. Each subdivided path retains the SAME UGEROD muscle ID.
// There are no additional sporting categories or fatigue/activation estimates.
const FRONT = [
  // Deltoid: anterior and lateral heads
  ['M03', 'M74 78 Q62 78 53 90 L48 105 L57 120 L67 112 L80 90 Z', true],
  ['M03', 'M67 112 L57 120 L61 132 L73 122 L83 100 Z', true],
  // Pectoralis major, upper and lower portions
  ['M01', 'M102 86 Q91 87 80 91 L71 103 L82 117 L105 122 Z', true],
  ['M01', 'M82 119 Q95 127 106 124 L105 137 Q86 142 73 126 Z', true],
  // Biceps and upper-arm definition
  ['M04', 'M49 123 Q43 132 39 148 L37 166 L46 172 L56 144 L58 133 Z', true],
  ['M04', 'M40 170 L46 172 L42 187 L34 184 Z', true],
  // Visible edge of latissimus dorsi, near the axilla
  ['M02', 'M74 128 L79 140 L76 170 L70 183 L67 150 Z', true],
  // Rectus abdominis: separated segments, not one solid rectangle
  ['M10', 'M98 139 L108 141 L108 153 L97 154 Z', true],
  ['M10', 'M97 157 L108 156 L108 169 L98 170 Z', true],
  ['M10', 'M99 173 L108 172 L108 185 L101 188 Z', true],
  ['M10', 'M101 191 L108 188 L108 213 L106 217 L102 205 Z', true],
  // External obliques and serratus transition
  ['M11', 'M80 141 L94 143 L91 156 L81 161 L75 152 Z', true],
  ['M11', 'M80 164 L93 159 L96 181 L86 201 L76 189 Z', true],
  ['M11', 'M88 203 L99 184 L101 205 L94 216 Z', true],
  // Quadriceps: rectus femoris, vastus lateralis and medialis
  ['M06', 'M89 239 Q101 239 105 249 L101 304 L94 324 L86 311 Z', true],
  ['M06', 'M79 244 L88 242 L85 310 L77 326 L71 297 Z', true],
  ['M06', 'M88 314 L97 329 L93 344 L82 339 L78 329 Z', true],
  // Lateral gastrocnemius visible on the front/side silhouette
  ['M09', 'M75 349 L84 350 L80 375 L71 383 L71 366 Z', true],
];
const REAR = [
  // Trapezius: neck / upper-fan and middle-fan, anatomical divisions.
  ['M13', 'M108 63 L95 74 L83 80 L68 91 L87 107 L108 101 Z', true],
  ['M13', 'M108 104 L91 111 L89 126 L106 137 L108 130 Z', true],
  // Posterior deltoid, cap and lower portion
  ['M03', 'M70 83 Q57 82 51 94 L49 108 L57 125 L72 105 Z', true],
  ['M03', 'M73 107 L59 126 L66 136 L77 122 L81 112 Z', true],
  // Triceps, long and lateral heads
  ['M05', 'M48 123 L59 134 L55 160 L41 179 L35 163 Z', true],
  ['M05', 'M60 135 L65 147 L55 179 L42 185 L55 162 Z', true],
  // Rhomboid/lats: upper and lower portions share the existing M02 ID
  ['M02', 'M86 115 L105 140 L104 159 L88 154 L76 132 Z', true],
  ['M02', 'M74 135 L87 157 L103 163 L99 192 L88 207 L74 182 Z', true],
  ['M02', 'M88 209 L102 193 L101 221 L91 225 L82 207 Z', true],
  // Spinal erectors: split left and right along the lumbar spine
  ['M12', 'M103 181 L108 183 L108 219 L103 228 L97 219 Z', true],
  // Gluteus maximus and lateral gluteal portion
  ['M08', 'M78 232 Q91 222 107 232 L105 251 Q104 271 86 275 L75 264 Z', true],
  ['M08', 'M77 231 L88 227 L78 248 L72 255 Z', true],
  // Hamstrings: biceps femoris + semitendinosus regions
  ['M07', 'M77 275 L87 277 L89 328 L78 343 L71 309 Z', true],
  ['M07', 'M90 279 L105 275 L100 317 L92 341 L87 325 Z', true],
  // Calf: two heads of gastrocnemius + lower soleus
  ['M09', 'M77 351 L87 347 L88 375 L80 393 L73 378 Z', true],
  ['M09', 'M89 348 L99 352 L96 378 L84 394 L87 370 Z', true],
  ['M09', 'M81 395 L95 382 L88 408 L80 414 L74 405 Z', true],
];

// Lines are aesthetic muscle separations; they're never separate selectable IDs.
const FRONT_DETAILS = [
  'M98 155 L107 154', 'M98 171 L108 170', 'M100 190 L108 188',
  'M85 141 L95 146', 'M81 163 L91 160', 'M84 185 L94 177',
  'M88 248 L85 300', 'M94 248 L95 304', 'M81 319 L86 333',
  'M64 111 L57 119', 'M43 144 L48 159',
];
const REAR_DETAILS = [
  'M96 88 L108 101', 'M88 111 L106 134',
  'M80 133 L98 156', 'M77 174 L94 198', 'M102 183 L106 216',
  'M81 242 L102 251', 'M80 266 Q92 277 105 260',
  'M83 288 L83 327', 'M96 288 L94 327',
  'M79 359 L81 383', 'M93 358 L89 384',
];
const FLIP = 'translate(220 0) scale(-1 1)';

function MuscleBody({ side, colorsByMuscle, onTouch }) {
  const shapes = side === 'back' ? REAR : FRONT;
  const details = side === 'back' ? REAR_DETAILS : FRONT_DETAILS;
  return (
    <Svg viewBox="0 0 220 432" width="100%" height="100%" accessible accessibilityLabel={side === 'back' ? 'Silhouette musculaire vue de dos' : 'Silhouette musculaire vue de face'}>
      {/* Head, neck, shoulders and torso have neutral, continuous contours. */}
      <Path
        d="M93 16 Q95 6 110 6 Q125 6 127 16 L129 37 Q126 52 118 58 L118 66 L140 79
           Q153 86 158 104 L153 137 L146 178 L146 204 Q136 227 110 238
           Q84 227 74 204 L74 178 L67 137 L62 104 Q67 86 80 79 L102 66 L102 58
           Q94 52 91 37 Z"
        fill={BODY} stroke={STROKE} strokeWidth="1.7" strokeLinejoin="round"
      />
      {/* Subtle shoulder joints, forearms, hands, hips, knees and feet. */}
      {[false, true].map((mirror) => (
        <G key={mirror ? 'right' : 'left'} transform={mirror ? FLIP : undefined}>
          <Path
            d="M69 84 Q52 80 46 96 L32 147 L15 205 Q10 220 18 226
               L26 228 L37 194 L52 158 L67 123 Z"
            fill={BODY} stroke={STROKE} strokeWidth="1.7" strokeLinejoin="round"
          />
          <Path d="M15 209 L12 232 Q12 240 17 237 L21 229 L21 240 Q21 244 25 239 L30 227 L34 215"
            fill="none" stroke={STROKE} strokeWidth="1.6" strokeLinecap="round" />
          <Path
            d="M79 226 Q68 250 70 288 L69 319 L73 348 L67 390 L66 413
               Q65 424 77 425 L91 424 L95 413 L96 391 L94 346
               Q102 319 106 289 L109 237 Z"
            fill={BODY} stroke={STROKE} strokeWidth="1.7" strokeLinejoin="round"
          />
          <Path d="M68 414 Q76 418 88 414 L93 425 Q79 429 66 425 Z"
            fill={BODY} stroke={STROKE} strokeWidth="1.3" />
          <Path d="M72 345 Q81 350 94 347" fill="none" stroke={STROKE} strokeWidth="1" />
          <Path d="M53 124 L38 171" fill="none" stroke="#C8CEC5" strokeWidth=".8" />
        </G>
      ))}

      {/* Every selected anatomical tile maps to an existing muscle identity. */}
      {shapes.map(([id, d, mirror], index) => {
        const fill = colorsByMuscle[id] ?? GRAY;
        return (
          <G key={id + ':' + index}>
            <Path d={d} fill={fill} stroke={MUSCLE_STROKE} strokeWidth=".95"
              strokeLinejoin="round" onPress={() => onTouch(id)} />
            {mirror ? (
              <G transform={FLIP}>
                <Path d={d} fill={fill} stroke={MUSCLE_STROKE} strokeWidth=".95"
                  strokeLinejoin="round" onPress={() => onTouch(id)} />
              </G>
            ) : null}
          </G>
        );
      })}

      {/* Fine anatomical lines add contour; no additional muscle classifications. */}
      <G pointerEvents="none">
        {details.map((d, index) => (
          <G key={'detail:' + index}>
            <Path d={d} fill="none" stroke="#F8F9F5" strokeWidth=".9"
              strokeLinecap="round" />
            <G transform={FLIP}>
              <Path d={d} fill="none" stroke="#F8F9F5" strokeWidth=".9"
                strokeLinecap="round" />
            </G>
          </G>
        ))}
        {side === 'back' ? (
          <Path d="M110 81 L110 230" stroke="#F8F9F5" strokeWidth="1.5" fill="none" />
        ) : (
          <Path d="M110 85 L110 216" stroke="#F8F9F5" strokeWidth="1.2" fill="none" />
        )}
        <Path d="M110 230 L110 246" stroke={STROKE} strokeWidth="1" />
      </G>
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
