CREATE TYPE "public"."assignment_mode" AS ENUM('individual', 'group');--> statement-breakpoint
CREATE TYPE "public"."booking_origin" AS ENUM('self', 'week_plan', 'on_behalf', 'waitlist_offer', 'admin_realloc');--> statement-breakpoint
CREATE TYPE "public"."desk_booking_status" AS ENUM('held', 'confirmed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."exception_kind" AS ENUM('release_to_shared', 'release_to_employee');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'approved', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."presence_intent_kind" AS ENUM('onsite', 'remote', 'not_informed');--> statement-breakpoint
CREATE TYPE "public"."resource_status_kind" AS ENUM('maintenance', 'admin_block');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('desk', 'room', 'booth');--> statement-breakpoint
CREATE TYPE "public"."space_booking_status" AS ENUM('confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."title_visibility" AS ENUM('private', 'manager', 'all');--> statement-breakpoint
CREATE TABLE "access_exception" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"kind" "exception_kind" NOT NULL,
	"beneficiary_employee_id" uuid,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_exception_dates" CHECK ("access_exception"."ends_on" >= "access_exception"."starts_on"),
	CONSTRAINT "access_exception_beneficiary" CHECK (("access_exception"."kind" = 'release_to_employee') = ("access_exception"."beneficiary_employee_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "access_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "access_group_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "access_group_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"added_by" uuid,
	"removed_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_group_member_dates" CHECK ("access_group_member"."valid_to" is null or "access_group_member"."valid_to" >= "access_group_member"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "desk_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"status" "desk_booking_status" NOT NULL,
	"origin" "booking_origin" NOT NULL,
	"actor_employee_id" uuid NOT NULL,
	"idempotency_key" text,
	"week_plan_request_id" uuid,
	"access_exception_id" uuid,
	"hold_expires_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desk_booking_hold" CHECK ("desk_booking"."status" <> 'held' or "desk_booking"."hold_expires_at" is not null),
	CONSTRAINT "desk_booking_on_behalf" CHECK ("desk_booking"."origin" <> 'on_behalf' or "desk_booking"."actor_employee_id" <> "desk_booking"."employee_id")
);
--> statement-breakpoint
CREATE TABLE "exclusive_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"mode" "assignment_mode" NOT NULL,
	"holder_employee_id" uuid,
	"access_group_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"needs_review" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"reason" text NOT NULL,
	"responsible" text NOT NULL,
	"created_by" uuid,
	"ended_by" uuid,
	"end_reason" text,
	"transferred_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exclusive_assignment_mode_target" CHECK (("exclusive_assignment"."mode" = 'individual' and "exclusive_assignment"."holder_employee_id" is not null and "exclusive_assignment"."access_group_id" is null) or ("exclusive_assignment"."mode" = 'group' and "exclusive_assignment"."access_group_id" is not null and "exclusive_assignment"."holder_employee_id" is null)),
	CONSTRAINT "exclusive_assignment_dates" CHECK ("exclusive_assignment"."valid_to" is null or "exclusive_assignment"."valid_to" >= "exclusive_assignment"."valid_from"),
	CONSTRAINT "exclusive_assignment_review_individual" CHECK ("exclusive_assignment"."needs_review" = false or "exclusive_assignment"."mode" = 'individual'),
	CONSTRAINT "exclusive_assignment_ended" CHECK (("exclusive_assignment"."ended_by" is null or "exclusive_assignment"."valid_to" is not null) and (("exclusive_assignment"."ended_by" is null) = ("exclusive_assignment"."end_reason" is null))),
	CONSTRAINT "exclusive_assignment_cancelled" CHECK (("exclusive_assignment"."cancelled_at" is null) = ("exclusive_assignment"."cancelled_by" is null))
);
--> statement-breakpoint
CREATE TABLE "floor_plan_placement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"w" real NOT NULL,
	"h" real NOT NULL,
	"rotation" real DEFAULT 0 NOT NULL,
	"shape" text DEFAULT 'rect' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floor_plan_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source_file_id" text,
	"source_sha256" text,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_calendar" (
	"date" date PRIMARY KEY NOT NULL,
	"is_open" boolean NOT NULL,
	"reason" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presence_intent" (
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"intent" "presence_intent_kind" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presence_intent_employee_id_date_pk" PRIMARY KEY("employee_id","date")
);
--> statement-breakpoint
CREATE TABLE "resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"type" "resource_type" NOT NULL,
	"zone_id" uuid,
	"capacity" integer,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attributes_verified_at" timestamp with time zone,
	"attributes_verified_by" uuid,
	"retired_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_code_unique" UNIQUE("code"),
	CONSTRAINT "resource_capacity_by_type" CHECK (("resource"."type" = 'desk' and "resource"."capacity" is null) or ("resource"."type" <> 'desk'))
);
--> statement-breakpoint
CREATE TABLE "resource_status_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"status" "resource_status_kind" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"released_on" date,
	"released_at" timestamp with time zone,
	"reason" text NOT NULL,
	"public_reason" text,
	"created_by" uuid,
	"released_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_status_period_dates" CHECK (("resource_status_period"."ends_on" is null or "resource_status_period"."ends_on" >= "resource_status_period"."starts_on") and ("resource_status_period"."released_on" is null or "resource_status_period"."released_on" >= "resource_status_period"."starts_on"))
);
--> statement-breakpoint
CREATE TABLE "space_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"title" text,
	"title_visibility" "title_visibility" DEFAULT 'private' NOT NULL,
	"status" "space_booking_status" DEFAULT 'confirmed' NOT NULL,
	"actor_employee_id" uuid NOT NULL,
	"idempotency_key" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "week_plan_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"plan_version_id" uuid,
	CONSTRAINT "zone_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "access_exception" ADD CONSTRAINT "access_exception_assignment_id_exclusive_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."exclusive_assignment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_exception" ADD CONSTRAINT "access_exception_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_exception" ADD CONSTRAINT "access_exception_beneficiary_employee_id_employee_id_fk" FOREIGN KEY ("beneficiary_employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_exception" ADD CONSTRAINT "access_exception_created_by_employee_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_exception" ADD CONSTRAINT "access_exception_revoked_by_employee_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_group_member" ADD CONSTRAINT "access_group_member_group_id_access_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_group_member" ADD CONSTRAINT "access_group_member_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_group_member" ADD CONSTRAINT "access_group_member_added_by_employee_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_group_member" ADD CONSTRAINT "access_group_member_removed_by_employee_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_booking" ADD CONSTRAINT "desk_booking_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_booking" ADD CONSTRAINT "desk_booking_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_booking" ADD CONSTRAINT "desk_booking_actor_employee_id_employee_id_fk" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_booking" ADD CONSTRAINT "desk_booking_week_plan_request_id_week_plan_request_id_fk" FOREIGN KEY ("week_plan_request_id") REFERENCES "public"."week_plan_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_booking" ADD CONSTRAINT "desk_booking_access_exception_id_access_exception_id_fk" FOREIGN KEY ("access_exception_id") REFERENCES "public"."access_exception"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_booking" ADD CONSTRAINT "desk_booking_cancelled_by_employee_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusive_assignment" ADD CONSTRAINT "exclusive_assignment_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusive_assignment" ADD CONSTRAINT "exclusive_assignment_holder_employee_id_employee_id_fk" FOREIGN KEY ("holder_employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusive_assignment" ADD CONSTRAINT "exclusive_assignment_access_group_id_access_group_id_fk" FOREIGN KEY ("access_group_id") REFERENCES "public"."access_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusive_assignment" ADD CONSTRAINT "exclusive_assignment_cancelled_by_employee_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusive_assignment" ADD CONSTRAINT "exclusive_assignment_created_by_employee_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusive_assignment" ADD CONSTRAINT "exclusive_assignment_ended_by_employee_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusive_assignment" ADD CONSTRAINT "exclusive_assignment_transferred_from_id_exclusive_assignment_id_fk" FOREIGN KEY ("transferred_from_id") REFERENCES "public"."exclusive_assignment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plan_placement" ADD CONSTRAINT "floor_plan_placement_plan_version_id_floor_plan_version_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."floor_plan_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plan_placement" ADD CONSTRAINT "floor_plan_placement_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plan_version" ADD CONSTRAINT "floor_plan_version_approved_by_employee_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plan_version" ADD CONSTRAINT "floor_plan_version_created_by_employee_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_calendar" ADD CONSTRAINT "office_calendar_updated_by_employee_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_settings" ADD CONSTRAINT "office_settings_updated_by_employee_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_intent" ADD CONSTRAINT "presence_intent_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_zone_id_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zone"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_attributes_verified_by_employee_id_fk" FOREIGN KEY ("attributes_verified_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_status_period" ADD CONSTRAINT "resource_status_period_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_status_period" ADD CONSTRAINT "resource_status_period_created_by_employee_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_status_period" ADD CONSTRAINT "resource_status_period_released_by_employee_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_booking" ADD CONSTRAINT "space_booking_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_booking" ADD CONSTRAINT "space_booking_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_booking" ADD CONSTRAINT "space_booking_actor_employee_id_employee_id_fk" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_plan_request" ADD CONSTRAINT "week_plan_request_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone" ADD CONSTRAINT "zone_plan_version_id_floor_plan_version_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."floor_plan_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_exception_resource_idx" ON "access_exception" USING btree ("resource_id","starts_on");--> statement-breakpoint
CREATE INDEX "access_group_member_idx" ON "access_group_member" USING btree ("group_id","valid_from","valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX "desk_booking_resource_day" ON "desk_booking" USING btree ("resource_id","booking_date") WHERE status in ('held', 'confirmed');--> statement-breakpoint
CREATE UNIQUE INDEX "desk_booking_employee_day" ON "desk_booking" USING btree ("employee_id","booking_date") WHERE status in ('held', 'confirmed');--> statement-breakpoint
CREATE UNIQUE INDEX "desk_booking_idempotency" ON "desk_booking" USING btree ("actor_employee_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "desk_booking_employee_idx" ON "desk_booking" USING btree ("employee_id","booking_date");--> statement-breakpoint
CREATE INDEX "desk_booking_resource_idx" ON "desk_booking" USING btree ("resource_id","booking_date");--> statement-breakpoint
CREATE INDEX "desk_booking_hold_idx" ON "desk_booking" USING btree ("hold_expires_at") WHERE status = 'held';--> statement-breakpoint
CREATE INDEX "exclusive_assignment_resource_idx" ON "exclusive_assignment" USING btree ("resource_id","valid_from");--> statement-breakpoint
CREATE INDEX "exclusive_assignment_holder_idx" ON "exclusive_assignment" USING btree ("holder_employee_id","valid_from","valid_to") WHERE cancelled_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "floor_plan_placement_unique" ON "floor_plan_placement" USING btree ("plan_version_id","resource_id");--> statement-breakpoint
CREATE INDEX "resource_zone_idx" ON "resource" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "resource_status_period_resource_idx" ON "resource_status_period" USING btree ("resource_id","starts_on");--> statement-breakpoint
CREATE UNIQUE INDEX "space_booking_idempotency" ON "space_booking" USING btree ("actor_employee_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "week_plan_request_unique" ON "week_plan_request" USING btree ("employee_id","idempotency_key");