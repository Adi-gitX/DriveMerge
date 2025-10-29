-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "wrappedFileKey" TEXT,
    "wrappedFileKeyIv" TEXT,
    "ownerId" VARCHAR(191),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "hash" VARCHAR(128) NOT NULL,
    "size" INTEGER,
    "wrappedChunkKey" TEXT,
    "wrapIv" TEXT,
    "chunkIv" TEXT,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hash" (
    "id" TEXT NOT NULL,
    "sha256" VARCHAR(128) NOT NULL,
    "refCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Hash_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hash_sha256_key" ON "Hash"("sha256");

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
