import React from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUser } from '../context/UserContext';

const LoginScreen = ({ navigation }: { navigation: any }) => {
  const { updateUser } = useUser();

  const handleQuickLogin = () => {
    // On met à jour l'état global de l'athlète et on passe à la suite
    updateUser({ email: 'athlete@ucoach.app', isAuthenticated: true });
    navigation.navigate('Main');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* HERO HEADER - Typographie Impact */}
        <View style={styles.heroSection}>
          <View style={styles.brandBadge}>
            <Text style={styles.brandBadgeText}>ENGINEERED PERFORMANCE</Text>
          </View>

          <Text style={styles.heroTitle}>
            DOMINATE{'\n'}
            YOUR <Text style={styles.heroHighlight}>WOD.</Text>
          </Text>

          <Text style={styles.heroSub}>
            Chaque athlète possède une signature physique unique. L'IA adapte chaque programmation à ton matériel, ta fatigue et tes objectifs.
          </Text>
        </View>

        {/* SECTION PILIERS / FEATURES */}
        <View style={styles.pillarsContainer}>
          
          <View style={styles.pillarRow}>
            <View style={styles.pillarHeader}>
              <Text style={styles.pillarTag}>01 / ADAPTATIF</Text>
              <Text style={styles.pillarTitle}>SMART WOD PREP</Text>
            </View>
            <Text style={styles.pillarDesc}>
              Saisis ton matériel et tes contraintes du jour. L'IA génère ton WOD optimisé sur-mesure.
            </Text>
          </View>

          <View style={styles.pillarRow}>
            <View style={styles.pillarHeader}>
              <Text style={styles.pillarTag}>02 / PERFORMANCE</Text>
              <Text style={styles.pillarTitle}>TRAIN LIKE A CHAMP</Text>
            </View>
            <Text style={styles.pillarDesc}>
              Suivi personnalisé de tes charges maximales (1RM), capacité cardio et mouvements de gym.
            </Text>
          </View>

          <View style={styles.pillarRow}>
            <View style={styles.pillarHeader}>
              <Text style={styles.pillarTag}>03 / LONGEVITÉ</Text>
              <Text style={styles.pillarTitle}>MAINTAIN THE GAIN</Text>
            </View>
            <Text style={styles.pillarDesc}>
              Prévention active des blessures et ajustement automatique de l'intensité selon ta récupération.
            </Text>
          </View>

        </View>

        {/* BOUTONS D'ACTION */}
        <View style={styles.actionCard}>
          <TouchableOpacity 
            style={styles.primaryBtn} 
            activeOpacity={0.88}
            onPress={handleQuickLogin}
          >
            <Text style={styles.primaryBtnText}>SE CONNECTER</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.secondaryBtn} 
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Onboarding')}
          >
            <Text style={styles.secondaryBtnText}>CRÉER UN COMPTE ATHLÈTE</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07090C' },
  scrollContent: { paddingHorizontal: 22, paddingVertical: 16, justifyContent: 'space-between', flexGrow: 1 },
  heroSection: { marginTop: 10, marginBottom: 28 },
  brandBadge: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(0, 85, 164, 0.2)', borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 4, marginBottom: 16,
  },
  brandBadgeText: { color: '#38BDF8', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  heroTitle: { fontSize: 42, fontWeight: '900', color: '#FFFFFF', lineHeight: 44, letterSpacing: 1, marginBottom: 12 },
  heroHighlight: { color: '#38BDF8' },
  heroSub: { color: '#94A3B8', fontSize: 13, lineHeight: 20, fontWeight: '500' },
  pillarsContainer: { marginVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.1)' },
  pillarRow: { paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.08)' },
  pillarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  pillarTag: { color: '#0055A4', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  pillarTitle: { color: '#38BDF8', fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  pillarDesc: { color: '#CBD5E1', fontSize: 12, lineHeight: 18 },
  actionCard: { marginTop: 24, marginBottom: 10, gap: 12 },
  primaryBtn: {
    backgroundColor: '#0055A4', paddingVertical: 16, borderRadius: 8, alignItems: 'center',
    shadowColor: '#0055A4', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4,
    shadowRadius: 10, elevation: 5,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', letterSpacing: 1.2 },
  secondaryBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)', borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.3)',
    paddingVertical: 15, borderRadius: 8, alignItems: 'center',
  },
  secondaryBtnText: { color: '#38BDF8', fontSize: 13, fontWeight: '800', letterSpacing: 1 },
});

export default LoginScreen;