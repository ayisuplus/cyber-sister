-- 云端切割（2026-09-07）：本地模型面删除，实例级 llama.cpp 配置表作废。
-- 聊天只有一条云端路径（供应商槽 GATEWAY_QWEN_*），配置只来自部署环境，不再落库。
DROP TABLE IF EXISTS "llm_runtime_configs";
