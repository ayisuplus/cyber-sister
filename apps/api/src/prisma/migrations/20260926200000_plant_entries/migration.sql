-- 路线图 C26 花草图鉴：纯新建，不动旧表。照片在 API 数据卷的 data/garden/ 下，不在数据库里。
CREATE TABLE "plant_entries" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scientific_name" TEXT,
  "family" TEXT,
  "status" TEXT NOT NULL DEFAULT 'met',
  "note" TEXT,
  "candidates" JSONB,
  "explanation" JSONB,
  "caution" TEXT,
  "prompt_version" TEXT,
  "identified_by" TEXT,
  "image_ext" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plant_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plant_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "plant_entries_user_id_created_at_idx" ON "plant_entries"("user_id", "created_at");
