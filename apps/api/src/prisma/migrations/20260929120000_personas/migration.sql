-- 人设库（2026-09-29 裁定）：用户自己定义的「她」，一人多张人设卡；users.persona 改存这里的 id（TEXT 不变）。
-- 旧说话方式枚举 → 人设卡的一次性数据迁移在 apps/api/scripts/migrate-personas.mjs（db:migrate:personas），不在 SQL 里。

-- CreateTable
CREATE TABLE "personas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "card" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personas_user_id_idx" ON "personas"("user_id");

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
