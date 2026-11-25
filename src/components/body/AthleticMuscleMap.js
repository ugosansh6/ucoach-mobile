/**
 * UGEROD athletic muscle map — original vector drawing, front and back.
 *
 * Schematic visualization of desired muscle targeting, not a fatigue map.
 * Preserves all existing Composer M01..M13 IDs and their click callbacks.
 * Narrower waist, defined shoulder cap and more natural limb proportions.
 */
import React from 'react';
import Svg, { G, Path } from 'react-native-svg';

const FILL = '#F2F3F0';
const INACTIVE = '#E4E7E2';
const OUTLINE = '#9CA99E';
const LANDMARK = '#B6C0B8';
const GAP = '#FFFFFF';
const FLIP = 'translate(220 0) scale(-1 1)';

const BODY = {
  head: 'M110 7 C99 7 94 15 94 29 L94 37 C90 35 86 39 89 46 Q90 51 95 52 C97 62 103 69 110 71 C117 69 123 62 125 52 C130 51 133 46 131 40 Q130 36 126 37 L126 28 C126 15 121 7 110 7 Z',
  neck: 'M98 61 L96 75 Q103 91 110 96 Q117 91 124 75 L122 61 Q115 70 110 71 Q105 71 98 61 Z',
  torso: 'M96 72 C87 79 75 80 65 85 C56 89 52 99 54 112 C57 126 69 143 74 163 Q82 182 81 196 Q80 209 74 227 Q73 233 84 239 L110 254 L136 239 Q147 232 146 227 Q140 210 139 196 Q138 182 146 163 C151 143 163 126 166 112 C168 99 164 89 155 85 C145 80 133 79 124 72 L118 84 Q114 90 110 97 Q106 90 102 84 Z',
  arm: 'M61 88 C49 87 42 95 39 106 Q35 120 39 136 C37 152 31 166 27 181 L17 218 C16 225 20 230 25 227 L41 198 Q51 184 54 166 C60 151 61 142 62 130 C72 116 71 99 61 88 Z',
  hand: 'M18 218 Q13 222 12 229 L11 240 Q11 245 14 245 L17 239 L17 249 Q18 255 22 251 L23 242 L25 254 Q28 257 30 251 L28 239 L33 245 Q36 247 38 242 L31 224 Q29 217 26 214 Z',
  leg: 'M81 233 C71 240 70 261 72 282 C73 302 75 317 81 332 Q76 342 76 352 C71 369 72 387 75 408 L94 410 C98 392 99 372 97 351 Q102 331 104 312 Q108 273 108 247 Q93 230 81 233 Z',
  foot: 'M75 399 L95 404 L94 416 C95 425 88 429 77 428 L61 428 Q56 427 58 423 C61 418 67 415 72 410 Z',
};

// Each tuple = [existing muscle ID, left-side SVG path]; mirrored to the right.
const FRONT = [
  ['M03', 'M65 89 C56 88 50 94 49 102 Q46 112 54 123 C64 116 70 107 79 96 Q72 91 65 89 Z'],
  ['M01', 'M105 96 C94 91 84 92 76 98 Q69 105 73 117 C83 125 94 129 107 126 L108 103 Q109 99 105 96 Z'],
  ['M02', 'M71 132 Q77 142 78 158 L73 173 Q69 165 67 152 Z'],
  ['M04', 'M45 128 C40 135 37 147 36 158 Q37 167 42 173 C51 161 55 148 59 132 Q53 126 45 128 Z'],
  ['M04', 'M39 164 C43 166 46 164 49 158 Q46 174 41 180 L36 179 Q37 172 39 164 Z'],
  ['M10', 'M94 139 Q100 136 107 139 L107 153 C103 157 98 156 94 153 Z'],
  ['M10', 'M94 159 Q101 156 107 158 L107 174 C103 178 98 176 94 172 Z'],
  ['M10', 'M96 180 Q102 178 107 180 L107 195 C103 199 100 197 96 193 Z'],
  ['M10', 'M99 201 Q103 199 107 200 L107 220 Q103 213 99 205 Z'],
  ['M11', 'M79 136 Q85 132 92 142 L92 155 Q86 156 79 150 L75 144 Z'],
  ['M11', 'M78 157 Q85 159 91 161 L94 178 Q87 184 80 180 Q75 171 78 157 Z'],
  ['M11', 'M82 183 Q89 185 95 181 L98 201 Q94 213 88 219 Q82 210 78 197 Z'],
  ['M06', 'M79 246 Q87 246 89 253 Q87 283 82 315 Q78 326 77 315 Q73 286 75 262 Z'],
  ['M06', 'M92 249 Q101 245 104 253 Q104 289 97 320 Q93 326 89 318 Q90 287 90 260 Z'],
  ['M06', 'M83 319 Q90 315 95 323 Q96 334 91 340 Q83 343 79 338 L78 331 Z'],
  ['M09', 'M77 352 Q84 349 88 354 Q86 371 80 388 L75 397 Q73 377 75 362 Z'],
  ['M09', 'M90 354 Q95 354 96 362 Q97 382 90 399 L83 400 Q88 378 90 354 Z'],
];

const BACK = [
  ['M13', 'M99 77 Q91 80 79 87 L74 92 Q87 104 106 115 L107 102 L102 91 Z'],
  ['M03', 'M64 89 Q53 89 49 101 Q47 111 54 126 C65 118 71 106 78 95 Q73 90 64 89 Z'],
  ['M05', 'M48 128 Q40 139 38 155 Q36 169 43 174 Q54 157 58 132 Z'],
  ['M05', 'M55 134 Q59 134 62 141 L57 160 L46 179 Q42 182 41 177 Q50 159 55 134 Z'],
  ['M02', 'M82 120 Q94 126 106 140 L107 166 Q97 165 87 156 L75 134 Z'],
  ['M02', 'M76 139 Q82 153 100 169 L104 178 Q100 199 88 214 Q79 204 76 187 Q72 165 76 139 Z'],
  ['M12', 'M100 185 Q106 182 108 186 L108 225 L101 228 Q98 213 99 201 Z'],
  ['M08', 'M81 234 Q91 230 107 234 L107 249 C105 264 100 274 88 278 Q79 273 76 259 Q76 243 81 234 Z'],
  ['M07', 'M79 281 C87 275 91 279 92 289 Q92 317 85 339 Q79 344 76 328 Q72 302 79 281 Z'],
  ['M07', 'M94 280 Q102 277 104 283 Q105 310 98 332 L91 342 Q89 323 91 298 Z'],
  ['M09', 'M78 351 Q84 348 88 353 Q90 365 85 381 L78 396 Q74 385 74 371 Z'],
  ['M09', 'M90 354 Q95 350 98 358 Q98 374 93 388 L85 399 Q88 373 90 354 Z'],
];

const FRONT_LANDMARKS = [
  'M94 75 Q101 88 110 97',
  'M77 93 Q84 87 95 91',
  'M72 122 Q78 128 90 132',
  'M71 146 Q72 168 77 180',
  'M85 215 Q96 228 109 235',
  'M54 133 Q48 150 42 174',
  'M38 178 Q30 204 24 217',
  'M82 252 Q75 276 79 304',
  'M91 347 Q96 364 93 388',
];
const BACK_LANDMARKS = [
  'M92 79 Q100 88 110 98',
  'M76 108 Q89 121 103 132',
  'M75 151 Q79 171 94 182',
  'M83 215 Q96 224 110 232',
  'M50 136 Q48 158 41 176',
  'M38 186 Q29 213 24 219',
  'M83 285 Q78 314 83 329',
  'M82 355 Q79 373 82 384',
];

function NeutralPath({ d, strokeWidth = 1.3 }) {
  return (
    <Path d={d} fill={FILL} stroke={OUTLINE}
      strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
  );
}

/**
 * Face/back interactive SVG using existing muscle IDs and selectable regions.
 * No clipping paths (to avoid web/iOS Safari quirks) or hidden layout changes.
 */
export default function AthleticMuscleMap({
  side = 'front',
  colorsByMuscle = {},
  onTouch = () => {},
}) {
  const back = side === 'back';
  const regions = back ? BACK : FRONT;
  const landmarks = back ? BACK_LANDMARKS : FRONT_LANDMARKS;
  return (
    <Svg viewBox="0 0 220 432" width="100%" height="100%"
      accessible accessibilityLabel={back
        ? 'Silhouette musculaire vue de dos'
        : 'Silhouette musculaire vue de face'}>
      <G pointerEvents="none">
        <NeutralPath d={BODY.torso} />
        <NeutralPath d={BODY.neck} strokeWidth={1.2} />
        <NeutralPath d={BODY.head} strokeWidth={1.5} />
        {[false, true].map((mirror) => (
          <G key={mirror ? 'right-body' : 'left-body'}
            transform={mirror ? FLIP : undefined}>
            <NeutralPath d={BODY.leg} />
            <NeutralPath d={BODY.foot} />
            <NeutralPath d={BODY.arm} />
            <NeutralPath d={BODY.hand} strokeWidth={1.1} />
          </G>
        ))}
      </G>

      {[false, true].map((mirror) => (
        <G key={mirror ? 'right-regions' : 'left-regions'}
          transform={mirror ? FLIP : undefined}>
          {regions.map(([id, d], index) => (
            <Path key={id + ':' + index} d={d}
              fill={colorsByMuscle[id] ?? INACTIVE}
              stroke={GAP} strokeWidth={1.45} strokeLinejoin="round"
              onPress={() => onTouch(id)} />
          ))}
          <G pointerEvents="none">
            {landmarks.map((d, i) => (
              <Path key={i} d={d} fill="none" stroke={LANDMARK}
                strokeWidth={.65} strokeLinecap="round" />
            ))}
          </G>
        </G>
      ))}
      <G pointerEvents="none">
        <Path d={back ? 'M110 97 L110 231' : 'M110 103 L110 221'}
          stroke={GAP} strokeWidth={1.2} fill="none" />
        <Path d="M110 76 L110 90" stroke={LANDMARK}
          strokeWidth={.7} fill="none" />
      </G>
    </Svg>
  );
}
