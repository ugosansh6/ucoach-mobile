


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."equipment_requirement" AS ENUM (
    'none',
    'optional',
    'required'
);


ALTER TYPE "public"."equipment_requirement" OWNER TO "postgres";


CREATE TYPE "public"."exercise_type" AS ENUM (
    'strength',
    'cardio',
    'skill',
    'mobility',
    'core',
    'conditioning'
);


ALTER TYPE "public"."exercise_type" OWNER TO "postgres";


CREATE TYPE "public"."experience_level" AS ENUM (
    'beginner',
    'intermediate',
    'advanced'
);


ALTER TYPE "public"."experience_level" OWNER TO "postgres";


CREATE TYPE "public"."workout_block_type" AS ENUM (
    'warmup',
    'core_tabata',
    'skill',
    'wod',
    'cooldown'
);


ALTER TYPE "public"."workout_block_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.profiles (
    id,
    firstname,
    lastname,
    onboarding_completed
  )
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'firstname'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'lastname'), ''),
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_constraints_pre_dedup_v1_4" (
    "id" integer,
    "exercise_id" character varying(10),
    "constraint_name" "text",
    "reason" "text",
    "priority" character varying(20),
    "body_zone" "text",
    "rule_type" "text",
    "severity" smallint
);


ALTER TABLE "public"."_backup_exercise_constraints_pre_dedup_v1_4" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_constraints_pre_v1" (
    "id" integer,
    "exercise_id" character varying(10),
    "constraint_name" "text",
    "reason" "text",
    "priority" character varying(20)
);


ALTER TABLE "public"."_backup_exercise_constraints_pre_v1" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_equipment_pre_dedup_v1_4" (
    "exercise_id" character varying(10),
    "equipment_id" character varying(10)
);


ALTER TABLE "public"."_backup_exercise_equipment_pre_dedup_v1_4" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_equipment_pre_v1" (
    "exercise_id" character varying(10),
    "equipment_id" character varying(10)
);


ALTER TABLE "public"."_backup_exercise_equipment_pre_v1" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_logs_pre_progress_v21" (
    "id" bigint,
    "user_id" "uuid",
    "exercise_id" "text",
    "reps_completed" integer,
    "weight_kg" numeric(5,2),
    "rpe" integer,
    "notes" "text",
    "created_at" timestamp with time zone,
    "session_id" "uuid",
    "duration_seconds" integer,
    "distance_meters" numeric,
    "status" "text"
);


ALTER TABLE "public"."_backup_exercise_logs_pre_progress_v21" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_muscles_pre_dedup_v1_4" (
    "exercise_id" character varying(10),
    "muscle_id" character varying(10),
    "priority" character varying(20)
);


ALTER TABLE "public"."_backup_exercise_muscles_pre_dedup_v1_4" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_muscles_pre_v1" (
    "exercise_id" character varying(10),
    "muscle_id" character varying(10),
    "priority" character varying(20)
);


ALTER TABLE "public"."_backup_exercise_muscles_pre_v1" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_tags_pre_dedup_v1_4" (
    "exercise_id" character varying(10),
    "tag" character varying(50)
);


ALTER TABLE "public"."_backup_exercise_tags_pre_dedup_v1_4" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_tags_pre_v1" (
    "exercise_id" character varying(10),
    "tag" character varying(50)
);


ALTER TABLE "public"."_backup_exercise_tags_pre_v1" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_variants_pre_dedup_v1_4" (
    "exercise_id" character varying(10),
    "target_exercise_id" character varying(10),
    "variant_type" character varying(50)
);


ALTER TABLE "public"."_backup_exercise_variants_pre_dedup_v1_4" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_variants_pre_v1" (
    "exercise_id" character varying(10),
    "target_exercise_id" character varying(10),
    "variant_type" character varying(50)
);


ALTER TABLE "public"."_backup_exercise_variants_pre_v1" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercise_variants_pre_v1_5" (
    "exercise_id" character varying(10),
    "target_exercise_id" character varying(10),
    "variant_type" character varying(50)
);


ALTER TABLE "public"."_backup_exercise_variants_pre_v1_5" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercises_pre_dedup_v1_4" (
    "id" character varying(10),
    "name" "text",
    "description" "text",
    "instructions" "text",
    "tips" "text",
    "exercise_type" character varying(50),
    "difficulty" character varying(50),
    "technical_complexity" integer,
    "movement_pattern" character varying(100),
    "exercise_family" character varying(50),
    "body_region" character varying(50),
    "training_focus" character varying(50),
    "equipment_requirement" character varying(50),
    "fatigue_score" integer,
    "cardio_score" integer,
    "joint_impact" integer,
    "stability_requirement" integer,
    "mobility_requirement" integer,
    "energy_system" character varying(50),
    "movement_side" character varying(50),
    "starting_position" character varying(50),
    "transition_cost" integer,
    "selection_weight" integer,
    "usable_for" "text"[],
    "home_friendly" boolean,
    "notes" "text",
    "created_at" timestamp with time zone,
    "prescription_type" character varying(50),
    "image_path" "text",
    "tracking_modes" "text"[],
    "tabata_eligible" boolean
);


ALTER TABLE "public"."_backup_exercises_pre_dedup_v1_4" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_exercises_pre_v1" (
    "id" character varying(10),
    "name" "text",
    "description" "text",
    "instructions" "text",
    "tips" "text",
    "exercise_type" character varying(50),
    "difficulty" character varying(50),
    "technical_complexity" integer,
    "movement_pattern" character varying(100),
    "exercise_family" character varying(50),
    "body_region" character varying(50),
    "training_focus" character varying(50),
    "equipment_requirement" character varying(50),
    "fatigue_score" integer,
    "cardio_score" integer,
    "joint_impact" integer,
    "stability_requirement" integer,
    "mobility_requirement" integer,
    "energy_system" character varying(50),
    "movement_side" character varying(50),
    "starting_position" character varying(50),
    "transition_cost" integer,
    "selection_weight" integer,
    "usable_for" "text"[],
    "home_friendly" boolean,
    "notes" "text",
    "created_at" timestamp with time zone,
    "prescription_type" character varying(50),
    "image_path" "text"
);


ALTER TABLE "public"."_backup_exercises_pre_v1" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_programming_rules_pre_clean_v1" (
    "rule_id" character varying(20),
    "description" "text",
    "scope" "text",
    "format" "text",
    "priority" smallint,
    "condition_json" "jsonb",
    "action_json" "jsonb"
);


ALTER TABLE "public"."_backup_programming_rules_pre_clean_v1" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_programming_rules_pre_v1" (
    "rule_id" character varying(20),
    "description" "text"
);


ALTER TABLE "public"."_backup_programming_rules_pre_v1" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_workout_session_exercises_pre_progress_v21" (
    "id" "uuid",
    "session_id" "uuid",
    "exercise_id" "text",
    "exercise_name" "text",
    "block_key" "text",
    "position" smallint,
    "status" "text",
    "prescription" "text",
    "rounds" smallint,
    "reps_completed" integer,
    "weight_kg" numeric(7,2),
    "rpe" smallint,
    "notes" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "duration_seconds" integer,
    "distance_meters" numeric
);


ALTER TABLE "public"."_backup_workout_session_exercises_pre_progress_v21" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."block_rules" (
    "id" bigint NOT NULL,
    "block_key" "text" NOT NULL,
    "format" "text",
    "duration_minutes" smallint,
    "min_exercises" smallint NOT NULL,
    "max_exercises" smallint NOT NULL,
    "preferred_exercises" smallint,
    "rounds" smallint,
    "work_seconds" smallint,
    "rest_seconds" smallint,
    "rotation_mode" "text",
    "active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."block_rules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."block_rules_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."block_rules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."block_rules_id_seq" OWNED BY "public"."block_rules"."id";



CREATE TABLE IF NOT EXISTS "public"."equipment" (
    "id" character varying(10) NOT NULL,
    "name" character varying(100) NOT NULL,
    "category" character varying(50) NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."equipment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."equipment_profiles" (
    "id" integer NOT NULL,
    "profile_name" character varying(100) NOT NULL,
    "available_equipment" "text"[],
    "description" "text"
);


ALTER TABLE "public"."equipment_profiles" OWNER TO "postgres";


ALTER TABLE "public"."equipment_profiles" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."equipment_profiles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."exercise_constraints" (
    "id" integer NOT NULL,
    "exercise_id" character varying(10),
    "constraint_name" "text" NOT NULL,
    "reason" "text",
    "priority" character varying(20),
    "body_zone" "text",
    "rule_type" "text",
    "severity" smallint,
    CONSTRAINT "exercise_constraints_rule_type_check" CHECK ((("rule_type" IS NULL) OR ("rule_type" = ANY (ARRAY['avoid'::"text", 'caution'::"text", 'regress'::"text"])))),
    CONSTRAINT "exercise_constraints_severity_check" CHECK ((("severity" IS NULL) OR (("severity" >= 1) AND ("severity" <= 3))))
);


ALTER TABLE "public"."exercise_constraints" OWNER TO "postgres";


ALTER TABLE "public"."exercise_constraints" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."exercise_constraints_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."exercise_equipment" (
    "exercise_id" character varying(10) NOT NULL,
    "equipment_id" character varying(10) NOT NULL
);


ALTER TABLE "public"."exercise_equipment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_favorites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "exercise_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."exercise_favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_logs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "exercise_id" "text" NOT NULL,
    "reps_completed" integer DEFAULT 0,
    "weight_kg" numeric(5,2) DEFAULT 0,
    "rpe" integer,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "session_id" "uuid",
    "duration_seconds" integer,
    "distance_meters" numeric,
    "status" "text" DEFAULT 'completed'::"text" NOT NULL,
    "prescription_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "exercise_logs_rpe_check" CHECK ((("rpe" >= 1) AND ("rpe" <= 10))),
    CONSTRAINT "exercise_logs_status_check" CHECK (("status" = ANY (ARRAY['completed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."exercise_logs" OWNER TO "postgres";


ALTER TABLE "public"."exercise_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."exercise_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."exercise_muscles" (
    "exercise_id" character varying(10) NOT NULL,
    "muscle_id" character varying(10) NOT NULL,
    "priority" character varying(20),
    CONSTRAINT "exercise_muscles_priority_check" CHECK ((("priority")::"text" = ANY ((ARRAY['primary'::character varying, 'secondary'::character varying, 'tertiary'::character varying])::"text"[])))
);


ALTER TABLE "public"."exercise_muscles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_tags" (
    "exercise_id" character varying(10) NOT NULL,
    "tag" character varying(50) NOT NULL
);


ALTER TABLE "public"."exercise_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_variants" (
    "exercise_id" character varying(10) NOT NULL,
    "target_exercise_id" character varying(10) NOT NULL,
    "variant_type" character varying(50) NOT NULL
);


ALTER TABLE "public"."exercise_variants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercises" (
    "id" character varying(10) NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "instructions" "text",
    "tips" "text",
    "exercise_type" character varying(50),
    "difficulty" character varying(50),
    "technical_complexity" integer,
    "movement_pattern" character varying(100),
    "exercise_family" character varying(50),
    "body_region" character varying(50),
    "training_focus" character varying(50),
    "equipment_requirement" character varying(50),
    "fatigue_score" integer,
    "cardio_score" integer,
    "joint_impact" integer,
    "stability_requirement" integer,
    "mobility_requirement" integer,
    "energy_system" character varying(50),
    "movement_side" character varying(50),
    "starting_position" character varying(50),
    "transition_cost" integer,
    "selection_weight" integer,
    "usable_for" "text"[],
    "home_friendly" boolean DEFAULT false,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "prescription_type" character varying(50) DEFAULT 'reps_standard'::character varying,
    "image_path" "text",
    "tracking_modes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "tabata_eligible" boolean DEFAULT false NOT NULL,
    CONSTRAINT "exercises_cardio_score_check" CHECK ((("cardio_score" >= 1) AND ("cardio_score" <= 5))),
    CONSTRAINT "exercises_fatigue_score_check" CHECK ((("fatigue_score" >= 1) AND ("fatigue_score" <= 5))),
    CONSTRAINT "exercises_joint_impact_check" CHECK ((("joint_impact" >= 1) AND ("joint_impact" <= 5))),
    CONSTRAINT "exercises_mobility_requirement_check" CHECK ((("mobility_requirement" >= 1) AND ("mobility_requirement" <= 5))),
    CONSTRAINT "exercises_stability_requirement_check" CHECK ((("stability_requirement" >= 1) AND ("stability_requirement" <= 5))),
    CONSTRAINT "exercises_technical_complexity_check" CHECK ((("technical_complexity" >= 1) AND ("technical_complexity" <= 5)))
);


ALTER TABLE "public"."exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."goals" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."movement_patterns" (
    "id" character varying(10) NOT NULL,
    "name" character varying(100) NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."movement_patterns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."muscles" (
    "id" character varying(10) NOT NULL,
    "name" character varying(100) NOT NULL
);


ALTER TABLE "public"."muscles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "firstname" "text",
    "lastname" "text",
    "birthdate" "date",
    "gender" "text",
    "height" integer,
    "weight" numeric,
    "experience" "public"."experience_level" DEFAULT 'beginner'::"public"."experience_level",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "onboarding_completed" boolean DEFAULT false NOT NULL,
    "weekly_session_target" smallint,
    "default_equipment" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "default_injured_zones" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "profiles_default_injured_zones_check" CHECK (("default_injured_zones" <@ ARRAY['Poignet'::"text", 'Coude'::"text", 'Épaule'::"text", 'Genou'::"text", 'Bas du dos'::"text"])),
    CONSTRAINT "profiles_weekly_session_target_check" CHECK ((("weekly_session_target" IS NULL) OR (("weekly_session_target" >= 2) AND ("weekly_session_target" <= 6))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programming_rules" (
    "rule_id" character varying(20) NOT NULL,
    "description" "text",
    "scope" "text",
    "format" "text",
    "priority" smallint DEFAULT 50 NOT NULL,
    "condition_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "action_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."programming_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "title" "text",
    "objective" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_exercise_progress" (
    "user_id" "uuid" NOT NULL,
    "exercise_id" character varying NOT NULL,
    "exposure_count" integer DEFAULT 0 NOT NULL,
    "completed_count" integer DEFAULT 0 NOT NULL,
    "skipped_count" integer DEFAULT 0 NOT NULL,
    "rpe_count" integer DEFAULT 0 NOT NULL,
    "avg_rpe" numeric(4,2),
    "last_rpe" numeric(4,2),
    "recent_rpe" numeric[] DEFAULT '{}'::numeric[] NOT NULL,
    "rpe_trend" numeric(6,3) DEFAULT 0 NOT NULL,
    "adherence_score" numeric(5,2) DEFAULT 0 NOT NULL,
    "performance_trend" numeric(8,4) DEFAULT 0 NOT NULL,
    "consistency_score" numeric(5,2) DEFAULT 0 NOT NULL,
    "mastery_score" numeric(5,2) DEFAULT 0 NOT NULL,
    "state" "text" DEFAULT 'LEARN'::"text" NOT NULL,
    "recommendation" "text" DEFAULT 'LEARN'::"text" NOT NULL,
    "last_performance_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_exercise_progress_adherence_chk" CHECK ((("adherence_score" >= (0)::numeric) AND ("adherence_score" <= (100)::numeric))),
    CONSTRAINT "user_exercise_progress_consistency_chk" CHECK ((("consistency_score" >= (0)::numeric) AND ("consistency_score" <= (100)::numeric))),
    CONSTRAINT "user_exercise_progress_mastery_chk" CHECK ((("mastery_score" >= (0)::numeric) AND ("mastery_score" <= (100)::numeric))),
    CONSTRAINT "user_exercise_progress_recommendation_chk" CHECK (("recommendation" = ANY (ARRAY['LEARN'::"text", 'MAINTAIN'::"text", 'PROGRESS_POSSIBLE'::"text", 'PROGRESS_RECOMMENDED'::"text", 'RECOVER'::"text"]))),
    CONSTRAINT "user_exercise_progress_state_chk" CHECK (("state" = ANY (ARRAY['LEARN'::"text", 'MAINTAIN'::"text", 'PROGRESS'::"text", 'RECOVER'::"text"])))
);


ALTER TABLE "public"."user_exercise_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_goals" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "goal_id" "uuid",
    "priority" integer DEFAULT 1,
    CONSTRAINT "user_goals_priority_check" CHECK ((("priority" IS NULL) OR (("priority" >= 1) AND ("priority" <= 10))))
);


ALTER TABLE "public"."user_goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_blocks" (
    "block_name" character varying(100) NOT NULL,
    "description" "text",
    "objective" "text",
    "avg_duration" character varying(50),
    "target_intensity" character varying(50),
    "constraints" "text"
);


ALTER TABLE "public"."workout_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_equipment" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "workout_id" "uuid",
    "equipment_id" "uuid"
);


ALTER TABLE "public"."workout_equipment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_exercises" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "block_id" "uuid",
    "exercise_id" "uuid",
    "position" integer,
    "measurement_type" "text" DEFAULT 'reps'::"text",
    "sets" integer,
    "reps" integer,
    "duration" integer,
    "rest" integer,
    "weight" numeric,
    CONSTRAINT "workout_exercises_measurement_type_check" CHECK (("measurement_type" = ANY (ARRAY['reps'::"text", 'time'::"text", 'distance'::"text", 'calories'::"text", 'max_reps'::"text"])))
);


ALTER TABLE "public"."workout_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_focus" (
    "focus_name" character varying(100) NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."workout_focus" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_formats" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."workout_formats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "workout_id" "uuid",
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "completed" boolean DEFAULT false,
    "feeling" integer,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "workout_logs_feeling_check" CHECK ((("feeling" >= 1) AND ("feeling" <= 10)))
);


ALTER TABLE "public"."workout_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_requests" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "available_time" integer,
    "experience" "public"."experience_level",
    "objective" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."workout_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_session_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "exercise_id" "text",
    "exercise_name" "text" NOT NULL,
    "block_key" "text" NOT NULL,
    "position" smallint DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "prescription" "text",
    "rounds" smallint,
    "reps_completed" integer,
    "weight_kg" numeric(7,2),
    "rpe" smallint,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "duration_seconds" integer,
    "distance_meters" numeric,
    "prescription_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "workout_session_exercises_block_key_check" CHECK (("block_key" = ANY (ARRAY['warm_up'::"text", 'tabata'::"text", 'skill'::"text", 'wod'::"text"]))),
    CONSTRAINT "workout_session_exercises_position_check" CHECK (("position" >= 1)),
    CONSTRAINT "workout_session_exercises_reps_completed_check" CHECK ((("reps_completed" IS NULL) OR ("reps_completed" >= 0))),
    CONSTRAINT "workout_session_exercises_rounds_check" CHECK ((("rounds" IS NULL) OR ("rounds" >= 1))),
    CONSTRAINT "workout_session_exercises_rpe_check" CHECK ((("rpe" IS NULL) OR (("rpe" >= 1) AND ("rpe" <= 10)))),
    CONSTRAINT "workout_session_exercises_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'skipped'::"text", 'completed'::"text"]))),
    CONSTRAINT "workout_session_exercises_weight_kg_check" CHECK ((("weight_kg" IS NULL) OR ("weight_kg" >= (0)::numeric)))
);


ALTER TABLE "public"."workout_session_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'generated'::"text" NOT NULL,
    "duration_minutes" smallint,
    "target_region" "text",
    "readiness" "text",
    "focus" "text",
    "available_equipment" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "injured_zones" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "post_workout_feeling" smallint,
    "global_rpe" smallint,
    "generated_workout" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workout_sessions_duration_minutes_check" CHECK ((("duration_minutes" IS NULL) OR (("duration_minutes" >= 1) AND ("duration_minutes" <= 300)))),
    CONSTRAINT "workout_sessions_global_rpe_check" CHECK ((("global_rpe" IS NULL) OR (("global_rpe" >= 1) AND ("global_rpe" <= 10)))),
    CONSTRAINT "workout_sessions_post_workout_feeling_check" CHECK ((("post_workout_feeling" IS NULL) OR (("post_workout_feeling" >= 1) AND ("post_workout_feeling" <= 10)))),
    CONSTRAINT "workout_sessions_status_check" CHECK (("status" = ANY (ARRAY['generated'::"text", 'in_progress'::"text", 'completed'::"text", 'abandoned'::"text"])))
);


ALTER TABLE "public"."workout_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_templates" (
    "template_name" character varying(100) NOT NULL,
    "description" "text",
    "duration_range" character varying(50),
    "movements_count" character varying(50),
    "rules" "text"
);


ALTER TABLE "public"."workout_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workouts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "program_id" "uuid",
    "request_id" "uuid",
    "focus_id" "uuid",
    "format_id" "uuid",
    "title" "text",
    "estimated_duration" integer,
    "generation_method" "text" DEFAULT 'ai_generated'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "workouts_generation_method_check" CHECK (("generation_method" = ANY (ARRAY['manual'::"text", 'template'::"text", 'ai_generated'::"text", 'coach_created'::"text"])))
);


ALTER TABLE "public"."workouts" OWNER TO "postgres";


ALTER TABLE ONLY "public"."block_rules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."block_rules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."block_rules"
    ADD CONSTRAINT "block_rules_block_key_format_duration_minutes_key" UNIQUE ("block_key", "format", "duration_minutes");



ALTER TABLE ONLY "public"."block_rules"
    ADD CONSTRAINT "block_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment_profiles"
    ADD CONSTRAINT "equipment_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment_profiles"
    ADD CONSTRAINT "equipment_profiles_profile_name_key" UNIQUE ("profile_name");



ALTER TABLE ONLY "public"."exercise_constraints"
    ADD CONSTRAINT "exercise_constraints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_equipment"
    ADD CONSTRAINT "exercise_equipment_pkey" PRIMARY KEY ("exercise_id", "equipment_id");



ALTER TABLE ONLY "public"."exercise_favorites"
    ADD CONSTRAINT "exercise_favorites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_favorites"
    ADD CONSTRAINT "exercise_favorites_user_exercise_unique" UNIQUE ("user_id", "exercise_id");



ALTER TABLE ONLY "public"."exercise_logs"
    ADD CONSTRAINT "exercise_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_muscles"
    ADD CONSTRAINT "exercise_muscles_pkey" PRIMARY KEY ("exercise_id", "muscle_id");



ALTER TABLE ONLY "public"."exercise_tags"
    ADD CONSTRAINT "exercise_tags_pkey" PRIMARY KEY ("exercise_id", "tag");



ALTER TABLE ONLY "public"."exercise_variants"
    ADD CONSTRAINT "exercise_variants_pkey" PRIMARY KEY ("exercise_id", "target_exercise_id", "variant_type");



ALTER TABLE ONLY "public"."exercises"
    ADD CONSTRAINT "exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movement_patterns"
    ADD CONSTRAINT "movement_patterns_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."movement_patterns"
    ADD CONSTRAINT "movement_patterns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."muscles"
    ADD CONSTRAINT "muscles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."muscles"
    ADD CONSTRAINT "muscles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."programming_rules"
    ADD CONSTRAINT "programming_rules_pkey" PRIMARY KEY ("rule_id");



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_exercise_progress"
    ADD CONSTRAINT "user_exercise_progress_pkey" PRIMARY KEY ("user_id", "exercise_id");



ALTER TABLE ONLY "public"."user_goals"
    ADD CONSTRAINT "user_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_goals"
    ADD CONSTRAINT "user_goals_user_id_goal_id_key" UNIQUE ("user_id", "goal_id");



ALTER TABLE ONLY "public"."workout_blocks"
    ADD CONSTRAINT "workout_blocks_pkey" PRIMARY KEY ("block_name");



ALTER TABLE ONLY "public"."workout_equipment"
    ADD CONSTRAINT "workout_equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_equipment"
    ADD CONSTRAINT "workout_equipment_workout_id_equipment_id_key" UNIQUE ("workout_id", "equipment_id");



ALTER TABLE ONLY "public"."workout_exercises"
    ADD CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_focus"
    ADD CONSTRAINT "workout_focus_pkey" PRIMARY KEY ("focus_name");



ALTER TABLE ONLY "public"."workout_formats"
    ADD CONSTRAINT "workout_formats_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."workout_formats"
    ADD CONSTRAINT "workout_formats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_logs"
    ADD CONSTRAINT "workout_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_requests"
    ADD CONSTRAINT "workout_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_session_exercises"
    ADD CONSTRAINT "workout_session_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_session_exercises"
    ADD CONSTRAINT "workout_session_exercises_session_id_block_key_position_key" UNIQUE ("session_id", "block_key", "position");



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_templates"
    ADD CONSTRAINT "workout_templates_pkey" PRIMARY KEY ("template_name");



ALTER TABLE ONLY "public"."workouts"
    ADD CONSTRAINT "workouts_pkey" PRIMARY KEY ("id");



CREATE INDEX "exercise_favorites_user_exercise_idx" ON "public"."exercise_favorites" USING "btree" ("user_id", "exercise_id");



CREATE INDEX "exercise_favorites_user_id_idx" ON "public"."exercise_favorites" USING "btree" ("user_id");



CREATE INDEX "exercise_logs_exercise_created_at_idx" ON "public"."exercise_logs" USING "btree" ("exercise_id", "created_at" DESC);



CREATE INDEX "exercise_logs_session_id_idx" ON "public"."exercise_logs" USING "btree" ("session_id");



CREATE INDEX "exercise_logs_user_created_at_idx" ON "public"."exercise_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "exercise_logs_user_id_idx" ON "public"."exercise_logs" USING "btree" ("user_id");



CREATE INDEX "idx_ex_muscles_priority" ON "public"."exercise_muscles" USING "btree" ("priority");



CREATE INDEX "idx_exercise_constraints_zone" ON "public"."exercise_constraints" USING "btree" ("body_zone", "rule_type", "severity");



CREATE INDEX "idx_exercise_logs_user_exercise_created" ON "public"."exercise_logs" USING "btree" ("user_id", "exercise_id", "created_at" DESC);



CREATE INDEX "idx_exercises_body_region" ON "public"."exercises" USING "btree" ("body_region");



CREATE INDEX "idx_exercises_difficulty" ON "public"."exercises" USING "btree" ("difficulty");



CREATE INDEX "idx_exercises_movement_pattern" ON "public"."exercises" USING "btree" ("movement_pattern");



CREATE INDEX "idx_exercises_pattern" ON "public"."exercises" USING "btree" ("movement_pattern");



CREATE INDEX "idx_exercises_tabata_eligible" ON "public"."exercises" USING "btree" ("tabata_eligible") WHERE ("tabata_eligible" = true);



CREATE INDEX "idx_user_exercise_progress_state" ON "public"."user_exercise_progress" USING "btree" ("user_id", "state", "mastery_score" DESC);



CREATE INDEX "idx_user_exercise_progress_user" ON "public"."user_exercise_progress" USING "btree" ("user_id");



CREATE INDEX "idx_workout_logs_user" ON "public"."workout_logs" USING "btree" ("user_id");



CREATE INDEX "idx_workout_session_exercises_session" ON "public"."workout_session_exercises" USING "btree" ("session_id");



CREATE INDEX "idx_workouts_program" ON "public"."workouts" USING "btree" ("program_id");



CREATE UNIQUE INDEX "user_goals_one_primary_goal_idx" ON "public"."user_goals" USING "btree" ("user_id") WHERE ("priority" = 1);



CREATE UNIQUE INDEX "user_goals_user_goal_unique_idx" ON "public"."user_goals" USING "btree" ("user_id", "goal_id");



CREATE INDEX "workout_session_exercises_block_idx" ON "public"."workout_session_exercises" USING "btree" ("session_id", "block_key");



CREATE INDEX "workout_session_exercises_session_block_idx" ON "public"."workout_session_exercises" USING "btree" ("session_id", "block_key");



CREATE INDEX "workout_session_exercises_session_idx" ON "public"."workout_session_exercises" USING "btree" ("session_id");



CREATE INDEX "workout_session_exercises_session_status_idx" ON "public"."workout_session_exercises" USING "btree" ("session_id", "status");



CREATE INDEX "workout_session_exercises_status_idx" ON "public"."workout_session_exercises" USING "btree" ("session_id", "status");



CREATE INDEX "workout_sessions_completed_at_idx" ON "public"."workout_sessions" USING "btree" ("completed_at" DESC);



CREATE INDEX "workout_sessions_status_idx" ON "public"."workout_sessions" USING "btree" ("status");



CREATE INDEX "workout_sessions_user_completed_idx" ON "public"."workout_sessions" USING "btree" ("user_id", "completed_at" DESC);



CREATE INDEX "workout_sessions_user_id_idx" ON "public"."workout_sessions" USING "btree" ("user_id");



CREATE INDEX "workout_sessions_user_status_idx" ON "public"."workout_sessions" USING "btree" ("user_id", "status");



CREATE OR REPLACE TRIGGER "profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workout_session_exercises_set_updated_at" BEFORE UPDATE ON "public"."workout_session_exercises" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workout_sessions_set_updated_at" BEFORE UPDATE ON "public"."workout_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."exercise_constraints"
    ADD CONSTRAINT "exercise_constraints_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_equipment"
    ADD CONSTRAINT "exercise_equipment_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_equipment"
    ADD CONSTRAINT "exercise_equipment_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_favorites"
    ADD CONSTRAINT "exercise_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_logs"
    ADD CONSTRAINT "exercise_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_logs"
    ADD CONSTRAINT "exercise_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_muscles"
    ADD CONSTRAINT "exercise_muscles_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_muscles"
    ADD CONSTRAINT "exercise_muscles_muscle_id_fkey" FOREIGN KEY ("muscle_id") REFERENCES "public"."muscles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_tags"
    ADD CONSTRAINT "exercise_tags_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_variants"
    ADD CONSTRAINT "exercise_variants_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_variants"
    ADD CONSTRAINT "exercise_variants_target_exercise_id_fkey" FOREIGN KEY ("target_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_exercise_progress"
    ADD CONSTRAINT "user_exercise_progress_exercise_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_exercise_progress"
    ADD CONSTRAINT "user_exercise_progress_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_goals"
    ADD CONSTRAINT "user_goals_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_goals"
    ADD CONSTRAINT "user_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_equipment"
    ADD CONSTRAINT "workout_equipment_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_logs"
    ADD CONSTRAINT "workout_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_logs"
    ADD CONSTRAINT "workout_logs_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id");



ALTER TABLE ONLY "public"."workout_requests"
    ADD CONSTRAINT "workout_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_session_exercises"
    ADD CONSTRAINT "workout_session_exercises_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workouts"
    ADD CONSTRAINT "workouts_format_id_fkey" FOREIGN KEY ("format_id") REFERENCES "public"."workout_formats"("id");



ALTER TABLE ONLY "public"."workouts"
    ADD CONSTRAINT "workouts_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workouts"
    ADD CONSTRAINT "workouts_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."workout_requests"("id");



CREATE POLICY "Allow public read on equipment" ON "public"."equipment" FOR SELECT USING (true);



CREATE POLICY "Allow public read on exercise_equipment" ON "public"."exercise_equipment" FOR SELECT USING (true);



CREATE POLICY "Allow public read on exercises" ON "public"."exercises" FOR SELECT USING (true);



CREATE POLICY "Allow public read on muscles" ON "public"."muscles" FOR SELECT USING (true);



CREATE POLICY "Authenticated users can read block rules" ON "public"."block_rules" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can create own exercise logs" ON "public"."exercise_logs" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create own goals" ON "public"."user_goals" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create their exercise favorites" ON "public"."exercise_favorites" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create their session exercises" ON "public"."workout_session_exercises" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workout_sessions" "ws"
  WHERE (("ws"."id" = "workout_session_exercises"."session_id") AND ("ws"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can create their workout sessions" ON "public"."workout_sessions" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete own exercise logs" ON "public"."exercise_logs" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete own goals" ON "public"."user_goals" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete their exercise favorites" ON "public"."exercise_favorites" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete their session exercises" ON "public"."workout_session_exercises" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workout_sessions" "ws"
  WHERE (("ws"."id" = "workout_session_exercises"."session_id") AND ("ws"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can delete their workout sessions" ON "public"."workout_sessions" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can insert own exercise progress" ON "public"."user_exercise_progress" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own exercise logs" ON "public"."exercise_logs" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can read own exercise progress" ON "public"."user_exercise_progress" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own goals" ON "public"."user_goals" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can read own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can read their exercise favorites" ON "public"."exercise_favorites" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can read their session exercises" ON "public"."workout_session_exercises" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workout_sessions" "ws"
  WHERE (("ws"."id" = "workout_session_exercises"."session_id") AND ("ws"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can read their workout sessions" ON "public"."workout_sessions" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update own exercise logs" ON "public"."exercise_logs" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update own exercise progress" ON "public"."user_exercise_progress" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own goals" ON "public"."user_goals" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update their session exercises" ON "public"."workout_session_exercises" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workout_sessions" "ws"
  WHERE (("ws"."id" = "workout_session_exercises"."session_id") AND ("ws"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workout_sessions" "ws"
  WHERE (("ws"."id" = "workout_session_exercises"."session_id") AND ("ws"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can update their workout sessions" ON "public"."workout_sessions" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."_backup_exercise_constraints_pre_dedup_v1_4" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercise_constraints_pre_v1" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercise_equipment_pre_dedup_v1_4" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercise_equipment_pre_v1" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercise_logs_pre_progress_v21" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercise_muscles_pre_dedup_v1_4" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercise_muscles_pre_v1" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercise_tags_pre_dedup_v1_4" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercise_tags_pre_v1" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercise_variants_pre_dedup_v1_4" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercise_variants_pre_v1" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercise_variants_pre_v1_5" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercises_pre_dedup_v1_4" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_exercises_pre_v1" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_programming_rules_pre_clean_v1" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_programming_rules_pre_v1" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_workout_session_exercises_pre_progress_v21" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."block_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercise_constraints" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercise_equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercise_favorites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercise_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercise_muscles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercise_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercise_variants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."goals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."movement_patterns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."muscles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "program owner" ON "public"."programs" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."programming_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."programs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read formats" ON "public"."workout_formats" FOR SELECT USING (true);



CREATE POLICY "read goals" ON "public"."goals" FOR SELECT USING (true);



CREATE POLICY "request owner" ON "public"."workout_requests" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_exercise_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workout logs owner" ON "public"."workout_logs" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "workout owner" ON "public"."workouts" USING ((EXISTS ( SELECT 1
   FROM "public"."programs"
  WHERE (("programs"."id" = "workouts"."program_id") AND ("programs"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."workout_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_exercises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_focus" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_formats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_session_exercises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workouts" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


























































































































































































GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";
























GRANT ALL ON TABLE "public"."_backup_exercise_constraints_pre_dedup_v1_4" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_constraints_pre_dedup_v1_4" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_constraints_pre_dedup_v1_4" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercise_constraints_pre_v1" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_constraints_pre_v1" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_constraints_pre_v1" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercise_equipment_pre_dedup_v1_4" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_equipment_pre_dedup_v1_4" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_equipment_pre_dedup_v1_4" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercise_equipment_pre_v1" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_equipment_pre_v1" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_equipment_pre_v1" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercise_logs_pre_progress_v21" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_logs_pre_progress_v21" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_logs_pre_progress_v21" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercise_muscles_pre_dedup_v1_4" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_muscles_pre_dedup_v1_4" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_muscles_pre_dedup_v1_4" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercise_muscles_pre_v1" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_muscles_pre_v1" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_muscles_pre_v1" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercise_tags_pre_dedup_v1_4" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_tags_pre_dedup_v1_4" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_tags_pre_dedup_v1_4" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercise_tags_pre_v1" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_tags_pre_v1" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_tags_pre_v1" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercise_variants_pre_dedup_v1_4" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_variants_pre_dedup_v1_4" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_variants_pre_dedup_v1_4" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercise_variants_pre_v1" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_variants_pre_v1" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_variants_pre_v1" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercise_variants_pre_v1_5" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercise_variants_pre_v1_5" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercise_variants_pre_v1_5" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercises_pre_dedup_v1_4" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercises_pre_dedup_v1_4" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercises_pre_dedup_v1_4" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_exercises_pre_v1" TO "anon";
GRANT ALL ON TABLE "public"."_backup_exercises_pre_v1" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_exercises_pre_v1" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_programming_rules_pre_clean_v1" TO "anon";
GRANT ALL ON TABLE "public"."_backup_programming_rules_pre_clean_v1" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_programming_rules_pre_clean_v1" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_programming_rules_pre_v1" TO "anon";
GRANT ALL ON TABLE "public"."_backup_programming_rules_pre_v1" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_programming_rules_pre_v1" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_workout_session_exercises_pre_progress_v21" TO "anon";
GRANT ALL ON TABLE "public"."_backup_workout_session_exercises_pre_progress_v21" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_workout_session_exercises_pre_progress_v21" TO "service_role";



GRANT ALL ON TABLE "public"."block_rules" TO "anon";
GRANT ALL ON TABLE "public"."block_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."block_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."block_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."block_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."block_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."equipment" TO "anon";
GRANT ALL ON TABLE "public"."equipment" TO "authenticated";
GRANT ALL ON TABLE "public"."equipment" TO "service_role";



GRANT ALL ON TABLE "public"."equipment_profiles" TO "anon";
GRANT ALL ON TABLE "public"."equipment_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."equipment_profiles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."equipment_profiles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."equipment_profiles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."equipment_profiles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_constraints" TO "anon";
GRANT ALL ON TABLE "public"."exercise_constraints" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_constraints" TO "service_role";



GRANT ALL ON SEQUENCE "public"."exercise_constraints_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."exercise_constraints_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."exercise_constraints_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_equipment" TO "anon";
GRANT ALL ON TABLE "public"."exercise_equipment" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_equipment" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_favorites" TO "anon";
GRANT ALL ON TABLE "public"."exercise_favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_favorites" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_logs" TO "anon";
GRANT ALL ON TABLE "public"."exercise_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."exercise_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."exercise_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."exercise_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_muscles" TO "anon";
GRANT ALL ON TABLE "public"."exercise_muscles" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_muscles" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_tags" TO "anon";
GRANT ALL ON TABLE "public"."exercise_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_tags" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_variants" TO "anon";
GRANT ALL ON TABLE "public"."exercise_variants" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_variants" TO "service_role";



GRANT ALL ON TABLE "public"."exercises" TO "anon";
GRANT ALL ON TABLE "public"."exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."exercises" TO "service_role";



GRANT ALL ON TABLE "public"."goals" TO "anon";
GRANT ALL ON TABLE "public"."goals" TO "authenticated";
GRANT ALL ON TABLE "public"."goals" TO "service_role";



GRANT ALL ON TABLE "public"."movement_patterns" TO "anon";
GRANT ALL ON TABLE "public"."movement_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."movement_patterns" TO "service_role";



GRANT ALL ON TABLE "public"."muscles" TO "anon";
GRANT ALL ON TABLE "public"."muscles" TO "authenticated";
GRANT ALL ON TABLE "public"."muscles" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."programming_rules" TO "anon";
GRANT ALL ON TABLE "public"."programming_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."programming_rules" TO "service_role";



GRANT ALL ON TABLE "public"."programs" TO "anon";
GRANT ALL ON TABLE "public"."programs" TO "authenticated";
GRANT ALL ON TABLE "public"."programs" TO "service_role";



GRANT ALL ON TABLE "public"."user_exercise_progress" TO "anon";
GRANT ALL ON TABLE "public"."user_exercise_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."user_exercise_progress" TO "service_role";



GRANT ALL ON TABLE "public"."user_goals" TO "anon";
GRANT ALL ON TABLE "public"."user_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."user_goals" TO "service_role";



GRANT ALL ON TABLE "public"."workout_blocks" TO "anon";
GRANT ALL ON TABLE "public"."workout_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."workout_equipment" TO "anon";
GRANT ALL ON TABLE "public"."workout_equipment" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_equipment" TO "service_role";



GRANT ALL ON TABLE "public"."workout_exercises" TO "anon";
GRANT ALL ON TABLE "public"."workout_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."workout_focus" TO "anon";
GRANT ALL ON TABLE "public"."workout_focus" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_focus" TO "service_role";



GRANT ALL ON TABLE "public"."workout_formats" TO "anon";
GRANT ALL ON TABLE "public"."workout_formats" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_formats" TO "service_role";



GRANT ALL ON TABLE "public"."workout_logs" TO "anon";
GRANT ALL ON TABLE "public"."workout_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_logs" TO "service_role";



GRANT ALL ON TABLE "public"."workout_requests" TO "anon";
GRANT ALL ON TABLE "public"."workout_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_requests" TO "service_role";



GRANT ALL ON TABLE "public"."workout_session_exercises" TO "anon";
GRANT ALL ON TABLE "public"."workout_session_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_session_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."workout_sessions" TO "anon";
GRANT ALL ON TABLE "public"."workout_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."workout_templates" TO "anon";
GRANT ALL ON TABLE "public"."workout_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_templates" TO "service_role";



GRANT ALL ON TABLE "public"."workouts" TO "anon";
GRANT ALL ON TABLE "public"."workouts" TO "authenticated";
GRANT ALL ON TABLE "public"."workouts" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































