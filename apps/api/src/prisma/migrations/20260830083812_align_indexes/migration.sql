-- DropIndex
DROP INDEX "memories_importance_idx";

-- DropIndex
DROP INDEX "memories_type_idx";

-- DropIndex
DROP INDEX "messages_created_at_idx";

-- CreateIndex
CREATE INDEX "memories_user_id_importance_created_at_idx" ON "memories"("user_id", "importance", "created_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
