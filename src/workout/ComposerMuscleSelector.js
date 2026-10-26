
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
// Light secondary khaki, distinct from gray without competing with orange.
const KHAKI = '#A7B19F';
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

// Anatomical SVG V3: more organic shapes, proportional divisions and soft contours.
// All subdivided segments preserve the existing UGEROD Mxx identifiers.
// The silhouette illustrates a TARGET, not measured fatigue or activation.
const FRONT = [
  // Rounded anterior / lateral deltoid heads.
  ['M03', 'M77 81 C65 79 56 86 52 96 C49 103 48 110 55 118 C64 114 70 104 81 91 Z', true],
  ['M03', 'M70 104 C68 113 60 121 56 126 L63 133 Q72 124 77 110 Z', true],
  // Upper and lower pectoralis major: curved rather than rectangular.
  ['M01', 'M102 89 C92 86 82 89 75 97 Q70 103 76 112 C84 118 94 122 106 122 L106 98 Q106 92 102 89 Z', true],
  ['M01', 'M75 115 C85 123 94 126 106 126 Q105 135 98 139 C86 140 78 136 73 130 Q69 122 75 115 Z', true],
  // Biceps / brachialis: upper-arm volume without coloring the forearm.
  ['M04', 'M48 126 C40 136 36 149 36 163 Q38 172 46 176 C51 163 56 147 59 133 Z', true],
  ['M04', 'M52 146 Q46 161 44 178 L37 185 Q42 188 47 183 L57 157 Z', true],
  // Narrow, visible latissimus edge under the arm.
  ['M02', 'M75 132 Q79 145 77 163 L71 182 Q68 160 67 148 Z', true],
  // Subtle, irregular rectus abdominis segments narrowing to the pelvis.
  ['M10', 'M97 143 Q102 141 108 143 L108 155 Q102 157 96 154 Z', true],
  ['M10', 'M96 160 Q102 158 108 159 L108 173 Q103 175 97 171 Z', true],
  ['M10', 'M98 178 Q103 176 108 177 L108 190 Q104 192 100 187 Z', true],
  ['M10', 'M101 195 Q105 193 108 193 L108 215 Q105 210 102 203 Z', true],
  // Obliques / serratus taper naturally across the flank.
  ['M11', 'M81 140 Q86 139 94 146 L91 158 Q84 161 78 153 L75 148 Z', true],
  ['M11', 'M80 164 Q85 161 93 161 L96 182 C92 190 87 198 83 204 L76 189 Z', true],
  ['M11', 'M84 205 C90 198 96 190 99 186 L101 205 L94 217 Q89 215 84 205 Z', true],
  // Three quadriceps components: lateral, central and medial teardrop.
  ['M06', 'M78 240 C73 250 72 272 74 297 Q75 317 81 327 C87 313 89 279 89 247 Q85 242 78 240 Z', true],
  ['M06', 'M93 240 Q101 242 105 251 C105 272 102 297 97 317 Q92 327 87 311 C88 291 90 263 90 245 Z', true],
  ['M06', 'M88 315 Q93 312 98 320 C99 332 93 343 86 343 Q79 341 78 334 Q83 325 88 315 Z', true],
  // Anterior/lateral lower-leg muscle definition.
  ['M09', 'M74 349 Q81 346 85 351 C83 360 81 375 75 384 L71 374 Q70 360 74 349 Z', true],
  ['M09', 'M79 386 Q84 380 86 375 L83 399 Q80 406 76 407 Z', true],
];

const REAR = [
  // Upper and mid trapezius across the scapular region.
  ['M13', 'M107 63 C101 70 92 75 83 79 L69 91 Q80 101 94 107 L107 101 Z', true],
  ['M13', 'M106 104 Q96 110 88 111 Q89 126 104 140 L108 132 Z', true],
  // Posterior deltoid: rounded cap and tapered lower head.
  ['M03', 'M72 82 Q59 80 53 90 Q48 99 49 109 Q52 119 57 125 C64 117 70 105 77 93 Z', true],
  ['M03', 'M74 106 Q67 119 58 127 L66 138 C70 132 75 122 81 113 Z', true],
  // Lateral and long triceps heads.
  ['M05', 'M49 124 C43 133 37 147 36 160 Q36 170 42 178 C51 169 56 152 59 134 Z', true],
  ['M05', 'M60 134 Q63 143 64 151 Q58 168 51 183 Q46 187 42 183 C51 167 55 149 60 134 Z', true],
  // Lats: broad under the scapula, tapering down the waist.
  ['M02', 'M83 115 Q93 125 105 140 L104 156 Q92 156 85 150 L75 133 Z', true],
  ['M02', 'M74 137 Q84 153 97 164 Q103 169 102 180 Q99 195 88 209 C80 198 73 181 73 164 Z', true],
  ['M02', 'M88 211 Q98 198 102 183 L101 220 L90 226 L83 210 Z', true],
  // Lumbar erectors, symmetrically beside the spine.
  ['M12', 'M101 183 Q105 183 108 185 L108 220 L103 229 Q99 220 98 207 Z', true],
  // Rounded gluteus maximus + lateral upper glute.
  ['M08', 'M83 229 Q95 223 107 233 L105 253 Q103 268 88 277 C78 273 74 266 75 254 Q76 236 83 229 Z', true],
  ['M08', 'M78 231 Q82 228 89 227 C82 236 78 245 74 254 L72 250 Z', true],
  // Hamstrings: curved outer and inner muscle bellies.
  ['M07', 'M77 279 Q83 275 88 279 C90 292 91 315 86 332 L79 344 Q73 332 73 310 C72 296 74 284 77 279 Z', true],
  ['M07', 'M91 279 Q99 278 105 276 Q105 298 99 320 L92 341 C89 323 89 296 91 279 Z', true],
  // Gastrocnemius heads taper to a narrower soleus / Achilles region.
  ['M09', 'M77 351 Q82 347 88 349 Q90 365 84 382 L78 394 Q71 384 72 371 Z', true],
  ['M09', 'M90 349 Q97 348 101 353 Q101 369 95 384 L86 394 Q87 373 90 349 Z', true],
  ['M09', 'M81 393 Q87 389 96 381 L90 403 Q86 412 80 414 L74 405 Z', true],
];

// Fine non-interactive tracings follow musculature, not a rectangular grid.
const FRONT_DETAILS = [
  'M79 94 Q71 103 65 112',
  'M83 117 Q95 126 105 124',
  'M97 157 Q103 159 108 157',
  'M98 175 Q103 177 108 175',
  'M99 191 Q104 193 108 191',
  'M79 153 Q87 159 92 157',
  'M83 187 Q89 192 94 185',
  'M84 244 Q84 284 81 307',
  'M97 247 Q99 275 96 300',
  'M83 325 Q88 323 94 329',
  'M44 152 Q42 163 45 173',
  'M75 356 Q78 367 76 379',
];
const REAR_DETAILS = [
  'M93 83 Q99 92 107 99',
  'M91 112 Q98 123 105 131',
  'M78 142 Q84 159 96 171',
  'M76 182 Q80 197 87 207',
  'M100 191 Q103 208 103 221',
  'M79 238 Q91 231 103 239',
  'M77 260 Q89 271 102 261',
  'M80 287 Q82 307 81 327',
  'M98 284 Q96 307 93 326',
  'M78 356 Q77 370 80 380',
  'M94 354 Q94 369 90 382',
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
            d="M69 84 Q53 81 47 95 C42 107 38 129 32 148 L17 205
               Q12 217 17 226 Q22 229 27 225 L37 194 Q42 180 52 157 L67 123 Z"
            fill={BODY} stroke={STROKE} strokeWidth="1.7" strokeLinejoin="round"
          />
          <Path d="M15 209 L12 232 Q12 240 17 237 L21 229 L21 240 Q21 244 25 239 L30 227 L34 215"
            fill="none" stroke={STROKE} strokeWidth="1.6" strokeLinecap="round" />
          <Path
            d="M79 228 C69 243 69 268 71 289 L69 318 Q68 331 73 348
               C70 365 68 381 67 393 L66 414 Q68 426 79 426 L90 425
               Q95 418 94 411 L96 390 Q97 367 94 347
               C101 326 103 305 105 286 L109 237 Z"
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
