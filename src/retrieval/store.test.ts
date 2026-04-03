import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVectorStore } from './store.js';
import { PineconeStore } from '@langchain/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Pinecone } from '@pinecone-database/pinecone';
import type { AppConfig } from '../types.js';

// Mock the external modules
vi.mock('@pinecone-database/pinecone', () => {
  const mockIndex = {
    upsert: vi.fn(),
    query: vi.fn(),
  };
  const mockPinecone = vi.fn(() => ({
    index: vi.fn(() => mockIndex),
  }));
  return { Pinecone: mockPinecone };
});

vi.mock('@langchain/openai', () => {
  const mockOpenAIEmbeddings = vi.fn(() => ({
    embedDocuments: vi.fn(),
    embedQuery: vi.fn(),
  }));
  return { OpenAIEmbeddings: mockOpenAIEmbeddings };
});

vi.mock('@langchain/pinecone', () => {
  const mockPineconeStore = vi.fn(() => ({})); // Mock constructor
  return { PineconeStore: mockPineconeStore };
});

describe('createVectorStore', () => {
  const mockConfig: AppConfig = {
    llm: {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 1000,
    },
    planner: {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1000,
    },
    developer: {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1000,
    },
    tester: {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1000,
    },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-ada-002',
      dimensions: 1536,
    },
    pinecone: {
      indexName: 'test-index',
      namespace: 'test-namespace',
    },
    chunking: {
      strategy: 'recursive',
      chunkSize: 1000,
      chunkOverlap: 200,
      batchSize: 1000, // Added batchSize
    },
    retrieval: {
      topK: 3,
      scoreThreshold: 0.7,
    },
    storage: {
      dataDir: './data',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PINECONE_API_KEY = 'test-api-key';
  });

  it('should initialize Pinecone, OpenAIEmbeddings, and PineconeStore correctly', async () => {
    await createVectorStore(mockConfig);

    // Verify Pinecone client initialization
    expect(Pinecone).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
    const pineconeInstance = (Pinecone as any).mock.results[0].value;
    expect(pineconeInstance.index).toHaveBeenCalledWith(mockConfig.pinecone.indexName);

    // Verify OpenAIEmbeddings initialization
    expect(OpenAIEmbeddings).toHaveBeenCalledWith({
      model: mockConfig.embedding.model,
      dimensions: mockConfig.embedding.dimensions,
    });
    const embeddingsInstance = (OpenAIEmbeddings as any).mock.results[0].value;

    // Verify PineconeStore initialization
    expect(PineconeStore).toHaveBeenCalledWith(embeddingsInstance, {
      pineconeIndex: pineconeInstance.index(),
      namespace: mockConfig.pinecone.namespace,
    });
  });

  it('should throw an error if PINECONE_API_KEY is not set', async () => {
    delete process.env.PINECONE_API_KEY;
    await expect(createVectorStore(mockConfig)).rejects.toThrow();
  });
});
