/**
 * Text chunking utilities for the ingestion pipeline.
 *
 * This module provides helpers for splitting large documents into smaller,
 * overlapping pieces that are suitable for embedding and vector storage.
 * Keeping chunks small ensures they fit within embedding model token limits,
 * while overlap preserves context across chunk boundaries.
 */
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// RecursiveCharacterTextSplitter tries each separator in order until chunks
// are small enough. This produces more natural splits than fixed-size chunking.
/**
 * Creates a configured text splitter for breaking documents into chunks.
 *
 * Uses `RecursiveCharacterTextSplitter`, which works down a priority list of
 * separators so splits happen at the most natural boundary available.
 *
 * @param chunkSize - Maximum number of characters allowed in a single chunk.
 * @param chunkOverlap - Number of characters shared between consecutive chunks;
 *   overlap helps retain context that would otherwise be lost at a boundary.
 * @returns A configured `RecursiveCharacterTextSplitter` instance ready to
 *   split `Document` objects or raw strings.
 */
export function createSplitter(chunkSize: number, chunkOverlap: number) {
  return new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    // Try to split on paragraph breaks first, then line breaks, then sentences,
    // then words — only splitting mid-word as a last resort.
    separators: ["\n\n", "\n", ". ", " ", ""],
  });
}
