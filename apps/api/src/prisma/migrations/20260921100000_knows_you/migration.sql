-- 「放在心上」：你挑出来的几件事，每轮都带给她，不靠聊到才想起。最多 5 条由服务端保证。
ALTER TABLE "memories" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "memories_user_id_pinned_idx" ON "memories"("user_id", "pinned");

-- 「她惦记的事」：做梦时从聊天里记下的、过几天该问问你的事。只在做梦开着时产生与出现。
CREATE TABLE "follow_ups" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "about" TEXT NOT NULL,
  "ask" TEXT NOT NULL,
  "ask_on" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "follow_ups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "follow_ups_user_id_status_ask_on_idx" ON "follow_ups"("user_id", "status", "ask_on");
