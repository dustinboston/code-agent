import type { PineconeStore } from "@langchain/pinecone";
import type { AppConfig, RetrievalResult } from "../types.js";

export interface RetrievalOutput {
  context: string;        // formatted string injected into the LLM prompt
  sources: RetrievalResult[];
}

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
