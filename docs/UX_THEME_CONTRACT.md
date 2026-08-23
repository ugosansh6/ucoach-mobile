# UGEROD — contrat thème UI

## Règle de base

Une page = un seul code de page.

Il ne doit jamais exister une version `light` et une version `dark` d'un même écran. Le contenu, les composants, les espacements, les tailles de police, les interactions et les évolutions UX sont communs. Seuls les tokens visuels issus du thème changent.

## Modes

- `dark` : fond sombre, accents kaki et orange.
- `light` : fond blanc/clair, accents kaki et orange.

Le bleu historique n'est plus une couleur d'accent de la nouvelle UI. Le rouge historique est remplacé par l'orange pour la nouvelle UI, y compris dans le thème sombre.

## Source d'autorité

- `src/constants/uxTheme.js` : palettes sémantiques clair/sombre.
- `src/contexts/UgerodThemeContext.js` : préférence persistée et accès runtime.

Une page migrée utilise `useUgerodTheme()` et des tokens sémantiques (`background`, `surface`, `accent`, `secondaryAccent`, `text`, `border`, etc.). Elle ne branche pas sa logique métier selon le thème.

## Règle d'évolution

Toute correction faite sur une page — contenu, hiérarchie, taille de police, composant, wording, interaction, accessibilité, comportement — doit être faite une seule fois et bénéficier automatiquement aux deux thèmes.

Aucune nouvelle fonctionnalité ne doit être implémentée uniquement pour un thème.

## Migration progressive

La passe UX reste page par page. Les pages non encore auditées peuvent conserver temporairement le thème historique. Quand une page est reprise, elle est migrée vers les tokens partagés clair/sombre dans le même chantier.
