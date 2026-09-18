CREATE TYPE "public"."image_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_filename" text NOT NULL,
	"storage_key" text,
	"mime_type" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"status" "image_status" DEFAULT 'pending' NOT NULL,
	"rejection_reasons" jsonb DEFAULT '[]'::jsonb,
	"phash" text,
	"face_count" integer,
	"blur_score" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "images_phash_idx" ON "images" USING btree ("phash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "images_status_idx" ON "images" USING btree ("status");