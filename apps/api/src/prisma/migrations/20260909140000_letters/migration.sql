-- M4「她的信」：每周一封基于本周真实数据生成的信。

CREATE TABLE "letters" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "letters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "letters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "letters_user_id_week_start_key" ON "letters"("user_id", "week_start");
