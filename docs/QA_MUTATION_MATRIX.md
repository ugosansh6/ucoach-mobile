# UGEROD — QA de mutation de séance

## Objectif

Cette QA couvre la vie réelle d'une séance après génération sur les quatre environnements :

- HOME
- BOX
- GYM
- OUTDOOR

Elle ne remplace pas les QA de génération / progression longitudinale. Elle protège les mutations utilisateur et le cycle de vie du Player.

## Parcours testé

Pour chaque environnement, `qa_session_mutation_lifecycle_v1` exécute réellement :

1. génération avec l'autorité backend utilisée en production ;
2. tentative d'exécution avant démarrage — doit être bloquée ;
3. Plan B complet avant démarrage ;
4. vérification que la nouvelle séance est réellement différente ;
5. vérification de conservation du check-in et de l'environnement ;
6. démarrage explicite de la séance ;
7. Plan B après démarrage — doit être bloqué ;
8. tentative d'exécution WOD avant reveal/start — doit être bloquée ;
9. réalisation d'un exercice visible servant de progression protégée ;
10. swap / Adapter sur un exercice sûr ;
11. adaptation globale `MORE_FATIGUED` ;
12. vérification que le `session_id` reste identique ;
13. vérification que la progression déjà réalisée ne change pas ;
14. vérification du focus Gym et du terrain Outdoor ;
15. vérification que le WOD est encore caché ;
16. tentative de démarrage WOD avant reveal — doit être bloquée ;
17. reveal WOD ;
18. démarrage WOD ;
19. réalisation partielle du WOD ;
20. nouvelle adaptation fatigue pour confirmer la protection du WOD démarré ;
21. completion via `complete_workout_session_v3` ;
22. vérification que la séance complétée compte bien comme entraînement.

## Invariants de release

La matrice échoue si l'un de ces invariants casse :

- l'environnement change d'identité ;
- Plan B ne remplace pas proprement une séance non démarrée ;
- Plan B reste disponible après start ;
- le check-in dérive pendant Plan B ;
- Adapter crée une nouvelle séance ;
- Adapter crée une dette ;
- une partie déjà réalisée est réécrite ;
- le focus musculaire Gym change pendant adaptation ;
- le terrain Outdoor change pendant adaptation/completion ;
- une exécution est persistée avant `started_at` ;
- une exécution WOD est persistée avant reveal + WOD start ;
- le WOD peut démarrer avant reveal ;
- le WOD commencé est modifié par une adaptation fatigue ;
- la completion ne ferme pas correctement la séance.

## Rollback

Chaque scénario tourne dans une sous-transaction PostgreSQL et déclenche volontairement `QA_FORCE_ROLLBACK`.

Le résultat contrôle ensuite que les compteurs sont revenus à l'état initial pour :

- `workout_sessions` ;
- `workout_session_swap_history` ;
- `user_skill_session_preferences` ;
- `exercise_logs`.

La QA peut donc être exécutée sur DEV sans laisser de séance, de swap ou d'historique artificiel.

## Exécution

Scénario unique :

```sql
select public.qa_session_mutation_lifecycle_v1(
  '<qa-user-id>'::uuid,
  'GYM',
  current_date + 45
);
```

Matrice complète :

```sql
select public.qa_session_mutation_matrix_v1(
  '<qa-user-id>'::uuid,
  current_date + 45
);
```

Ces fonctions sont réservées aux opérateurs : elles ne sont pas exécutables par `anon` ou `authenticated`.

## Dernière validation DEV

La matrice complète a été exécutée après création du contrat Point 5 et a retourné `pass = true` pour HOME, BOX, GYM et OUTDOOR, avec rollback propre sur les quatre scénarios.
