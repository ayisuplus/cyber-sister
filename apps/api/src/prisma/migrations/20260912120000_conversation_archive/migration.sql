ALTER TABLE "conversations" ADD COLUMN "archived_at" TIMESTAMP(3);
CREATE INDEX "conversations_user_id_archived_at_updated_at_idx"
  ON "conversations"("user_id", "archived_at", "updated_at");
