import { PineconeStore } from "@langchain/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Pinecone } from "@pinecone-database/pinecone";
import type { AppConfig } from "../types.js";

// Creates a PineconeStore instance connected to an existing index.
// Used at chat startup and after in-chat ingestion.
export async function createVectorStore(config: AppConfig): Promise<PineconeStore> {
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
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
