-- 宠物（路线图 C17 修订）：每天领饲料、喂它长成长值、摸它长好感度；只涨不掉。
ALTER TABLE "users" ADD COLUMN "pet_food" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pet_food_day" TEXT,
ADD COLUMN "active_pet_species" TEXT;

CREATE TABLE "pets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "affection" INTEGER NOT NULL DEFAULT 0,
    "growth" INTEGER NOT NULL DEFAULT 0,
    "petted_day" TEXT,
    "petted_today" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pets_user_id_species_key" ON "pets"("user_id", "species");

ALTER TABLE "pets" ADD CONSTRAINT "pets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
