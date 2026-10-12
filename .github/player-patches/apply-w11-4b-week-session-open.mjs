import fs from 'node:fs';

const path = 'app/(tabs)/planning.js';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  source = source.replace(from, to);
}

replaceOnce(
`import { getWeekSessionExercisePreviews } from '../../src/services/weekSessionPreviewService';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';`,
`import { getWeekSessionExercisePreviews } from '../../src/services/weekSessionPreviewService';
import { reloadWorkoutSession } from '../../src/services/workoutService';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';`,
'import real session opener dependencies'
);

replaceOnce(
`function SessionDetails({ item, exercises, palette }) {`,
`function SessionDetails({ item, exercises, palette, onOpen, opening }) {`,
'SessionDetails signature'
);

replaceOnce(
`      <View style={{ marginTop: 15 }}>
        <ActionButton
          label="VOIR LA SÉANCE"
          icon="arrow-forward-outline"
          primary
          palette={palette}
          onPress={() => item?.sessionId && router.push(\`/workout/\${item.sessionId}\`)}
        />
      </View>`,
`      {item?.displayState !== 'REALISEE' ? (
        <View style={{ marginTop: 15 }}>
          <ActionButton
            label={opening ? 'OUVERTURE…' : item?.displayState === 'ACTIVE' ? 'REPRENDRE LA SÉANCE' : 'OUVRIR LA SÉANCE'}
            icon={item?.displayState === 'ACTIVE' ? 'play-outline' : 'arrow-forward-outline'}
            primary
            palette={palette}
            onPress={() => !opening && onOpen?.(item)}
          />
        </View>
      ) : null}`,
'replace temporary history route'
);

replaceOnce(
`  onDragStart, onDragMove, onDragDrop, onDragCancel,
}) {`,
`  onDragStart, onDragMove, onDragDrop, onDragCancel, onOpenSession, openingSessionId,
}) {`,
'WeekObject props'
);

replaceOnce(
`          ? <SessionDetails item={item} exercises={exercises} palette={palette} />`,
`          ? <SessionDetails
              item={item}
              exercises={exercises}
              palette={palette}
              onOpen={onOpenSession}
              opening={openingSessionId === item?.sessionId}
            />`,
'wire session open into details'
);

replaceOnce(
`  onDragStart, onDragMove, onDragDrop, onDragCancel,
}) {`,
`  onDragStart, onDragMove, onDragDrop, onDragCancel, onOpenSession, openingSessionId,
}) {`,
'DaySection props'
);

replaceOnce(
`              onDragCancel={onDragCancel}
            />`,
`              onDragCancel={onDragCancel}
              onOpenSession={onOpenSession}
              openingSessionId={openingSessionId}
            />`,
'pass session open through DaySection'
);

replaceOnce(
`  const { isDark } = useUgerodTheme();
  const params = useLocalSearchParams();`,
`  const { isDark } = useUgerodTheme();
  const { setGeneratedWorkout } = useWorkout();
  const params = useLocalSearchParams();`,
'use workout context'
);

replaceOnce(
`  const [movingItemId, setMovingItemId] = useState(null);
  const [moveFeedback, setMoveFeedback] = useState(null);`,
`  const [movingItemId, setMovingItemId] = useState(null);
  const [openingSessionId, setOpeningSessionId] = useState(null);
  const [moveFeedback, setMoveFeedback] = useState(null);`,
'opening state'
);

replaceOnce(
`  const handleDragDrop = useCallback((item, pageY) => {
    performMove(item, resolveDropTarget(pageY) ?? dropTargetDate);
  }, [dropTargetDate, performMove, resolveDropTarget]);

  if (action === 'new')`,
`  const handleDragDrop = useCallback((item, pageY) => {
    performMove(item, resolveDropTarget(pageY) ?? dropTargetDate);
  }, [dropTargetDate, performMove, resolveDropTarget]);

  const handleOpenSession = useCallback(async (item) => {
    const sessionId = item?.sessionId ?? null;
    if (!sessionId || openingSessionId) return;

    try {
      setOpeningSessionId(sessionId);
      const restored = await reloadWorkoutSession({ sessionId });
      setGeneratedWorkout(restored);
      router.push('/workout/session');
    } catch (openError) {
      console.warn('[MaSemaine] open session failed', openError);
      showMoveFeedback('Impossible d’ouvrir cette séance pour le moment.');
    } finally {
      setOpeningSessionId(null);
    }
  }, [openingSessionId, setGeneratedWorkout, showMoveFeedback]);

  if (action === 'new')`,
'real session open handler'
);

replaceOnce(
`                  onDragDrop={handleDragDrop}
                  onDragCancel={clearDrag}
                />`,
`                  onDragDrop={handleDragDrop}
                  onDragCancel={clearDrag}
                  onOpenSession={handleOpenSession}
                  openingSessionId={openingSessionId}
                />`,
'pass screen session opener'
);

replaceOnce(
`            <Text style={[styles.shareFootnote, { color: palette.textMuted }]}>La résolution du partage sera branchée avec le chantier Mes modèles / partage.</Text>`,
`            <Text style={[styles.shareFootnote, { color: palette.textMuted }]}>Import par lien ou code bientôt disponible.</Text>`,
'clean share placeholder copy'
);

fs.writeFileSync(path, source);
console.log('W11.4b patch applied');
