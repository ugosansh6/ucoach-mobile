const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sessionPath = path.join(root, 'app', 'workout', 'session.js');

const raw = fs.readFileSync(sessionPath, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const startMarker = 'function BlockStatus({';
const endMarker = 'function ExerciseStatusModal({';
const start = text.indexOf(startMarker);
const end = text.indexOf(endMarker, start);

if (start === -1 || end === -1) {
  throw new Error('BlockStatus introuvable dans app/workout/session.js');
}

const replacement = `function BlockStatus({
  validated,
  locked,
  selected,
  onPress,
}) {
  if (locked) {
    return (
      <View
        style={styles.exerciseStatus}
      >
        <Ionicons
          name="lock-closed"
          size={16}
          color={colors.textMuted}
        />
      </View>
    );
  }

  if (validated) {
    return (
      <View
        style={[
          styles.exerciseStatus,
          styles.exerciseStatusCompleted,
        ]}
      >
        <Ionicons
          name="checkmark"
          size={16}
          color={colors.brandWhite}
        />
      </View>
    );
  }

  if (onPress) {
    return (
      <Pressable
        onPress={(event) => {
          event?.stopPropagation?.();
          onPress();
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Sélectionner ou désélectionner les exercices du bloc"
        style={({ pressed }) => [
          styles.exerciseStatus,
          selected &&
            styles.exerciseStatusCompleted,
          pressed &&
            styles.blockStatusPressed,
        ]}
      >
        {selected ? (
          <Ionicons
            name="checkmark"
            size={16}
            color={colors.brandWhite}
          />
        ) : null}
      </Pressable>
    );
  }

  return (
    <View style={styles.exerciseStatus} />
  );
}

`;

text = text.slice(0, start) + replacement + text.slice(end);
fs.writeFileSync(sessionPath, text.replace(/\n/g, eol), 'utf8');

console.log('SESSION BLOCK BUTTON PATCH APPLIED SUCCESSFULLY');
console.log('Modified: app/workout/session.js');
console.log('Visual: block selector now uses the exact same 36px circle/check style as exercise status buttons.');
console.log('Behavior: selection/deselection logic unchanged; block validation still only happens via TERMINER.');
