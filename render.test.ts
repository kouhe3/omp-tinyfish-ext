import { describe, expect, test } from "bun:test";
import { type FetchDetails, defineFetchTool } from "./fetch-tool";
import { type RenderTheme } from "./render";
import { type SearchDetails, defineSearchTool } from "./search-tool";

const schema = () => ({
	describe() {
		return this;
	},
	optional() {
		return this;
	},
	max() {
		return this;
	},
	min() {
		return this;
	},
});

const zStub = {
	string: schema,
	number: schema,
	boolean: schema,
	enum: schema,
	array: schema,
	object: schema,
};

const mockTheme: RenderTheme = {
	fg: (_color: string, text: string) => text,
	status: {
		success: "✓",
		error: "✕",
		warning: "⚠",
		pending: "…",
	},
	tree: {
		branch: "├─",
		last: "└─",
	},
	sep: {
		dot: "·",
	},
};

describe("TinyFish TUI Rendering", () => {
	test("both tools configure mergeCallAndResult to prevent duplicated lines", () => {
		const searchTool = defineSearchTool({ zod: zStub } as never);
		const fetchTool = defineFetchTool({ zod: zStub } as never);

		expect(searchTool.mergeCallAndResult).toBe(true);
		expect(fetchTool.mergeCallAndResult).toBe(true);
	});

	describe("tf_search", () => {
		const searchTool = defineSearchTool({ zod: zStub } as never);

		test("renderCall displays pending status with spinner and query", () => {
			const component = searchTool.renderCall(
				{ query: "OpenAI GPT-5 release date" },
				{ spinnerFrame: 2 },
				mockTheme,
			);
			const lines = component.render(80);
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain("Search: OpenAI GPT-5 release date");
			expect(lines[0]).toContain("⠹");
		});

		test("renderResult during in-flight execution (no details) does NOT display '无结果'", () => {
			const component = searchTool.renderResult(
				{ content: [{ type: "text", text: "[tf] 正在搜索…" }] },
				{ spinnerFrame: 0, isPartial: true },
				mockTheme,
				{ query: "TypeScript 5.8" },
			);
			const lines = component.render(80);
			expect(lines).toHaveLength(1);
			expect(lines[0]).not.toContain("无结果");
			expect(lines[0]).not.toContain("搜索失败");
			expect(lines[0]).toContain("Search: TypeScript 5.8");
			expect(lines[0]).toContain("⠋");
		});

		test("renderResult displays search results correctly when completed", () => {
			const details: SearchDetails = {
				query: "Bun vs Node",
				total_results: 2,
				page: 0,
				latency_ms: 120,
				shown: 2,
				truncated: false,
				results: [
					{
						position: 1,
						title: "Bun 1.2 Performance",
						url: "https://bun.sh/blog/bun-v1.2",
						snippet: "Bun is fast...",
						site_name: "bun.sh",
						date: "2025-01-20",
					},
					{
						position: 2,
						title: "Node.js 24 Overview",
						url: "https://nodejs.org/en/blog",
						snippet: "Node.js 24 release...",
						site_name: "nodejs.org",
						date: "2025-02-10",
					},
				],
			};
			const component = searchTool.renderResult(
				{ details },
				{ expanded: false },
				mockTheme,
				{ query: "Bun vs Node" },
			);
			const lines = component.render(80);
			expect(lines[0]).toContain("✓ Search: Bun vs Node");
			expect(lines[0]).toContain("共 2 条 · 120ms");
			expect(lines.some((l: string) => l.includes("1. Bun 1.2 Performance"))).toBe(true);
			expect(lines.some((l: string) => l.includes("2. Node.js 24 Overview"))).toBe(true);
		});

		test("renderResult displays warning when no results found", () => {
			const details: SearchDetails = {
				query: "asdkjhqwiueyhasjkdhaksd",
				total_results: 0,
				page: 0,
				latency_ms: 85,
				shown: 0,
				truncated: false,
				results: [],
			};
			const component = searchTool.renderResult(
				{ details },
				{ expanded: false },
				mockTheme,
				{ query: "asdkjhqwiueyhasjkdhaksd" },
			);
			const lines = component.render(80);
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain("⚠ Search: asdkjhqwiueyhasjkdhaksd");
			expect(lines[0]).toContain("无结果 · 85ms");
		});

		test("renderResult displays error status when isError is true", () => {
			const component = searchTool.renderResult(
				{ isError: true },
				{ expanded: false },
				mockTheme,
				{ query: "test query" },
			);
			const lines = component.render(80);
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain("✕ Search: test query");
			expect(lines[0]).toContain("搜索失败");
		});
	});

	describe("tf_fetch", () => {
		const fetchTool = defineFetchTool({ zod: zStub } as never);

		test("renderCall displays pending status with spinner and URL count/desc", () => {
			const componentSingle = fetchTool.renderCall(
				{ urls: ["https://example.com/api"] },
				{ spinnerFrame: 1 },
				mockTheme,
			);
			const linesSingle = componentSingle.render(80);
			expect(linesSingle[0]).toContain("Fetch: https://example.com/api");
			expect(linesSingle[0]).toContain("⠙");

			const componentMulti = fetchTool.renderCall(
				{ urls: ["https://a.com", "https://b.com"] },
				{ spinnerFrame: 3 },
				mockTheme,
			);
			const linesMulti = componentMulti.render(80);
			expect(linesMulti[0]).toContain("Fetch: 2 个 URL");
			expect(linesMulti[0]).toContain("⠸");
		});

		test("renderResult during in-flight execution (no details) does NOT display '无内容'", () => {
			const component = fetchTool.renderResult(
				{ content: [{ type: "text", text: "[tf] 正在抓取 1 个 URL…" }] },
				{ spinnerFrame: 0, isPartial: true },
				mockTheme,
				{ urls: ["https://example.com"] },
			);
			const lines = component.render(80);
			expect(lines).toHaveLength(1);
			expect(lines[0]).not.toContain("无内容");
			expect(lines[0]).not.toContain("抓取失败");
			expect(lines[0]).toContain("Fetch: https://example.com");
			expect(lines[0]).toContain("⠋");
		});

		test("renderResult displays fetch results correctly when completed", () => {
			const details: FetchDetails = {
				latency_ms: 250,
				results: [
					{
						url: "https://example.com",
						final_url: "https://example.com",
						title: "Example Domain",
						description: null,
						language: null,
						author: null,
						published_date: null,
						text: "This domain is for use in illustrative examples.",
					} as never,
				],
				errors: [],
				chars: [48],
			};
			const component = fetchTool.renderResult(
				{ details },
				{ expanded: false },
				mockTheme,
				{ urls: ["https://example.com"] },
			);
			const lines = component.render(80);
			expect(lines[0]).toContain("✓ Fetch: https://example.com");
			expect(lines[0]).toContain("成功 1 · 250ms");
			expect(lines.some((l: string) => l.includes("1. Example Domain — example.com"))).toBe(true);
		});

		test("renderResult displays warning when no content and no errors", () => {
			const details: FetchDetails = {
				latency_ms: 150,
				results: [],
				errors: [],
				chars: [],
			};
			const component = fetchTool.renderResult(
				{ details },
				{ expanded: false },
				mockTheme,
				{ urls: ["https://empty.com"] },
			);
			const lines = component.render(80);
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain("⚠ Fetch: https://empty.com");
			expect(lines[0]).toContain("无内容 · 150ms");
		});

		test("renderResult displays error message for failed URLs", () => {
			const details: FetchDetails = {
				latency_ms: 300,
				results: [],
				errors: [
					{
						url: "https://invalid.url.xyz",
						error: "DNS resolution failed",
					},
				],
				chars: [],
			};
			const component = fetchTool.renderResult(
				{ details },
				{ expanded: false },
				mockTheme,
				{ urls: ["https://invalid.url.xyz"] },
			);
			const lines = component.render(80);
			expect(lines[0]).toContain("✕ Fetch: https://invalid.url.xyz");
			expect(lines[0]).toContain("失败 1 · 300ms");
			expect(lines.some((l: string) => l.includes("✕ https://invalid.url.xyz — DNS resolution failed"))).toBe(true);
		});

		test("renderResult in expanded mode renders detailed content preview", () => {
			const details: FetchDetails = {
				latency_ms: 200,
				results: [
					{
						url: "https://example.com/article",
						final_url: "https://example.com/article",
						title: "Article Title",
						description: "Article description",
						author: "Alice",
						published_date: "2025-02-01",
						text: "Paragraph 1\nParagraph 2\nParagraph 3",
						links: ["https://example.com/a", "https://example.com/b"],
					} as never,
				],
				errors: [],
				chars: [50],
			};
			const component = fetchTool.renderResult(
				{ details },
				{ expanded: true },
				mockTheme,
				{ urls: ["https://example.com/article"] },
			);
			const lines = component.render(80);
			expect(lines.some((l: string) => l.includes("Article Title"))).toBe(true);
			expect(lines.some((l: string) => l.includes("Article description"))).toBe(true);
			expect(lines.some((l: string) => l.includes("Alice · 2025-02-01"))).toBe(true);
			expect(lines.some((l: string) => l.includes("Paragraph 1"))).toBe(true);
			expect(lines.some((l: string) => l.includes("链接 2 个"))).toBe(true);
		});
	});
});
