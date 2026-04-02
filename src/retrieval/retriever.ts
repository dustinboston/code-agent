/**
 * @module retrieval/retriever
 *
 * Semantic search layer that sits between the vector store and the LLM prompt.
 *
 * Given a user query, this module retrieves the top-k most relevant document
 * chunks from Pinecone (via LangChain's `similaritySearchWithScore`), formats
 * them into a numbered context string suitable for prompt injection, and
 * returns source metadata so the UI can display citations.
 */
import type { PineconeStore } from "@langchain/pinecone";
import type { AppConfig, RetrievalResult } from "../types.js";

/**
 * The value returned by {@link retrieve}.
 *
 * @property context  - A formatted, numbered string of document excerpts ready
 *                      to be injected into the system/user prompt.
 * @property sources  - An array of {@link RetrievalResult} objects carrying the
 *                      raw content, source path, and similarity score for each
 *                      retrieved chunk (used for UI citation display).
 */
export interface RetrievalOutput {
  context: string;        // formatted string injected into the LLM prompt
  sources: RetrievalResult[];
}

/**
 * Retrieve the most relevant document chunks for a natural-language query.
 *
 * The function performs a similarity search against the supplied
 * {@link PineconeStore}, returns up to `config.retrieval.topK` results, and
 * formats them into a context block the LLM can reference. All top-k results
 * are included — no hard score cutoff is applied so the model can judge
 * relevance on its own.
 *
 * When the store is empty (no documents ingested), a helpful fallback message
 * is returned as the context string.
 *
 * @param store  - An initialised LangChain {@link PineconeStore} to query.
 * @param query  - The user's natural-language question.
 * @param config - Application configuration (supplies `retrieval.topK`).
 * @returns A {@link RetrievalOutput} containing the formatted context and
 *          source metadata.
 */
// Retrieves the most relevant chunks for a query, formats them as a context
// string for the prompt, and returns source metadata for UI display.
export async function retrieve(
  store: PineconeStore,
  query: string,
  config: AppConfig
): Promise<RetrievalOutput> {
  const results = await store.similaritySearchWithScore(query, config.retrieval.topK);

  if (results.length === 0) {
    return {
      context: "No documents have been ingested yet. Run `rag-starter ingest <path>` first.",
      sources: [],
    };
  }

  // Always pass all top-k results to the LLM — let it judge relevance rather
  // than using a hard score cutoff that can silently drop useful context.
  const sources: RetrievalResult[] = results.map(([doc, score]) => ({
    content: doc.pageContent,
    source: (doc.metadata.source as string | undefined) ?? "unknown",
    score,
  }));

  const context = results
    .map(([doc, score], i) => {
      const src = (doc.metadata.source as string | undefined) ?? "unknown";
      return `[Source ${i + 1}: ${src} — relevance: ${(score * 100).toFixed(0)}%]\n${doc.pageContent}`;
    })
    .join("\n\n---\n\n");

  return { context, sources };
}
