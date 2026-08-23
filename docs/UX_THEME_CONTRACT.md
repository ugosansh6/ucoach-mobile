# UGEROD — contrat thème UI

## Règle de base

Une page = un seul code de page.

Il ne doit jamais exister une version `light` et une version `dark` d'un même écran. Le contenu, les composants, les espacements, les tailles de police, les interactions et les évolutions UX sont communs. Seuls les tokens visuels issus du thème changent.

## Modes

- `dark` : palette historique UGEROD, fond sombre, accent principal bleu, accent secondaire rouge.
- `light` : fond blanc/clair, accent principal kaki, accent secondaire orange.

Le thème sombre doit rester visuellement cohérent avec le reste de l'application tant que les autres pages n'ont pas été reprises : bleu/rouge historiques conservés. Le thème clair est la déclinaison blanc/kaki/orange.

## Source d'autorité

- `src/constants/uxTheme.js` : palettes sémantiques clair/sombre.
- `src/contexts/UgerodThemeContext.js` : préférence persistée et accès runtime.

Une page migrée utilise `useUgerodTheme()` et des tokens sémantiques (`background`, `surface`, `accent`, `secondaryAccent`, `text`, `border`, etc.). Elle ne branche pas sa logique métier selon le thème.

## Règle d'évolution

Toute correction faite sur une page — contenu, hiérarchie, taille de police, composant, wording, interaction, accessibilité, comportement — doit être faite une seule fois et bénéficier automatiquement aux deux thèmes.

Aucune nouvelle fonctionnalité ne doit être implémentée uniquement pour un thème.

Une évolution de design commune peut changer tailles, espacements ou composants pour les deux modes. En revanche, les couleurs restent propres au mode : bleu/rouge en sombre, kaki/orange en clair.

## Migration progressive

La passe UX reste page par page. Les pages non encore auditées conservent temporairement leur thème sombre historique et leurs tailles actuelles. On ne modifie pas globalement leurs tailles ou leur structure avant leur audit dédié.

Quand une page est reprise, elle est migrée vers les tokens partagés clair/sombre dans le même chantier, avec un seul code d'interface.
