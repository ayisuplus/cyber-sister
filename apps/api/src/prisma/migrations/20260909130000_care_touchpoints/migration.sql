-- M3 主动关怀「她来想你」：资料总开关 + 触点按日忽略表。

ALTER TABLE "users" ADD COLUMN "care_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "care_dismissals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "care_dismissals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "care_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "care_dismissals_user_id_key_key" ON "care_dismissals"("user_id", "key");
