const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'workout', 'preparation.js');

if (!fs.existsSync(filePath)) {
  console.error('ERROR: app/workout/preparation.js introuvable.');
  process.exit(1);
}

const source = fs.readFileSync(filePath, 'utf8');
const startMarker = 'function DurationSlider({';
const endMarker = '\nfunction SectionTitle({';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

if (start === -1 || end === -1) {
  console.error('ERROR: bloc DurationSlider exact introuvable. Aucun fichier modifie.');
  process.exit(1);
}

const replacement = `function DurationSlider({
  value,
  onChange,
}) {
  const [trackWidth, setTrackWidth] =
    useState(0);

  const currentIndex = Math.max(
    0,
    DURATIONS.indexOf(value)
  );

  const step =
    trackWidth > 0
      ? trackWidth /
        (DURATIONS.length - 1)
      : 0;

  /*
   * IMPORTANT MOBILE / IOS
   * ----------------------
   * Le PanResponder doit rester stable pendant tout le drag.
   * Sinon chaque changement de duree rerend le composant et peut remplacer
   * les handlers pendant que le doigt est encore pose sur le curseur.
   * Les refs gardent les valeurs courantes sans recreer le responder.
   */
  const dragOriginXRef = useRef(0);
  const currentIndexRef = useRef(currentIndex);
  const stepRef = useRef(step);
  const trackWidthRef = useRef(trackWidth);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  currentIndexRef.current = currentIndex;
  stepRef.current = step;
  trackWidthRef.current = trackWidth;
  valueRef.current = value;
  onChangeRef.current = onChange;

  const updateFromXRef = useRef(null);

  updateFromXRef.current = (x) => {
    const liveTrackWidth =
      trackWidthRef.current;
    const liveStep = stepRef.current;

    if (!liveTrackWidth || !liveStep) {
      return;
    }

    const clampedX = Math.max(
      0,
      Math.min(liveTrackWidth, x)
    );

    const nextIndex = Math.max(
      0,
      Math.min(
        DURATIONS.length - 1,
        Math.round(clampedX / liveStep)
      )
    );

    const nextValue =
      DURATIONS[nextIndex];

    if (nextValue !== valueRef.current) {
      valueRef.current = nextValue;
      onChangeRef.current(nextValue);
    }
  };

  const knobPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder:
          () => true,
        onStartShouldSetPanResponderCapture:
          () => true,
        onMoveShouldSetPanResponder:
          () => true,
        onMoveShouldSetPanResponderCapture:
          () => true,
        onPanResponderGrant: () => {
          dragOriginXRef.current =
            currentIndexRef.current *
            stepRef.current;
        },
        onPanResponderMove: (
          _event,
          gestureState
        ) => {
          updateFromXRef.current?.(
            dragOriginXRef.current +
              gestureState.dx
          );
        },
        onPanResponderRelease: (
          _event,
          gestureState
        ) => {
          updateFromXRef.current?.(
            dragOriginXRef.current +
              gestureState.dx
          );
        },
        onPanResponderTerminate: (
          _event,
          gestureState
        ) => {
          updateFromXRef.current?.(
            dragOriginXRef.current +
              gestureState.dx
          );
        },
        onPanResponderTerminationRequest:
          () => false,
        onShouldBlockNativeResponder:
          () => true,
      }),
    []
  );

  const knobLeft =
    currentIndex * step;

  const durationColor =
    value <= 30
      ? colors.primaryLight
      : value >= 75
        ? colors.brandRed
        : colors.textPrimary;

  return (
    <View style={styles.durationSliderCard}>
      <View style={styles.durationDigitalPanel}>
        <Text
          style={[
            styles.durationDigitalValue,
            {
              color: durationColor,
            },
          ]}
        >
          {value}
        </Text>

        <Text
          style={[
            styles.durationDigitalUnit,
            {
              color: durationColor,
            },
          ]}
        >
          MIN
        </Text>
      </View>

      <View style={styles.durationSliderRight}>
        <View
          onLayout={(event) => {
            const nextTrackWidth =
              event.nativeEvent.layout.width;

            trackWidthRef.current =
              nextTrackWidth;
            setTrackWidth(
              nextTrackWidth
            );
          }}
          style={styles.durationTrackTouch}
        >
          <View style={styles.durationTrack}>
            <View
              style={[
                styles.durationTrackProgress,
                {
                  width: knobLeft,
                  backgroundColor:
                    durationColor,
                },
              ]}
            />

            <View
              style={styles.durationPressZones}
            >
              {DURATIONS.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityLabel={\`${'${item}'} minutes\`}
                  onPress={() =>
                    onChange(item)
                  }
                  style={styles.durationPressZone}
                />
              ))}
            </View>

            <View
              {...knobPanResponder.panHandlers}
              style={[
                styles.durationKnob,
                {
                  left: knobLeft,
                  borderColor:
                    durationColor,
                },
              ]}
            >
              <Ionicons
                name="stopwatch-outline"
                size={18}
                color={colors.textPrimary}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
`;

const next =
  source.slice(0, start) +
  replacement +
  source.slice(end);

if (next === source) {
  console.error('ERROR: aucune modification produite.');
  process.exit(1);
}

fs.writeFileSync(filePath, next, 'utf8');

console.log('PREPARATION DURATION SLIDER MOBILE V5 APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/preparation.js');
console.log('Preserved UX: 20/30 blue, 45/60 white, 75/90 red; 6 tap zones; drag only on stopwatch knob.');
console.log('Mobile fix: PanResponder stays stable during drag and blocks ScrollView from stealing the gesture.');