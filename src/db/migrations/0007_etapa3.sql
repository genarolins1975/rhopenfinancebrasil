CREATE TYPE "public"."checkin_method" AS ENUM('portal', 'qr');--> statement-breakpoint
CREATE TYPE "public"."waitlist_entry_status" AS ENUM('waiting', 'offered', 'accepted', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."waitlist_offer_status" AS ENUM('open', 'accepted', 'expired', 'declined');--> statement-breakpoint
CREATE TABLE "checkin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"desk_booking_id" uuid,
	"space_booking_id" uuid,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" "checkin_method" NOT NULL,
	"actor_employee_id" uuid NOT NULL,
	CONSTRAINT "checkin_one_booking" CHECK (("checkin"."desk_booking_id" is not null)::int + ("checkin"."space_booking_id" is not null)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "employee_preference" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"share_with_manager" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "waitlist_entry_status" DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"close_reason" text
);
--> statement-breakpoint
CREATE TABLE "waitlist_offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"hold_booking_id" uuid NOT NULL,
	"offered_by" uuid,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "waitlist_offer_status" DEFAULT 'open' NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "waitlist_offer_holdBookingId_unique" UNIQUE("hold_booking_id")
);
--> statement-breakpoint
ALTER TABLE "checkin" ADD CONSTRAINT "checkin_desk_booking_id_desk_booking_id_fk" FOREIGN KEY ("desk_booking_id") REFERENCES "public"."desk_booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin" ADD CONSTRAINT "checkin_space_booking_id_space_booking_id_fk" FOREIGN KEY ("space_booking_id") REFERENCES "public"."space_booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin" ADD CONSTRAINT "checkin_actor_employee_id_employee_id_fk" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_preference" ADD CONSTRAINT "employee_preference_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_closed_by_employee_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offer" ADD CONSTRAINT "waitlist_offer_entry_id_waitlist_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."waitlist_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offer" ADD CONSTRAINT "waitlist_offer_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offer" ADD CONSTRAINT "waitlist_offer_hold_booking_id_desk_booking_id_fk" FOREIGN KEY ("hold_booking_id") REFERENCES "public"."desk_booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offer" ADD CONSTRAINT "waitlist_offer_offered_by_employee_id_fk" FOREIGN KEY ("offered_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkin_desk_unique" ON "checkin" USING btree ("desk_booking_id") WHERE desk_booking_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "checkin_space_unique" ON "checkin" USING btree ("space_booking_id") WHERE space_booking_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entry_active" ON "waitlist_entry" USING btree ("employee_id","date") WHERE status in ('waiting', 'offered');--> statement-breakpoint
CREATE INDEX "waitlist_entry_date_idx" ON "waitlist_entry" USING btree ("date","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_offer_open" ON "waitlist_offer" USING btree ("entry_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "waitlist_offer_expiry_idx" ON "waitlist_offer" USING btree ("expires_at") WHERE status = 'open';