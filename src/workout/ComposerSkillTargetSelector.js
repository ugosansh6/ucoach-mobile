import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function ComposerSkillTargetSelector({
  visible, optional, selectedPath, options = [], loading, error, onRetry,
  onOpen, onChange, onRemove, colors, fontFamilies,
}) {
  const [showAll, setShowAll] = useState(false);
  const text = { color: colors.text, fontFamily: fontFamilies.medium, fontSize: 14 };
  const action = { ...text, color: colors.accent };
  if (!visible) return (
    <Pressable onPress={onOpen} accessibilityRole="button" style={{ paddingVertical: 14 }}>
      <Text style={action}>Ajouter un objectif technique</Text>
    </Pressable>
  );
  const knownTarget = options.find((option) => option.key === selectedPath);
  function choice(key, label) {
    const checked = selectedPath === key;
    return (
      <Pressable key={key ?? 'automatic'} onPress={() => onChange(key)}
        accessibilityRole="radio" accessibilityState={{ checked }} aria-checked={checked}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10,
          padding: 12, borderWidth: 1, borderRadius: 12,
          borderColor: checked ? colors.accent : colors.border,
          backgroundColor: checked ? colors.accentSoft : colors.surface }}>
        <Ionicons name={checked ? 'radio-button-on' : 'radio-button-off'}
          size={19} color={checked ? colors.accent : colors.textSecondary} />
        <Text style={{ ...text, flex: 1 }}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 10, paddingTop: 14 }}>
      <Text style={{ ...text, fontFamily: fontFamilies.bold }}>Mouvement à travailler</Text>
      {optional ? <Text style={{ ...text, color: colors.textSecondary, fontSize: 12 }}>
        Un objectif complémentaire. Tu conserves ta dominante.
      </Text> : null}
      {choice(null, 'UGEROD choisit')}
      {options.filter((option, index) => showAll || index < 4 || option.key === selectedPath)
        .map((option) => choice(option.key, option.name))}
      {selectedPath && !knownTarget ? (
        <Text style={{ ...text, color: colors.textSecondary }}>
          Objectif enregistré : {selectedPath}. {loading ? 'Chargement du catalogue…' : 'Choix conservé ; disponibilité à revalider.'}
        </Text>
      ) : null}
      {loading ? <ActivityIndicator color={colors.accent} accessibilityLabel="Chargement des mouvements techniques" /> : null}
      {error ? <Pressable onPress={onRetry} accessibilityRole="button" style={{ paddingVertical: 8 }}>
        <Text style={action}>Catalogue indisponible · Réessayer</Text>
      </Pressable> : !loading && options.length === 0 ? <Text style={{ ...text, color: colors.textSecondary }}>
        Aucun parcours technique disponible pour le moment.
      </Text> : null}
      {options.length > 4 ? <Pressable onPress={() => setShowAll((value) => !value)}
        accessibilityRole="button" accessibilityState={{ expanded: showAll }} aria-expanded={showAll} style={{ paddingVertical: 8 }}>
        <Text style={action}>{showAll ? 'Réduire la liste' : 'Voir tous les mouvements'}</Text>
      </Pressable> : null}
      {optional ? <Pressable onPress={onRemove} accessibilityRole="button" style={{ paddingVertical: 8 }}>
        <Text style={action}>Retirer l’objectif technique</Text>
      </Pressable> : null}
    </View>
  );
}
