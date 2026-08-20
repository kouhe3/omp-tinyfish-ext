/**
 * `tf_fetch` — TinyFish Fetch as a first-class OMP tool.
 *
 * Fetches one or more URLs and returns clean extracted content. The model
 * gets a per-URL digest (title / description / truncated body / canonical
 * link); the full response rides in `details` and renders as cards.
 */
import { type FetchResponse } from "@tiny-fish/sdk";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import { getTinyFish, formatTinyFishError } from "./client";
import {
	MAX_COLLAPSED_ITEMS,
	MAX_EXPANDED_BODY_LINES,
	clip,
	detailRow,
	hostOf,
	moreHint,
	previewLines,
	statusLine,
	stripAnsi,
	treeRow,
	type Component,
	type RenderTheme,
} from "./render";

const DEFAULT_MAX_TEXT_CHARS = 6_000;
const MAX_TOTAL_TEXT_CHARS = 40_000;

interface FetchParams {
	urls: string[];
	purpose?: string;
	format?: "markdown" | "html" | "json";
	links?: boolean;
	image_links?: boolean;
	ttl?: number;
	per_url_timeout_ms?: number;
	max_text_chars?: number;
}

export interface FetchDetails {
	latency_ms: number;
	results: FetchResponse["results"];
	errors: FetchResponse["errors"];
	chars: number[];
}

interface FetchApi {
	fetch: { getContents(p: FetchParams): Promise<FetchResponse> };
}

/** Per-URL digest for the model. */
export function buildFetchDigest(
	res: FetchResponse,
	maxTextChars: number,
	latencyMs: number,
): string {
	const blocks = res.results.map((r, i) => {
		const head = r.title ? `[${i + 1}] ${r.title}` : `[${i + 1}] ${r.url}`;
		const meta = [r.description, r.author, r.published_date].filter(Boolean).join(" · ");
		const text = typeof r.text === "string" ? r.text : JSON.stringify(r.text ?? "");
		const body = text.length > maxTextChars ? `${text.slice(0, maxTextChars)}…（已截断）` : text;
		const links = r.links?.length ? `\n链接：${r.links.slice(0, 10).join(" · ")}${r.links.length > 10 ? ` …（共 ${r.links.length} 个）` : ""}` : "";
		const imgs = r.image_links?.length ? `\n图片：${r.image_links.slice(0, 5).join(" · ")}${r.image_links.length > 5 ? ` …（共 ${r.image_links.length} 个）` : ""}` : "";
		return `${head}${meta ? `\n${meta}` : ""}\n来源：${r.final_url ?? r.url}\n\n${body}${links}${imgs}`;
	});
	const errs = res.errors.map(e => `失败：${e.url} — ${e.error}`);
	const footer = `共 ${res.results.length} 个 URL 抓取成功，${res.errors.length} 个失败（耗时 ${latencyMs}ms）`;
	// stripAnsi: third-party page bodies/titles/links must not carry escape
	// sequences into the model context or downstream rendering.
	return stripAnsi([...blocks, ...errs, "", footer].join("\n\n"));
}

/** Core execute body — split out for smoke tests. */
export async function runFetch(
	params: FetchParams,
	api: FetchApi,
	onUpdate?: (update: { content: Array<{ type: "text"; text: string }> }) => void,
	signal?: AbortSignal,
): Promise<{ text: string; details: FetchDetails; isError?: boolean }> {
	const started = Date.now();
	const n = params.urls.length;
	onUpdate?.({ content: [{ type: "text", text: `[tf] 正在抓取 ${n} 个 URL…` }] });
	if (signal?.aborted) return { text: "已取消", details: emptyDetails() };

	// `max_text_chars` is a local digest cap — the SDK schema is strict and
	// rejects unknown keys, so it must not reach the wire.
	const { max_text_chars: _maxTextChars, ...apiParams } = params;
	let res: FetchResponse;
	try {
		res = await api.fetch.getContents(apiParams);
	} catch (err) {
		return { text: formatTinyFishError(err), details: emptyDetails(), isError: true };
	}
	if (signal?.aborted) return { text: "已取消", details: emptyDetails() };

	const latencyMs = Date.now() - started;
	const budget = Math.max(1, params.max_text_chars ?? DEFAULT_MAX_TEXT_CHARS);
	const perUrl = Math.max(200, Math.min(budget, Math.floor(MAX_TOTAL_TEXT_CHARS / Math.max(1, n))));
	const chars = res.results.map(r => (typeof r.text === "string" ? r.text.length : 0));
	return {
		text: buildFetchDigest(res, perUrl, latencyMs),
		details: { latency_ms: latencyMs, results: res.results, errors: res.errors, chars },
	};
}

function emptyDetails(): FetchDetails {
	return { latency_ms: 0, results: [], errors: [], chars: [] };
}

function fetchTree(
	r: FetchResponse["results"][number],
	index: number,
	theme: RenderTheme,
	width: number,
	expanded: boolean,
	isLast: boolean,
): string[] {
	const maxRowWidth = Math.max(30, (width || 80) - 4);
	const maxDetailWidth = Math.max(26, (width || 80) - 6);
	const title = `${index + 1}. ${r.title ?? hostOf(r.final_url ?? r.url)}`;
	if (!expanded) {
		return [treeRow(`${title} — ${hostOf(r.final_url ?? r.url)}`, theme, isLast, maxRowWidth)];
	}
	const meta = [r.language, r.author, r.published_date, r.latency_ms != null ? `${Math.round(r.latency_ms)}ms` : undefined]
		.filter((v): v is string => Boolean(v));
	const text = typeof r.text === "string" ? r.text : JSON.stringify(r.text ?? "");
	const body = text.split("\n").filter(line => line.trim());
	const lines = [treeRow(title, theme, false, maxRowWidth)];
	if (r.description) lines.push(detailRow(r.description, theme, 3, maxDetailWidth));
	if (meta.length > 0) lines.push(detailRow(meta.join(" · "), theme, 3, maxDetailWidth));
	if (body.length > 0) lines.push(...previewLines(body, MAX_EXPANDED_BODY_LINES, theme, width));
	if (r.links?.length) lines.push(detailRow(theme.fg("dim", `链接 ${r.links.length} 个：${clip(r.links.join(" · "), maxDetailWidth)}`), theme, 3, maxDetailWidth));
	if (r.image_links?.length) lines.push(detailRow(theme.fg("dim", `图片 ${r.image_links.length} 个：${clip(r.image_links.join(" · "), maxDetailWidth)}`), theme, 3, maxDetailWidth));
	lines.push(detailRow(theme.fg("dim", r.final_url ?? r.url), theme, 3, maxDetailWidth));
	return lines;
}

export function defineFetchTool(pi: ExtensionAPI) {
	const z = pi.zod;
	return {
		name: "tf_fetch",
		label: "TinyFish Fetch",
		description:
			"TinyFish 网页抓取：提取干净的正文内容（markdown），支持批量 URL、缓存 TTL、每 URL 超时、ETag 校验。比 MCP fetch 信息更全：返回标题/作者/发布日期/语言/最终 URL/耗时，卡片渲染正文预览。",
		mergeCallAndResult: true,
		parameters: z.object({
			urls: z.array(z.string()).min(1).max(10).describe("要抓取的 URL 列表（1-10 个）"),
			purpose: z.string().optional().describe("为什么抓取（目标/用途）"),
			format: z.enum(["markdown", "html", "json"]).optional().describe("输出格式，默认 markdown"),
			links: z.boolean().optional().describe("是否返回页面内链接列表"),
			image_links: z.boolean().optional().describe("是否返回页面内图片链接列表"),
			ttl: z.number().optional().describe("缓存容忍秒数；0 = 强制实时抓取"),
			per_url_timeout_ms: z.number().optional().describe("每个 URL 的独立超时（毫秒）"),
			max_text_chars: z
				.number()
				.optional()
				.describe(`返回给模型的单 URL 正文上限（默认 ${DEFAULT_MAX_TEXT_CHARS}）`),
		}),
		async execute(
			_toolCallId: string,
			params: FetchParams,
			signal: AbortSignal | undefined,
			onUpdate: ((update: { content: Array<{ type: "text"; text: string }> }) => void) | undefined,
			_ctx: unknown,
		) {
			const client = getTinyFish();
			const out = await runFetch(params, client, onUpdate, signal);
			const content: Array<{ type: "text"; text: string }> = [{ type: "text", text: out.text }];
			return { content, details: out.details, isError: out.isError };
		},
		renderCall(args: FetchParams, options: { spinnerFrame?: number }, theme: RenderTheme): Component {
			const count = args?.urls?.length ?? 0;
			const desc = count === 1 && args?.urls?.[0] ? clip(args.urls[0], 80) : `${count} 个 URL`;
			return {
				render: () => [
					statusLine(
						{
							icon: "pending",
							spinnerFrame: options.spinnerFrame,
							title: "Fetch",
							description: desc,
						},
						theme,
					),
				],
			};
		},
		renderResult(
			result: { content?: Array<{ type: string; text?: string }>; details?: FetchDetails; isError?: boolean },
			options: { expanded?: boolean; isPartial?: boolean; spinnerFrame?: number },
			theme: RenderTheme,
			args?: FetchParams,
		): Component {
			const count = args?.urls?.length ?? result.details?.results.length ?? 0;
			const desc = count === 1 && args?.urls?.[0] ? clip(args.urls[0], 80) : `${count} 个 URL`;

			if (result.isError) {
				return {
					render: () => [
						statusLine(
							{
								icon: "error",
								title: "Fetch",
								description: desc,
								meta: ["抓取失败"],
							},
							theme,
						),
					],
				};
			}

			const d = result.details;
			if (!d) {
				// Partial / pending update during execution (e.g. onUpdate fired before response arrived).
				// Keep the in-flight status line with spinner rather than showing "无内容".
				return {
					render: () => [
						statusLine(
							{
								icon: "pending",
								spinnerFrame: options.spinnerFrame,
								title: "Fetch",
								description: desc,
							},
							theme,
						),
					],
				};
			}
			if (d.results.length === 0 && d.errors.length === 0) {
				return {
					render: () => [
						statusLine(
							{
								icon: "warning",
								title: "Fetch",
								description: desc,
								meta: ["无内容", `${d.latency_ms}ms`],
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
					const meta: string[] = [];
					if (d.results.length > 0) meta.push(`成功 ${d.results.length}`);
					if (d.errors.length > 0) meta.push(`失败 ${d.errors.length}`);
					meta.push(`${d.latency_ms}ms`);

					const icon =
						d.errors.length > 0 && d.results.length === 0
							? "error"
							: d.errors.length > 0
								? "warning"
								: "success";

					lines.push(
						statusLine(
							{
								icon,
								title: "Fetch",
								description: desc,
								meta,
							},
							theme,
						),
					);
					const items = expanded ? d.results.length : Math.min(d.results.length, MAX_COLLAPSED_ITEMS);
					for (let i = 0; i < items; i++) {
						lines.push(...fetchTree(d.results[i], i, theme, width, expanded, i === items - 1 && d.errors.length === 0));
					}
					if (!expanded && d.results.length > items) {
						lines.push(moreHint(d.results.length - items, "URL", theme));
					}
					const maxErrWidth = Math.max(30, (width || 80) - 6);
					for (const e of d.errors) {
						lines.push(theme.fg("error", ` ✕ ${clip(e.url, maxErrWidth)} — ${e.error}`));
					}
					return lines;
				},
			};
		},
	};
}
