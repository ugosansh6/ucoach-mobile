export const COLORS = {
  // --- FOND & SURFACES (Effet Carbone / Luxe) ---
  background: '#0B0D10',       // Carbone profond aux reflets bleu nuit très subtils
  surface: '#14181F',          // Surface principale (Cartes, blocs d'exercices)
  surfaceLight: '#1E242E',     // Élément sélectionné, survol ou pilule active
  border: '#2A313D',           // BORDURES fines métalliques (Effet usiné)
  borderGlow: '#0055A4',       // Bordure active ou en surbrillance (Bleu Alpine)

  // --- COULEURS IDENTITAIRES ALPINE (Tricolore Haute Performance) ---
  primary: '#0055A4',          // Bleu Alpine emblématique (Boutons CTA, badges principaux)
  primaryLight: '#2B7FFF',     // Bleu Alpine Électrique (Gradients, états actifs)
  accentRed: '#EF4135',        // Rouge Racing (Alertes, blessures, RPE maximal, Finisher)
  white: '#FFFFFF',            // Blanc Pur (Titres, valeurs clés, contraste maximal)
  
  // --- TEXTES & ÉTATS ---
  text: '#FFFFFF',             // Texte principal
  textDim: '#8C9AAD',          // Texte secondaire (Inspiration instrument de bord)
  textMuted: '#526071',        // Consignes passives / Unités (kg, reps)

  // --- PERFORMANCE & ÉTATS DU WOD ---
  success: '#28A745',          // Vert Drapeau à damier / Validé
  rest: '#3A7CA5',             // Bleu Récupération / Calme
  danger: '#EF4135',           // Rouge Danger
};

export const RADIUS = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

// Effets visuels (Luxe & Performance)
export const SHADOWS = {
  alpineGlow: {
    shadowColor: '#0055A4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
};