/**
 * `tf_search` — TinyFish Search as a first-class OMP tool.
 *
 * Differences vs the MCP-backed `search`:
 * - Full parameter surface (purpose, domains, date range, recency, domain_type…)
 * - Live `onUpdate` progress while the query runs
 * - Model-facing output is a compact digest (default 8 results, ~2 lines each)
 * - Full structured data rides in `details` and is rendered as result cards
 *   in the TUI (title / site / date / snippet / link per card)
 */
import { type SearchQueryResponse, type SearchResult } from "@tiny-fish/sdk";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import { getTinyFish, formatTinyFishError } from "./client";
import {
	MAX_COLLAPSED_ITEMS,
	clip,
	detailRow,
	moreHint,
	statusLine,
	stripAnsi,
	treeRow,
	type Component,
	type RenderTheme,
} from "./render";

const DEFAULT_MAX_RESULTS = 8;

interface SearchParams {
	query: string;
	purpose?: string;
	location?: string;
	language?: string;
	include_domains?: string;
	exclude_domains?: string;
	after_date?: string;
	before_date?: string;
	recency_minutes?: number;
	domain_type?: "web" | "news" | "research_paper";
	pub_year_min?: number;
	pub_year_max?: number;
	page?: number;
	max_results?: number;
}

export interface SearchDetails {
	query: string;
	total_results: number;
	page: number;
	latency_ms: number;
	shown: number;
	truncated: boolean;
	results: SearchResult[];
}

/** Compact digest for the model (keeps context small). */
export function buildSearchDigest(res: SearchQueryResponse, shown: number, latencyMs: number): string {
	const rows = res.results.slice(0, shown).map((r, i) => {
		const meta = [r.site_name, r.date].filter(Boolean).join(" · ");
		const head = `${i + 1}. ${r.title}${meta ? ` — ${meta}` : ""}`;
		const snippet = r.snippet ? `   ${r.snippet}` : "";
		return `${head}\n${snippet}\n   ${r.url}`;
	});
	const footer = `共 ${res.total_results} 条结果（第 ${(res.page ?? 0) + 1} 页，耗时 ${latencyMs}ms）`;
	// stripAnsi: third-party titles/snippets/URLs must not carry escape
	// sequences into the model context or downstream rendering.
	return stripAnsi([`搜索「${res.query}」：`, ...rows, "", footer].join("\n"));
}

/** Core execute body — split out so a smoke test can drive it with a stub client. */
export async function runSearch(
	params: SearchParams,
	api: { search: { query(p: SearchParams): Promise<SearchQueryResponse> } },
	onUpdate?: (update: { content: Array<{ type: "text"; text: string }> }) => void,
	signal?: AbortSignal,
): Promise<{ text: string; details: SearchDetails; isError?: boolean }> {
	const started = Date.now();
	onUpdate?.({ content: [{ type: "text", text: `[tf] 正在搜索「${stripAnsi(params.query)}」…` }] });
	if (signal?.aborted) return { text: "已取消", details: emptyDetails(params) };

	// `max_results` is a local display cap — the SDK schema is strict and
	// rejects unknown keys, so it must not reach the wire.
	const { max_results: _maxResults, ...apiParams } = params;
	let res: SearchQueryResponse;
	try {
		res = await api.search.query(apiParams);
	} catch (err) {
		return { text: formatTinyFishError(err), details: emptyDetails(params), isError: true };
	}
	if (signal?.aborted) return { text: "已取消", details: emptyDetails(params) };

	const latencyMs = Date.now() - started;
	const max = Math.max(1, Math.min(20, params.max_results ?? DEFAULT_MAX_RESULTS));
	const shown = Math.min(res.results.length, max);
	return {
		text: buildSearchDigest(res, shown, latencyMs),
		details: {
			query: params.query,
			total_results: res.total_results,
			page: res.page,
			latency_ms: latencyMs,
			shown,
			truncated: res.results.length > shown,
			results: res.results,
		},
	};
}

function emptyDetails(params: SearchParams): SearchDetails {
	return {
		query: params.query,
		total_results: 0,
		page: 1,
		latency_ms: 0,
		shown: 0,
		truncated: false,
		results: [],
	};
}

function searchTree(
	result: SearchResult,
	index: number,
	theme: RenderTheme,
	expanded: boolean,
	isLast: boolean,
	maxRowWidth = 80,
): string[] {
	const maxDetailWidth = Math.max(26, maxRowWidth - 4);
	const title = `${index + 1}. ${result.title || result.url}`;
	if (!expanded) {
		const meta = [result.site_name, result.date, result.publisher].filter((v): v is string => Boolean(v));
		return [treeRow(meta.length > 0 ? `${title} — ${meta.join(" · ")}` : title, theme, isLast, maxRowWidth)];
	}
	const lines = [treeRow(title, theme, false, maxRowWidth)];
	if (result.snippet) lines.push(detailRow(result.snippet, theme, 3, maxDetailWidth));
	const meta = [result.site_name, result.date, result.publisher].filter((v): v is string => Boolean(v));
	if (meta.length > 0) lines.push(detailRow(meta.join(" · "), theme, 3, maxDetailWidth));
	lines.push(detailRow(theme.fg("dim", result.url), theme, 3, maxDetailWidth));
	return lines;
}

export function defineSearchTool(pi: ExtensionAPI) {
	const z = pi.zod;
	return {
		name: "tf_search",
		label: "TinyFish Search",
		description:
			"TinyFish 网页搜索。比 MCP search 信息更全：支持 purpose（搜索意图）、域名白/黑名单、日期范围、时效、学术/新闻过滤；结果以卡片渲染，给模型的摘要默认 8 条。",
		mergeCallAndResult: true,
		parameters: z.object({
			query: z.string().describe("搜索查询词"),
			purpose: z.string().optional().describe("为什么搜索（目标/用途），给搜索附加意图信号"),
			location: z.string().optional().describe("搜索地理位置，如 'CN'"),
			language: z.string().optional().describe("结果语言，如 'zh'"),
			include_domains: z.string().optional().describe("限定域名，逗号分隔，如 'github.com,arxiv.org'"),
			exclude_domains: z.string().optional().describe("排除域名，逗号分隔"),
			after_date: z.string().optional().describe("最早日期，YYYY-MM-DD"),
			before_date: z.string().optional().describe("最晚日期，YYYY-MM-DD"),
			recency_minutes: z.number().optional().describe("只看最近 N 分钟内的结果"),
			domain_type: z.enum(["web", "news", "research_paper"]).optional().describe("结果类型：网页/新闻/学术论文"),
			pub_year_min: z.number().optional().describe("论文出版年份下限"),
			pub_year_max: z.number().optional().describe("论文出版年份上限"),
			page: z.number().max(10).optional().describe("分页页码，0 起（0 = 第 1 页），最大 10"),
			max_results: z.number().optional().describe(`返回给模型的条数上限，默认 ${DEFAULT_MAX_RESULTS}，最大 20`),
		}),
		async execute(
			_toolCallId: string,
			params: SearchParams,
			signal: AbortSignal | undefined,
			onUpdate: ((update: { content: Array<{ type: "text"; text: string }> }) => void) | undefined,
			_ctx: unknown,
		) {
			const client = getTinyFish();
			const out = await runSearch(params, client, onUpdate, signal);
			const content: Array<{ type: "text"; text: string }> = [{ type: "text", text: out.text }];
			return { content, details: out.details, isError: out.isError };
		},
		renderCall(
			args: SearchParams,
			options: { spinnerFrame?: number },
			theme: RenderTheme,
		): Component {
			const desc = args?.query ? clip(args.query, 80) : "…";
			return {
				render: () => [
					statusLine(
						{
							icon: "pending",
							spinnerFrame: options.spinnerFrame,
							title: "Search",
							description: desc,
						},
						theme,
					),
				],
			};
		},
		renderResult(
			result: { content?: Array<{ type: string; text?: string }>; details?: SearchDetails; isError?: boolean },
			options: { expanded?: boolean; isPartial?: boolean; spinnerFrame?: number },
			theme: RenderTheme,
			args?: SearchParams,
		): Component {
			if (result.isError) {
				const desc = args?.query ? clip(args.query, 80) : undefined;
				return {
					render: () => [
						statusLine(
							{
								icon: "error",
								title: "Search",
								description: desc,
								meta: ["搜索失败"],
							},
							theme,
						),
					],
				};
			}

			const d = result.details;
			if (!d) {
				// Partial / pending update during execution (e.g. onUpdate fired before response arrived).
				// Keep the in-flight status line with spinner rather than showing "无结果".
				const desc = args?.query ? clip(args.query, 80) : "…";
				return {
					render: () => [
						statusLine(
							{
								icon: "pending",
								spinnerFrame: options.spinnerFrame,
								title: "Search",
								description: desc,
							},
							theme,
						),
					],
				};
			}

			if (d.results.length === 0) {
				return {
					render: () => [
						statusLine(
							{
								icon: "warning",
								title: "Search",
								description: clip(d.query, 80),
								meta: ["无结果", `${d.latency_ms}ms`],
							},
							theme,
						),
					],
				};
			}
			return {
				render: (width: number) => {
					const expanded = options.expanded === true;
					const lines: string[] = [];
					const maxDescLen = Math.max(30, (width || 80) - 30);
					lines.push(
						statusLine(
							{
								icon: "success",
								title: "Search",
								description: clip(d.query, maxDescLen),
								meta: [`共 ${d.total_results} 条`, `${d.latency_ms}ms`],
							},
							theme,
						),
					);
					const items = expanded ? d.results.length : Math.min(d.results.length, MAX_COLLAPSED_ITEMS);
					const maxRowWidth = Math.max(30, (width || 80) - 4);
					for (let i = 0; i < items; i++) {
						lines.push(...searchTree(d.results[i], i, theme, expanded, i === items - 1, maxRowWidth));
					}
					if (!expanded && d.results.length > items) {
						lines.push(moreHint(d.results.length - items, "result", theme));
					}
					return lines;
				},
			};
		},
	};
}

