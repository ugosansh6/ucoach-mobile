# UGEROD — contrat UI / thème

## Règle de base

Une page = un seul code de page.

Il ne doit jamais exister une version `light` et une version `dark` d'un même écran. Le contenu, les composants, les espacements, les tailles de police, les interactions et les évolutions UX sont communs. Seuls les tokens visuels issus du thème changent.

## Modes

- `dark` : palette historique UGEROD, fond sombre, accent principal bleu, accent secondaire rouge.
- `light` : fond blanc/clair, accent principal kaki, accent secondaire orange.

Le thème sombre et le thème clair utilisent exactement les mêmes composants. Une évolution du Player doit donc être contrôlée sur les deux thèmes dans le même chantier.

## Source d'autorité

- `src/constants/uxTheme.js` : palettes sémantiques clair/sombre.
- `src/contexts/UgerodThemeContext.js` : préférence persistée et accès runtime.
- `src/constants/typography.js` : contrat typographique.

Une page migrée utilise `useUgerodTheme()` et des tokens sémantiques (`background`, `surface`, `accent`, `secondaryAccent`, `accentSoft`, `secondaryAccentSoft`, `text`, `border`, etc.). Elle ne branche pas sa logique métier selon le thème.

Les couleurs de marque ne sont pas recodées localement dans les Players. Par exemple, un bouton d’action utilise `colors.accent` et une alerte/action secondaire utilise `colors.secondaryAccent`.

## Typographie

### Manrope = interface UGEROD

Manrope est la police de l’interface :

- titres d’écran et de cartes ;
- noms d’exercices ;
- descriptions et consignes ;
- labels ;
- boutons ;
- navigation ;
- champs et textes courants.

Les styles partagés doivent utiliser les familles Manrope définies dans `typography.js`.

### Bebas Neue = données sportives fortes uniquement

Bebas Neue est réservé aux données qui doivent être lues instantanément comme une métrique sportive :

- gros chrono ;
- gros compteur ;
- score / métrique principale.

Il ne doit pas servir de police générique pour les titres, boutons ou textes d’interface.

### Oswald

Oswald ne fait plus partie du contrat du nouveau Player.

La police reste temporairement chargée tant que des écrans historiques non migrés existent encore, mais aucun nouveau composant Player ne doit l’utiliser. Les anciens styles sont supprimés au fur et à mesure de leur nettoyage, sans casser les écrans historiques.

## Couleurs du Player

Le Player ne possède pas de palette locale.

Il utilise notamment :

- `colors.accent` ;
- `colors.accentSoft` ;
- `colors.secondaryAccent` ;
- `colors.secondaryAccentSoft` ;
- `colors.text` ;
- `colors.textSecondary` ;
- `colors.textOnAccent` ;
- `colors.border`.

Conséquence :

- thème clair → kaki / orange ;
- thème sombre → bleu / rouge.

Le WOD, le Tabata et les blocs Salle / Extérieur doivent suivre automatiquement ce contrat.

## Règle d'évolution

Toute correction faite sur une page — contenu, hiérarchie, taille de police, composant, wording, interaction, accessibilité, comportement — doit être faite une seule fois et bénéficier automatiquement aux deux thèmes.

Aucune nouvelle fonctionnalité ne doit être implémentée uniquement pour un thème.

Une évolution de design commune peut changer tailles, espacements ou composants pour les deux modes. En revanche, les couleurs restent propres au mode via les tokens sémantiques.

## Migration progressive

La passe UX reste page par page. Les pages non encore auditées peuvent conserver temporairement leurs anciens styles.

Quand une page est reprise, elle est migrée vers les tokens partagés clair/sombre dans le même chantier, avec un seul code d'interface.

Les anciens styles ou composants ne sont supprimés que lorsqu'ils ne sont plus utilisés par le parcours actif et qu'un filet de QA existe.
