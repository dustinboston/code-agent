import { PineconeStore } from "@langchain/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Pinecone } from "@pinecone-database/pinecone";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, basename, join } from "path";
import { randomUUID } from "crypto";
import { loadDocument, detectFormat } from "./loader.js";
import { createSplitter } from "./chunker.js";
import type { AppConfig, IngestedDocument } from "../types.js";

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

  // Check that at least some pages have actual text content
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
  const taggedChunks = chunks.map((chunk, i) => ({
    ...chunk,
    metadata: {
      ...chunk.metadata,
      source: filePath,
      format: detectFormat(filePath),
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

  // fromDocuments embeds each chunk and upserts the vectors into Pinecone
  await PineconeStore.fromDocuments(taggedChunks, embeddings, {
    pineconeIndex: index,
    namespace: config.pinecone.namespace,
  });

  // Persist a local metadata record so `store list` works without hitting Pinecone
  const docRecord: IngestedDocument = {
    id: randomUUID(),
    source: resolve(filePath),
    format: detectFormat(filePath),
    chunkCount: chunks.length,
    ingestedAt: new Date().toISOString(),
  };

  const docsDir = resolve(config.storage.dataDir, "documents");
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, `${docRecord.id}.json`), JSON.stringify(docRecord, null, 2));

  return docRecord;
}
