# Travailler sur UGEROD

Ces consignes s'appliquent aux assistants intervenant sur ce dépôt. Les instructions explicites d'Ugo dans la session courante priment ; enregistrer les décisions durables acceptées.

## Démarrer une tâche

1. Lire [UGEROD.md](UGEROD.md), puis le ticket concerné dans son état actuel. Les anciennes conversations et documents de reprise servent d'archives.
2. Vérifier la branche distante `ux-navigation-coach-v1`, sa tête, les changements locaux et les travaux en cours. `main` n'est pas la référence de développement actuelle.
3. Lire les contrats et les fichiers/fonctions effectivement concernés. Séparer comportement attendu, comportement observé et hypothèse ; ne pas transformer un ancien compte rendu en preuve actuelle.
4. Donner un bref constat et poursuivre la demande autorisée. Demander un arbitrage produit manquant, l'accord d'inscription au backlog défini ci-dessous, ou signaler un accès réellement bloquant.

## Une tâche, un suivi

- Utiliser les issues GitHub comme suivi unique. Rechercher un ticket existant avant d'en créer un ; ne pas dupliquer le backlog dans un fichier ou une nouvelle conversation.
- Maintenir la description du ticket : objectif, critères d'acceptation, état (à faire / en cours / à vérifier / terminé), commit ou branche, résultats et prochaine action exacte. Garder les preuves utiles précédentes.
- Signaler dans le ticket la tâche prise en charge et vérifier les travaux concurrents. Ce signalement n'est pas un verrou technique ; relire avant toute écriture partagée.
- Diagnostiquer avant de corriger ; limiter les modifications au problème traité. Ugo arbitre les changements produit/UX ; les corrections techniques déjà autorisées avancent sans nouvelle demande de GO.
- Préserver le travail existant. Pour les écritures distantes, vérifier la tête attendue et refuser les écrasements ; ne pas forcer une branche ni nettoyer les branches sans demande.
- Ne pas considérer une correction codée comme déployée, ni un build réussi comme une validation du parcours utilisateur.

## Accord d'Ugo avant tout ajout au backlog

- Lorsqu'une nouvelle évolution émerge d'une discussion ou d'un arbitrage, l'assistant doit proposer explicitement son inscription au backlog avant de créer un ticket ou d'élargir la portée d'un ticket existant.
- Présenter brièvement le titre et le besoin retenu, puis demander : « Veux-tu que j'ajoute cette évolution au backlog ? » Attendre une réponse explicite. Une idée évoquée, une solution jugée intéressante, un accord sur le principe produit, le silence ou un changement de sujet ne valent pas accord d'inscription.
- Une instruction explicite d'Ugo d'ajouter l'élément identifié vaut déjà accord ; ne pas demander une deuxième confirmation pour la même inscription. Conserver la date et le périmètre de cet accord dans le ticket.
- Sans accord d'inscription, ne pas ajouter l'évolution dans un ticket, une checklist, un commentaire de suivi, un document projet ou un brouillon GitHub pour contourner la règle. Les échanges exploratoires restent dans la conversation.
- Pour éviter les oublis, avant de clore un échange d'arbitrage, rappeler les évolutions évoquées qui restent sans décision d'inscription et demander lesquelles retenir. Une validation groupée est possible si chaque ajout est présenté clairement ; aucun lot implicite.
- Rechercher les doublons après accord, puis créer ou compléter la fiche existante sans étendre le périmètre approuvé.
- Les mises à jour d'avancement, preuves, tests et prochaine action d'une tâche déjà acceptée restent à la charge de l'assistant et ne nécessitent pas un nouvel accord tant que sa portée ne change pas. Un accord d'inscription seul n'autorise pas le développement.
- Pour l'import du backlog Excel, préparer le rapprochement avec les tickets actuels puis faire valider explicitement la liste des ajouts avant leur création ; ne pas importer automatiquement des idées anciennes ou des statuts historiques.

## Garder la continuité

- Enregistrer une décision produit durable dans UGEROD.md ou le contrat concerné dès qu'elle est acceptée, sans attendre une fin de conversation.
- Dans le même chantier que le code, actualiser les règles modifiées ; après vérification, actualiser le ticket avec les preuves et les limites.
- Si la tâche s'arrête, conserver le travail autorisé et noter dans le ticket ce qui est fait, ce qui manque et la prochaine action. Si l'enregistrement échoue, le signaler explicitement.
- Ne pas créer de document de reprise daté à chaque session. Les archives existantes restent conservées ; ne pas prétendre les avoir toutes consolidées.
- Terminer par un bilan court : résultat, vérification, reste éventuel, lien. La tenue du suivi incombe à l'assistant.
- Ces consignes nécessitent un assistant qui lit le dépôt et dispose des accès utiles ; elles n'activent ni synchronisation en arrière-plan ni mémoire universelle entre conversations.

## Supabase

- GitHub conserve les changements attendus ; la base et les fonctions déployées fournissent la preuve de l'état appliqué. Consulter les deux pour une tâche backend.
- Identifier le projet et l'environnement avant toute action. DEV est le périmètre habituel ; STAGING/PROD nécessitent une demande explicite. Ne jamais déduire la cible du seul lien local ou de la branche Git.
- Examiner les définitions effectives, l'historique de migrations et, selon le problème, les logs et contrôles pertinents. Une migration présente dans Git n'est pas une preuve d'application.
- Versionner le SQL et les sources Edge Functions concernés. Associer dans le ticket : commit/fichier, cible nommée, version appliquée ou déployée, date, résultat et limite de la vérification.
- Privilégier les essais locaux/isolés ; tester sur DEV avec fixtures synthétiques et rollback vérifié quand possible, sans polluer l'historique réel.
- Ne pas réécrire une migration déjà appliquée. Ne pas réparer artificiellement le registre ni rejouer tout le répertoire : la dette historique de reproductibilité reste suivie dans #27.
- Ne publier ni .env, clé, token, URL de connexion, donnée personnelle ni export de données utilisateur dans ce dépôt public. Ne jamais demander de secret dans la conversation.

## Vérifier sans surcharger

- Exécuter les contrôles pertinents au changement et annoncer ce qui n'a pas été exécuté. Pour une modification documentaire seule, vérifier les liens et le diff ; aucune QA applicative ou modification de base n'est nécessaire.
- Respecter [le contrat Composer](docs/COMPOSER_UX_CONTRACT.md) et [le contrat des thèmes](docs/UX_THEME_CONTRACT.md). Vérifier les deux thèmes pour une modification d'interface concernée.
- Avant de coder avec Expo, vérifier package.json et package-lock.json puis lire la documentation officielle de la version installée. Les deux déclarent actuellement SDK 54 (~54.0.0) : https://docs.expo.dev/versions/v54.0.0/ . L'ancienne mention SDK 57 ne correspondait pas aux dépendances ; aucune montée de version n'est demandée.
- Avant une commande Supabase, vérifier la version du CLI, son aide et la cible explicite ; consulter la documentation actuelle.
