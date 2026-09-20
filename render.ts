/**
 * Compact tree-style helpers for the TinyFish tool renderers.
 *
 * Design mirrors the built-in `web_search` renderer: ONE block per tool call
 * (header + tree rows), NOT one card per result. Collapsed = one row per
 * item; expanded = a few rows per item. Long bodies (fetch) are NEVER shown
 * in full — a short preview with a "N more" hint, like `read`.
 *
 * `renderCall`/`renderResult` return a pi-tui `Component`, which is a
 * duck-typed `{ render(width: number): string[] }` — plain objects stay the
 * contract. The one host import is the frame MARK: `framedTree` flags the
 * component via `markFramedBlockComponent`, a module-private symbol on the
 * host's pi-tui copy, so omp stops padding the block by a column and painting
 * its own state tint and renders our rows as-is. That symbol cannot be
 * duck-typed; omp rewrites `@oh-my-pi/pi-tui/*` imports in extension sources
 * onto its own in-process copy, so this import reaches the same instance
 * `ToolExecutionComponent` checks.
 */

/**
 * Mark a component as owning its frame: the host then renders these rows
 * flush instead of padding the block and tinting it by tool state.
 *
 * Borderless on purpose — this extension draws a tree, not a card, so the
 * rows the caller returns are the whole block.
 */
export { markFramedBlockComponent as framedTree } from "@oh-my-pi/pi-tui/render";

/** Max items shown per tool result before "N more" (PREVIEW_LIMITS.COLLAPSED_ITEMS = 8). */
export const MAX_COLLAPSED_ITEMS = 8;
/** Body preview lines per item when expanded (PREVIEW_LIMITS.EXPANDED_LINES = 12). */
export const MAX_EXPANDED_BODY_LINES = 12;

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Minimal shape of the host Theme as used here. */
export interface RenderTheme {
	fg(color: string, text: string): string;
	bold?(text: string): string;
	status?: {
		success?: string;
		error?: string;
		warning?: string;
		info?: string;
		pending?: string;
		running?: string;
	};
	tree?: { branch?: string; last?: string; vertical?: string; horizontal?: string };
	sep?: { dot?: string; slash?: string; pipe?: string };
}

/** Duck-typed pi-tui Component. */
export interface Component {
	render(width: number): string[];
}

export function textComponent(lines: string[]): Component {
	return { render: () => lines };
}

/**
 * Strip ANSI escape and control sequences before terminal rendering.
 * Third-party page content (fetch bodies, search snippets, URLs) can carry
 * escape sequences that would otherwise execute in the user's terminal —
 * cursor moves, OSC 8 hyperlinks, title changes (CWE-1174 terminal escape
 * injection). Applied at the render entry point so every TUI path is covered.
 */
export function stripAnsi(text: string): string {
	return text.replace(
		/\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-9A-Z]|[@-Z\\-_])|\x9b[0-9;?]*[ -/]*[@-~]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
		"",
	);
}

/** ANSI-aware width truncation fallback (kept dependency-free). */
export function clip(line: string, width: number): string {
	if (width <= 0) return "";
	const text = stripAnsi(line);
	let visible = 0;
	let out = "";
	for (const ch of text) {
		const w = ch.charCodeAt(0) > 0xff ? 2 : 1;
		if (visible + w > width) return `${out}…`;
		out += ch;
		visible += w;
	}
	return out;
}

export interface StatusLineOptions {
	icon?: "pending" | "running" | "success" | "error" | "warning" | "info";
	iconOverride?: string;
	spinnerFrame?: number;
	title: string;
	titleColor?: string;
	description?: string;
	meta?: string[];
}

/** Standardized status line for renderCall/renderResult header. */
export function statusLine(opts: StatusLineOptions, theme: RenderTheme): string {
	let iconStr = "";
	if (opts.iconOverride) {
		iconStr = opts.iconOverride;
	} else if (opts.spinnerFrame !== undefined) {
		const frame = SPINNER_FRAMES[Math.abs(opts.spinnerFrame) % SPINNER_FRAMES.length];
		iconStr = theme.fg("accent", frame);
	} else if (opts.icon === "success") {
		const sym = theme.status?.success ?? "✓";
		iconStr = theme.fg("success", sym);
	} else if (opts.icon === "error") {
		const sym = theme.status?.error ?? "✕";
		iconStr = theme.fg("error", sym);
	} else if (opts.icon === "warning") {
		const sym = theme.status?.warning ?? "⚠";
		iconStr = theme.fg("warning", sym);
	} else if (opts.icon === "running") {
		const sym = theme.status?.running ?? "⠋";
		iconStr = theme.fg("accent", sym);
	} else if (opts.icon === "pending") {
		const sym = theme.status?.pending ?? "…";
		iconStr = theme.fg("dim", sym);
	}

	const titleColor = opts.titleColor ?? "accent";
	const titleText = theme.fg(titleColor, opts.title);
	let line = iconStr ? `${iconStr} ${titleText}` : titleText;

	if (opts.description) {
		line += `: ${theme.fg("muted", opts.description)}`;
	}

	const meta = opts.meta?.filter(Boolean) ?? [];
	if (meta.length > 0) {
		const dot = theme.sep?.dot ?? "·";
		line += ` ${theme.fg("dim", meta.join(` ${dot} `))}`;
	}

	return line;
}

const glyph = (theme: RenderTheme, isLast: boolean): string => {
	const t = theme.tree;
	return isLast ? (t?.last ?? "└─") : (t?.branch ?? "├─");
};

/** One tree row: `  glyph text` with the glyph dimmed. */
export function treeRow(text: string, theme: RenderTheme, isLast = false, maxWidth = 80): string {
	return ` ${theme.fg("dim", glyph(theme, isLast))} ${clip(text, maxWidth)}`;
}

/** Indented detail row under a tree item (spacer keeps the branch column). */
export function detailRow(text: string, theme: RenderTheme, indent = 3, maxWidth = 77): string {
	return `${" ".repeat(indent)}${theme.fg("dim", clip(text, maxWidth))}`;
}

/** "N more" footer hint. */
export function moreHint(count: number, what: string, theme: RenderTheme): string {
	return theme.fg("dim", `… ${count} more ${what} (ctrl+o 展开)`);
}

/** Extract a displayable domain from a URL. */
export function hostOf(url: string): string {
	try {
		const u = new URL(url);
		return u.hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

/** Collapse a long body into at most `maxLines` clipped lines + "N more". */
export function previewLines(
	body: string[],
	maxLines: number,
	theme: RenderTheme,
	width: number,
): string[] {
	const shown: string[] = [];
	const maxLineWidth = Math.max(20, width - 6);
	for (const line of body) {
		if (shown.length >= maxLines) break;
		shown.push(theme.fg("toolOutput", clip(line, maxLineWidth)));
	}
	const remaining = body.length - shown.length;
	if (remaining > 0) shown.push(moreHint(remaining, "line", theme));
	return shown;
}
