import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// RecursiveCharacterTextSplitter tries each separator in order until chunks
// are small enough. This produces more natural splits than fixed-size chunking.
export function createSplitter(chunkSize: number, chunkOverlap: number) {
  return new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    // Try to split on paragraph breaks first, then line breaks, then sentences,
    // then words — only splitting mid-word as a last resort.
    separators: ["\n\n", "\n", ". ", " ", ""],
  });
}
