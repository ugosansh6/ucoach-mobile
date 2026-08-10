// @ts-ignore -- import URL résolu par Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- import URL résolu par Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Experience = "Débutant" | "Intermédiaire" | "Avancé";
type Focus =
  | "Strength"
  | "Muscle Gain"
  | "Fat Loss"
  | "Conditioning"
  | "Skill"
  | "General Fitness";
type TargetRegion = "Full Body" | "Lower" | "Upper" | "Core";
type WodFormat = "AMRAP" | "EMOM" | "FOR_TIME" | "CIRCUIT" | "STRENGTH";

interface RequestPayload {
  duration_minutes?: number;
  readiness?: number | "Faible" | "Normale" | "Olympique";
  available_equipment?: string[];
  injured_zones?: string[];
  target_region?: TargetRegion | null;
  format_preference?: WodFormat | null;
  focus_override?: Focus | null;
  excluded_exercise_ids?: string[];
  excluded_patterns?: string[];
}

interface BlockRule {
  id: number;
  block_key: string;
  format: string | null;
  duration_minutes: number | null;
  min_exercises: number;
  max_exercises: number;
  preferred_exercises: number | null;
  rounds: number | null;
  work_seconds: number | null;
  rest_seconds: number | null;
  rotation_mode: string | null;
  active: boolean;
}

interface ProgrammingRule {
  rule_id: string;
  description: string;
  scope: string | null;
  format: string | null;
  priority: number;
  condition_json: Record<string, unknown>;
  action_json: Record<string, unknown>;
}

interface Exercise {
  id: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  tips?: string | null;
  difficulty?: string | null;
  technical_complexity?: number | null;
  movement_pattern?: string | null;
  exercise_family?: string | null;
  body_region?: string | null;
  training_focus?: string | null;
  equipment_requirement?: string | null;
  fatigue_score?: number | null;
  joint_impact?: number | null;
  transition_cost?: number | null;
  starting_position?: string | null;
  selection_weight?: number | null;
  usable_for?: string[] | string | null;
  prescription_type?: string | null;
  tracking_modes?: string[] | null;
  tabata_eligible?: boolean | null;
  exercise_equipment?: { equipment_id: string }[] | null;
}

interface ExerciseConstraint {
  exercise_id: string;
  body_zone: string | null;
  rule_type: "avoid" | "caution" | "regress" | null;
  severity: number | null;
}

interface Variant {
  exercise_id: string;
  target_exercise_id: string;
  variant_type: "progression" | "regression" | string;
}

interface AutoRegionResult {
  region: "Full Body" | "Lower" | "Upper";
  scores: { Upper: number; Lower: number };
}

interface UserExerciseProgress {
  exercise_id: string;
  mastery_score: number;
  state: "LEARN" | "MAINTAIN" | "PROGRESS" | "RECOVER";
  recommendation:
    | "LEARN"
    | "MAINTAIN"
    | "PROGRESS_POSSIBLE"
    | "PROGRESS_RECOMMENDED"
    | "RECOVER";
  exposure_count?: number | null;
  completed_count?: number | null;
  skipped_count?: number | null;
  avg_rpe?: number | null;
  last_rpe?: number | null;
  rpe_trend?: number | null;
  adherence_score?: number | null;
  performance_trend?: number | null;
  consistency_score?: number | null;
}

interface GeneratedExercise {
  id: string;
  name: string;
  pattern: string | null;
  region: string | null;
  prescription: string;
  prescription_json: Record<string, unknown>;
  instructions?: string | null;
  tips?: string | null;
  tracking_modes: string[];
}

interface GeneratedBlock {
  block_key: "warmup" | "tabata" | "skill" | "wod";
  block_name: string;
  duration_minutes: number;
  objective: string;
  structure: string;
  rounds?: number | null;
  work_seconds?: number | null;
  rest_seconds?: number | null;
  rotation_mode?: string | null;
  exercises: GeneratedExercise[];
}

interface SessionArchitecture {
  dominant_block: "wod" | "skill" | "balanced" | "tabata";
  transition_budget_minutes: number;
  active_budget_minutes: number;
  warmup_target_minutes: number;
  tabata_duration_minutes: 0 | 4 | 8;
  skill_duration_minutes: number;
  provisional_wod_minutes: number;
}

type SkillPriorityLevel = "none" | "medium" | "strong";

interface SkillCoachPriority {
  level: SkillPriorityLevel;
  reasons: string[];
  confirmed_learning_ids: string[];
  progress_possible_ids: string[];
  progress_recommended_ids: string[];
  priority_exercise_ids: string[];
  progression_target_ids: string[];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing Supabase environment variables.");
    }

    // IMPORTANT:
    // Le JWT de l'utilisateur est transmis au client Supabase.
    // Les lectures/écritures sont donc soumises aux RLS de l'utilisateur connecté.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body: RequestPayload = await req.json();

    const durationMinutes = clampInt(body.duration_minutes ?? 45, 20, 120);
    const readinessScore = normalizeReadiness(body.readiness);
    const availableEquipment =
      body.available_equipment && body.available_equipment.length > 0
        ? uniqueStrings(body.available_equipment)
        : ["Aucun"];
    const injuredZones = uniqueStrings(body.injured_zones ?? []);
    const excludedExerciseIds = new Set(
      uniqueStrings(body.excluded_exercise_ids ?? []),
    );
    const excludedPatterns = new Set(
      uniqueStrings(body.excluded_patterns ?? []),
    );

    // -------------------------------------------------------------------------
    // 1. PROFIL
    // -------------------------------------------------------------------------
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(
        "id, experience, weekly_session_target, default_equipment, default_injured_zones",
      )
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw new Error(profileError.message);

    const experience: Experience = normalizeExperience(profile?.experience);
    const focus: Focus = body.focus_override ?? "General Fitness";

    // La readiness du jour peut durcir le plafond de complexité.
    const maxComplexity = getMaxComplexity(experience, readinessScore);

    // -------------------------------------------------------------------------
    // 2. HISTORIQUE : RÉGION, ANTI-RÉPÉTITION, PROGRESSION
    // -------------------------------------------------------------------------
    const automaticRegion = await resolveAutomaticTargetRegion(
      supabase,
      user.id,
    );

    const effectiveTargetRegion: TargetRegion =
      body.target_region ?? automaticRegion.region;

    const thirtyDaysAgo = isoDaysAgo(30);
    const fourDaysAgo = isoDaysAgo(4);

    const [{ data: logs30d, error: logs30dError }, { data: logs4d, error: logs4dError }] =
      await Promise.all([
        supabase
          .from("exercise_logs")
          .select(
            "exercise_id, rpe, reps_completed, weight_kg, duration_seconds, distance_meters, status, created_at",
          )
          .eq("user_id", user.id)
          .eq("status", "completed")
          .gte("created_at", thirtyDaysAgo),
        supabase
          .from("exercise_logs")
          .select("exercise_id")
          .eq("user_id", user.id)
          .eq("status", "completed")
          .gte("created_at", fourDaysAgo),
      ]);

    if (logs30dError) throw new Error(logs30dError.message);
    if (logs4dError) throw new Error(logs4dError.message);

    const executionCounts: Record<string, number> = {};

    for (const log of logs30d ?? []) {
      if (!log.exercise_id) continue;
      executionCounts[log.exercise_id] =
        (executionCounts[log.exercise_id] ?? 0) + 1;
    }

    const recentExerciseIds = new Set(
      (logs4d ?? []).map((x: any) => x.exercise_id).filter(Boolean),
    );

    // Le calcul de maîtrise est désormais fait à la fin de chaque séance par
    // historique V2.1 et stocké dans user_exercise_progress.
    const { data: progressData, error: progressError } = await supabase
      .from("user_exercise_progress")
      .select(
        "exercise_id, mastery_score, state, recommendation, exposure_count, completed_count, skipped_count, avg_rpe, last_rpe, rpe_trend, adherence_score, performance_trend, consistency_score",
      )
      .eq("user_id", user.id);

    if (progressError) throw new Error(progressError.message);

    const userProgress = (progressData ?? []) as UserExerciseProgress[];

    // -------------------------------------------------------------------------
    // 3. CONFIGURATION MOTEUR : BLOCK_RULES + PROGRAMMING_RULES
    // -------------------------------------------------------------------------
    const [
      { data: blockRules, error: blockRulesError },
      { data: programmingRules, error: programmingRulesError },
    ] = await Promise.all([
      supabase
        .from("block_rules")
        .select(
          "id, block_key, format, duration_minutes, min_exercises, max_exercises, preferred_exercises, rounds, work_seconds, rest_seconds, rotation_mode, active",
        )
        .eq("active", true),
      supabase
        .from("programming_rules")
        .select(
          "rule_id, description, scope, format, priority, condition_json, action_json",
        )
        .order("priority", { ascending: false }),
    ]);

    if (blockRulesError) throw new Error(blockRulesError.message);
    if (programmingRulesError) throw new Error(programmingRulesError.message);

    const typedBlockRules = (blockRules ?? []) as BlockRule[];
    const typedProgrammingRules = (programmingRules ?? []) as ProgrammingRule[];

    const wodFormat = chooseWodFormat(
      body.format_preference ?? null,
      focus,
      readinessScore,
      durationMinutes,
    );

    // Le Skill n'est plus déclenché par un simple statut abstrait.
    // On combine :
    // - expérience réelle du mouvement (LEARN confirmé par plusieurs expositions),
    // - performance (PROGRESS_POSSIBLE / RECOMMENDED),
    // - difficulté ressentie (RPE),
    // - tendance récente,
    // - état du jour (readiness).
    const skillCoachPriority = buildSkillCoachPriority({
      userProgress,
      variants: [],
      readinessScore,
      focus,
    });

    const architecture = planSessionArchitecture({
      durationMinutes,
      focus,
      readinessScore,
      wodFormat,
      skillPriorityLevel: skillCoachPriority.level,
    });

    const warmupRule = getBlockRule(typedBlockRules, "warmup", null, null);
    // On charge toujours la règle Skill : un WOD technique sélectionné plus bas
    // peut rendre le Skill pertinent même s'il n'était pas prioritaire au départ.
    const skillRule = getBlockRule(typedBlockRules, "skill", null, null);
    const wodRule = getBlockRule(typedBlockRules, "wod", wodFormat, null);
    const tabataRule =
      architecture.tabata_duration_minutes > 0
        ? getBlockRule(
            typedBlockRules,
            "tabata",
            "TABATA",
            architecture.tabata_duration_minutes,
          )
        : null;

    if (!warmupRule || !wodRule) {
      throw new Error(
        "Configuration block_rules incomplète pour Warm-up / WOD.",
      );
    }

    if (!skillRule) {
      throw new Error(
        "Configuration block_rules incomplète pour le Skill.",
      );
    }

    if (architecture.tabata_duration_minutes > 0 && !tabataRule) {
      throw new Error(
        `Configuration block_rules incomplète pour le Tabata ${architecture.tabata_duration_minutes} min.`,
      );
    }

    // -------------------------------------------------------------------------
    // 4. MATÉRIEL
    // -------------------------------------------------------------------------
    const { data: equipData, error: equipError } = await supabase
      .from("equipment")
      .select("id, name")
      .in("name", availableEquipment);

    if (equipError) throw new Error(equipError.message);

    const validEquipmentIds = new Set<string>(
      (equipData ?? []).map((equipment: any) => String(equipment.id)),
    );

    // -------------------------------------------------------------------------
    // 5. CATALOGUE + CONTRAINTES + VARIANTES
    // -------------------------------------------------------------------------
    const { data: rawExercises, error: exercisesError } = await supabase
      .from("exercises")
      .select(`
        id,
        name,
        description,
        instructions,
        tips,
        difficulty,
        technical_complexity,
        movement_pattern,
        exercise_family,
        body_region,
        training_focus,
        equipment_requirement,
        fatigue_score,
        joint_impact,
        transition_cost,
        starting_position,
        selection_weight,
        usable_for,
        prescription_type,
        tracking_modes,
        tabata_eligible,
        exercise_equipment(equipment_id)
      `)
      .lte("technical_complexity", maxComplexity);

    if (exercisesError || !rawExercises) {
      throw new Error(exercisesError?.message ?? "Catalogue exercises indisponible.");
    }

    const exerciseIds = rawExercises.map((exercise: any) => exercise.id);

    const [
      { data: constraints, error: constraintsError },
      { data: variants, error: variantsError },
    ] = await Promise.all([
      exerciseIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("exercise_constraints")
            .select("exercise_id, body_zone, rule_type, severity")
            .in("exercise_id", exerciseIds),
      supabase
        .from("exercise_variants")
        .select("exercise_id, target_exercise_id, variant_type"),
    ]);

    if (constraintsError) throw new Error(constraintsError.message);
    if (variantsError) throw new Error(variantsError.message);

    const typedExercises = rawExercises as Exercise[];
    const typedConstraints = (constraints ?? []) as ExerciseConstraint[];
    const typedVariants = (variants ?? []) as Variant[];

    // Maintenant que les variantes sont chargées, on complète les cibles de
    // progression utilisables par le Skill.
    const resolvedSkillCoachPriority = buildSkillCoachPriority({
      userProgress,
      variants: typedVariants,
      readinessScore,
      focus,
    });

    const constraintsByExercise = groupConstraints(typedConstraints);
    const exerciseById = new Map(typedExercises.map((e: Exercise) => [e.id, e]));

    // -------------------------------------------------------------------------
    // PROGRESSION PERSONNALISÉE
    // -------------------------------------------------------------------------
    // Map target_exercise_id -> multiplicateur de probabilité.
    // PROGRESS_POSSIBLE : +35 %
    // PROGRESS_RECOMMENDED : +75 %
    // RECOVER : on favorise la régression (+60 %) et on retire le mouvement
    // courant si une vraie régression existe.
    const progressionTargets = new Map<string, number>();
    const recoveryBlockedIds = new Set<string>();

    for (const progress of userProgress) {
      if (
        readinessScore >= 5 &&
        progress.state !== "RECOVER" &&
        (
          progress.recommendation === "PROGRESS_POSSIBLE" ||
          progress.recommendation === "PROGRESS_RECOMMENDED"
        )
      ) {
        const boost =
          progress.recommendation === "PROGRESS_RECOMMENDED" ? 1.75 : 1.35;

        for (const variant of typedVariants) {
          if (
            variant.variant_type === "progression" &&
            variant.exercise_id === progress.exercise_id
          ) {
            progressionTargets.set(
              variant.target_exercise_id,
              Math.max(
                progressionTargets.get(variant.target_exercise_id) ?? 1,
                boost,
              ),
            );
          }
        }
      }

      if (progress.state === "RECOVER") {
        const regressions = typedVariants.filter(
          (variant) =>
            variant.variant_type === "regression" &&
            variant.exercise_id === progress.exercise_id,
        );

        if (regressions.length > 0) {
          recoveryBlockedIds.add(progress.exercise_id);
          for (const regression of regressions) {
            progressionTargets.set(
              regression.target_exercise_id,
              Math.max(progressionTargets.get(regression.target_exercise_id) ?? 1, 1.6),
            );
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // 6. SAFE POOL
    // -------------------------------------------------------------------------
    let safePool = typedExercises.filter((exercise) => {
      if (excludedExerciseIds.has(exercise.id)) return false;
      if (recoveryBlockedIds.has(exercise.id)) return false;
      if (
        exercise.movement_pattern &&
        excludedPatterns.has(exercise.movement_pattern)
      ) {
        return false;
      }

      if (!hasAvailableEquipment(exercise, validEquipmentIds)) return false;

      if (
        isHardBlockedByConstraint(
          exercise.id,
          injuredZones,
          constraintsByExercise,
        )
      ) {
        return false;
      }

      // Filet de sécurité conservateur tant que la table exercise_constraints
      // n'est pas exhaustive à 100 %.
      if (isLegacyUnsafeForInjuries(exercise, injuredZones)) return false;

      if (readinessScore <= 4) {
        if ((exercise.fatigue_score ?? 1) > 4) return false;
        if ((exercise.technical_complexity ?? 1) > 3) return false;
      }

      return true;
    });

    if (safePool.length < 8) {
      throw new Error(
        "Pas assez d'exercices sûrs avec les contraintes du jour. Ajuste le matériel, la zone ciblée ou les précautions.",
      );
    }

    // Anti-répétition 4 jours : préférence forte, mais pas au détriment de la sécurité.
    const freshPool = safePool.filter(
      (exercise) => !recentExerciseIds.has(exercise.id),
    );
    const mainPool = freshPool.length >= 10 ? freshPool : safePool;

    // -------------------------------------------------------------------------
    // 7. ARCHITECTURE TEMPORELLE
    // -------------------------------------------------------------------------
    // Le temps choisi par l'utilisateur est un temps réel de séance.
    // Une partie est donc réservée aux transitions / récupérations entre blocs.
    // Le reste constitue le budget actif réellement programmable.
    const transitionBudgetMinutes = architecture.transition_budget_minutes;
    const activeBudgetMinutes = architecture.active_budget_minutes;
    const tabataDuration = architecture.tabata_duration_minutes;
    let skillDuration = architecture.skill_duration_minutes;
    const provisionalWarmupDuration = architecture.warmup_target_minutes;
    const provisionalWodDuration = architecture.provisional_wod_minutes;

    // -------------------------------------------------------------------------
    // 8. WOD D'ABORD : STIMULUS PRINCIPAL
    // -------------------------------------------------------------------------
    const sessionUsedIds = new Set<string>();
    const sessionUsedNames = new Set<string>();

    const markUsed = (exercise: Exercise) => {
      sessionUsedIds.add(exercise.id);
      sessionUsedNames.add(normalizeExerciseName(exercise.name));
    };

    const notUsed = (pool: Exercise[]) =>
      pool.filter(
        (exercise) =>
          !sessionUsedIds.has(exercise.id) &&
          !sessionUsedNames.has(normalizeExerciseName(exercise.name)),
      );

    let wodPool = filterUsableFor(mainPool, "WOD");
    let backupWodPool = filterUsableFor(safePool, "WOD");

    if (effectiveTargetRegion !== "Full Body") {
      const targetedMain = wodPool.filter(
        (e) => e.body_region === effectiveTargetRegion,
      );
      const targetedBackup = backupWodPool.filter(
        (e) => e.body_region === effectiveTargetRegion,
      );

      // On ne force la région que si le pool reste suffisamment viable.
      if (targetedBackup.length >= wodRule.min_exercises) {
        wodPool = targetedMain;
        backupWodPool = targetedBackup;
      }
    }

    wodPool = applyFormatCandidateFilters(wodPool, wodFormat);
    backupWodPool = applyFormatCandidateFilters(backupWodPool, wodFormat);

    const wodCount = chooseExerciseCount(
      wodRule,
      provisionalWodDuration,
      wodFormat === "CIRCUIT" ? 6 : wodRule.preferred_exercises ?? 3,
    );

    let selectedWod = selectWodExercises({
      primaryPool: notUsed(wodPool),
      backupPool: notUsed(backupWodPool),
      count: wodCount,
      format: wodFormat,
      executionCounts,
      progressionTargets,
      readinessScore,
    });

    // Fallback WOD global :
    // si la région ou le filtre de format a trop réduit le pool,
    // on élargit à tous les exercices WOD sûrs compatibles.
    if (selectedWod.length < Math.max(1, wodRule.min_exercises)) {
      const globalWodMain = filterUsableFor(mainPool, "WOD");
      const globalWodBackup = filterUsableFor(safePool, "WOD");

      selectedWod = selectWodExercises({
        primaryPool: notUsed(globalWodMain),
        backupPool: notUsed(globalWodBackup),
        count: wodCount,
        format: wodFormat,
        executionCounts,
        progressionTargets,
        readinessScore,
      });
    }

    if (selectedWod.length < Math.max(1, wodRule.min_exercises)) {
      throw new Error(
        `Impossible de construire un WOD ${wodFormat} valide avec les contraintes actuelles.`,
      );
    }

    selectedWod.forEach(markUsed);

    // Un mouvement réellement technique dans le WOD peut créer une priorité
    // Skill "moyenne" : on prépare alors ce mouvement avant le WOD, mais sans
    // voler le minimum de 8 minutes réservé au stimulus principal.
    const technicalWodPriority = selectedWod.some(
      (exercise) => (exercise.technical_complexity ?? 1) >= 4,
    );

    if (
      technicalWodPriority &&
      skillDuration === 0 &&
      durationMinutes >= 35 &&
      readinessScore >= 4
    ) {
      const maxSkillFromRemainingBudget = Math.max(
        0,
        activeBudgetMinutes - provisionalWarmupDuration - tabataDuration - 8,
      );

      if (maxSkillFromRemainingBudget >= 6) {
        skillDuration = Math.min(10, maxSkillFromRemainingBudget);
      }
    }

    // -------------------------------------------------------------------------
    // 9. SKILL LIÉ AU WOD — OPTIONNEL SELON L'ARCHITECTURE
    // -------------------------------------------------------------------------
    const primaryWodPattern = getPrimaryMovementPattern(selectedWod);
    let selectedSkill: Exercise[] = [];

    if (skillDuration > 0 && skillRule) {
      const allSkillMain = filterUsableFor(mainPool, "Skill");
      const allSkillBackup = filterUsableFor(safePool, "Skill");

      const skillCount = chooseExerciseCount(
        skillRule,
        skillDuration,
        skillRule.preferred_exercises ?? 1,
      );

      // Niveau COACH — si l'historique montre un apprentissage confirmé ou
      // une progression pertinente, on essaie d'abord de travailler ce mouvement
      // (ou sa variante de progression), à condition qu'il soit sûr et utilisable
      // dans un bloc Skill.
      const coachPriorityIds = new Set<string>([
        ...resolvedSkillCoachPriority.priority_exercise_ids,
        ...resolvedSkillCoachPriority.progression_target_ids,
      ]);

      if (coachPriorityIds.size > 0) {
        const coachMain = allSkillMain.filter((exercise) =>
          coachPriorityIds.has(exercise.id),
        );
        const coachBackup = allSkillBackup.filter((exercise) =>
          coachPriorityIds.has(exercise.id),
        );

        selectedSkill = selectUniqueExercises(
          notUsed(coachMain),
          notUsed(coachBackup),
          skillCount,
          executionCounts,
          progressionTargets,
          true,
        );
      }

      // Niveau A — même pattern principal que le WOD.
      if (selectedSkill.length === 0 && primaryWodPattern) {
        const samePatternMain = allSkillMain.filter(
          (exercise) => exercise.movement_pattern === primaryWodPattern,
        );
        const samePatternBackup = allSkillBackup.filter(
          (exercise) => exercise.movement_pattern === primaryWodPattern,
        );

        selectedSkill = selectUniqueExercises(
          notUsed(samePatternMain),
          notUsed(samePatternBackup),
          skillCount,
          executionCounts,
          progressionTargets,
          true,
        );
      }

      // Niveau B — même famille ou même région qu'un exercice du WOD.
      if (selectedSkill.length === 0) {
        const wodFamilies = new Set<string>(
          selectedWod
            .map((exercise) => exercise.exercise_family)
            .filter(
              (value): value is string =>
                typeof value === "string" && value.length > 0,
            ),
        );

        const wodRegions = new Set<string>(
          selectedWod
            .map((exercise) => exercise.body_region)
            .filter(
              (value): value is string =>
                typeof value === "string" && value.length > 0,
            ),
        );

        const relatedMain = allSkillMain.filter(
          (exercise) =>
            (exercise.exercise_family &&
              wodFamilies.has(exercise.exercise_family)) ||
            (exercise.body_region &&
              wodRegions.has(exercise.body_region)),
        );

        const relatedBackup = allSkillBackup.filter(
          (exercise) =>
            (exercise.exercise_family &&
              wodFamilies.has(exercise.exercise_family)) ||
            (exercise.body_region &&
              wodRegions.has(exercise.body_region)),
        );

        selectedSkill = selectUniqueExercises(
          notUsed(relatedMain),
          notUsed(relatedBackup),
          skillCount,
          executionCounts,
          progressionTargets,
          true,
        );
      }

      // Niveau C — n'importe quel Skill sûr compatible avec la séance.
      if (selectedSkill.length === 0) {
        selectedSkill = selectUniqueExercises(
          notUsed(allSkillMain),
          notUsed(allSkillBackup),
          skillCount,
          executionCounts,
          progressionTargets,
          true,
        );
      }

      // Si le Skill prévu n'est finalement pas constructible, on ne bloque pas
      // toute la séance : son budget sera rendu au WOD plus bas.
      if (selectedSkill.length > 0) {
        selectedSkill.forEach(markUsed);
      }
    }

    const effectiveSkillDuration =
      selectedSkill.length > 0 ? skillDuration : 0;

    // -------------------------------------------------------------------------
    // 10. WARM-UP : PRÉPARE WOD + SKILL
    // -------------------------------------------------------------------------
    const targetExercises = [...selectedWod, ...selectedSkill];
    const targetPatterns = new Set<string>(
      targetExercises
        .map((e) => e.movement_pattern)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    );
    const targetFamilies = new Set<string>(
      targetExercises
        .map((e) => e.exercise_family)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    );

    let warmupPool = filterUsableFor(mainPool, "Warm-up");
    let backupWarmupPool = filterUsableFor(safePool, "Warm-up");

    const specificWarmups = warmupPool.filter(
      (exercise) =>
        (exercise.movement_pattern &&
          targetPatterns.has(exercise.movement_pattern)) ||
        (exercise.exercise_family &&
          targetFamilies.has(exercise.exercise_family)) ||
        exercise.training_focus === "Mobility",
    );

    const specificBackupWarmups = backupWarmupPool.filter(
      (exercise) =>
        (exercise.movement_pattern &&
          targetPatterns.has(exercise.movement_pattern)) ||
        (exercise.exercise_family &&
          targetFamilies.has(exercise.exercise_family)) ||
        exercise.training_focus === "Mobility",
    );

    if (specificBackupWarmups.length >= warmupRule.min_exercises) {
      warmupPool = specificWarmups;
      backupWarmupPool = specificBackupWarmups;
    }

    const warmupPlan = chooseAdaptiveWarmupPlan({
      rule: warmupRule,
      wodFormat,
      focus,
      readinessScore,
      selectedWod,
      selectedSkill,
      targetPatterns,
      availableCandidateCount: notUsed(backupWarmupPool).length,
      durationBudgetMinutes: provisionalWarmupDuration,
    });

    let selectedWarmup = selectAdaptiveWarmupExercises({
      primaryPool: notUsed(warmupPool),
      backupPool: notUsed(backupWarmupPool),
      count: warmupPlan.exerciseCount,
      mobilityTarget: warmupPlan.mobilityTarget,
      targetPatterns,
      targetFamilies,
      executionCounts,
      progressionTargets,
    });

    // Fallback Warm-up global :
    // si le Warm-up spécifique WOD/Skill est trop restreint,
    // on élargit à tous les Warm-up sûrs avant d'échouer.
    if (selectedWarmup.length < Math.max(1, warmupRule.min_exercises)) {
      const globalWarmupMain = filterUsableFor(mainPool, "Warm-up");
      const globalWarmupBackup = filterUsableFor(safePool, "Warm-up");

      selectedWarmup = selectAdaptiveWarmupExercises({
        primaryPool: notUsed(globalWarmupMain),
        backupPool: notUsed(globalWarmupBackup),
        count: warmupPlan.exerciseCount,
        mobilityTarget: warmupPlan.mobilityTarget,
        targetPatterns,
        targetFamilies,
        executionCounts,
        progressionTargets,
      });
    }

    if (selectedWarmup.length < Math.max(1, warmupRule.min_exercises)) {
      throw new Error(
        "Impossible de construire un Warm-up valide avec les contraintes actuelles.",
      );
    }

    selectedWarmup.forEach(markUsed);

    // La durée réelle du Warm-up dépend du contenu sélectionné, mais ne peut
    // jamais dépasser l'enveloppe prévue par l'architecture de séance.
    const estimatedWarmupDuration = estimateAdaptiveWarmupDuration({
      selectedWarmup,
      wodFormat,
      focus,
      readinessScore,
    });

    const warmupDuration = clampInt(
      Math.min(estimatedWarmupDuration, provisionalWarmupDuration),
      4,
      provisionalWarmupDuration,
    );

    // Une seule source de vérité pour le WOD : le budget actif restant après
    // Warm-up, Tabata et Skill réellement présents. Les transitions sont déjà
    // sorties du budget actif.
    const wodDuration = Math.max(
      8,
      activeBudgetMinutes -
        warmupDuration -
        tabataDuration -
        effectiveSkillDuration,
    );

    // -------------------------------------------------------------------------
    // 11. TABATA — OPTIONNEL, 2 EXOS / 4 MIN OU 4 EXOS / 8 MIN
    // -------------------------------------------------------------------------
    let selectedTabata: Exercise[] = [];

    if (tabataDuration > 0 && tabataRule) {
      const tabataPool = mainPool.filter(
        (exercise) =>
          exercise.tabata_eligible === true &&
          exercise.body_region === "Core" &&
          !sessionUsedIds.has(exercise.id),
      );

      const backupTabataPool = safePool.filter(
        (exercise) =>
          exercise.tabata_eligible === true &&
          exercise.body_region === "Core" &&
          !sessionUsedIds.has(exercise.id),
      );

      // 4 min = 1 Tabata = 2 exercices alternés.
      // 8 min = 2 Tabatas = 4 exercices au total.
      const tabataCount = tabataDuration === 8 ? 4 : 2;

      selectedTabata = selectUniqueExercises(
        tabataPool,
        backupTabataPool,
        tabataCount,
        executionCounts,
        progressionTargets,
        true,
      );

      if (selectedTabata.length < tabataCount) {
        const globalTabataPool = safePool.filter(
          (exercise) =>
            exercise.tabata_eligible === true &&
            exercise.body_region === "Core" &&
            !sessionUsedIds.has(exercise.id),
        );

        selectedTabata = selectUniqueExercises(
          globalTabataPool,
          globalTabataPool,
          tabataCount,
          executionCounts,
          progressionTargets,
          true,
        );
      }

      if (selectedTabata.length < tabataCount) {
        throw new Error(
          `Impossible de construire un Tabata ${tabataDuration} min avec ${tabataCount} exercices sûrs distincts.`,
        );
      }

      selectedTabata.forEach(markUsed);
    }

    // -------------------------------------------------------------------------
    // 12. PROGRAMMING_RULES : VALIDATION FINALE
    // -------------------------------------------------------------------------
    const appliedRuleIds = new Set<string>();

    // Les règles critiques utilisées par le moteur sont identifiées depuis la DB.
    // Cela rend l'audit du comportement visible dans generated_workout.meta.
    for (const rule of typedProgrammingRules) {
      if (
        rule.scope === "global" ||
        rule.scope === "wod" ||
        rule.scope === "warmup" ||
        rule.scope === "skill" ||
        rule.scope === "tabata"
      ) {
        appliedRuleIds.add(rule.rule_id);
      }
    }

    validateGeneratedWorkout({
      selectedWod,
      selectedSkill,
      selectedWarmup,
      selectedTabata,
      wodFormat,
      readinessScore,
      injuredZones,
      constraintsByExercise,
      tabataDuration,
      skillDuration: effectiveSkillDuration,
      wodDuration,
    });

    // -------------------------------------------------------------------------
    // 13. PRESCRIPTIONS + JSON FINAL
    // -------------------------------------------------------------------------
    const skillStructure = selectedSkill.length > 0
      ? getSkillBlockStructure(
          selectedSkill,
          focus,
          readinessScore,
        )
      : null;

    const blocks: GeneratedBlock[] = [];

    blocks.push({
      block_key: "warmup",
      block_name: "Warm-up spécifique",
      duration_minutes: warmupDuration,
      objective:
        "Préparer les patterns, articulations et zones sollicitées ensuite.",
      structure: getAdaptiveWarmupStructure(
        selectedWarmup.length,
        warmupDuration,
        wodFormat,
      ),
      exercises: selectedWarmup.map((exercise) =>
        toGeneratedExercise(
          exercise,
          getWarmupPrescription(exercise.prescription_type, readinessScore),
        ),
      ),
    });

    if (selectedTabata.length > 0 && tabataRule) {
      const tabataRounds = tabataDuration === 8 ? 16 : 8;
      const tabataStructure =
        tabataDuration === 8
          ? `2 Tabatas de 4 min — 8 rounds par Tabata — alterne les 2 exercices — ${tabataRule.work_seconds ?? 20}s / ${tabataRule.rest_seconds ?? 10}s`
          : `1 Tabata de 4 min — 8 rounds — alterne les 2 exercices — ${tabataRule.work_seconds ?? 20}s / ${tabataRule.rest_seconds ?? 10}s`;

      blocks.push({
        block_key: "tabata",
        block_name: "Tabata",
        duration_minutes: tabataDuration,
        objective: "Travail court en intervalles 20/10.",
        structure: tabataStructure,
        rounds: tabataRounds,
        work_seconds: tabataRule.work_seconds ?? 20,
        rest_seconds: tabataRule.rest_seconds ?? 10,
        rotation_mode: "alternate_pairs",
        exercises: selectedTabata.map((exercise, index) => {
          const generated = toGeneratedExercise(
            exercise,
            getTabataPrescription(exercise.prescription_type),
          );

          generated.prescription_json = {
            ...generated.prescription_json,
            tabata_number: tabataDuration === 8 ? (index < 2 ? 1 : 2) : 1,
            tabata_position: index % 2 === 0 ? "A" : "B",
            active_rounds: index % 2 === 0 ? [1, 3, 5, 7] : [2, 4, 6, 8],
          };

          return generated;
        }),
      });
    }

    if (selectedSkill.length > 0 && skillStructure) {
      blocks.push({
        block_key: "skill",
        block_name: "Skill & Force",
        duration_minutes: effectiveSkillDuration,
        objective:
          resolvedSkillCoachPriority.level !== "none" &&
          selectedSkill.some((exercise) =>
            resolvedSkillCoachPriority.priority_exercise_ids.includes(exercise.id) ||
            resolvedSkillCoachPriority.progression_target_ids.includes(exercise.id)
          )
            ? getSkillCoachObjective(resolvedSkillCoachPriority, readinessScore)
            : primaryWodPattern
            ? `Préparer et renforcer le pattern ${primaryWodPattern}.`
            : `Renforcement ciblé — ${focus}.`,
        structure: skillStructure,
        exercises: selectedSkill.map((exercise) =>
          toGeneratedExercise(
            exercise,
            getSkillExercisePrescription(
              exercise,
              focus,
              readinessScore,
            ),
          ),
        ),
      });
    }

    blocks.push({
      block_key: "wod",
      block_name: "WOD principal",
      duration_minutes: wodDuration,
      objective: getWodObjective(wodFormat, focus),
      structure: getWodStructure(wodFormat, wodDuration, selectedWod.length),
      exercises: selectedWod.map((exercise) =>
        toGeneratedExercise(
          exercise,
          getDynamicWodPrescription(
            exercise.prescription_type ?? "reps_standard",
            exercise.technical_complexity ?? 1,
            readinessScore,
            wodFormat,
          ),
        ),
      ),
    });

    const generatedWorkout = {
      version: "bright-handler-v2.4.2",
      meta: {
        user_id: user.id,
        total_duration_minutes: durationMinutes,
        experience,
        focus,
        readiness_score: readinessScore,
        readiness_zone: readinessZone(readinessScore),
        target_region: effectiveTargetRegion,
        target_region_source: body.target_region
          ? "user_preference"
          : "automatic_history",
        automatic_region_scores: automaticRegion.scores,
        format: wodFormat,
        session_architecture: {
          dominant_block: architecture.dominant_block,
          transition_budget_minutes: transitionBudgetMinutes,
          active_budget_minutes: activeBudgetMinutes,
          warmup_minutes: warmupDuration,
          tabata_minutes: tabataDuration,
          skill_minutes: effectiveSkillDuration,
          wod_minutes: wodDuration,
          skill_priority: {
            level: resolvedSkillCoachPriority.level,
            reasons: resolvedSkillCoachPriority.reasons,
            confirmed_learning_count:
              resolvedSkillCoachPriority.confirmed_learning_ids.length,
            progress_possible_count:
              resolvedSkillCoachPriority.progress_possible_ids.length,
            progress_recommended_count:
              resolvedSkillCoachPriority.progress_recommended_ids.length,
            priority_exercise_ids:
              resolvedSkillCoachPriority.priority_exercise_ids,
            progression_target_ids:
              resolvedSkillCoachPriority.progression_target_ids,
            contextual_from_technical_wod: technicalWodPriority,
            readiness_allows_progression: readinessScore >= 5,
          },
          programmed_minutes:
            warmupDuration +
            tabataDuration +
            effectiveSkillDuration +
            wodDuration,
        },
        available_equipment: availableEquipment,
        injured_zones: injuredZones,
        recent_exercises_4d: recentExerciseIds.size,
        progression_engine: {
          tracked_exercises: userProgress.length,
          learn: userProgress.filter((p) => p.state === "LEARN").length,
          maintain: userProgress.filter((p) => p.state === "MAINTAIN").length,
          progress: userProgress.filter((p) => p.state === "PROGRESS").length,
          recover: userProgress.filter((p) => p.state === "RECOVER").length,
        },
        progression_targets_preferred: Array.from(progressionTargets.entries()).map(
          ([exercise_id, boost]) => ({ exercise_id, boost }),
        ),
        programming_rule_ids_loaded: typedProgrammingRules.map((r) => r.rule_id),
        programming_rule_ids_applied: Array.from(appliedRuleIds),
        generated_at: new Date().toISOString(),
      },
      blocks,
    };

    // -------------------------------------------------------------------------
    // 14. PERSISTENCE : workout_sessions
    // -------------------------------------------------------------------------
    const { data: session, error: sessionError } = await supabase
      .from("workout_sessions")
      .insert({
        user_id: user.id,
        status: "generated",
        duration_minutes: durationMinutes,
        target_region: effectiveTargetRegion,
        readiness: readinessZone(readinessScore),
        focus,
        available_equipment: availableEquipment,
        injured_zones: injuredZones,
        generated_at: new Date().toISOString(),
        generated_workout: generatedWorkout,
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      throw new Error(
        sessionError?.message ?? "Impossible de créer workout_sessions.",
      );
    }

    const sessionExerciseRows = buildSessionExerciseRows(
      session.id,
      blocks,
    );

    if (sessionExerciseRows.length > 0) {
      const { error: sessionExercisesError } = await supabase
        .from("workout_session_exercises")
        .insert(sessionExerciseRows);

      if (sessionExercisesError) {
        // Best-effort rollback applicatif pour ne pas laisser une séance vide.
        await supabase.from("workout_sessions").delete().eq("id", session.id);
        throw new Error(sessionExercisesError.message);
      }
    }

    return jsonResponse(
      {
        session_id: session.id,
        status: "generated",
        ...generatedWorkout,
      },
      200,
    );
  } catch (error) {
    console.error("bright-handler-v2.4.2", error);
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Unknown generation error",
      },
      400,
    );
  }
});

// ============================================================================
// PRIORITÉ SKILL — VISION COACH
// ============================================================================

function buildSkillCoachPriority(args: {
  userProgress: UserExerciseProgress[];
  variants: Variant[];
  readinessScore: number;
  focus: Focus;
}): SkillCoachPriority {
  const { userProgress, variants, readinessScore, focus } = args;

  const confirmedLearning = userProgress.filter((progress) => {
    if (progress.state !== "LEARN") return false;

    // Un nouveau mouvement ne devient pas automatiquement une priorité Skill.
    // Il faut plusieurs observations réelles OU un signal clair de difficulté.
    const completed = progress.completed_count ?? 0;
    const exposure = progress.exposure_count ?? 0;
    const hardSignal =
      (progress.last_rpe ?? 0) >= 8.5 ||
      (progress.avg_rpe ?? 0) >= 8.2 ||
      (progress.adherence_score ?? 100) < 70;

    return completed >= 3 || exposure >= 4 || hardSignal;
  });

  const progressRecommended = userProgress.filter(
    (progress) =>
      progress.recommendation === "PROGRESS_RECOMMENDED" &&
      progress.state !== "RECOVER",
  );

  const progressPossible = userProgress.filter((progress) => {
    if (
      progress.recommendation !== "PROGRESS_POSSIBLE" ||
      progress.state === "RECOVER"
    ) {
      return false;
    }

    // Une progression "possible" ne devient intéressante pour le Skill que si
    // la performance est au moins stable et que la difficulté est maîtrisée.
    const performanceStable = (progress.performance_trend ?? 0) >= -0.15;
    const rpeControlled =
      progress.avg_rpe == null || (progress.avg_rpe ?? 10) <= 8;

    return performanceStable && rpeControlled;
  });

  const reasons: string[] = [];
  let level: SkillPriorityLevel = "none";

  if (confirmedLearning.length > 0) {
    level = "strong";
    reasons.push("confirmed_learning");
  }

  if (progressRecommended.length > 0) {
    level = "strong";
    reasons.push("progress_recommended");
  }

  if (
    level !== "strong" &&
    progressPossible.length > 0 &&
    readinessScore >= 5
  ) {
    level = "medium";
    reasons.push("progress_possible");
  }

  if (level === "none" && focus === "Strength") {
    level = "medium";
    reasons.push("strength_goal");
  }

  // Readiness basse : on conserve éventuellement un travail technique,
  // mais on ne programme pas une séance dominée par la progression.
  if (readinessScore <= 4 && level === "strong") {
    level = "medium";
    reasons.push("downgraded_low_readiness");
  }

  const priorityExerciseIds = Array.from(
    new Set([
      ...confirmedLearning.map((p) => p.exercise_id),
      ...progressRecommended.map((p) => p.exercise_id),
      ...progressPossible.map((p) => p.exercise_id),
    ]),
  );

  const progressionSourceIds =
    readinessScore >= 5
      ? new Set([
          ...progressRecommended.map((p) => p.exercise_id),
          ...progressPossible.map((p) => p.exercise_id),
        ])
      : new Set<string>();

  const progressionTargetIds = Array.from(
    new Set(
      variants
        .filter(
          (variant) =>
            variant.variant_type === "progression" &&
            progressionSourceIds.has(variant.exercise_id),
        )
        .map((variant) => variant.target_exercise_id),
    ),
  );

  return {
    level,
    reasons,
    confirmed_learning_ids: confirmedLearning.map((p) => p.exercise_id),
    progress_possible_ids: progressPossible.map((p) => p.exercise_id),
    progress_recommended_ids: progressRecommended.map((p) => p.exercise_id),
    priority_exercise_ids: priorityExerciseIds,
    progression_target_ids: progressionTargetIds,
  };
}

function getSkillCoachObjective(
  priority: SkillCoachPriority,
  readinessScore: number,
): string {
  if (
    priority.reasons.includes("progress_recommended") &&
    readinessScore >= 5
  ) {
    return "Consolider un mouvement maîtrisé et préparer une progression adaptée.";
  }

  if (priority.reasons.includes("confirmed_learning")) {
    return "Renforcer la maîtrise technique d’un mouvement encore en apprentissage.";
  }

  if (
    priority.reasons.includes("progress_possible") &&
    readinessScore >= 5
  ) {
    return "Consolider le niveau actuel et tester une progression sans dégrader la qualité.";
  }

  if (priority.reasons.includes("downgraded_low_readiness")) {
    return "Entretenir la technique aujourd’hui sans chercher à progresser en difficulté.";
  }

  return "Travail technique ciblé selon l’historique et l’état du jour.";
}

// ============================================================================
// ARCHITECTURE DE SÉANCE
// ============================================================================

function planSessionArchitecture(args: {
  durationMinutes: number;
  focus: Focus;
  readinessScore: number;
  wodFormat: WodFormat;
  skillPriorityLevel: SkillPriorityLevel;
}): SessionArchitecture {
  const {
    durationMinutes,
    focus,
    readinessScore,
    wodFormat,
    skillPriorityLevel,
  } = args;

  // Le temps utilisateur inclut la réalité de la séance : lire la consigne,
  // changer de matériel, boire et récupérer entre les blocs.
  const transitionBudgetMinutes = clampInt(
    Math.ceil(durationMinutes * 0.12),
    2,
    8,
  );

  const activeBudgetMinutes = Math.max(
    12,
    durationMinutes - transitionBudgetMinutes,
  );

  let warmupTargetMinutes = clampInt(
    Math.round(activeBudgetMinutes * 0.14),
    4,
    8,
  );

  // Le Skill ne devient plus prioritaire simplement parce qu'un objectif
  // arbitraire l'impose. On distingue :
  // - priorité forte : apprentissage (LEARN) ou progression recommandée ;
  // - priorité moyenne : objectif Strength ;
  // - priorité contextuelle : WOD technique, détecté après sa sélection.
  const strongSkillPriority = skillPriorityLevel === "strong";
  const mediumSkillPriority =
    skillPriorityLevel === "medium" || focus === "Strength";

  let dominantBlock: SessionArchitecture["dominant_block"] = "balanced";
  let tabataDuration: 0 | 4 | 8 = 0;
  let skillDuration = 0;

  if (strongSkillPriority && durationMinutes >= 28) {
    dominantBlock = "skill";
    const maxSkill = durationMinutes >= 45 ? 20 : 14;
    skillDuration = clampInt(
      Math.round(activeBudgetMinutes * 0.34),
      8,
      maxSkill,
    );

    // Sur une séance longue, un court Tabata peut coexister avec un vrai
    // travail d'apprentissage/progression, sans être obligatoire.
    if (durationMinutes >= 60 && readinessScore >= 5) {
      tabataDuration = 4;
    }
  } else if (mediumSkillPriority && durationMinutes >= 30) {
    dominantBlock = "skill";
    const maxSkill = durationMinutes >= 45 ? 16 : 12;
    skillDuration = clampInt(
      Math.round(activeBudgetMinutes * 0.25),
      6,
      maxSkill,
    );

    if (durationMinutes >= 60 && readinessScore >= 5) {
      tabataDuration = 4;
    }
  } else if (focus === "Fat Loss") {
    dominantBlock = "tabata";
    if (durationMinutes >= 30) tabataDuration = 8;
    else if (durationMinutes >= 25) tabataDuration = 4;

    if (durationMinutes >= 55) {
      skillDuration = 6;
    }
  } else if (focus === "Conditioning") {
    dominantBlock = "wod";
    if (durationMinutes >= 50) tabataDuration = 8;
    else if (durationMinutes >= 28) tabataDuration = 4;

    if (durationMinutes >= 55) {
      skillDuration = 6;
    }
  } else {
    dominantBlock = "balanced";
    if (durationMinutes >= 55) tabataDuration = 8;
    else if (durationMinutes >= 28) tabataDuration = 4;

    if (durationMinutes >= 40) {
      skillDuration = clampInt(
        Math.round(activeBudgetMinutes * 0.18),
        6,
        12,
      );
    }
  }

  // Readiness faible : on conserve le Warm-up mais on simplifie les blocs
  // secondaires avant de toucher au WOD.
  if (readinessScore <= 4) {
    warmupTargetMinutes = Math.min(8, warmupTargetMinutes + 1);
    if (tabataDuration === 8) tabataDuration = 4;
    skillDuration = Math.min(skillDuration, 10);
  }

  // Le WOD doit conserver un vrai stimulus. On réduit les blocs secondaires
  // si nécessaire, au lieu de créer un WOD artificiellement trop court.
  let provisionalWodMinutes =
    activeBudgetMinutes -
    warmupTargetMinutes -
    tabataDuration -
    skillDuration;

  if (provisionalWodMinutes < 8 && skillDuration > 0) {
    const reducibleSkill = Math.max(0, skillDuration - 6);
    const needed = 8 - provisionalWodMinutes;
    const reduction = Math.min(reducibleSkill, needed);
    skillDuration -= reduction;
    provisionalWodMinutes += reduction;

    if (skillDuration > 0 && skillDuration < 6) {
      provisionalWodMinutes += skillDuration;
      skillDuration = 0;
    }
  }

  if (provisionalWodMinutes < 8 && tabataDuration > 0) {
    provisionalWodMinutes += tabataDuration;
    tabataDuration = 0;
  }

  if (provisionalWodMinutes < 8 && warmupTargetMinutes > 4) {
    const reduction = Math.min(
      warmupTargetMinutes - 4,
      8 - provisionalWodMinutes,
    );
    warmupTargetMinutes -= reduction;
    provisionalWodMinutes += reduction;
  }

  provisionalWodMinutes = Math.max(8, provisionalWodMinutes);

  return {
    dominant_block: dominantBlock,
    transition_budget_minutes: transitionBudgetMinutes,
    active_budget_minutes: activeBudgetMinutes,
    warmup_target_minutes: warmupTargetMinutes,
    tabata_duration_minutes: tabataDuration,
    skill_duration_minutes: skillDuration,
    provisional_wod_minutes: provisionalWodMinutes,
  };
}

// ============================================================================
// BLOCK RULES
// ============================================================================

function getBlockRule(
  rules: BlockRule[],
  blockKey: string,
  format: string | null,
  duration: number | null,
): BlockRule | null {
  const candidates = rules.filter((r) => {
    if (r.block_key !== blockKey) return false;
    if (format !== null && r.format !== format) return false;
    if (duration !== null && r.duration_minutes !== duration) return false;
    return true;
  });

  if (candidates.length > 0) return candidates[0];

  // Fallback plus souple pour warmup / skill.
  return (
    rules.find(
      (r) =>
        r.block_key === blockKey &&
        (format === null || r.format === format),
    ) ?? null
  );
}

function chooseExerciseCount(
  rule: BlockRule,
  durationMinutes: number,
  preferredFallback: number,
): number {
  const preferred = rule.preferred_exercises ?? preferredFallback;

  let target = preferred;

  if (rule.block_key === "wod") {
    if (durationMinutes <= 10) target = Math.min(target, 3);
    if (durationMinutes >= 20) target = Math.max(target, 4);
  }

  return clampInt(target, rule.min_exercises, rule.max_exercises);
}

// ============================================================================
// WARM-UP ADAPTATIF
// ============================================================================

function chooseAdaptiveWarmupPlan(args: {
  rule: BlockRule;
  wodFormat: WodFormat;
  focus: Focus;
  readinessScore: number;
  selectedWod: Exercise[];
  selectedSkill: Exercise[];
  targetPatterns: Set<string>;
  availableCandidateCount: number;
  durationBudgetMinutes: number;
}) {
  const {
    rule,
    wodFormat,
    focus,
    readinessScore,
    selectedWod,
    selectedSkill,
    targetPatterns,
    availableCandidateCount,
    durationBudgetMinutes,
  } = args;

  const technicalExercises = [...selectedWod, ...selectedSkill].filter(
    (exercise) => (exercise.technical_complexity ?? 1) >= 4,
  ).length;

  const highImpactExercises = selectedWod.filter(
    (exercise) => (exercise.joint_impact ?? 0) >= 4,
  ).length;

  const patternCount = Array.from(targetPatterns).filter(Boolean).length;

  let target = 4;
  let mobilityTarget = 1;

  // Force : moins d'exercices, mais préparation plus ciblée et plus progressive.
  if (wodFormat === "STRENGTH" || focus === "Strength") {
    target = 4;
    mobilityTarget = 1;

    if (patternCount >= 2) target += 1;
    if (technicalExercises >= 1) target += 1;
  }
  // Conditioning : plus de variété pour faire monter progressivement la température.
  else if (
    wodFormat === "AMRAP" ||
    wodFormat === "FOR_TIME" ||
    wodFormat === "CIRCUIT" ||
    focus === "Conditioning" ||
    focus === "Fat Loss"
  ) {
    target = 5;
    mobilityTarget = 2;

    if (patternCount >= 3) target += 1;
    if (highImpactExercises >= 1) target += 1;
  }
  // EMOM / Skill : préparation technique intermédiaire.
  else if (wodFormat === "EMOM" || focus === "Skill") {
    target = 5;
    mobilityTarget = 2;

    if (technicalExercises >= 1) target += 1;
  }

  // Readiness basse : on privilégie davantage de mobilité/activation,
  // sans rallonger artificiellement la séance.
  if (readinessScore <= 4) {
    mobilityTarget += 1;
    target = Math.max(target, 5);
  }

  // Le catalogue peut proposer jusqu'à 10 mouvements si le WOD le justifie,
  // mais 10 n'est jamais une cible systématique.
  const adaptiveMin = Math.max(3, Math.min(rule.min_exercises, 3));
  const adaptiveMax = Math.min(
    10,
    Math.max(rule.max_exercises, 10),
    Math.max(3, availableCandidateCount),
  );

  // Le nombre de mouvements doit tenir réellement dans le temps annoncé.
  // On évite notamment 6 exercices x 2 tours dans un Warm-up de 6 minutes.
  const maxByTime =
    durationBudgetMinutes <= 4
      ? 3
      : durationBudgetMinutes <= 6
      ? 4
      : durationBudgetMinutes <= 7
      ? 5
      : 6;

  const exerciseCount = clampInt(
    Math.min(target, maxByTime),
    adaptiveMin,
    Math.min(adaptiveMax, maxByTime),
  );

  return {
    exerciseCount,
    mobilityTarget: Math.min(mobilityTarget, Math.max(1, exerciseCount - 2)),
  };
}

function selectAdaptiveWarmupExercises(args: {
  primaryPool: Exercise[];
  backupPool: Exercise[];
  count: number;
  mobilityTarget: number;
  targetPatterns: Set<string>;
  targetFamilies: Set<string>;
  executionCounts: Record<string, number>;
  progressionTargets: Map<string, number>;
}): Exercise[] {
  const {
    primaryPool,
    backupPool,
    count,
    mobilityTarget,
    targetPatterns,
    targetFamilies,
    executionCounts,
    progressionTargets,
  } = args;

  const selected: Exercise[] = [];
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();

  const addPicked = (exercise: Exercise | null) => {
    if (!exercise) return false;
    if (usedIds.has(exercise.id)) return false;

    const normalizedName = normalizeExerciseName(exercise.name);
    if (usedNames.has(normalizedName)) return false;

    selected.push(exercise);
    usedIds.add(exercise.id);
    usedNames.add(normalizedName);
    return true;
  };

  const available = (pool: Exercise[]) =>
    pool.filter(
      (exercise) =>
        !usedIds.has(exercise.id) &&
        !usedNames.has(normalizeExerciseName(exercise.name)),
    );

  const pickFrom = (pool: Exercise[]) =>
    selectWeightedExercise(
      available(pool),
      executionCounts,
      progressionTargets,
    );

  // 1) Mobilité dynamique : réellement intégrée, pas seulement autorisée.
  for (let i = 0; i < mobilityTarget && selected.length < count; i++) {
    const primaryMobility = available(primaryPool).filter(
      (exercise) => exercise.training_focus === "Mobility",
    );
    const backupMobility = available(backupPool).filter(
      (exercise) => exercise.training_focus === "Mobility",
    );

    const picked =
      selectWeightedExercise(
        primaryMobility.length > 0 ? primaryMobility : backupMobility,
        executionCounts,
        progressionTargets,
      );

    if (!addPicked(picked)) break;
  }

  // 2) Préparation spécifique des patterns / familles du WOD + Skill.
  while (selected.length < count) {
    const primarySpecific = available(primaryPool).filter(
      (exercise) =>
        (exercise.movement_pattern &&
          targetPatterns.has(exercise.movement_pattern)) ||
        (exercise.exercise_family &&
          targetFamilies.has(exercise.exercise_family)),
    );

    const backupSpecific = available(backupPool).filter(
      (exercise) =>
        (exercise.movement_pattern &&
          targetPatterns.has(exercise.movement_pattern)) ||
        (exercise.exercise_family &&
          targetFamilies.has(exercise.exercise_family)),
    );

    const picked =
      selectWeightedExercise(
        primarySpecific.length > 0 ? primarySpecific : backupSpecific,
        executionCounts,
        progressionTargets,
      );

    if (!addPicked(picked)) break;
  }

  // 3) Complément d'activation générale si nécessaire.
  while (selected.length < count) {
    const picked = pickFrom(
      available(primaryPool).length > 0 ? primaryPool : backupPool,
    );
    if (!addPicked(picked)) break;
  }

  return selected;
}

function estimateAdaptiveWarmupDuration(args: {
  selectedWarmup: Exercise[];
  wodFormat: WodFormat;
  focus: Focus;
  readinessScore: number;
}): number {
  const { selectedWarmup, wodFormat, focus, readinessScore } = args;

  if (selectedWarmup.length === 0) return 4;

  let estimatedSeconds = 45; // transitions / explication initiale

  for (const exercise of selectedWarmup) {
    if (exercise.training_focus === "Mobility") {
      estimatedSeconds += 35;
    } else if (exercise.prescription_type === "distance") {
      estimatedSeconds += 40;
    } else if (exercise.prescription_type === "isometric") {
      estimatedSeconds += 35;
    } else {
      estimatedSeconds += 30;
    }

    estimatedSeconds += 10; // transition réaliste entre mouvements
  }

  // Avant un travail de force, on laisse légèrement plus de temps pour
  // l'activation spécifique, sans transformer le Warm-up en mini-WOD.
  if (wodFormat === "STRENGTH" || focus === "Strength") {
    estimatedSeconds += 45;
  }

  if (readinessScore <= 4) {
    estimatedSeconds += 30;
  }

  return clampInt(Math.ceil(estimatedSeconds / 60), 4, 9);
}

function getAdaptiveWarmupStructure(
  exerciseCount: number,
  durationMinutes: number,
  wodFormat: WodFormat,
): string {
  // Beaucoup de mouvements différents = un passage fluide.
  if (exerciseCount >= 6) {
    return `1 passage fluide — ${exerciseCount} mouvements — environ ${durationMinutes} min`;
  }

  // Pour la force, on privilégie la qualité et la préparation progressive.
  if (wodFormat === "STRENGTH") {
    return `1 passage ciblé + activation progressive — environ ${durationMinutes} min`;
  }

  // Un petit Warm-up peut être répété une fois si le temps le permet.
  if (exerciseCount <= 3 && durationMinutes >= 6) {
    return `2 passages courts — ${exerciseCount} mouvements — environ ${durationMinutes} min`;
  }

  return `1 passage fluide — ${exerciseCount} mouvements — environ ${durationMinutes} min`;
}

// ============================================================================
// FORMAT
// ============================================================================

function chooseWodFormat(
  preference: WodFormat | null,
  focus: Focus,
  readinessScore: number,
  durationMinutes: number,
): WodFormat {
  if (preference) {
    // Readiness très basse : on évite un format agressif demandé manuellement.
    if (readinessScore <= 3 && preference === "FOR_TIME") return "CIRCUIT";
    return preference;
  }

  if (focus === "Strength") return "STRENGTH";
  if (focus === "Conditioning") {
    return durationMinutes <= 40 ? "EMOM" : "AMRAP";
  }
  if (focus === "Fat Loss") return "CIRCUIT";
  if (focus === "Skill") return "EMOM";

  if (readinessScore <= 4) return "CIRCUIT";

  const options: WodFormat[] = ["AMRAP", "EMOM", "FOR_TIME", "CIRCUIT"];
  return options[Math.floor(Math.random() * options.length)];
}

function applyFormatCandidateFilters(
  pool: Exercise[],
  format: WodFormat,
): Exercise[] {
  if (format === "AMRAP") {
    return pool.filter(
      (exercise) =>
        (exercise.transition_cost ?? 0) <= 3 &&
        (exercise.technical_complexity ?? 1) <= 4,
    );
  }

  if (format === "EMOM") {
    return pool.filter(
      (exercise) => (exercise.technical_complexity ?? 1) <= 4,
    );
  }

  if (format === "STRENGTH") {
    const strengthPool = pool.filter(
      (exercise) =>
        exercise.training_focus === "Strength" ||
        exercise.prescription_type === "reps_heavy",
    );
    return strengthPool.length >= 2 ? strengthPool : pool;
  }

  return pool;
}

// ============================================================================
// SELECTION
// ============================================================================

function selectWodExercises(args: {
  primaryPool: Exercise[];
  backupPool: Exercise[];
  count: number;
  format: WodFormat;
  executionCounts: Record<string, number>;
  progressionTargets: Map<string, number>;
  readinessScore: number;
}): Exercise[] {
  const {
    primaryPool,
    backupPool,
    count,
    format,
    executionCounts,
    progressionTargets,
    readinessScore,
  } = args;

  const selected: Exercise[] = [];
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  const usedPatterns = new Set<string>();

  const tryFill = (source: Exercise[]) => {
    let remaining = source.filter(
      (exercise) =>
        !usedIds.has(exercise.id) &&
        !usedNames.has(normalizeExerciseName(exercise.name)),
    );

    while (selected.length < count && remaining.length > 0) {
      let candidates = remaining.filter((candidate) =>
        isValidWodAddition(selected, candidate, format, readinessScore),
      );

      const differentPattern = candidates.filter(
        (candidate) =>
          !candidate.movement_pattern ||
          !usedPatterns.has(candidate.movement_pattern),
      );

      if (differentPattern.length > 0) candidates = differentPattern;
      if (candidates.length === 0) break;

      const picked = selectWeightedExercise(
        candidates,
        executionCounts,
        progressionTargets,
      );
      if (!picked) break;

      selected.push(picked);
      usedIds.add(picked.id);
      usedNames.add(normalizeExerciseName(picked.name));
      if (picked.movement_pattern) usedPatterns.add(picked.movement_pattern);

      remaining = remaining.filter(
        (exercise) =>
          exercise.id !== picked.id &&
          normalizeExerciseName(exercise.name) !==
            normalizeExerciseName(picked.name),
      );
    }
  };

  tryFill(primaryPool);
  if (selected.length < count) tryFill(backupPool);

  return selected;
}

function isValidWodAddition(
  selected: Exercise[],
  candidate: Exercise,
  format: WodFormat,
  readinessScore: number,
): boolean {
  if (readinessScore <= 4) {
    if ((candidate.fatigue_score ?? 1) > 4) return false;
    if ((candidate.technical_complexity ?? 1) > 3) return false;
  }

  // PRG-V1-003 : max 1 exercice joint_impact >= 5.
  if ((candidate.joint_impact ?? 0) >= 5) {
    const existingHighImpact = selected.some(
      (e) => (e.joint_impact ?? 0) >= 5,
    );
    if (existingHighImpact) return false;
  }

  // PRG-V1-042 : max 1 Jump.
  if (candidate.movement_pattern === "Jump") {
    if (selected.some((e) => e.movement_pattern === "Jump")) return false;
  }

  // PRG-V1-060 / 043 : max 1 exercice très technique en EMOM,
  // et par défaut sur WOD court.
  if ((candidate.technical_complexity ?? 1) >= 4) {
    const existingTechnical = selected.some(
      (e) => (e.technical_complexity ?? 1) >= 4,
    );
    if (format === "EMOM" && existingTechnical) return false;
  }

  // PRG-V1-061 : max 1 fatigue 5 dans EMOM.
  if (format === "EMOM" && (candidate.fatigue_score ?? 0) >= 5) {
    if (selected.some((e) => (e.fatigue_score ?? 0) >= 5)) return false;
  }

  const previous = selected[selected.length - 1];

  if (previous) {
    // PRG-V1-004.
    const previousExplosive =
      ["Power", "Conditioning"].includes(previous.training_focus ?? "") &&
      (previous.fatigue_score ?? 0) >= 4;
    const candidateExplosive =
      ["Power", "Conditioning"].includes(candidate.training_focus ?? "") &&
      (candidate.fatigue_score ?? 0) >= 4;

    if (previousExplosive && candidateExplosive) return false;

    // PRG-V1-005.
    if (
      previous.body_region === "Upper" &&
      (previous.fatigue_score ?? 0) >= 4 &&
      candidate.starting_position === "Handstand"
    ) {
      return false;
    }

    // PRG-V1-070.
    if (format === "FOR_TIME") {
      const pair = new Set([
        previous.movement_pattern,
        candidate.movement_pattern,
      ]);

      if (
        pair.has("Hinge") &&
        pair.has("Jump") &&
        (previous.fatigue_score ?? 0) >= 5 &&
        (candidate.fatigue_score ?? 0) >= 5
      ) {
        return false;
      }
    }
  }

  return true;
}

function selectUniqueExercises(
  primaryPool: Exercise[],
  backupPool: Exercise[],
  count: number,
  executionCounts: Record<string, number>,
  progressionTargets: Map<string, number>,
  preferUniquePattern: boolean,
): Exercise[] {
  const selected: Exercise[] = [];
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  const usedPatterns = new Set<string>();

  const fill = (source: Exercise[]) => {
    let remaining = [...source];

    while (selected.length < count && remaining.length > 0) {
      let candidates = remaining.filter(
        (exercise) =>
          !usedIds.has(exercise.id) &&
          !usedNames.has(normalizeExerciseName(exercise.name)),
      );

      if (preferUniquePattern) {
        const uniquePatternCandidates = candidates.filter(
          (exercise) =>
            !exercise.movement_pattern ||
            !usedPatterns.has(exercise.movement_pattern),
        );
        if (uniquePatternCandidates.length > 0) {
          candidates = uniquePatternCandidates;
        }
      }

      const picked = selectWeightedExercise(
        candidates,
        executionCounts,
        progressionTargets,
      );

      if (!picked) break;

      selected.push(picked);
      usedIds.add(picked.id);
      usedNames.add(normalizeExerciseName(picked.name));
      if (picked.movement_pattern) usedPatterns.add(picked.movement_pattern);

      remaining = remaining.filter((e) => e.id !== picked.id);
    }
  };

  fill(primaryPool);
  if (selected.length < count) fill(backupPool);

  return selected;
}

function selectWeightedExercise(
  pool: Exercise[],
  executionCounts: Record<string, number>,
  progressionTargets: Map<string, number>,
): Exercise | null {
  if (!pool || pool.length === 0) return null;

  const weighted = pool.map((exercise) => {
    const executionCount = executionCounts[exercise.id] ?? 0;
    const recencyWeight = 1 / (1 + executionCount);
    const catalogWeight = Math.max(1, exercise.selection_weight ?? 1);
    const progressionBoost = progressionTargets.get(exercise.id) ?? 1;

    return {
      exercise,
      weight: recencyWeight * catalogWeight * progressionBoost,
    };
  });

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;

  for (const item of weighted) {
    if (random < item.weight) return item.exercise;
    random -= item.weight;
  }

  return weighted[0]?.exercise ?? pool[0] ?? null;
}

// ============================================================================
// SAFETY / CONTRAINTES
// ============================================================================

function groupConstraints(
  constraints: ExerciseConstraint[],
): Map<string, ExerciseConstraint[]> {
  const map = new Map<string, ExerciseConstraint[]>();

  for (const constraint of constraints) {
    if (!map.has(constraint.exercise_id)) {
      map.set(constraint.exercise_id, []);
    }
    map.get(constraint.exercise_id)!.push(constraint);
  }

  return map;
}

function isHardBlockedByConstraint(
  exerciseId: string,
  injuredZones: string[],
  constraintsByExercise: Map<string, ExerciseConstraint[]>,
): boolean {
  if (injuredZones.length === 0) return false;

  const normalizedZones = new Set(injuredZones.map(toConstraintZone));
  const constraints = constraintsByExercise.get(exerciseId) ?? [];

  return constraints.some((constraint) => {
    if (!constraint.body_zone) return false;
    if (!normalizedZones.has(constraint.body_zone)) return false;

    // avoid = exclusion systématique
    if (constraint.rule_type === "avoid") return true;

    // regress sévère = l'exercice courant n'est pas candidat direct.
    if (
      constraint.rule_type === "regress" &&
      (constraint.severity ?? 1) >= 2
    ) {
      return true;
    }

    return false;
  });
}

function isLegacyUnsafeForInjuries(
  exercise: Exercise,
  injuredZones: string[],
): boolean {
  if (injuredZones.length === 0) return false;

  const name = (exercise.name ?? "").toLowerCase();
  const pattern = (exercise.movement_pattern ?? "").toLowerCase();
  const family = (exercise.exercise_family ?? "").toLowerCase();

  for (const rawZone of injuredZones) {
    const zone = toConstraintZone(rawZone);

    if (zone === "wrist") {
      if (
        pattern.includes("push") ||
        name.includes("pompe") ||
        name.includes("plank") ||
        name.includes("handstand") ||
        name.includes("burpee")
      ) {
        return true;
      }
    }

    if (zone === "knee") {
      if (
        pattern.includes("squat") ||
        pattern.includes("lunge") ||
        name.includes("jump") ||
        name.includes("burpee") ||
        name.includes("thruster") ||
        name.includes("step")
      ) {
        return true;
      }
    }

    if (zone === "shoulder") {
      if (
        pattern.includes("push") ||
        family.includes("push") ||
        name.includes("handstand") ||
        name.includes("snatch") ||
        name.includes("overhead")
      ) {
        return true;
      }
    }

    if (zone === "lower_back") {
      if (
        pattern.includes("hinge") ||
        name.includes("rdl") ||
        name.includes("deadlift") ||
        name.includes("swing") ||
        name.includes("good morning")
      ) {
        return true;
      }
    }

    if (zone === "elbow") {
      if (
        name.includes("diamant") ||
        name.includes("dip") ||
        name.includes("triceps")
      ) {
        return true;
      }
    }
  }

  return false;
}

function toConstraintZone(value: string): string {
  const normalized = normalizeText(value);

  const map: Record<string, string> = {
    poignet: "wrist",
    wrist: "wrist",
    genou: "knee",
    knee: "knee",
    epaule: "shoulder",
    shoulder: "shoulder",
    "bas du dos": "lower_back",
    lombaires: "lower_back",
    lower_back: "lower_back",
    coude: "elbow",
    elbow: "elbow",
  };

  return map[normalized] ?? normalized.replace(/\s+/g, "_");
}

// ============================================================================
// VALIDATION FINALE
// ============================================================================

function validateGeneratedWorkout(args: {
  selectedWod: Exercise[];
  selectedSkill: Exercise[];
  selectedWarmup: Exercise[];
  selectedTabata: Exercise[];
  wodFormat: WodFormat;
  readinessScore: number;
  injuredZones: string[];
  constraintsByExercise: Map<string, ExerciseConstraint[]>;
  tabataDuration: number;
  skillDuration: number;
  wodDuration: number;
}) {
  const {
    selectedWod,
    selectedSkill,
    selectedWarmup,
    selectedTabata,
    readinessScore,
    injuredZones,
    constraintsByExercise,
    tabataDuration,
    skillDuration,
    wodDuration,
  } = args;

  const allExercises = [
    ...selectedWarmup,
    ...selectedTabata,
    ...selectedSkill,
    ...selectedWod,
  ];

  const ids = allExercises.map((e) => e.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Validation moteur: exercice dupliqué dans la séance.");
  }

  for (const exercise of allExercises) {
    if (
      isHardBlockedByConstraint(
        exercise.id,
        injuredZones,
        constraintsByExercise,
      )
    ) {
      throw new Error(
        `Validation moteur: ${exercise.name} viole une contrainte de sécurité.`,
      );
    }

    if (
      readinessScore <= 4 &&
      ((exercise.technical_complexity ?? 1) > 3 ||
        (exercise.fatigue_score ?? 1) > 4)
    ) {
      throw new Error(
        `Validation moteur: ${exercise.name} est trop exigeant pour la readiness du jour.`,
      );
    }
  }

  if (selectedWarmup.length === 0) {
    throw new Error(
      "Validation moteur: le Warm-up ne contient aucun exercice.",
    );
  }

  if (selectedWod.length === 0) {
    throw new Error(
      "Validation moteur: le WOD ne contient aucun exercice.",
    );
  }

  if (wodDuration < 8) {
    throw new Error(
      "Validation moteur: la durée du WOD est inférieure au minimum de 8 minutes.",
    );
  }

  if (skillDuration > 0 && selectedSkill.length === 0) {
    throw new Error(
      "Validation moteur: un Skill est budgété mais aucun exercice n'a été sélectionné.",
    );
  }

  if (tabataDuration === 0 && selectedTabata.length !== 0) {
    throw new Error(
      "Validation moteur: des exercices Tabata sont présents sans bloc Tabata.",
    );
  }

  if (tabataDuration > 0) {
    if (
      selectedTabata.some(
        (exercise) =>
          exercise.tabata_eligible !== true || exercise.body_region !== "Core",
      )
    ) {
      throw new Error(
        "Validation moteur: le Tabata contient un exercice non éligible.",
      );
    }

    const expectedCount = tabataDuration === 8 ? 4 : 2;
    if (selectedTabata.length !== expectedCount) {
      throw new Error(
        `Validation moteur: Tabata ${tabataDuration} min invalide — ${expectedCount} exercices attendus.`,
      );
    }
  }
}

// ============================================================================
// PRESCRIPTIONS
// ============================================================================

function getWarmupPrescription(
  prescriptionType: string | null | undefined,
  readinessScore: number,
): string {
  const low = readinessScore <= 4;

  switch (prescriptionType) {
    case "isometric":
      return low ? "15 à 20 secondes" : "20 à 30 secondes";
    case "reps_unilateral":
      return low ? "4 à 6 reps par côté" : "6 à 8 reps par côté";
    case "metabolic_high":
      return low ? "4 à 6 reps contrôlées" : "6 à 8 reps progressives";
    case "distance":
      return low
        ? "10 à 15 mètres à rythme facile"
        : "15 à 20 mètres progressifs";
    case "reps_heavy":
      return low ? "5 reps très légères" : "6 à 8 reps légères";
    default:
      return low ? "6 à 8 reps" : "8 à 10 reps";
  }
}

function getTabataPrescription(
  prescriptionType: string | null | undefined,
): string {
  if (prescriptionType === "isometric") {
    return "20 secondes de maintien / 10 secondes de repos";
  }
  return "20 secondes de travail / 10 secondes de repos";
}

function isIsometricExercise(exercise: Exercise): boolean {
  if (exercise.prescription_type === "isometric") {
    return true;
  }

  // Garde-fou catalogue :
  // un mouvement explicitement nommé "Hold" doit être traité comme un maintien
  // même si sa prescription_type est mal renseignée en base.
  const name = normalizeText(exercise.name ?? "");

  return (
    name.includes("hold") ||
    name.includes("wall sit") ||
    name.includes("dead hang")
  );
}

function getSkillBaseSettings(
  focus: Focus,
  readinessScore: number,
) {
  let sets = 4;
  let reps = "5 à 8 répétitions";
  let rest = "1 min 30";
  let targetRpe = "RPE 6-7";

  if (focus === "Strength") {
    sets = 5;
    reps = "3 à 5 répétitions";
    rest = "2 min à 2 min 30";
    targetRpe = "RPE 8";
  } else if (focus === "Muscle Gain") {
    sets = 4;
    reps = "8 à 10 répétitions";
    rest = "1 min 30";
    targetRpe = "RPE 7-8";
  } else if (focus === "Conditioning" || focus === "Fat Loss") {
    sets = 4;
    reps = "8 à 12 répétitions";
    rest = "45 sec à 1 min";
    targetRpe = "RPE 7";
  }

  if (readinessScore <= 4) {
    sets = Math.min(sets, 3);
    targetRpe = "RPE 5-6";
  }

  return {
    sets,
    reps,
    rest,
    targetRpe,
  };
}

function getSkillExercisePrescription(
  exercise: Exercise,
  focus: Focus,
  readinessScore: number,
): string {
  const settings = getSkillBaseSettings(
    focus,
    readinessScore,
  );

  const low = readinessScore <= 4;
  const high = readinessScore >= 8;

  if (isIsometricExercise(exercise)) {
    const hold = low
      ? "15 à 20 secondes de maintien"
      : high
      ? "30 à 40 secondes de maintien"
      : "20 à 30 secondes de maintien";

    return `${settings.sets} séries x ${hold} — repos ${settings.rest} — ${settings.targetRpe}`;
  }

  if (exercise.prescription_type === "distance") {
    const distance = low
      ? "10 à 15 m"
      : high
      ? "20 à 30 m"
      : "15 à 20 m";

    return `${settings.sets} séries x ${distance} — repos ${settings.rest} — ${settings.targetRpe}`;
  }

  if (exercise.prescription_type === "reps_unilateral") {
    const reps = low
      ? "5 à 6 reps par côté"
      : high
      ? "8 à 10 reps par côté"
      : "6 à 8 reps par côté";

    return `${settings.sets} séries x ${reps} — repos ${settings.rest} — ${settings.targetRpe}`;
  }

  if (exercise.prescription_type === "reps_heavy") {
    const reps = low
      ? "3 à 5 répétitions"
      : high
      ? "4 à 6 répétitions"
      : "3 à 5 répétitions";

    return `${settings.sets} séries x ${reps} — repos ${settings.rest} — ${settings.targetRpe}`;
  }

  return `${settings.sets} séries x ${settings.reps} — repos ${settings.rest} — ${settings.targetRpe}`;
}

function getSkillBlockStructure(
  exercises: Exercise[],
  focus: Focus,
  readinessScore: number,
): string {
  const settings = getSkillBaseSettings(
    focus,
    readinessScore,
  );

  if (
    exercises.length > 0 &&
    exercises.every(isIsometricExercise)
  ) {
    return `${settings.sets} séries — maintien contrôlé — repos ${settings.rest}`;
  }

  if (
    exercises.some(isIsometricExercise)
  ) {
    return `${settings.sets} séries — prescription adaptée à chaque exercice — repos ${settings.rest}`;
  }

  return `${settings.sets} séries — travail technique / force — repos ${settings.rest}`;
}

function getDynamicWodPrescription(
  prescriptionType: string,
  complexity: number,
  readinessScore: number,
  format: WodFormat,
): string {
  const low = readinessScore <= 4;
  const high = readinessScore >= 8;

  if (format === "STRENGTH") {
    if (prescriptionType === "isometric") {
      return low ? "3 x 20 secondes" : "4 x 30 à 40 secondes";
    }
    return low ? "3 x 5 reps — RPE 5-6" : "4 à 5 x 3 à 6 reps — RPE 7-8";
  }

  if (prescriptionType === "reps_unilateral") {
    if (complexity >= 4) {
      return low
        ? "4 à 6 reps par côté"
        : high
        ? "8 à 10 reps par côté"
        : "6 à 8 reps par côté";
    }
    return low
      ? "6 reps par côté"
      : high
      ? "10 reps par côté"
      : "8 reps par côté";
  }

  if (prescriptionType === "reps_heavy") {
    return low ? "3 reps charge modérée" : high ? "5 à 7 reps" : "5 reps";
  }

  if (prescriptionType === "isometric") {
    return low
      ? "20 secondes"
      : high
      ? "40 à 50 secondes"
      : "30 secondes";
  }

  if (prescriptionType === "metabolic_high") {
    return low ? "8 à 12 reps" : high ? "18 à 22 reps" : "12 à 16 reps";
  }

  if (prescriptionType === "distance") {
    return low
      ? "10 à 15 m"
      : high
      ? "20 à 30 m"
      : "15 à 20 m";
  }

  if (complexity >= 4) {
    return low ? "3 à 5 reps" : high ? "6 à 8 reps" : "4 à 6 reps";
  }

  return low ? "6 à 8 reps" : high ? "12 à 15 reps" : "8 à 12 reps";
}

// ============================================================================
// HISTORIQUE / REGION
// ============================================================================

async function resolveAutomaticTargetRegion(
  supabase: any,
  userId: string,
): Promise<AutoRegionResult> {
  const fallback: AutoRegionResult = {
    region: "Full Body",
    scores: { Upper: 0, Lower: 0 },
  };

  const fourteenDaysAgo = isoDaysAgo(14);

  const { data: recentLogs, error: logsError } = await supabase
    .from("exercise_logs")
    .select("exercise_id, created_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .gte("created_at", fourteenDaysAgo)
    .order("created_at", { ascending: false });

  if (logsError || !recentLogs || recentLogs.length === 0) return fallback;

  const ids = Array.from(
    new Set(recentLogs.map((log: any) => log.exercise_id).filter(Boolean)),
  );

  if (ids.length === 0) return fallback;

  const { data: exercises, error: exercisesError } = await supabase
    .from("exercises")
    .select("id, body_region")
    .in("id", ids);

  if (exercisesError || !exercises) return fallback;

  const regionById = new Map(
    exercises.map((exercise: any) => [exercise.id, exercise.body_region]),
  );

  const scores = { Upper: 0, Lower: 0 };
  const now = Date.now();

  for (const log of recentLogs) {
    const region = regionById.get(log.exercise_id);
    if (!region) continue;

    const ageDays = Math.max(
      0,
      (now - new Date(log.created_at).getTime()) / 86_400_000,
    );
    const weight = Math.max(0.3, 1 - ageDays / 20);

    if (region === "Upper") scores.Upper += weight;
    else if (region === "Lower") scores.Lower += weight;
    else if (region === "Full Body") {
      scores.Upper += weight * 0.5;
      scores.Lower += weight * 0.5;
    } else if (region === "Core") {
      scores.Upper += weight * 0.15;
      scores.Lower += weight * 0.15;
    }
  }

  if (Math.abs(scores.Upper - scores.Lower) <= 1) {
    return { region: "Full Body", scores };
  }

  return {
    region: scores.Upper < scores.Lower ? "Upper" : "Lower",
    scores,
  };
}

// ============================================================================
// PERSISTENCE
// ============================================================================

function buildSessionExerciseRows(
  sessionId: string,
  blocks: GeneratedBlock[],
) {
  const rows: Record<string, unknown>[] = [];

  for (const block of blocks) {
    block.exercises.forEach((exercise, index) => {
      rows.push({
        session_id: sessionId,
        exercise_id: exercise.id,
        exercise_name: exercise.name,

        // La DB utilise "warm_up" alors que le moteur interne utilise "warmup".
        block_key:
          block.block_key === "warmup"
            ? "warm_up"
            : block.block_key,

        position: index + 1,
        status: "pending",
        prescription: exercise.prescription,
        prescription_json: exercise.prescription_json,
        rounds: block.rounds ?? null,
      });
    });
  }

  return rows;
}

// ============================================================================
// HELPERS
// ============================================================================

function toGeneratedExercise(
  exercise: Exercise,
  prescription: string,
): GeneratedExercise {
  return {
    id: exercise.id,
    name: exercise.name,
    pattern: exercise.movement_pattern ?? null,
    region: exercise.body_region ?? null,
    prescription,
    prescription_json: buildPrescriptionJson(exercise, prescription),
    instructions: exercise.instructions ?? null,
    tips: exercise.tips ?? null,
    tracking_modes: exercise.tracking_modes ?? [],
  };
}

function buildPrescriptionJson(
  exercise: Exercise,
  prescription: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    prescription_type: exercise.prescription_type ?? "reps_standard",
    tracking_modes: exercise.tracking_modes ?? [],
    text: prescription,
  };

  const normalized = prescription
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const setsMatch =
    normalized.match(/(\d+)\s*series/) ||
    normalized.match(/(\d+)\s*x\s*\d+/);
  if (setsMatch) result.sets = Number(setsMatch[1]);

  const repsRange = normalized.match(
    /(\d+)\s*(?:a|-)\s*(\d+)\s*(?:reps|repetitions)/,
  );
  if (repsRange) {
    result.reps_min = Number(repsRange[1]);
    result.reps_max = Number(repsRange[2]);
  } else {
    const repsExact = normalized.match(/(\d+)\s*(?:reps|repetitions)/);
    if (repsExact) {
      result.reps_min = Number(repsExact[1]);
      result.reps_max = Number(repsExact[1]);
    }
  }

  const durationRange = normalized.match(
    /(\d+)\s*(?:a|-)\s*(\d+)\s*secondes?/,
  );
  if (durationRange) {
    result.duration_seconds_min = Number(durationRange[1]);
    result.duration_seconds_max = Number(durationRange[2]);
  } else {
    const durationExact = normalized.match(/(\d+)\s*secondes?/);
    if (durationExact) {
      result.duration_seconds_min = Number(durationExact[1]);
      result.duration_seconds_max = Number(durationExact[1]);
    }
  }

  const distanceRange = normalized.match(
    /(\d+)\s*(?:a|-)\s*(\d+)\s*m(?:\s|$)/,
  );
  if (distanceRange) {
    result.distance_meters_min = Number(distanceRange[1]);
    result.distance_meters_max = Number(distanceRange[2]);
  } else {
    const distanceExact = normalized.match(/(\d+)\s*metres?/);
    if (distanceExact) {
      result.distance_meters_min = Number(distanceExact[1]);
      result.distance_meters_max = Number(distanceExact[1]);
    }
  }

  const rpeRange = normalized.match(/rpe\s*(\d+)\s*(?:a|-)\s*(\d+)/);
  if (rpeRange) {
    result.target_rpe_min = Number(rpeRange[1]);
    result.target_rpe_max = Number(rpeRange[2]);
  } else {
    const rpeExact = normalized.match(/rpe\s*(\d+)/);
    if (rpeExact) {
      result.target_rpe_min = Number(rpeExact[1]);
      result.target_rpe_max = Number(rpeExact[1]);
    }
  }

  return result;
}

function filterUsableFor(pool: Exercise[], tag: string): Exercise[] {
  return pool.filter((exercise) => {
    if (Array.isArray(exercise.usable_for)) {
      return exercise.usable_for.includes(tag);
    }
    if (typeof exercise.usable_for === "string") {
      return exercise.usable_for.includes(tag);
    }
    return false;
  });
}

function hasAvailableEquipment(
  exercise: Exercise,
  validEquipmentIds: Set<string>,
): boolean {
  const relations = exercise.exercise_equipment ?? [];

  if (
    exercise.equipment_requirement === "none" ||
    relations.length === 0
  ) {
    return true;
  }

  return relations.some((relation) =>
    validEquipmentIds.has(relation.equipment_id)
  );
}

function getPrimaryMovementPattern(exercises: Exercise[]): string | null {
  const counts = new Map<string, number>();

  for (const exercise of exercises) {
    if (!exercise.movement_pattern) continue;
    counts.set(
      exercise.movement_pattern,
      (counts.get(exercise.movement_pattern) ?? 0) + 1,
    );
  }

  let best: string | null = null;
  let bestCount = 0;

  for (const [pattern, count] of counts.entries()) {
    if (count > bestCount) {
      best = pattern;
      bestCount = count;
    }
  }

  return best;
}

function getWodObjective(format: WodFormat, focus: Focus): string {
  if (format === "STRENGTH") return `Développer la force — focus ${focus}.`;
  if (format === "EMOM") return "Maintenir qualité, rythme et répétabilité.";
  if (format === "AMRAP") return "Accumuler un volume propre à rythme soutenu.";
  if (format === "FOR_TIME") return "Compléter le travail avec une exécution efficace.";
  return "Enchaîner les mouvements avec qualité et fatigue maîtrisée.";
}

function getWodStructure(
  format: WodFormat,
  durationMinutes: number,
  exerciseCount: number,
): string {
  if (format === "EMOM") {
    return `EMOM ${durationMinutes} min — ${exerciseCount} stations en rotation`;
  }
  if (format === "AMRAP") {
    return `AMRAP ${durationMinutes} min — ${exerciseCount} exercices`;
  }
  if (format === "FOR_TIME") {
    return `For Time — cap ${durationMinutes} min — ${exerciseCount} exercices`;
  }
  if (format === "STRENGTH") {
    return `Strength ${durationMinutes} min — ${exerciseCount} exercices`;
  }
  return `Circuit ${durationMinutes} min — ${exerciseCount} exercices`;
}

function normalizeExperience(value: unknown): Experience {
  const normalized = normalizeText(String(value ?? ""));

  if (normalized.includes("debut")) return "Débutant";
  if (normalized.includes("avance")) return "Avancé";
  return "Intermédiaire";
}

function normalizeReadiness(
  value: number | string | undefined,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampInt(Math.round(value), 1, 10);
  }

  const normalized = normalizeText(String(value ?? "Normale"));

  if (normalized === "faible") return 3;
  if (normalized === "olympique") return 9;
  return 6;
}

function readinessZone(score: number): "low" | "normal" | "high" {
  if (score <= 4) return "low";
  if (score >= 8) return "high";
  return "normal";
}

function getMaxComplexity(
  experience: Experience,
  readinessScore: number,
): number {
  let base = experience === "Débutant" ? 3 : experience === "Avancé" ? 5 : 4;

  if (readinessScore <= 4) base -= 1;
  else if (readinessScore >= 8) base += 0;

  return clampInt(base, 1, 5);
}

function normalizeExerciseName(value: string | null | undefined): string {
  return normalizeText(value ?? "").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
