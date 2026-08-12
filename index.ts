/**
 * TinyFish OMP 扩展 — 比 MCP 更好的调用信息。
 *
 * 注册两个原生工具：
 * - `tf_search`：TinyFish 搜索（完整参数面 + 结果卡片渲染）
 * - `tf_fetch`：TinyFish 抓取（批量 + 正文卡片渲染）
 *
 * 与 MCP 版本的区别：
 * - 实时 onUpdate 进度（工具执行中可见，不是干等到结束）
 * - 结果以卡片渲染（标题/站点/日期/摘要/链接），折叠/展开
 * - 调用耗时、结果数、截断状态在渲染中可见
 * - 给模型的 digest 精简（默认 8 条），完整数据在 details 中
 *
 * API key：环境变量 `TINYFISH_API_KEY`（或 `TF_API_KEY`）。
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import { defineFetchTool } from "./fetch-tool";
import { defineSearchTool } from "./search-tool";

export default function (pi: ExtensionAPI): void {
	pi.setLabel("TinyFish");
	pi.registerTool(defineSearchTool(pi));
	pi.registerTool(defineFetchTool(pi));
}
