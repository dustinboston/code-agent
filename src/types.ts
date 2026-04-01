// Shared types for the RAG starter application

export interface IngestedDocument {
  id: string;
  source: string;        // absolute file path
  format: string;        // txt, md, pdf
  chunkCount: number;
  ingestedAt: string;    // ISO timestamp
}

export interface RetrievalResult {
  content: string;
  source: string;
  score: number;         // cosine similarity 0–1
}

// A single message in the chat UI
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";  // system = in-app notices
  content: string;
  sources?: RetrievalResult[];            // only on assistant messages
  timestamp: string;
}

export type Provider = "anthropic" | "openai";

export interface AppConfig {
  llm: {
    provider: Provider;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  planner: {
    provider: Provider;
    model: string;
    temperature: number;
    maxTokens: number; 
  },
  developer: {
    provider: Provider;
    model: string;
    temperature: number;
    maxTokens: number;
  },
  tester: {
    provider: Provider;
    model: string;
    temperature: number;
    maxTokens: number;
  };  
  embedding: {
    provider: "openai";
    model: string;
    dimensions: number;
  };
  pinecone: {
    indexName: string;
    namespace?: string;
  };
  chunking: {
    strategy: "recursive";
    chunkSize: number;
    chunkOverlap: number;
  };
  retrieval: {
    topK: number;
    scoreThreshold: number;
  };
  storage: {
    dataDir: string;
  };
}
