-- 「装扮」从生成改成收藏：衣柜与化妆间共用这一张表。纯新建，不动旧表
-- （makeup_presets、wardrobe_items 只读保留，仅随导出）。照片在 API 数据卷的 data/collection/ 下，不在数据库里。
CREATE TABLE "collection_items" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "shelf" TEXT NOT NULL,
  "category" TEXT,
  "name" TEXT NOT NULL,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'have',
  "link" TEXT,
  "image_ext" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "collection_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "collection_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "collection_items_user_id_shelf_created_at_idx" ON "collection_items"("user_id", "shelf", "created_at");
