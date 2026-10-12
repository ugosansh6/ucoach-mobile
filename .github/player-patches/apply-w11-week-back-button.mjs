import fs from 'node:fs';

const file = 'app/(tabs)/planning.js';
let source = fs.readFileSync(file, 'utf8');

const oldHeader = `          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={[styles.eyebrow, { color: palette.accent }]}>COACH</Text>
              <Text style={[styles.title, { color: palette.text }]}>MA SEMAINE.</Text>
            </View>
            <TouchableOpacity
              style={[styles.profileButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
              onPress={() => router.push('/profile')}
              accessibilityRole="button"
            >
              <Ionicons name="person-outline" size={20} color={palette.text} />
            </TouchableOpacity>
          </View>`;

const newHeader = `          <View style={styles.header}>
            <TouchableOpacity
              style={[styles.backButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
              onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}
              accessibilityRole="button"
              accessibilityLabel="Retour"
              accessibilityHint="Revenir à l’écran précédent."
            >
              <Ionicons name="arrow-back" size={20} color={palette.text} />
            </TouchableOpacity>
            <View style={styles.headerText}>
              <Text style={[styles.eyebrow, { color: palette.accent }]}>COACH</Text>
              <Text style={[styles.title, { color: palette.text }]}>MA SEMAINE.</Text>
            </View>
            <TouchableOpacity
              style={[styles.profileButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
              onPress={() => router.push('/profile')}
              accessibilityRole="button"
            >
              <Ionicons name="person-outline" size={20} color={palette.text} />
            </TouchableOpacity>
          </View>`;

if (!source.includes(oldHeader)) {
  throw new Error('Planning header anchor not found');
}
source = source.replace(oldHeader, newHeader);

const oldStyles = `  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  headerText: { flex: 1 },`;
const newStyles = `  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  backButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0 },`;

if (!source.includes(oldStyles)) {
  throw new Error('Planning header styles anchor not found');
}
source = source.replace(oldStyles, newStyles);

fs.writeFileSync(file, source);
