# UGEROD — référence produit et décisions conservées

Consolidation documentaire du 13/11/2026. Ce fichier n'autorise aucune évolution ni déploiement. Les résultats de réalisation restent dans les tickets et leurs preuves. Lire seulement la section utile au chantier.

## Doctrine commune

- Coach simple en surface, intelligent dans ses décisions ; interface simple par défaut et explications à la demande.
- Réutiliser le moteur et les contrats existants ; aucune nouvelle logique métier concurrente dans le front.
- Données brutes immuables, contexte d'effort séparé et provenance vérifiable ; unknown ne signifie pas faiblesse.
- Comparaisons : soi-même, puis objectif, puis population comparable uniquement avec source et méthode fiables.
- Un niveau est propre au mouvement et au protocole ; aucun niveau global arbitraire. Un seuil de capacité n'est pas une prescription de séance.
- Chronos interprétables uniquement sur les fenêtres d'effort contrôlées ; feedback demandé seulement s'il apporte une information utile.
- Conseils précis, causaux et fondés sur les données effectivement disponibles ; aucun récit d'historique inventé ni faux score physiologique.
- Pas de dette de séance, de rattrapage obligatoire ou de motivation punitive.
- L'environnement ne déduit pas le matériel ; une séance future ne prédit ni douleur ni readiness.
- Distinguer dominante, zone, architecture de blocs, mécanique et dose. Conserver les choix utilisateur sous les contrôles de sécurité applicables.
- Les nouvelles données, wearables et extensions sportives restent subordonnés à une utilité et à un arbitrage ; leur mention n'est pas une instruction de les développer.
- Préserver l'existant et avancer page par page ; aucune refonte globale induite par ce changement de méthode.

## Précédence et écarts explicités

| Sujet | Consigne de reprise |
|---|---|
| Aujourd'hui / Ma semaine | Décision explicite du 12/11 dans #3 et #26 : génération classique Maison Skill + WOD ; Composer conserve exactement les blocs choisis et leur ordre. Les anciennes formulations imposant Warm-up/Tabata à toute composition ne doivent pas ajouter ces blocs à une composition enregistrée. |
| Composer / répétition d'exercices | Ajustement du 14/11 dans #3 : une même identité de mouvement peut être choisie dans deux blocs distincts (ex. Air Squat dans Strength puis WOD), sans substitution silencieuse. Chaque occurrence reste une instance exécutable différente. Le choix manuel et son avertissement sont conservés ; une duplication accidentelle du même exercice au sein d'un seul bloc demeure bloquée. |
| Préparation du jour / CTA Composer | Décision UX du 14/11 dans #3 : si toutes les confirmations obligatoires du check-in sont remplies, le CTA affiche « Lancer la séance » ; sinon « Finaliser la séance » reste affiché et permet de compléter les conditions manquantes. Le label ne contourne ni la validation sportive ni la protection d'une autre séance active. |
| WOD d'une séance composée | Décision explicite du 14/11 dans #3 : une séance créée dans Ma semaine expose immédiatement les exercices et la mécanique du WOD choisi, dans « Voici ta séance » et dans le Player, sans bouton « Découvrir le WOD ». Les séances automatiques conservent le masquage progressif. La visibilité ne déclenche ni départ de séance, ni révélation persistée ; au départ réel du WOD, le backend valide `in_progress → wod_revealed → wod_started`. |
| UI Composer historique | Le contrat UX du 14/10 contient des formulations dépassées par les arbitrages du 26–27/10 : date gérée par Ma semaine, CTA Valider ma séance, détails Mouvements progressifs. Consulter les décisions ci-dessous et les sources actuelles avant de modifier l'écran. |
| Thèmes | Le contrat UX_THEME_CONTRACT actuel prévoit un sombre bleu/rouge alors que DEC-33 historique décrit kaki/orange dans les deux thèmes. Contradiction documentaire non tranchée ici : ne pas recolorier l'application pendant la transition ; demander l'arbitrage avant un changement de palette. |
| Réalisation | Le dernier handoff du 27/10 s'arrête à PR #21. Les références #3/#26 du 12/11 et les preuves des PR #23–25 sont plus récentes ; ne pas restaurer leurs anciens statuts. |
| Backend | #27 suit la dette de reconstruction ; aucune égalité Git/DEV ou validation STAGING/PROD n'est présumée. |

## Registre historique des décisions

Source : feuille 07_DECISIONS du backlog compagnon du 27/10/2026, rapprochée du document maître du 08/10 (doctrine) et du handoff du 27/10 (§§42–49 prioritaires pour son état de code). Identifiants et formulations historiques conservés ; application soumise aux précédences ci-dessus. Les mentions livré/validé/à développer sont des statuts de source, pas une recette actuelle. Les trous DEC-35..37 ne sont pas comblés par invention.

| ID | Décision de source | Statut de source et réserve actuelle |
|---|---|---|
| DEC-01 | Ne pas refondre la génération maintenant : elle est considérée comme assez solide pour devenir le socle, tout en restant perfectible. | VALIDÉ |
| DEC-02 | Limiter les règles dures aux contraintes réellement nécessaires : sécurité, douleur, faisabilité matériel/technique et quelques invariants mécaniques. | VALIDÉ |
| DEC-03 | Un WOD jambes peut volontairement être très concentré jambes (Lunge + Squat + Squat Jump). | VALIDÉ |
| DEC-04 | La cohérence entre séances doit regarder la charge réellement réalisée, pas seulement l’étiquette Lower/Full Body. | PRINCIPE VALIDÉ / FORMULE À VALIDER |
| DEC-05 | La donnée brute ne doit jamais être trafiquée pour tenir compte de la difficulté. | VALIDÉ |
| DEC-06 | UGEROD doit collecter le maximum de données sans demander de saisie lorsque l’information est déjà connue. | VALIDÉ |
| DEC-07 | Ne pas chronométrer les temps hors fenêtres sportives contrôlées. | VALIDÉ |
| DEC-08 | Le feedback utilisateur ne doit être demandé que s’il change une décision ou comble une information impossible à déduire. | VALIDÉ |
| DEC-09 | Les conseils Coach doivent être précis et causaux, pas génériques. | VALIDÉ |
| DEC-10 | UGEROD peut contextualiser le niveau par rapport à la population, mais uniquement avec données normatives solides. | VALIDÉ |
| DEC-11 | La page Progression doit être repensée depuis l’UX utilisateur avant tout développement supplémentaire. | VALIDÉ |
| DEC-12 | Même moteur, deux profondeurs de lecture. | VALIDÉ |
| DEC-13 | La motivation ne doit pas reposer sur culpabilisation, dette ou streak obligatoire. | VALIDÉ |
| DEC-14 | La future extension vers sommeil, pas, hydratation, nutrition et wearables doit rester subordonnée à une utilité de coaching explicite. | VALIDÉ |
| DEC-15 | Le moteur long terme doit être indépendant du sport ; Functional Fitness est le premier module, pas l’architecture finale. | VALIDÉ |
| DEC-16 | La roadmap/backlog n’autorise pas une implémentation par elle-même ; un item futur est développé seulement lorsqu’il est explicitement lancé. Les briques déjà validées W1–W4/Skill restent la base à préserver. | VALIDÉ |
| DEC-17 | UGEROD possède son propre référentiel de niveaux ; les sources publiques servent uniquement de contrôle/ancrage documenté. | VALIDÉ |
| DEC-18 | Un standard s’applique uniquement au mouvement et au protocole exacts. | VALIDÉ |
| DEC-19 | Le moteur conserve 5 niveaux internes ; l’utilisateur voit 3 niveaux simples. | VALIDÉ |
| DEC-20 | Les références sont sexuées quand elles diffèrent ; aucun facteur âge universel n’est appliqué. | VALIDÉ |
| DEC-21 | Il n’existe pas de niveau global unique UGEROD. | VALIDÉ |
| DEC-22 | Un test contrôlé exact peut valider immédiatement ; hors test, une mesure exacte demande une confirmation STRICTLY_COMPARABLE. Une série ordinaire ne prouve qu’un plancher. | VALIDÉ |
| DEC-23 | Le seuil suivant est un objectif de capacité, pas une prescription de séance. | VALIDÉ |
| DEC-24 | Les adaptations n’héritent d’un standard parent que si la règle est explicite ; Knee Push-up → Push-up est validé à 40 reps strictes. | VALIDÉ |
| DEC-25 | Aucune deadline de lancement officiel ni de PROD n’est définie. La roadmap ordonne des capacités et de la qualité, pas des dates de release. | VALIDÉ |
| DEC-26 | Skill Curriculum étend les contrats W1–W4 et les skill paths existants ; il ne possède pas sa propre vérité de niveau, de mastery ou de progression. | VALIDÉ |
| DEC-27 | EXERCISE_MASTERY est distinct de LEVEL : 2 exécutions comparables valides permettent la mastery naturelle ; un hard threshold validé peut être un shortcut ; les régressions maîtrisées restent disponibles en fallback. | VALIDÉ |
| DEC-28 | Le mode standard Skill + WOD apprend d’abord passivement. Une calibration dédiée reste rare et n’apparaît que si elle débloque une décision importante ou appartient explicitement à un programme ciblé. | VALIDÉ |
| DEC-29 | Toute fonctionnalité récupérée de l’historique doit consommer les contrats W1–W4/Skill : raw immuable, unknown ≠ weakness, contexte séparé, causalité W3, preuve W4, pas de moteur parallèle. | VALIDÉ |
| DEC-30 | La saisie d’une séance box/externe est gratuite en manuel, collage, dictée native et recherche catalogue ; l’import photo intelligent est Premium. | VALIDÉ — 25/08/2026 |
| DEC-31 | Le Dashboard est une surface de décision et de continuité du Coach : le Coach domine l'Accueil mais ne doit pas avaler le calendrier, l'historique ni les actions manuelles utiles. | VALIDÉ — 08/10/2026 |
| DEC-32 | Le Hero Dashboard expose 3 intentions maximum : séance du Coach, création libre, séance faite ailleurs. Pas d'auto-carousel, pas de loop ; Coach par défaut. | VALIDÉ — 08/10/2026 |
| DEC-33 | L'identité UGEROD est kaki #646F5E + orange #FF6B19 dans les thèmes clair ET sombre ; le thème sombre change les fonds, pas la marque. | VALIDÉ — 08/10/2026 — CONTRADICTION DE PALETTE NON TRANCHÉE |
| DEC-34 | Le thème sombre utilise le même logo que le thème clair sur toutes les pages. | VALIDÉ — 08/10/2026 |
| DEC-38 | « Ma semaine » est consultation-first : UGEROD prépare une trajectoire courte, l’utilisateur peut ne rien faire, co-construire ou créer librement ; aucun bouton de validation de semaine. | VALIDÉ — 12/10/2026 |
| DEC-39 | Le Dashboard ne doit avoir qu’un accès principal à « Ma semaine ». Le Hero 2 devient la porte de prise de contrôle ; la zone temporelle peut montrer un aperçu futur mais sans second CTA vers la même page. | VALIDÉ — 12/10/2026 |
| DEC-40 | Ne jamais demander « Laisser UGEROD gérer ». Fermer une intention future sans action signifie automatiquement que le Coach continue à gérer et générera au jour J si nécessaire. | VALIDÉ — 12/10/2026 |
| DEC-41 | Dans « Composer avec UGEROD », les choix structurants de l’utilisateur (blocs, exercices choisis, mécanique) sont conservés ; le jour J UGEROD peut ajuster les prescriptions fines (reps, charge, volume, repos) après check-in. | VALIDÉ — 12/10/2026 |
| DEC-42 | Les jours de la semaine sont souples. Le déplacement utilisateur se fait par drag & drop intra-semaine, sans bouton « Déplacer ». Une séance non réalisée ne crée ni dette, ni retard, ni rattrapage obligatoire. | VALIDÉ — 12/10/2026 |
| DEC-43 | Une séance USER_COMPOSED VALIDÉE est enregistrée automatiquement et durablement dans Mes séances comme template personnel. La date dépend uniquement de Ma semaine ; chaque usage est une occurrence autonome, l'exécution un snapshot distinct. | VALIDÉ — ACTUALISÉ 26/10/2026 |
| DEC-44 | Un programme structuré progresse par complétion/validation des expositions, pas par simple passage du calendrier. Lorsqu’un programme est actif, il devient l’ancre de la semaine ; l’utilisateur peut faire autre chose sans quitter le programme. | VALIDÉ — 12/10/2026 |
| DEC-45 | Une séance prête conserve un mini check-in le jour J. UGEROD suit « conserver → adapter → remplacer en dernier recours ». Toutes les origines convergent vers la même workout_session canonique, le même Player et la même completion. | VALIDÉ — 12/10/2026 |
| DEC-46 | Ma semaine facultative : Coach propose un programme cohérent sans planification manuelle ; seule Ma semaine gère les dates. | VALIDÉ PRODUIT 26/10 — DEV À VÉRIFIER |
| DEC-47 | Dominante Force / Conditioning / Skill et zone préférée sont séparées ; ce sont des axes souples, pas un verrou de mouvements. | VALIDÉ PRODUIT 26/10 — DEV À VÉRIFIER |
| DEC-48 | L'architecture dépend du lieu, matériel déclaré, temps et historique ; utilisateur libre d'ajuster structure sans WOD imposé. Format ≠ mécanique. | VALIDÉ PRODUIT 26/10 — DEV À VÉRIFIER |
| DEC-49 | Composer commence par Strength/Skill/WOD ; Warm-up et Tabata sont toujours comptabilisés, leurs exercices préremplis et modifiables au récap. | VALIDÉ PRODUIT 26/10 — DEV À VÉRIFIER — portée limitée par la décision du 12/11, aucun ajout aux compositions enregistrées |
| DEC-50 | Recommandation d'exercice : filtres faisabilité puis progression/hebdomadaire/composition/matériel rare/préférence ; « Recommandé » + une cause précise, sans faux score. | VALIDÉ PRODUIT 26/10 — DEV À VÉRIFIER |
| DEC-51 | Chaque substitution déclenche recalcul contextualisé des raisons/autres mouvements ; suggérer sans jamais swapper de force. | VALIDÉ PRODUIT 26/10 — DEV À VÉRIFIER |
| DEC-52 | Carte uniforme : titre, badge, type+difficulté sous titre, matériel, raison, Description et Remplacer ; palette kaki/orange. | VALIDÉ PRODUIT 26/10 — DEV À VÉRIFIER — détails progressifs précisés ensuite par DEC-65 |
| DEC-53 | Mécanique après mouvements : compatibles actives, incompatibles grisées et expliquées ; prescription découle du choix. | VALIDÉ PRODUIT 26/10 — DEV À VÉRIFIER |
| DEC-54 | Récap doit présenter la dose réelle du moteur, Warm-up/Tabata, temps et charges calibrées ; CTA unique « Valider ma séance » crée le template personnel. | VALIDÉ PRODUIT 26/10 — DEV À VÉRIFIER |
| DEC-55 | Preparation reste la page actuelle avec seule carte en tête pour USER_COMPOSED prévue aujourd'hui ; édition libre et adaptations graduées. | VALIDÉ PRODUIT 26/10 — DEV À VÉRIFIER |
| DEC-56 | Issue #3 P0 : le draft Composer doit devenir une unique workout_session serveur transactionnelle/idempotente, contrôlée par QA rollback et Player unique. | VALIDÉ PRODUIT 26/10 — DEV À VÉRIFIER |
| DEC-57 | La zone « Dos » est une préférence de ciblage souple dans le Composer, distincte de Force/Conditioning/Skill, et de « Haut du corps » ; par défaut « UGEROD choisit ». | VALIDÉ PRODUIT 27/10 — À IMPLÉMENTER |
| DEC-58 | Carte SVG anatomique réutilisable avec identifiants musculaires existants, vue Face/Dos, sélection à gauche et silhouette à droite sur mobile ; bascule dos pour focus Dos. | VALIDÉ PRODUIT 27/10 — À IMPLÉMENTER |
| DEC-59 | Dans le Composer, orange = zone principalement ciblée ; kaki = secondairement ciblée ; gris = non ciblée. C'est une représentation d'INTENTION et non de charge ou de fatigue. | VALIDÉ PRODUIT 27/10 — À IMPLÉMENTER |
| DEC-60 | Réutiliser muscles/exercise_muscles (priorité primaire/secondaire). Dos = M02/M13/M12 ; M15/M16 sont systémiques et non des surfaces anatomiques. Préserver l'ancienne nomenclature du moteur. | VALIDÉ PRODUIT 27/10 — À IMPLÉMENTER |
| DEC-61 | Option C uniquement APRÈS séance : utiliser les actuals/LOAD pour estimer la sollicitation réalisée et afficher le même SVG ; distinguer sollicitation, fatigue et récupération. Aucune formule de score/seuil imposée en V1. | VALIDÉ EN CONCEPT 27/10 — DIFFÉRÉ |
| DEC-62 | La silhouette neutre constitue l'enveloppe corporelle anatomique, distincte des muscles colorés V3 ; ses courbes doivent les contenir sans masquer leur rendu. Ne pas réintroduire le ClipPath #15 non compatible observé Safari. | VALIDÉ PRODUIT / PR #17 FUSIONNÉE ; QA SAFARI OUVERTE |
| DEC-63 | La jauge Structure doit présenter le budget calculé complet et dans l'ordre Warm-up, Tabata, blocs principaux, transitions ; affichage du type de bloc adapté à Salle/Box/Maison/Extérieur sans renommer le type technique. | VALIDÉ PRODUIT / PR #19 FUSIONNÉE ; QA CONTEXTE OUVERTE |
| DEC-64 | La présélection des exercices classe et diversifie les schémas moteurs avant l'affichage ; ne force pas deux variantes identiques pour remplir un quota. La sélection manuelle de doublons reste autorisée et avertie. | VALIDÉ PRODUIT / PR #20 FUSIONNÉE ; QA SPORTIVE OUVERTE |
| DEC-65 | L'étape Mouvements doit être compacte sur mobile : nom, schéma moteur, matériel ; recommandations/description/difficulté en détail dépliable ; warning pertinent toujours visible ; alternatives dans un sélecteur unique. | VALIDÉ PRODUIT / PR #21 FUSIONNÉE ; CAPTURE IPHONE ATTENDUE |
