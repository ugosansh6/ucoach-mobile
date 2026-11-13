# Transition de fonctionnement — vérification du 13/11/2026

## Résultat et périmètre

Consolidation documentaire et préparation d'import. Aucun changement applicatif, migration SQL, déploiement Edge Function, règle de protection ou workflow ajouté. Priorités produit conservées : #26 et validation E2E #3. Les contrôles techniques supplémentaires proposés en conversation ne sont pas activés.

## Sources examinées

- Document maître UGEROD_REPRISE_2026-10-08_FINAL.md : doctrine et méthode, avec repérage des addenda plus récents.
- UGEROD_REPRISE_2026-10-27_COMPOSER_UI_QA_PR21_FINAL.md : décisions Composer et addenda §§42–49.
- UGEROD_Roadmap_Coach_Intelligent_2026-10-27_MASTER_BACKLOG_COMPOSER_PR21.xlsx : 15 feuilles extraites ; rapprochement de toutes les lignes de 04_BACKLOG et des 62 entrées de 07_DECISIONS.
- Tickets GitHub et métadonnées de PR #1–27 consultés ; documents et arborescence de la branche de référence.
- Dernier succès du workflow web observé : commit 00a0717286f54329c01f1c971b6ce8e96bde16c9. Les commits de méthode suivants ne constituent pas de nouvelles livraisons applicatives.
- Les sources originales restent conservées dans leur emplacement d'origine ; elles n'ont pas été supprimées ni publiées en bloc dans le dépôt public.

Cette passe porte sur les références de travail et les décisions répertoriées ; elle ne certifie pas chaque phrase des anciens handoffs, toutes les conversations ni tout le code de l'application.

## Couverture du rapprochement

| Ensemble | Résultat |
|---|---|
| Backlog source | 280 lignes, 280 identifiants distincts, aucune ligne perdue ; GYM-001..007 reste une ligne groupée |
| Rattachements identifiés | BASE-005 vers #27 ; MSW-015, MSW-045, CMP-010 et CMP-015 vers #3 ; relation de périmètre, pas couverture totale prouvée |
| Réalisation historique déclarée | 85 lignes conservées dans le rapport ; proposition de les archiver sans créer des tickets fermés |
| Candidats restants | 190 lignes présentées à Ugo pour validation avant toute création ; comprennent des idées et travaux futurs à sélectionner |
| Décisions | 62 identifiants préservés avec le statut de source ; DEC-35..37 absents de la source, aucun comblement inventé |
| Tickets modifiés ou créés par cette passe | Aucun |

Le rapport détaillé de rapprochement est remis séparément à Ugo. Ce document n'est pas un second backlog et n'énumère pas de nouvelles évolutions à développer.

## Écarts rendus visibles

1. Des états du handoff du 27/10 précèdent PR #23–25 : utiliser les preuves récentes et les limites de #3/#26.
2. Warm-up/Tabata systématiques dans les anciens documents ne doivent pas modifier une architecture explicitement choisie : décision du 12/11 prioritaire.
3. Le contrat Composer du 14/10 comporte un CTA et des détails de flux révisés ensuite ; un bandeau de lecture oriente vers les décisions plus récentes.
4. Les sources historiques et UX_THEME_CONTRACT divergent sur la palette sombre. Aucune recoloration ni décision produit prise ici ; arbitrage nécessaire avant un changement de palette.
5. La correspondance Git/Supabase n'est pas rétablie par la documentation. #27 conserve l'observation en lecture seule et les étapes de preuve nécessaires ; aucun nouvel audit de base exécuté pendant cette passe.

## Conditions de reprise sans ralentir le développement

Lire UGEROD.md, le ticket concerné et les contrats pertinents. Confirmer version, périmètre, preuves et prochaine action ; reprendre le travail déjà autorisé. Ni l'import complet du backlog ni la résolution d'une contradiction hors du chantier n'est un gate DEV ajouté par cette méthode.

Le contrôle de lecture des fichiers, liens et invariants de reprise est réalisé après enregistrement. Une vraie nouvelle conversation reste un test utilisateur à effectuer : aucun mécanisme ici ne crée automatiquement une conversation ni ne lui garantit l'accès aux connecteurs.

L'import de nouveaux tickets attend la validation explicite de la liste. Aucune clôture n'est déduite d'un statut historique.
