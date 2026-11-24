import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fontFamilies } from '../../constants/typography';

function orientationLabel(intent) {
  if (['TECHNIQUE', 'COACH_TECHNIQUE'].includes(intent?.key)) return 'Technique';
  const focus = String(intent?.focus ?? '').replace(/\s/g, '').toLowerCase();
  return {
    strength: 'Force', conditioning: 'Endurance', musclegain: 'Muscle',
    fatloss: 'Perte de poids', generalfitness: 'Forme',
  }[focus] || String(intent?.label ?? 'Séance').split('·')[0].trim();
}

// Only presents the current choices. The composer still owns every selection
// and the shared engine still owns prescriptions and duration validation.
export default function ComposerMovementOverview({ minutes, environment, intent, regions, technicalTarget, colors }) {
  const styles = makeStyles(colors);
  const cards = [
    { key: 'duration', icon: 'time-outline', value: `${minutes} min`, label: `Durée totale : ${minutes} minutes` },
    { key: 'environment', icon: 'location-outline', value: environment, label: `Lieu : ${environment}` },
    { key: 'orientation', icon: 'flag-outline', value: orientationLabel(intent), label: `Orientation : ${intent?.label ?? orientationLabel(intent)}` },
  ];
  return <View style={styles.overview} testID="movement-overview">
    <View style={styles.summaryRow}>
      {cards.map((card) => <View key={card.key} accessible accessibilityLabel={card.label}
        testID={`movement-summary-${card.key}`} style={styles.summaryCard}>
        <View style={[styles.iconCircle, card.key === 'orientation' && styles.orientationCircle]}>
          <Ionicons name={card.icon} size={22} color={card.key === 'orientation' ? colors.secondaryAccent : colors.accent} accessible={false} />
        </View>
        <Text style={styles.summaryValue}>{card.value}</Text>
      </View>)}
    </View>
    {regions.length ? <View accessible accessibilityLabel={`Zones de travail : ${regions.join(', ')}`}
      style={styles.regionsCard} testID="movement-summary-regions">
      <View style={styles.iconCircle}>
        <Ionicons name="body-outline" size={22} color={colors.accent} accessible={false} />
      </View>
      <Text style={styles.regionsValue}>{regions.join(' · ')}</Text>
    </View> : null}
    {technicalTarget ? <View style={styles.tags}>
      {technicalTarget ? <View style={styles.target}>
        <Ionicons name="sparkles-outline" size={14} color={colors.secondaryAccent} accessible={false} />
        <Text style={styles.targetText}>{technicalTarget}</Text>
      </View> : null}
    </View> : null}
  </View>;
}

export function ComposerMovementTabs({ blocks, selectedIndex, onSelect, colors }) {
  const styles = makeStyles(colors);
  return <View accessibilityRole="tablist" accessibilityLabel="Blocs de la séance" style={styles.tabs}>
    {blocks.map((block, index) => <Pressable key={`${block.type}-${index}`}
      accessibilityRole="tab" accessibilityState={{ selected: index === selectedIndex }} aria-selected={index === selectedIndex}
      accessibilityLabel={`${block.label}, ${block.minutes} minutes`}
      onPress={() => onSelect(index)}
      style={({ pressed }) => [styles.tab, index === selectedIndex && styles.tabSelected, pressed && styles.pressed]}>
      <Text style={[styles.tabName, index === selectedIndex && styles.tabTextSelected]}>{block.label}</Text>
      <Text style={[styles.tabMinutes, index === selectedIndex && styles.tabTextSelected]}>{block.minutes} min</Text>
    </Pressable>)}
  </View>;
}

function makeStyles(colors) {
  return StyleSheet.create({
    overview: { marginTop: 18, gap: 12 },
    summaryRow: { flexDirection: 'row', gap: 8 },
    summaryCard: { flex: 1, minWidth: 0, minHeight: 102, paddingHorizontal: 5, paddingVertical: 14, gap: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    orientationCircle: { backgroundColor: colors.secondaryAccentSoft },
    summaryValue: { fontFamily: fontFamilies.bold, fontSize: 16, lineHeight: 22, textAlign: 'center', color: colors.text, maxWidth: '100%' },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    regionsCard: { padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
    regionsValue: { flex: 1, minWidth: 0, fontFamily: fontFamilies.semiBold, fontSize: 15, lineHeight: 22, color: colors.text },
    target: { flexDirection: 'row', gap: 6, alignItems: 'center', maxWidth: '100%', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.secondaryAccentSoft },
    targetText: { flexShrink: 1, fontFamily: fontFamilies.semiBold, fontSize: 12, lineHeight: 18, color: colors.text },
    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
    tab: { flexGrow: 1, flexBasis: 0, minWidth: 120, minHeight: 76, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'center', gap: 5 },
    tabSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
    tabName: { fontFamily: fontFamilies.bold, fontSize: 17, lineHeight: 23, color: colors.text },
    tabMinutes: { fontFamily: fontFamilies.medium, fontSize: 14, lineHeight: 20, color: colors.textSecondary },
    tabTextSelected: { color: colors.textOnAccent },
    pressed: { opacity: 0.76 },
  });
}
