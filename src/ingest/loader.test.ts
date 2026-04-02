/// <reference types="vitest/globals" />

import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { loadDocument, detectFormat } from "./loader";
import { Document } from "@langchain/core/documents";
import { readFile } from "fs/promises";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";

// Mock Node.js fs/promises module
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

// Mock LangChain PDFLoader
vi.mock("@langchain/community/document_loaders/fs/pdf", () => ({
  PDFLoader: vi.fn(() => ({
    load: vi.fn(),
  })),
}));


describe("detectFormat", () => {
  it("should return 'pdf' for .pdf extension", () => {
    expect(detectFormat("file.pdf")).toBe("pdf");
  });

  it("should return 'txt' for .txt extension", () => {
    expect(detectFormat("file.txt")).toBe("txt");
  });

  it("should return 'md' for .md extension", () => {
    expect(detectFormat("file.md")).toBe("md");
  });

  it("should return 'md' for .mdx extension", () => {
    expect(detectFormat("file.mdx")).toBe("md");
  });

  it("should return 'unknown' for unsupported extension", () => {
    expect(detectFormat("file.docx")).toBe("unknown");
  });

  it("should handle uppercase extensions", () => {
    expect(detectFormat("file.PDF")).toBe("pdf");
    expect(detectFormat("file.TXT")).toBe("txt");
  });

  it("should handle files without extension", () => {
    expect(detectFormat("file_without_extension")).toBe("unknown");
  });
});

describe("loadDocument", () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  it("should load a .txt file correctly", async () => {
    const mockContent = "This is a test text file.";
    (readFile as Mock).mockResolvedValue(mockContent);

    const filePath = "/path/to/test.txt";
    const docs = await loadDocument(filePath);

    expect(readFile).toHaveBeenCalledWith(filePath, "utf-8");
    expect(docs).toEqual([
      new Document({
        pageContent: mockContent,
        metadata: { source: filePath },
      }),
    ]);
    expect(docs.length).toBe(1);
  });

  it("should load a .md file correctly", async () => {
    const mockContent = "# Markdown Content";
    (readFile as Mock).mockResolvedValue(mockContent);

    const filePath = "/path/to/test.md";
    const docs = await loadDocument(filePath);

    expect(readFile).toHaveBeenCalledWith(filePath, "utf-8");
    expect(docs).toEqual([
      new Document({
        pageContent: mockContent,
        metadata: { source: filePath },
      }),
    ]);
  });

  it("should load a .mdx file correctly", async () => {
    const mockContent = "# MDX Content";
    (readFile as Mock).mockResolvedValue(mockContent);

    const filePath = "/path/to/test.mdx";
    const docs = await loadDocument(filePath);

    expect(readFile).toHaveBeenCalledWith(filePath, "utf-8");
    expect(docs).toEqual([
      new Document({
        pageContent: mockContent,
        metadata: { source: filePath },
      }),
    ]);
  });

  it("should load a .pdf file correctly", async () => {
    const mockPdfDocs = [
      new Document({ pageContent: "Page 1 content", metadata: { page: 1 } }),
      new Document({ pageContent: "Page 2 content", metadata: { page: 2 } }),
    ];
    const mockLoad = vi.fn().mockResolvedValue(mockPdfDocs);
    (PDFLoader as unknown as Mock).mockImplementation(() => ({
      load: mockLoad,
    }));

    const filePath = "/path/to/test.pdf";
    const docs = await loadDocument(filePath);

    expect(PDFLoader).toHaveBeenCalledWith(filePath);
    expect(mockLoad).toHaveBeenCalled();
    expect(docs).toEqual(mockPdfDocs);
  });

  it("should throw an error for unsupported file formats", async () => {
    const filePath = "/path/to/test.docx";
    await expect(loadDocument(filePath)).rejects.toThrow(
      'Unsupported file format: ".docx". Supported formats: .txt, .md, .mdx, .pdf'
    );
  });

  it("should handle file read errors for text files", async () => {
    const errorMessage = "File not found";
    (readFile as Mock).mockRejectedValue(new Error(errorMessage));

    const filePath = "/path/to/nonexistent.txt";
    await expect(loadDocument(filePath)).rejects.toThrow(errorMessage);
  });

  it("should handle PDFLoader errors", async () => {
    const errorMessage = "PDF parsing failed";
    const mockLoad = vi.fn().mockRejectedValue(new Error(errorMessage));
    (PDFLoader as unknown as Mock).mockImplementation(() => ({
      load: mockLoad,
    }));

    const filePath = "/path/to/corrupt.pdf";
    await expect(loadDocument(filePath)).rejects.toThrow(errorMessage);
  });
});
