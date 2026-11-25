import { Text, View } from 'react-native';

// Presentation of the producer's prescription, never a second time solver.
export default function ComposerOutdoorCardioPreview({ block, minutes, styles }) {
  if (!block) return null;
  const prescription = block.exercises?.[0]?.prescription_json ?? block.exercises?.[0]?.prescription;
  const seconds = block.time?.prescribed_seconds ?? prescription?.execution_target_duration_seconds;
  const executionMinutes = seconds == null ? null : Math.round(Number(seconds) / 60 * 10) / 10;
  return <View style={styles.protocolCard}>
    <Text style={styles.sectionSmallTitle}>TON CARDIO EXTÉRIEUR</Text>
    <Text style={styles.previewHeadline}>{block.mechanic === 'RUN_CONTINUOUS' ? 'Course continue' : 'Intervalles de course'}</Text>
    <Text style={styles.sectionSmallHint}>{minutes} min réservées{executionMinutes != null ? ` · ${executionMinutes} min de protocole` : ''}</Text>
    {prescription?.text ? <Text style={styles.previewExerciseDose}>{prescription.text}</Text> : null}
    <Text style={styles.previewFootnote}>Effort et récupération guidés dans le player.</Text>
  </View>;
}
