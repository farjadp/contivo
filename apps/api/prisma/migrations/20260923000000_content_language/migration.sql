-- The language a workspace writes its content in.
--
-- Additive and defaulted, so every existing workspace keeps producing English
-- exactly as it did before this shipped. Nothing about an existing row changes
-- until someone chooses otherwise.
--
-- This column is not optional for the application: the content engine, the
-- quality gate and the Autopilot runner all read it, and a deploy without it
-- fails every workspace query. It has to be applied before or with the deploy,
-- not after.

-- CreateEnum
CREATE TYPE "ContentLanguage" AS ENUM ('EN', 'FA');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "contentLanguage" "ContentLanguage" NOT NULL DEFAULT 'EN';
