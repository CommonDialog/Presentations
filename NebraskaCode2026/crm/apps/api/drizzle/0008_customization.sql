CREATE TABLE "entity_layouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"record_type_id" uuid,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_layouts_org_entity_rt_unique" UNIQUE NULLS NOT DISTINCT("organization_id","entity_type","record_type_id"),
	CONSTRAINT "entity_layouts_entity_type" CHECK ("entity_layouts"."entity_type" in ('account', 'contact', 'deal', 'lead', 'project'))
);
--> statement-breakpoint
CREATE TABLE "record_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_types_entity_type" CHECK ("record_types"."entity_type" in ('account', 'contact', 'deal', 'lead', 'project'))
);
--> statement-breakpoint
ALTER TABLE "entity_layouts" ADD CONSTRAINT "entity_layouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_layouts" ADD CONSTRAINT "entity_layouts_record_type_id_record_types_id_fk" FOREIGN KEY ("record_type_id") REFERENCES "public"."record_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_types" ADD CONSTRAINT "record_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_layouts_org_entity_idx" ON "entity_layouts" USING btree ("organization_id","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "record_types_org_entity_key_unique" ON "record_types" USING btree ("organization_id","entity_type","key");