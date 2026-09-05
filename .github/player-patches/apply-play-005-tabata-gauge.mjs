import fs from 'node:fs';

function mustReplace(text, label, search, replacement) {
  const next = text.replace(search, replacement);
  if (next === text) throw new Error(`PLAY-005 radial patch failed: ${label}`);
  return next;
}

const path = 'app/workout/session-focused-core.js';
let text = fs.readFileSync(path, 'utf8');

if (!text.includes('const TABATA_RING_SEGMENTS = 48;')) {
  text = mustReplace(
    text,
    'add radial ring constant',
    "const TABATA_REST_COLOR = '#5E6633';",
    "const TABATA_REST_COLOR = '#5E6633';\nconst TABATA_RING_SEGMENTS = 48;"
  );
}

text = mustReplace(
  text,
  'derive active radial segments',
  "  const progressPercent = totalSeconds > 0\n    ? Math.max(0, Math.min(100, (elapsed / totalSeconds) * 100))\n    : 0;\n  const phaseColor = resting ? TABATA_REST_COLOR : TABATA_WORK_COLOR;",
  "  const progressPercent = totalSeconds > 0\n    ? Math.max(0, Math.min(100, (elapsed / totalSeconds) * 100))\n    : 0;\n  const activeRingSegments = Math.max(0, Math.min(\n    TABATA_RING_SEGMENTS,\n    Math.ceil((segmentProgressPercent / 100) * TABATA_RING_SEGMENTS)\n  ));\n  const phaseColor = resting ? TABATA_REST_COLOR : TABATA_WORK_COLOR;"
);

const oldTimer = `      <Text style={styles.timerValue}>{remaining}</Text>
      <Text style={styles.timerUnit}>secondes</Text>

      <View style={styles.tabataCountdownWrap}>
        <View style={styles.tabataCountdownHeader}>
          <Text style={styles.tabataCountdownLabel}>
            {resting ? 'Décompte récupération' : 'Décompte effort'}
          </Text>
          <Text style={[styles.tabataCountdownValue, { color: phaseColor }]}>
            {remaining}s / {segmentDuration}s
          </Text>
        </View>
        <View style={styles.tabataCountdownTrack}>
          <View
            style={[
              styles.tabataCountdownFill,
              {
                width: \`${'${segmentProgressPercent}'}%\`,
                backgroundColor: phaseColor,
              },
            ]}
          />
        </View>
      </View>`;

const newTimer = `      <View style={styles.tabataTimerRing}>
        {Array.from({ length: TABATA_RING_SEGMENTS }).map((_, index) => {
          const angle = (index / TABATA_RING_SEGMENTS) * Math.PI * 2 - Math.PI / 2;
          const radius = 88;
          const active = index < activeRingSegments;
          return (
            <View
              key={\`tabata-ring-${'${index}'}\`}
              style={[
                styles.tabataRingTick,
                {
                  left: 100 + Math.cos(angle) * radius - 2.5,
                  top: 100 + Math.sin(angle) * radius - 6,
                  backgroundColor: active ? phaseColor : colors.border,
                  transform: [{ rotate: \`${'${(index / TABATA_RING_SEGMENTS) * 360}'}deg\` }],
                },
              ]}
            />
          );
        })}
        <View style={styles.tabataTimerCenter}>
          <Text style={styles.timerValue}>{remaining}</Text>
          <Text style={styles.timerUnit}>secondes</Text>
        </View>
      </View>`;

text = mustReplace(text, 'replace horizontal countdown with radial timer', oldTimer, newTimer);

const oldStyles = `    tabataCountdownWrap: { width: '100%', marginTop: 20 },
    tabataCountdownHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    tabataCountdownLabel: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.textSecondary,
    },
    tabataCountdownValue: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 12,
    },
    tabataCountdownTrack: {
      width: '100%',
      height: 14,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: colors.surfacePressed,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabataCountdownFill: { height: '100%', borderRadius: 999 },`;

const newStyles = `    tabataTimerRing: {
      width: 200,
      height: 200,
      marginTop: 12,
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabataRingTick: {
      position: 'absolute',
      width: 5,
      height: 12,
      borderRadius: 3,
    },
    tabataTimerCenter: {
      width: 152,
      height: 152,
      borderRadius: 76,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },`;

text = mustReplace(text, 'replace linear gauge styles with radial ring styles', oldStyles, newStyles);

if (!text.includes('TABATA_RING_SEGMENTS = 48')) throw new Error('Missing radial segment constant');
if (!text.includes('tabataTimerRing')) throw new Error('Missing radial timer ring');
if (text.includes('tabataCountdownTrack')) throw new Error('Legacy horizontal countdown still present');

fs.writeFileSync(path, text);
console.log('PLAY-005 radial Tabata timer patch applied.');
