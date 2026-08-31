-- CreateTable
CREATE TABLE "llm_runtime_configs" (
    "id" TEXT NOT NULL DEFAULT 'local',
    "provider" TEXT NOT NULL DEFAULT 'llamacpp',
    "base_url" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "last_verified_at" TIMESTAMP(3),
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_runtime_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_runtime_configs_updated_by_user_id_idx" ON "llm_runtime_configs"("updated_by_user_id");

-- AddForeignKey
ALTER TABLE "llm_runtime_configs"
ADD CONSTRAINT "llm_runtime_configs_updated_by_user_id_fkey"
FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
