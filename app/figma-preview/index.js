import { Link } from 'expo-router';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

const ROUTES = [
  ['Dashboard', '/(tabs)'],
  ['Progression', '/(tabs)/progression'],
  ['Programmes', '/(tabs)/programmes'],
  ['Bibliothèque', '/(tabs)/library'],
  ['Préparation', '/workout/preparation'],
  ['Builder', '/workout/builder'],
  ['Séance externe', '/workout/external'],
  ['Records / PR', '/progression/records'],
  ['Profil', '/profile'],
];

export default function FigmaPreviewIndex() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>UGEROD · FIGMA PREVIEW</Text>
        <Text style={styles.title}>Écrans réels</Text>
        <Text style={styles.body}>
          Ce hub existe uniquement sur la branche ui-figma-preview. Chaque lien ouvre la vraie route de l’application avec ses vrais composants.
        </Text>

        <View style={styles.list}>
          {ROUTES.map(([label, href]) => (
            <Link key={href} href={href} style={styles.link}>
              {label}
            </Link>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#07090C' },
  content: { padding: 24, paddingBottom: 60 },
  eyebrow: {
    color: '#98A2B3',
    fontFamily: 'Manrope_700Bold',
    fontSize: 11,
    letterSpacing: 1.1,
  },
  title: {
    marginTop: 10,
    color: '#F7F9FC',
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 42,
    lineHeight: 44,
  },
  body: {
    marginTop: 10,
    color: '#98A2B3',
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
  list: { marginTop: 28, gap: 12 },
  link: {
    paddingHorizontal: 18,
    paddingVertical: 17,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#11151A',
    color: '#F7F9FC',
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 15,
  },
});
