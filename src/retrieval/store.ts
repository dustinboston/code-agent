/**
 * @module retrieval/store
 *
 * Factory for creating a LangChain {@link PineconeStore} backed by an
 * existing Pinecone index. The store is the shared access point for both
 * querying (at chat startup) and upserting (after in-chat ingestion).
 *
 * Environment requirement: `PINECONE_API_KEY` must be set.
 */
import { PineconeStore } from "@langchain/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Pinecone } from "@pinecone-database/pinecone";
import type { AppConfig } from "../types.js";

/**
 * Initialise and return a {@link PineconeStore} connected to the configured
 * Pinecone index and namespace.
 *
 * Internally this:
 * 1. Creates a Pinecone client using the `PINECONE_API_KEY` env var.
 * 2. Obtains a handle to the index specified in `config.pinecone.indexName`.
 * 3. Configures {@link OpenAIEmbeddings} with the model and dimensions from
 *    `config.embedding`.
 * 4. Returns a `PineconeStore` that LangChain can use for similarity search
 *    and document upserts.
 *
 * @param config - Application configuration supplying Pinecone index/namespace
 *                 and embedding model settings.
 * @returns A ready-to-use {@link PineconeStore} instance.
 */
// Creates a PineconeStore instance connected to an existing index.
// Used at chat startup and after in-chat ingestion.
export async function createVectorStore(config: AppConfig): Promise<PineconeStore> {
  if (!process.env.PINECONE_API_KEY) {
    throw new Error("PINECONE_API_KEY environment variable is not set.");
  }
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pinecone.index(config.pinecone.indexName);

  const embeddings = new OpenAIEmbeddings({
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });

  return new PineconeStore(embeddings, {
    pineconeIndex: index,
    namespace: config.pinecone.namespace,
  });
}
