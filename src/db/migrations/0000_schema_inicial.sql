CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('invited', 'active', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('previewed', 'applied', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."org_condition" AS ENUM('standard', 'director');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "area_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"actor_employee_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"request_id" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"full_name" text NOT NULL,
	"corporate_email" "citext" NOT NULL,
	"area_id" uuid,
	"job_title" text,
	"manager_employee_id" uuid,
	"org_condition" "org_condition" DEFAULT 'standard' NOT NULL,
	"status" "employee_status" DEFAULT 'invited' NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "employee_corporateEmail_unique" UNIQUE("corporate_email")
);
--> statement-breakpoint
CREATE TABLE "employee_org_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"area_id" uuid,
	"manager_employee_id" uuid,
	"job_title" text,
	"org_condition" "org_condition" DEFAULT 'standard' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_org_assignment_dates" CHECK ("employee_org_assignment"."valid_to" is null or "employee_org_assignment"."valid_to" >= "employee_org_assignment"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "employee_permission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"granted_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_permission_no_self_grant" CHECK ("employee_permission"."granted_by" is null or "employee_permission"."granted_by" <> "employee_permission"."employee_id"),
	CONSTRAINT "employee_permission_dates" CHECK ("employee_permission"."valid_to" is null or "employee_permission"."valid_to" >= "employee_permission"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "employee_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"granted_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_role_no_self_grant" CHECK ("employee_role"."granted_by" is null or "employee_role"."granted_by" <> "employee_role"."employee_id"),
	CONSTRAINT "employee_role_dates" CHECK ("employee_role"."valid_to" is null or "employee_role"."valid_to" >= "employee_role"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "employee_sensitive" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"cpf_ciphertext" "bytea" NOT NULL,
	"cpf_key_version" integer NOT NULL,
	"cpf_hmac" "bytea" NOT NULL,
	"cpf_hmac_key_version" integer NOT NULL,
	"cpf_suffix" char(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_sensitive_cpfHmac_unique" UNIQUE("cpf_hmac")
);
--> statement-breakpoint
CREATE TABLE "employment_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"hire_date" date NOT NULL,
	"exit_date" date,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employment_period_dates" CHECK ("employment_period"."exit_date" is null or "employment_period"."exit_date" >= "employment_period"."hire_date")
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid NOT NULL,
	"status" "import_batch_status" DEFAULT 'previewed' NOT NULL,
	"rows_ciphertext" "bytea" NOT NULL,
	"row_count" integer NOT NULL,
	"summary" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"sent_at" timestamp with time zone,
	"delivery_status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "login_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"success" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_event_idempotencyKey_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "permission" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"privileged" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"role_code" text NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "role_permission_role_code_permission_code_pk" PRIMARY KEY("role_code","permission_code")
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factor" ADD CONSTRAINT "auth_two_factor_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_area_id_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_manager_employee_id_employee_id_fk" FOREIGN KEY ("manager_employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_org_assignment" ADD CONSTRAINT "employee_org_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_org_assignment" ADD CONSTRAINT "employee_org_assignment_area_id_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_org_assignment" ADD CONSTRAINT "employee_org_assignment_manager_employee_id_employee_id_fk" FOREIGN KEY ("manager_employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_permission" ADD CONSTRAINT "employee_permission_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_permission" ADD CONSTRAINT "employee_permission_permission_code_permission_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permission"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_permission" ADD CONSTRAINT "employee_permission_granted_by_employee_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_role" ADD CONSTRAINT "employee_role_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_role" ADD CONSTRAINT "employee_role_role_code_role_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."role"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_role" ADD CONSTRAINT "employee_role_granted_by_employee_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_sensitive" ADD CONSTRAINT "employee_sensitive_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_period" ADD CONSTRAINT "employment_period_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_employee_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_code_role_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."role"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_code_permission_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permission"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_two_factor_secret_idx" ON "auth_two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "auth_two_factor_user_idx" ON "auth_two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_actor_idx" ON "audit_event" USING btree ("actor_employee_id","created_at");--> statement-breakpoint
CREATE INDEX "employee_status_idx" ON "employee" USING btree ("status");--> statement-breakpoint
CREATE INDEX "employee_area_idx" ON "employee" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "employee_org_assignment_employee_idx" ON "employee_org_assignment" USING btree ("employee_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_permission_active" ON "employee_permission" USING btree ("employee_id","permission_code") WHERE "employee_permission"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_role_active" ON "employee_role" USING btree ("employee_id","role_code") WHERE "employee_role"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "employment_period_employee_idx" ON "employment_period" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_active_per_employee" ON "invitation" USING btree ("employee_id") WHERE "invitation"."used_at" is null and "invitation"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "login_attempt_email_idx" ON "login_attempt" USING btree ("email_hash","attempted_at");--> statement-breakpoint
CREATE INDEX "outbox_event_pending_idx" ON "outbox_event" USING btree ("status","next_attempt_at");