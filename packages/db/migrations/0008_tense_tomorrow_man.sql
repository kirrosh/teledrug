CREATE TABLE "oauth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"user_id" bigint NOT NULL,
	"provider" varchar(50) NOT NULL,
	"state" varchar(128) NOT NULL,
	"code_verifier" varchar(128) NOT NULL,
	"metadata" jsonb,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE INDEX "idx_oauth_sessions_session_id" ON "oauth_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_sessions_expires_at" ON "oauth_sessions" USING btree ("expires_at");