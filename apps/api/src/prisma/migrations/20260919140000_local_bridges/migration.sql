-- 本机助手：用户电脑上主动外连的小程序。一行 = 一台电脑；连接码与令牌只存 SHA-256 哈希。
CREATE TABLE "local_bridges" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT,
  "pairing_code_hash" TEXT,
  "pairing_expires_at" TIMESTAMP(3),
  "token_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "local_bridges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "local_bridges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "local_bridges_pairing_code_hash_key" ON "local_bridges"("pairing_code_hash");
CREATE UNIQUE INDEX "local_bridges_token_hash_key" ON "local_bridges"("token_hash");
CREATE INDEX "local_bridges_user_id_idx" ON "local_bridges"("user_id");
