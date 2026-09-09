-- 化妆间自定义妆容预设 + 3D 衣柜单品（图生 3D 外部服务未配置时只出 503，不落行）。

CREATE TABLE "makeup_presets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "smooth" INTEGER NOT NULL,
    "whiten" INTEGER NOT NULL,
    "slim" INTEGER NOT NULL,
    "eye" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "makeup_presets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wardrobe_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_ext" TEXT NOT NULL,
    "model_ext" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wardrobe_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "makeup_presets_user_id_idx" ON "makeup_presets"("user_id");

CREATE INDEX "wardrobe_items_user_id_idx" ON "wardrobe_items"("user_id");

ALTER TABLE "makeup_presets" ADD CONSTRAINT "makeup_presets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wardrobe_items" ADD CONSTRAINT "wardrobe_items_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
