/// <reference types="vitest/globals" />

import { describe, it, expect, vi } from "vitest";
import { createSplitter } from "./chunker";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

describe("createSplitter", () => {
  it("should return an instance of RecursiveCharacterTextSplitter", () => {
    const splitter = createSplitter(1000, 200);
    expect(splitter).toBeInstanceOf(RecursiveCharacterTextSplitter);
  });

  it("should configure the splitter with provided chunk size and overlap", () => {
    const chunkSize = 500;
    const chunkOverlap = 100;
    const splitter = createSplitter(chunkSize, chunkOverlap);

    expect((splitter as any).chunkSize).toBe(chunkSize);
    expect((splitter as any).chunkOverlap).toBe(chunkOverlap);
    expect((splitter as any).separators).toEqual(["\n\n", "\n", ". ", " ", ""]);
  });

  it("should correctly split a simple text into expected chunks", async () => {
    const splitter = createSplitter(10, 0); // Small chunk size for easy testing
    const text = "hello world test";
    const chunks = await splitter.splitText(text);

    expect(chunks.length).toBe(3);
    expect(chunks[0]).toBe("hello");
    expect(chunks[1]).toBe("world");
    expect(chunks[2]).toBe("test");
  });

  it("should handle chunk overlap correctly (basic check)", async () => {
    const splitter = createSplitter(20, 5);
    const text = "This is a longer sentence to test chunk overlap functionality.";
    const chunks = await splitter.splitText(text);

    expect(chunks.length).toBeGreaterThan(1);
    // We are primarily testing that the splitter is configured with overlap,
    // and that it produces multiple chunks for a longer text.
    // Exact content of overlapping chunks is hard to predict and brittle to test.
    // The configuration test above already verifies chunkOverlap is set.
    // This test ensures basic splitting with overlap enabled happens.
    expect(chunks[0].length).toBeLessThanOrEqual(20);
    expect(chunks[1].length).toBeLessThanOrEqual(20);
  });

  it("should handle empty string gracefully", async () => {
    const splitter = createSplitter(100, 20);
    const chunks = await splitter.splitText("");
    expect(chunks).toEqual([]);
  });

  it("should handle text shorter than chunk size", async () => {
    const splitter = createSplitter(100, 20);
    const text = "Short text.";
    const chunks = await splitter.splitText(text);
    expect(chunks).toEqual(["Short text."]);
    expect(chunks.length).toBe(1);
  });
});
