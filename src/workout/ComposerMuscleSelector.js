
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
const STROKE = '#929E94';
const BODY = '#F2F3F0';
const MUSCLE_STROKE = '#87958A';

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

// Anatomical SVG V3.1: clearer outlines, corrected landmarks and muscle placement.
// All subdivided segments preserve the existing UGEROD Mxx identifiers.
// The silhouette illustrates a TARGET, not measured fatigue or activation.
const FRONT = [
  // Rounded anterior / lateral deltoid heads.
  ['M03', 'M77 81 C65 79 56 86 52 96 C49 103 48 110 55 118 C64 114 70 104 81 91 Z', true],
  ['M03', 'M70 104 C68 113 60 121 56 126 L63 133 Q72 124 77 110 Z', true],
  // Upper and lower pectoralis major: curved rather than rectangular.
  ['M01', 'M102 89 C92 86 82 89 75 97 Q70 103 76 112 C84 118 94 122 106 122 L106 98 Q106 92 102 89 Z', true],
  ['M01', 'M75 115 C85 123 94 126 106 126 Q105 135 98 139 C86 140 78 136 73 130 Q69 122 75 115 Z', true],
  // Biceps and brachialis end at the elbow. Forearm remains neutral.
  ['M04', 'M48 126 Q41 134 37 150 C35 160 37 168 44 174 Q51 161 58 134 Z', true],
  ['M04', 'M53 143 Q49 156 44 172 L40 179 Q43 182 47 176 L57 151 Z', true],
  // Narrow, visible latissimus edge under the arm.
  ['M02', 'M75 132 Q79 145 77 163 L71 182 Q68 160 67 148 Z', true],
  // Subtle, irregular rectus abdominis segments narrowing to the pelvis.
  ['M10', 'M97 143 Q102 141 108 143 L108 155 Q102 157 96 154 Z', true],
  ['M10', 'M96 160 Q102 158 108 159 L108 173 Q103 175 97 171 Z', true],
  ['M10', 'M98 178 Q103 176 108 177 L108 190 Q104 192 100 187 Z', true],
  ['M10', 'M101 195 Q105 193 108 193 L108 215 Q105 210 102 203 Z', true],
  // Serratus reads below the ribs; obliques taper with the waist towards the pelvis.
  ['M11', 'M80 142 Q85 139 94 145 L91 157 Q85 160 79 153 L76 149 Z', true],
  ['M11', 'M80 163 Q86 160 93 162 Q97 176 94 185 C89 194 85 201 81 203 L76 186 Z', true],
  ['M11', 'M82 203 Q92 193 97 187 L100 205 Q96 215 92 219 Q86 214 82 203 Z', true],
  // Anatomical quad placement: vastus lateralis outside, rectus femoris central,
  // and vastus medialis teardrop by the INNER knee rather than the outside.
  ['M06', 'M81 240 C73 244 71 254 72 275 C72 296 75 310 80 321 C86 309 89 279 89 246 Q86 240 81 240 Z', true],
  ['M06', 'M92 241 Q102 243 104 253 C103 276 99 299 96 311 Q89 306 88 285 L89 247 Z', true],
  ['M06', 'M100 309 Q107 311 107 321 Q105 335 96 340 C91 340 86 335 90 330 Q96 321 100 309 Z', true],
  // Only a narrow lateral glimpse of the calf is visible from the front.
  // The main calf mass lives on the rear view (avoids a false shin depiction).
  ['M09', 'M74 351 Q80 348 84 353 C82 364 80 378 75 388 Q70 376 72 365 Z', true],
];

const REAR = [
  // Trapezius fans between neck and scapular spine; lower fibres stop above the lats.
  ['M13', 'M107 64 Q97 75 84 80 L70 91 C80 101 93 107 107 103 Z', true],
  ['M13', 'M107 107 Q97 113 88 114 Q91 128 106 139 L108 132 Z', true],
  // Posterior deltoid: rounded cap and tapered lower head.
  ['M03', 'M72 82 Q59 80 53 90 Q48 99 49 109 Q52 119 57 125 C64 117 70 105 77 93 Z', true],
  ['M03', 'M74 106 Q67 119 58 127 L66 138 C70 132 75 122 81 113 Z', true],
  // Lateral and long triceps heads.
  ['M05', 'M49 124 C43 133 37 147 36 160 Q36 170 42 178 C51 169 56 152 59 134 Z', true],
  ['M05', 'M60 134 Q63 143 64 151 Q58 168 51 183 Q46 187 42 183 C51 167 55 149 60 134 Z', true],
  // Lats begin BELOW the trapezius/scapula, flare laterally, then taper to waist.
  ['M02', 'M76 135 Q86 140 96 150 L105 155 L103 169 Q90 164 79 151 Z', true],
  ['M02', 'M75 154 Q85 165 103 172 Q102 191 91 210 Q77 199 73 180 Z', true],
  ['M02', 'M89 211 Q97 201 102 191 L101 221 L91 226 L83 209 Z', true],
  // Lumbar erectors, symmetrically beside the spine.
  ['M12', 'M101 183 Q105 183 108 185 L108 220 L103 229 Q99 220 98 207 Z', true],
  // Rounded gluteus maximus, anchored under the pelvis, not on the hamstring.
  ['M08', 'M84 232 Q97 225 106 233 Q108 245 103 257 C99 268 90 273 82 271 Q74 267 75 255 C75 245 78 236 84 232 Z', true],
  ['M08', 'M79 233 Q83 229 91 230 Q81 238 76 251 L72 254 Q72 242 79 233 Z', true],
  // Hamstrings start BELOW the gluteal fold, with lateral and medial bellies.
  ['M07', 'M77 277 Q84 274 89 280 Q92 305 87 330 L80 341 C75 326 74 311 73 297 Z', true],
  ['M07', 'M92 279 Q99 277 104 273 Q104 302 100 320 L93 339 Q89 322 90 297 Z', true],
  // Medial and lateral gastrocnemius heads end above the narrower Achilles tendon.
  ['M09', 'M79 352 Q85 349 90 355 Q91 373 84 387 L79 394 Q73 383 73 369 Z', true],
  ['M09', 'M91 352 Q98 350 101 357 Q102 371 94 386 L86 395 Q86 374 91 352 Z', true],
  ['M09', 'M81 394 Q89 386 95 384 L89 405 L80 412 L76 406 Z', true],
];

// Every detail line references the muscle it belongs to. This lets neutral
// gray muscles remain legible without darkening orange / khaki fills.
const FRONT_DETAILS = [
  ['M03', 'M79 93 Q69 103 64 115'],
  ['M01', 'M83 120 Q94 126 105 125'],
  ['M04', 'M44 145 Q40 158 45 168'],
  ['M10', 'M97 156 Q102 158 108 156'],
  ['M10', 'M98 175 Q103 177 108 175'],
  ['M10', 'M100 193 Q104 195 108 193'],
  ['M11', 'M81 153 Q87 158 91 157'],
  ['M11', 'M81 184 Q87 190 92 184'],
  ['M06', 'M83 248 Q82 274 79 307'],
  ['M06', 'M96 247 Q100 271 96 298'],
  ['M06', 'M94 324 Q99 326 102 325'],
  ['M09', 'M76 357 Q77 369 75 381'],
];
const REAR_DETAILS = [
  ['M13', 'M93 84 Q100 94 106 99'],
  ['M13', 'M92 116 Q99 126 104 133'],
  ['M03', 'M57 104 Q61 115 65 119'],
  ['M05', 'M43 148 Q39 162 43 173'],
  ['M02', 'M79 150 Q87 158 100 166'],
  ['M02', 'M77 180 Q81 195 88 203'],
  ['M12', 'M103 187 Q105 204 104 218'],
  ['M08', 'M80 242 Q92 234 103 242'],
  ['M08', 'M79 261 Q89 267 101 256'],
  ['M07', 'M80 286 Q83 307 81 326'],
  ['M07', 'M96 283 Q96 307 94 325'],
  ['M09', 'M79 359 Q77 373 80 383'],
  ['M09', 'M95 359 Q94 372 90 383'],
];
// Landmark lines for neutral anatomy where no existing Mxx muscle is mapped.
// These are decorative only, so they must never intercept a user touch.
const FRONT_LANDMARKS = [
  'M87 76 Q98 80 105 86', // clavicular line
  'M68 136 Q68 157 70 178', // outer ribs
  'M67 190 Q75 205 82 220', // iliac crest
  'M51 186 Q44 204 34 224', // forearm tendon
  'M89 346 Q84 358 84 371', // knee to shin
  'M89 407 L83 417', // ankle
];
const REAR_LANDMARKS = [
  'M86 109 Q92 118 98 130', // scapular ridge
  'M70 144 Q67 173 74 192', // posterior flank
  'M82 224 Q91 220 98 225', // iliac crest
  'M48 186 L37 213', // forearm
  'M82 344 Q88 347 93 344', // posterior knee
  'M88 410 L82 420', // Achilles
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
        fill={BODY} stroke={STROKE} strokeWidth="2.05" strokeLinejoin="round"
      />
      {/* Subtle shoulder joints, forearms, hands, hips, knees and feet. */}
      {[false, true].map((mirror) => (
        <G key={mirror ? 'right' : 'left'} transform={mirror ? FLIP : undefined}>
          <Path
            d="M69 84 Q53 81 47 95 C42 107 38 129 32 148 L17 205
               Q12 217 17 226 Q22 229 27 225 L37 194 Q42 180 52 157 L67 123 Z"
            fill={BODY} stroke={STROKE} strokeWidth="2.05" strokeLinejoin="round"
          />
          <Path d="M15 209 L12 232 Q12 240 17 237 L21 229 L21 240 Q21 244 25 239 L30 227 L34 215"
            fill="none" stroke={STROKE} strokeWidth="1.85" strokeLinecap="round" />
          <Path
            d="M79 228 C69 243 69 268 71 289 L69 318 Q68 331 73 348
               C70 365 68 381 67 393 L66 414 Q68 426 79 426 L90 425
               Q95 418 94 411 L96 390 Q97 367 94 347
               C101 326 103 305 105 286 L109 237 Z"
            fill={BODY} stroke={STROKE} strokeWidth="2.05" strokeLinejoin="round"
          />
          <Path d="M68 414 Q76 418 88 414 L93 425 Q79 429 66 425 Z"
            fill={BODY} stroke={STROKE} strokeWidth="1.5" />
          <Path d="M72 345 Q81 350 94 347" fill="none" stroke={STROKE} strokeWidth="1.2" />
          <Path d="M53 124 L38 171" fill="none" stroke="#AEB8AD" strokeWidth="1.15" />
        </G>
      ))}

      {/* Every selected anatomical tile maps to an existing muscle identity. */}
      {shapes.map(([id, d, mirror], index) => {
        const fill = colorsByMuscle[id] ?? GRAY;
        const borderColor = fill === ORANGE ? '#EEECE4' : MUSCLE_STROKE;
        const borderWidth = fill === GRAY ? 1.65 : 1.22;
        return (
          <G key={id + ':' + index}>
            <Path d={d} fill={fill} stroke={borderColor} strokeWidth={borderWidth}
              strokeLinejoin="round" onPress={() => onTouch(id)} />
            {mirror ? (
              <G transform={FLIP}>
                <Path d={d} fill={fill} stroke={borderColor} strokeWidth={borderWidth}
                  strokeLinejoin="round" onPress={() => onTouch(id)} />
              </G>
            ) : null}
          </G>
        );
      })}

      {/* Visible neutral anatomical subdivisions, pointer-events disabled. */}
      <G pointerEvents="none">
        {details.map(([muscleId, d], index) => {
          const activity = colorsByMuscle[muscleId] ?? GRAY;
          const detailStroke = activity === ORANGE
            ? '#FFF4EC'
            : activity === KHAKI ? '#E8EDE6' : '#9BA89D';
          return (
            <G key={'detail:' + index}>
              <Path d={d} fill="none" stroke={detailStroke} strokeWidth="1.25"
                strokeLinecap="round" strokeLinejoin="round" />
              <G transform={FLIP}>
                <Path d={d} fill="none" stroke={detailStroke} strokeWidth="1.25"
                  strokeLinecap="round" strokeLinejoin="round" />
              </G>
            </G>
          );
        })}
        {(side === 'back' ? REAR_LANDMARKS : FRONT_LANDMARKS).map((d, index) => (
          <G key={'landmark:' + index}>
            <Path d={d} fill="none" stroke="#A6B1A6" strokeWidth="1.15"
              strokeLinecap="round" />
            <G transform={FLIP}>
              <Path d={d} fill="none" stroke="#A6B1A6" strokeWidth="1.15"
                strokeLinecap="round" />
            </G>
          </G>
        ))}
        <Path
          d={side === 'back' ? 'M110 80 L110 228' : 'M110 90 L110 217'}
          stroke="#ACB7AA" strokeWidth="1.1" fill="none" />
        <Path d="M110 231 L110 247" stroke={STROKE} strokeWidth="1.2" />
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
