# UGEROD — point d'entrée commun

Ce fichier conserve les repères et décisions durables. Les tâches et leurs preuves vivent dans les [issues GitHub](https://github.com/ugosansh6/ucoach-mobile/issues), sans backlog parallèle. L'assistant maintient ces références pendant le travail ; Ugo décrit son besoin et arbitre les choix produit.

## Reprendre depuis une nouvelle conversation

Lire [AGENTS.md](AGENTS.md), consulter ce fichier sur la branche de référence, ouvrir le ticket pertinent puis vérifier le code et, si nécessaire, Supabase. Ne pas demander à Ugo un document de reprise si ces sources sont accessibles.

Lien de démarrage : https://github.com/ugosansh6/ucoach-mobile/blob/ux-navigation-coach-v1/UGEROD.md

Un nouveau chat doit avoir accès au dépôt et lire ces consignes. Aucun mécanisme installé ici ne charge automatiquement le contexte dans tous les chats et aucun processus de synchronisation ne tourne en arrière-plan.

## Références

| Élément | Référence et usage |
| --- | --- |
| Dépôt | ugosansh6/ucoach-mobile |
| Branche de travail | ux-navigation-coach-v1 ; vérifier sa tête au début de chaque tâche |
| Branche par défaut GitHub | main ; ne pas la traiter comme la version actuelle ni y reporter les changements par défaut |
| Interface | React Native / Expo ; SDK à vérifier dans les dépendances |
| Backend de travail | Supabase, projet nommé ugoach (DEV) ; retrouver et vérifier son identifiant via l'accès connecté avant toute requête |
| Préproduction | Projet nommé ugerod-staging ; aucune réactivation ou écriture sans demande explicite |
| Production | Aucune cible n'est présumée validée par ce fichier |
| Publication web DEV | [Workflow Deploy UGEROD Web](.github/workflows/deploy-ugerod-web.yml), déclenché sur les pushes de la branche de référence ; lire le run du commit concerné |

Le statut des projets Supabase peut changer : le relire au moment utile. Les noms ci-dessus sont des repères, pas une autorisation de modifier un environnement.

## Décisions produit courantes

Décision confirmée le 12/11/2026, à modifier lorsqu'Ugo valide une évolution :

| Parcours | Règle attendue |
| --- | --- |
| Aujourd'hui | Le Coach compose automatiquement la séance selon la politique applicable |
| Aujourd'hui / Maison classique | Skill + WOD réels et exécutables ; incompatibilité explicite si une séance valide est impossible, sans READY trompeur |
| Ma semaine / Composer | Conserver exactement les blocs choisis et leur ordre ; ne pas ajouter un bloc pour appliquer la politique automatique |
| Renforcement seul depuis Ma semaine | Strength seul doit être exécutable, y compris à la maison |
| Check-in Jour J | Adaptation contrôlée des prescriptions, du contexte et de la sécurité ; aucune reconstruction silencieuse de l'architecture choisie |
| Séance commencée | Préserver l'identité de séance et les éléments déjà réalisés |

Ces règles décrivent la cible ; elles ne certifient pas que tous les cas fonctionnent. Les vérifications restantes sont dans les tickets.

Contrats existants à lire selon le chantier :
- [Composer et expérience Coach](docs/COMPOSER_UX_CONTRACT.md).
- [Thèmes clair/sombre et typographie](docs/UX_THEME_CONTRACT.md) : code de page commun, palettes historiques conservées.
- [Mutation et cycle de vie d'une séance](docs/QA_MUTATION_MATRIX.md).
- [Évolutions des séances et limites de validation](docs/session-evolutions-2026-10-28.md), compte rendu historique à confronter à l'état actuel.

## Où reprendre le travail

Repères établis le 13/11/2026 ; le statut détaillé reste dans chaque ticket :

- [#26 — Aujourd'hui Maison : Skill absent sur 30 min](https://github.com/ugosansh6/ucoach-mobile/issues/26) : priorité fonctionnelle identifiée.
- [#3 — Composer vers Player et historique](https://github.com/ugosansh6/ucoach-mobile/issues/3) : validations réelles iPhone et critères restants. Les routines Mobilité/Gainage 10–15 min et badges sont identifiés dans la suite produit de ce ticket.
- [#27 — Correspondance migrations Git / DEV](https://github.com/ugosansh6/ucoach-mobile/issues/27) : dette de reproductibilité à résoudre avant promotion.
- [PR #2 — Débrief expérimental](https://github.com/ugosansh6/ucoach-mobile/pull/2) : exploration en pause, à reprendre seulement après arbitrage produit.

Les priorités peuvent être changées par Ugo. Lire les tickets récents avant d'agir et actualiser ces liens si le découpage du travail évolue.

## Suivre un changement Supabase

Utiliser le même ticket pour les parties interface et backend du même besoin. Y conserver, pour chaque environnement concerné :

| Preuve | Ce qu'il faut enregistrer |
| --- | --- |
| SQL ou fonction versionnés | Chemin et commit Git |
| Base modifiée | Migration effectivement appliquée, cible et date |
| Edge Function déployée | Nom, version déployée, cible et date ; un fichier Git ne suffit pas |
| Contrôle backend | Cas testé, résultat et rollback/nettoyage le cas échéant |
| Contrôle utilisateur | Parcours, appareil/environnement, résultat ou mention à faire |

Si l'une des preuves manque, marquer cet étage non vérifié. L'absence d'accès à Supabase ne doit jamais être masquée par un succès côté GitHub.

Le contrôle en lecture seule du 13/11 a confirmé un écart entre les identifiants des migrations Git et le registre DEV, désormais suivi dans #27. Il ne constitue ni une comparaison complète du schéma ni une réparation. [L'audit BASE-005 antérieur](docs/backend/BASE-005_DEV_GIT_MIGRATION_AUDIT_2026-08-29.md) reste une preuve historique. Ne pas déclarer une reconstruction depuis Git validée avant un replay isolé réussi.

## Inscrire une évolution au backlog

**Règle décidée par Ugo le 13/11/2026 : l'assistant propose systématiquement l'inscription d'une nouvelle évolution et attend l'accord explicite d'Ugo avant tout ajout.**

1. Une idée ou un arbitrage émerge dans la conversation.
2. L'assistant reformule brièvement l'évolution et demande si elle doit être inscrite au backlog.
3. Ugo accepte, refuse ou demande de poursuivre la réflexion. Sans accord, aucune entrée de suivi n'est créée.
4. Après accord, l'assistant recherche un doublon et crée ou complète le ticket correspondant, avec le périmètre validé et la date de l'accord.

Une demande explicite « ajoute cette évolution au backlog » constitue déjà l'accord et n'appelle pas une seconde confirmation. Une validation groupée exige une liste explicite des ajouts.

Cette règle couvre aussi l'ajout d'une nouvelle évolution à un ticket existant : ne pas la glisser dans sa checklist ou un document de suivi. En fin d'arbitrage, rappeler les idées encore sans décision d'inscription pour éviter les oublis. L'agent conseille ; Ugo décide de ce qui entre au backlog. L'inscription seule ne vaut pas lancement du développement.

L'agent continue à actualiser l'avancement, les résultats de tests et la prochaine action des tâches acceptées sans redemander l'accord à chaque mise à jour. L'import historique de l'Excel doit d'abord être rapproché des tickets actuels et la liste des ajouts validée explicitement.

## Valider la fin d'un développement

Règle décidée par Ugo le 13/11/2026 :

1. L'assistant termine les vérifications pertinentes et enregistre le résultat dans le ticket.
2. Il présente ce qui fonctionne, les preuves, les éventuelles réserves et comment vérifier.
3. Il demande systématiquement en fin de développement de la tâche si Ugo souhaite clôturer le ticket ou le garder ouvert.
4. Le ticket reste ouvert, à valider par Ugo, jusqu'à un accord explicite de clôture portant sur ce ticket.
5. Après accord, l'assistant enregistre la date et les réserves éventuellement acceptées puis clôture. Une demande directe de fermeture vaut accord.

Un code enregistré, un déploiement réussi et une validation utilisateur sont des étapes distinctes. Pas de clôture automatique à la fusion sans accord. Une interruption ou un développement partiel donne lieu à une mise à jour d'avancement, sans prétendre que la tâche est terminée.

À la reprise, l'assistant indique brièvement le ticket, la version de code, la cible utile et la prochaine action. À la fin, il vérifie l'enregistrement des modifications et du suivi. Une seule conversation modifie une même tâche à la fois ; il s'agit d'une discipline de coordination, pas d'un verrou technique.

## Format du suivi dans une issue

Garder une seule description à jour, avec l'objectif et les critères d'acceptation, puis :
- état : à faire / en cours / à vérifier / à valider par Ugo / terminé après accord ;
- changements : commit, fichiers et cible ;
- vérifications : exécutées, résultats et limites ;
- prochaine action exacte si la tâche reste ouverte.

En cas de changement de règle produit, actualiser également le contrat concerné dans le même chantier. Les échanges et anciens documents de reprise restent des archives, sans recréer un nouveau compte rendu à chaque session.
