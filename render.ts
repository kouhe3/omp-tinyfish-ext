/**
 * Zero-dependency TUI rendering helpers — compact tree style.
 *
 * Design mirrors the built-in `web_search` renderer: ONE block per tool call
 * (header + tree rows), NOT one card per result. Collapsed = one row per
 * item; expanded = a few rows per item. Long bodies (fetch) are NEVER shown
 * in full — a short preview with a "N more" hint, like `read`.
 *
 * `renderCall`/`renderResult` must return a pi-tui `Component`, which is a
 * duck-typed `{ render(width: number): string[] }`. We deliberately do NOT
 * import `@oh-my-pi/pi-tui`: the host runs its own bundled copy, and a second
 * copy from the extension's node_modules would make `instanceof` checks (and
 * any hidden class identity) diverge. A plain object with a `render` method
 * is the stable contract.
 */

/** Max items shown per tool result before "N more" (PREVIEW_LIMITS.COLLAPSED_ITEMS = 8). */
export const MAX_COLLAPSED_ITEMS = 8;
/** Body preview lines per item when expanded (PREVIEW_LIMITS.EXPANDED_LINES = 12). */
export const MAX_EXPANDED_BODY_LINES = 12;

/** Minimal shape of the host Theme as used here. */
export interface RenderTheme {
	fg(color: string, text: string): string;
	/** Tree glyphs — optional so a minimal theme still works. */
	tree?: { branch?: string; last?: string };
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

/** Status line for renderCall/renderResult header. */
export function statusLine(icon: string, title: string, description: string, theme: RenderTheme): string {
	const left = `${theme.fg("dim", "‹")} ${icon} ${theme.fg("accent", title)}`;
	const right = description ? theme.fg("dim", description) : "";
	return right ? `${left} ${right}` : left;
}

const glyph = (theme: RenderTheme, isLast: boolean): string => {
	const t = theme.tree;
	return isLast ? (t?.last ?? "└─") : (t?.branch ?? "├─");
};

/** One tree row: `  glyph text` with the glyph dimmed. */
export function treeRow(text: string, theme: RenderTheme, isLast = false): string {
	return ` ${theme.fg("dim", glyph(theme, isLast))} ${clip(text, 80)}`;
}

/** Indented detail row under a tree item (spacer keeps the branch column). */
export function detailRow(text: string, theme: RenderTheme, indent = 3): string {
	return `${" ".repeat(indent)}${theme.fg("dim", clip(text, 77))}`;
}

/** "N more" footer hint, matching formatMoreItems style. */
export function moreHint(count: number, what: string, theme: RenderTheme): string {
	return theme.fg("dim", `… ${count} more ${what}（Enter 展开）`);
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
	for (const line of body) {
		if (shown.length >= maxLines) break;
		shown.push(theme.fg("toolOutput", clip(line, width - 6)));
	}
	const remaining = body.length - shown.length;
	if (remaining > 0) shown.push(moreHint(remaining, "line", theme));
	return shown;
}
