/**
 * TinyFish API client singleton.
 *
 * The API key is read from `TINYFISH_API_KEY` (canonical) or `TF_API_KEY`
 * (alias). A missing key surfaces as a clear tool error instead of a cryptic
 * SDK failure.
 */
import { TinyFish } from "@tiny-fish/sdk";

let client: TinyFish | null = null;

export function getTinyFish(): TinyFish {
	if (client) return client;
	const apiKey = process.env.TINYFISH_API_KEY || process.env.TF_API_KEY || "";
	if (!apiKey) {
		throw new Error(
			"TinyFish API key 未配置：请设置环境变量 TINYFISH_API_KEY（或 TF_API_KEY）后重启 omp 会话。",
		);
	}
	client = new TinyFish({ apiKey, maxRetries: 2, timeout: 60_000 });
	return client;
}

/** Format any thrown error into a one-line user-facing message. */
export function formatTinyFishError(err: unknown): string {
	if (err instanceof Error) {
		const name = err.constructor.name;
		if (name === "RateLimitError") {
			return `TinyFish 限流：${err.message}（稍后重试）`;
		}
		if (name === "AuthenticationError") {
			return `TinyFish 认证失败：${err.message}（检查 TINYFISH_API_KEY）`;
		}
		return `TinyFish ${name}：${err.message}`;
	}
	return `TinyFish 调用失败：${String(err)}`;
}
