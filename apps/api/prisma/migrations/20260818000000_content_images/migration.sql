-- CreateTable
CREATE TABLE "content_images" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "width" INTEGER,
    "height" INTEGER,
    "prompt" TEXT,
    "altText" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_images_contentItemId_idx" ON "content_images"("contentItemId");

-- CreateIndex
CREATE INDEX "content_images_workspaceId_idx" ON "content_images"("workspaceId");

-- AddForeignKey
ALTER TABLE "content_images" ADD CONSTRAINT "content_images_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
