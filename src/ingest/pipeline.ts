/**
 * Document ingestion pipeline.
 *
 * This module orchestrates the full end-to-end flow for ingesting a document:
 *   1. Load the file from disk into `Document` objects (via `loader.ts`).
 *   2. Split the documents into overlapping text chunks (via `chunker.ts`).
 *   3. Embed each chunk using the configured OpenAI embeddings model.
 *   4. Upsert the resulting vectors into the configured Pinecone index.
 *   5. Write a local JSON metadata record so the document can be listed
 *      without querying Pinecone again.
 */
import { PineconeStore } from "@langchain/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Pinecone } from "@pinecone-database/pinecone";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, basename, join } from "path";
import { randomUUID } from "crypto";
import { loadDocument, detectFormat } from "./loader.js";
import { createSplitter } from "./chunker.js";
import type { AppConfig, IngestedDocument } from "../types.js";

/**
 * Retries an async operation on rate-limit errors (HTTP 429) using
 * exponential backoff. All other errors are re-thrown immediately.
 *
 * @param fn - The async operation to attempt.
 * @param maxRetries - Maximum number of retry attempts (default 5).
 * @returns The resolved value of `fn` on success.
 * @throws The original error after all retries are exhausted, or immediately
 *   for non-rate-limit errors.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit =
        err instanceof Error &&
        (err.message.includes("429") ||
          err.message.toLowerCase().includes("rate limit") ||
          (err as { status?: number }).status === 429);
      if (!isRateLimit || attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 32000)));
    }
  }
  // unreachable — loop always throws or returns
  throw new Error("Retry loop exited unexpectedly");
}

/**
 * Ingests a single document file through the full pipeline.
 *
 * Loads the file, validates that it contains extractable text, splits it into
 * chunks, embeds those chunks via OpenAI, stores the vectors in Pinecone, and
 * persists a local metadata record for fast listing.
 *
 * @param filePath - Path to the document file to ingest (absolute or relative).
 * @param config - Application configuration supplying chunking parameters,
 *   Pinecone index name and namespace, embedding model and dimensions, and the
 *   local storage directory for metadata records.
 * @param onProgress - Optional callback invoked with a human-readable status
 *   string at each major stage of the pipeline (loading, splitting, embedding).
 * @returns A promise that resolves to an `IngestedDocument` metadata record
 *   describing the file, its format, chunk count, and ingestion timestamp.
 * @throws {Error} If the file yields no documents, all pages have empty text
 *   (e.g. a scanned/image-only PDF), or splitting produces no chunks.
 */
export async function ingestFile(
  filePath: string,
  config: AppConfig,
  onProgress?: (message: string) => void
): Promise<IngestedDocument> {
  onProgress?.(`Loading ${basename(filePath)}...`);

  const docs = await loadDocument(filePath);

  if (docs.length === 0) {
    throw new Error("No content could be extracted from this file. It may be empty.");
  }

  // Verify that the PDF is not purely image-based (scanned) so we don't ingest empty documents.
  const totalChars = docs.reduce((sum, d) => sum + d.pageContent.trim().length, 0);
  if (totalChars === 0) {
    throw new Error(
      `The file loaded ${docs.length} page(s) but all have empty text content.\n` +
      "This usually means the PDF is image-based (scanned). pdf-parse can only\n" +
      "extract text from PDFs with selectable text — not scanned images.\n" +
      "Try opening the PDF and selecting some text to confirm."
    );
  }

  onProgress?.(`Loaded ${docs.length} page(s), ${totalChars.toLocaleString()} characters. Splitting into chunks...`);

  const splitter = createSplitter(config.chunking.chunkSize, config.chunking.chunkOverlap);
  const chunks = await splitter.splitDocuments(docs);

  if (chunks.length === 0) {
    throw new Error("Document was loaded but produced no chunks. The content may be too short.");
  }

  // Tag each chunk with source metadata so we can show it in the chat UI
  const format = detectFormat(filePath);
  const taggedChunks = chunks.map((chunk, i) => ({
    ...chunk,
    metadata: {
      ...chunk.metadata,
      source: filePath,
      format,
      chunkIndex: i,
    },
  }));

  onProgress?.(`Embedding ${chunks.length} chunks and storing in Pinecone...`);

  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pinecone.index(config.pinecone.indexName);

  const embeddings = new OpenAIEmbeddings({
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });

  const batchSize = config.chunking.batchSize;
  for (let i = 0; i < taggedChunks.length; i += batchSize) {
    const batch = taggedChunks.slice(i, i + batchSize);
    onProgress?.(`Embedding chunks ${i + 1} to ${Math.min(i + batchSize, taggedChunks.length)} of ${taggedChunks.length}...`);
    await withRetry(() =>
      PineconeStore.fromDocuments(batch, embeddings, {
        pineconeIndex: index,
        namespace: config.pinecone.namespace,
      })
    );
  }

  // Persist a local metadata record so `store list` works without hitting Pinecone
  const docRecord: IngestedDocument = {
    id: randomUUID(),
    source: resolve(filePath),
    format,
    chunkCount: chunks.length,
    ingestedAt: new Date().toISOString(),
  };

  const docsDir = resolve(config.storage.dataDir, "documents");
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, `${docRecord.id}.json`), JSON.stringify(docRecord, null, 2));

  return docRecord;
}
