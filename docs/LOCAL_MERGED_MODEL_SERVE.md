# 本机 `local-ai-serve/merged` 推理 + 已部署网站公网访问

仓库内 `local-ai-serve/` 默认被 `.gitignore` 忽略（模型体积大）。本文说明如何把 **本机 merged 模型** 接到 **已有 downAiGC 后端** 的 `REMOTE_INFERENCE_URL` 流程。

## 架构

1. **本机**：`local-ai-serve/openai_compatible_server.py` 监听 `127.0.0.1:8010`，提供 `POST /v1/chat/completions`（与 `backend/main.py` 中 `_remote_chat_sync` 一致）。
2. **隧道**：`cloudflared tunnel --url http://127.0.0.1:8010`（或其它）把公网 HTTPS 转发到本机。
3. **线上后端**：`.env` 里配置 `REMOTE_INFERENCE_URL` 指向隧道完整 URL（含 `/v1/chat/completions`），`REMOTE_INFERENCE_API_KEY` 与本机 `INFERENCE_API_KEY` 相同。

这样 **浏览器用户不直连推理**；只有你的后端带密钥访问隧道，等价于「推理能力只给你的站用」。

## 与本仓库的衔接

- 后端环境变量说明见 `backend/.env.example` 中 `REMOTE_INFERENCE_*`。
- 详细步骤、可选 `ALLOWED_INFERENCE_HOSTS`、**无量化 FP16 混合（`HYBRID_PRESET=8g32g` / `run-hybrid-fp16-8g32g.ps1`）与量化备选** 见 **`local-ai-serve/README.md`** §7。

## 安全清单

- 必须设置足够长的 **`INFERENCE_API_KEY`**，且仅出现在服务器 `.env` 与本机运行环境。
- 不要把隧道 URL 写进前端代码或公开仓库。
- 本机关机或断网后，线上润色/降重会失败，需有心理预期或备用 `REMOTE_INFERENCE_URL`。
