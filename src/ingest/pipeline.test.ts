/// <reference types="vitest/globals" />

import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { ingestFile } from "./pipeline";
import { Document } from "@langchain/core/documents";
import { PineconeStore } from "@langchain/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Pinecone } from "@pinecone-database/pinecone";
import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";
import type { AppConfig } from "../types";

// Mock internal module dependencies
vi.mock("./loader", () => ({
  loadDocument: vi.fn(),
  detectFormat: vi.fn(),
}));
vi.mock("./chunker", () => ({
  createSplitter: vi.fn(() => ({
    splitDocuments: vi.fn(),
  })),
}));

// Mock external dependencies
vi.mock("@langchain/pinecone", () => ({
  PineconeStore: {
    fromDocuments: vi.fn(),
  },
}));
vi.mock("@langchain/openai", () => ({
  OpenAIEmbeddings: vi.fn(),
}));

const mockPineconeIndex = {
  index: vi.fn(() => ({})), // Mock index method to return a mock index object
};
vi.mock("@pinecone-database/pinecone", () => ({
  Pinecone: vi.fn(() => mockPineconeIndex),
}));

// Mock Node.js built-ins
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock("crypto", () => ({
  randomUUID: vi.fn(),
}));
vi.mock("path", () => ({
  resolve: vi.fn((...args) => {
    // Custom mock for path.resolve to handle the specific case of dataDir
    if (args[0] === "./data" && args[1] === "documents") {
      return "/data/documents"; // Simulate absolute path resolution
    }
    return args.join("/"); // Default behavior for other calls
  }),
  basename: vi.fn((p) => p.split("/").pop()),
  join: vi.fn((...args) => args.join("/")),
}));

// Import mocked functions
import { loadDocument, detectFormat } from "./loader";
import { createSplitter } from "./chunker";

describe("ingestFile", () => {
  const mockConfig: AppConfig = {
    llm: { provider: "openai", model: "gpt-4", temperature: 0.7, maxTokens: 1000 },
    planner: { provider: "openai", model: "gpt-4", temperature: 0.7, maxTokens: 1000 },
    developer: { provider: "openai", model: "gpt-4", temperature: 0.7, maxTokens: 1000 },
    tester: { provider: "openai", model: "gpt-4", temperature: 0.7, maxTokens: 1000 },
    embedding: { provider: "openai", model: "text-embedding-ada-002", dimensions: 1536 },
    pinecone: { indexName: "test-index", namespace: "test-namespace" },
    chunking: { strategy: "recursive", chunkSize: 1000, chunkOverlap: 200, batchSize: 50 },
    retrieval: { topK: 5, scoreThreshold: 0.8 },
    storage: { dataDir: "./data" },
  };
  const mockFilePath = "/data/test.pdf";
  const mockOnProgress = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations for a successful run
    (loadDocument as Mock).mockResolvedValue([
      new Document({ pageContent: "Page 1 content.", metadata: { page: 1 } }),
      new Document({ pageContent: "Page 2 content.", metadata: { page: 2 } }),
    ]);
    (detectFormat as Mock).mockReturnValue("pdf");

    const mockSplitter = {
      splitDocuments: vi.fn().mockResolvedValue([
        new Document({ pageContent: "Chunk 1", metadata: {} }),
        new Document({ pageContent: "Chunk 2", metadata: {} }),
      ]),
    };
    (createSplitter as Mock).mockReturnValue(mockSplitter);

    (OpenAIEmbeddings as Mock).mockImplementation(() => ({}));
    (PineconeStore.fromDocuments as Mock).mockResolvedValue(undefined);

    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.mkdirSync as Mock).mockReturnValue(undefined);
    (fs.writeFileSync as Mock).mockReturnValue(undefined);
    (crypto.randomUUID as Mock).mockReturnValue("mock-uuid");

    // Mock process.env.PINECONE_API_KEY
    process.env.PINECONE_API_KEY = "test-api-key";
  });

  it("should successfully ingest a file and return document record", async () => {
    const result = await ingestFile(mockFilePath, mockConfig, mockOnProgress);

    expect(mockOnProgress).toHaveBeenCalledWith("Loading test.pdf...");
    expect(loadDocument).toHaveBeenCalledWith(mockFilePath);
    expect(mockOnProgress).toHaveBeenCalledWith("Loaded 2 page(s), 30 characters. Splitting into chunks...");
    expect(createSplitter).toHaveBeenCalledWith(mockConfig.chunking.chunkSize, mockConfig.chunking.chunkOverlap);
    expect(((createSplitter(0, 0) as unknown) as { splitDocuments: Mock }).splitDocuments).toHaveBeenCalledWith([
      new Document({ pageContent: "Page 1 content.", metadata: { page: 1 } }),
      new Document({ pageContent: "Page 2 content.", metadata: { page: 2 } }),
    ]);
    expect(detectFormat).toHaveBeenCalledWith(mockFilePath);
    expect(mockOnProgress).toHaveBeenCalledWith("Embedding 2 chunks and storing in Pinecone...");
    expect(Pinecone).toHaveBeenCalledWith({ apiKey: "test-api-key" });
    expect(mockPineconeIndex.index).toHaveBeenCalledWith(mockConfig.pinecone.indexName);
    expect(OpenAIEmbeddings).toHaveBeenCalledWith({
      model: mockConfig.embedding.model,
      dimensions: mockConfig.embedding.dimensions,
    });
    expect(PineconeStore.fromDocuments).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          pageContent: "Chunk 1",
          metadata: { source: mockFilePath, format: "pdf", chunkIndex: 0 },
        }),
        expect.objectContaining({
          pageContent: "Chunk 2",
          metadata: { source: mockFilePath, format: "pdf", chunkIndex: 1 },
        }),
      ]),
      expect.any(Object), // OpenAIEmbeddings instance
      {
        pineconeIndex: expect.any(Object), // Mocked Pinecone index
        namespace: mockConfig.pinecone.namespace,
      }
    );
    expect(fs.existsSync).toHaveBeenCalledWith("/data/documents");
    expect(fs.mkdirSync).not.toHaveBeenCalled(); // existsSync returns true by default

    // Get the arguments passed to writeFileSync
    const writeFileSyncArgs = (fs.writeFileSync as Mock).mock.calls[0];
    expect(writeFileSyncArgs[0]).toBe("/data/documents/mock-uuid.json");

    const writtenContent = JSON.parse(writeFileSyncArgs[1]);
    expect(writtenContent).toEqual({
      id: "mock-uuid",
      source: "/data/test.pdf",
      format: "pdf",
      chunkCount: 2,
      ingestedAt: expect.any(String),
    });

    expect(result).toEqual({
      id: "mock-uuid",
      source: "/data/test.pdf",
      format: "pdf",
      chunkCount: 2,
      ingestedAt: expect.any(String),
    });
  });

  it("should throw error if no content could be extracted", async () => {
    (loadDocument as Mock).mockResolvedValue([]);

    await expect(ingestFile(mockFilePath, mockConfig, mockOnProgress)).rejects.toThrow(
      "No content could be extracted from this file. It may be empty."
    );
    expect(mockOnProgress).toHaveBeenCalledWith("Loading test.pdf...");
  });

  it("should throw error if all pages have empty text content", async () => {
    (loadDocument as Mock).mockResolvedValue([
      new Document({ pageContent: "", metadata: { page: 1 } }),
      new Document({ pageContent: " ", metadata: { page: 2 } }),
    ]);

    await expect(ingestFile(mockFilePath, mockConfig, mockOnProgress)).rejects.toThrow(
      /The file loaded 2 page\(s\) but all have empty text content/i
    );
  });

  it("should throw error if splitting produces no chunks", async () => {
    const mockSplitter = {
      splitDocuments: vi.fn().mockResolvedValue([]),
    };
    (createSplitter as Mock).mockReturnValue(mockSplitter);

    await expect(ingestFile(mockFilePath, mockConfig, mockOnProgress)).rejects.toThrow(
      "Document was loaded but produced no chunks. The content may be too short."
    );
  });

  it("should create documents directory if it does not exist", async () => {
    (fs.existsSync as Mock).mockReturnValue(false);

    await ingestFile(mockFilePath, mockConfig);

    expect(fs.existsSync).toHaveBeenCalledWith("/data/documents");
    expect(fs.mkdirSync).toHaveBeenCalledWith("/data/documents", { recursive: true });

    const writeFileSyncArgs = (fs.writeFileSync as Mock).mock.calls[0];
    expect(writeFileSyncArgs[0]).toBe("/data/documents/mock-uuid.json");
    const writtenContent = JSON.parse(writeFileSyncArgs[1]);
    expect(writtenContent).toEqual({
      id: "mock-uuid",
      source: "/data/test.pdf",
      format: "pdf",
      chunkCount: 2,
      ingestedAt: expect.any(String),
    });
  });

  it("should handle onProgress being undefined", async () => {
    // Should not throw an error when onProgress is not provided
    await expect(ingestFile(mockFilePath, mockConfig)).resolves.toBeDefined();
  });

  it("should correctly tag chunks with metadata", async () => {
    const mockDocs = [
      new Document({ pageContent: "Doc 1 content.", metadata: { original: "meta" } }),
    ];
    const mockChunks = [
      new Document({ pageContent: "Chunk A", metadata: { original: "meta" } }),
      new Document({ pageContent: "Chunk B", metadata: { original: "meta" } }),
    ];
    (loadDocument as Mock).mockResolvedValue(mockDocs);
    const mockSplitter = {
      splitDocuments: vi.fn().mockResolvedValue(mockChunks),
    };
    (createSplitter as Mock).mockReturnValue(mockSplitter);
    (detectFormat as Mock).mockReturnValue("txt");

    await ingestFile(mockFilePath, mockConfig);

    const expectedTaggedChunks = [
      expect.objectContaining({
        pageContent: "Chunk A",
        metadata: { original: "meta", source: mockFilePath, format: "txt", chunkIndex: 0 },
      }),
      expect.objectContaining({
        pageContent: "Chunk B",
        metadata: { original: "meta", source: mockFilePath, format: "txt", chunkIndex: 1 },
      }),
    ];
    expect(PineconeStore.fromDocuments).toHaveBeenCalledWith(
      expectedTaggedChunks,
      expect.any(Object),
      expect.any(Object)
    );
  });
});
