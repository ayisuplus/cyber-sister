-- 自定义模型供应商（2026-09-22）：实例管理员在应用里配置多家 OpenAI 兼容服务，
-- 网关按 priority 依次切换，不再绑死单一家厂商的环境变量槽（GATEWAY_QWEN_*）。
-- key 只存 AES-256-GCM 密文，主密钥来自只读文件 MODEL_CONFIG_KEY_FILE。
-- 纯新建表，不动旧表、不回填、不锁已有表。
CREATE TABLE "model_providers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "api_key_encrypted" TEXT,
  "scenes" TEXT NOT NULL DEFAULT 'chat',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "model_providers_pkey" PRIMARY KEY ("id")
);
-- 网关装配只读「启用的供应商按优先级」这一个形状
CREATE INDEX "model_providers_enabled_priority_idx" ON "model_providers"("enabled", "priority");
