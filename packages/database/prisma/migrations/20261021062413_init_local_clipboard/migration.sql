-- CreateTable
CREATE TABLE "clips" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content_type" TEXT NOT NULL,
    "encrypted_payload" BLOB NOT NULL,
    "encryption_nonce" BLOB NOT NULL,
    "encryption_auth_tag" BLOB,
    "encryption_version" INTEGER NOT NULL DEFAULT 1,
    "payload_byte_length" INTEGER NOT NULL,
    "source_app" TEXT,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "pinned_at" DATETIME,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "snippets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT,
    "encrypted_content" BLOB NOT NULL,
    "encryption_nonce" BLOB NOT NULL,
    "encryption_auth_tag" BLOB,
    "encryption_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "clips_created_at_idx" ON "clips"("created_at");

-- CreateIndex
CREATE INDEX "clips_pinned_at_idx" ON "clips"("pinned_at");

-- CreateIndex
CREATE INDEX "clips_expires_at_idx" ON "clips"("expires_at");

-- CreateIndex
CREATE INDEX "clips_content_type_idx" ON "clips"("content_type");

-- CreateIndex
CREATE INDEX "clips_pinned_at_created_at_idx" ON "clips"("pinned_at", "created_at");

-- CreateIndex
CREATE INDEX "snippets_title_idx" ON "snippets"("title");

-- CreateIndex
CREATE INDEX "snippets_language_idx" ON "snippets"("language");

-- CreateIndex
CREATE INDEX "snippets_created_at_idx" ON "snippets"("created_at");
