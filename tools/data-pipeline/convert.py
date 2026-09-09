"""
格式转换模块

将清洗后的小红书笔记 JSON 数据转换为 QLoRA / DPO 训练格式：
- QLoRA: instruction/input/output 格式
- DPO:   prompt/chosen/rejected 偏好对格式
- 支持输出 JSONL 和 Parquet 格式

Author: software-engineer
Date: 2025-07
"""

import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import yaml
from tqdm import tqdm

logger = logging.getLogger(__name__)


def load_config(config_path: str = "config.yaml") -> Dict[str, Any]:
    """加载配置文件中的 convert 部分。

    Args:
        config_path: 配置文件路径

    Returns:
        convert 配置字典
    """
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return config.get("convert", {})


def extract_note_content(note: Dict[str, Any]) -> str:
    """从笔记中提取主文本内容（与 clean.py 保持一致）。

    Args:
        note: 笔记数据字典

    Returns:
        文本内容
    """
    for field in ("content", "text", "desc"):
        val = note.get(field)
        if val and isinstance(val, str):
            return val.strip()

    title = note.get("title", "")
    body = note.get("note_content", "") or note.get("note_text", "")
    combined = f"{title} {body}".strip()
    return combined


def extract_topic(note: Dict[str, Any]) -> str:
    """从笔记中提取话题/主题。

    Args:
        note: 笔记数据字典

        Returns:
            话题文本
    """
    # 尝试从 tag_list 或 topics 提取
    tags = note.get("tag_list") or note.get("topics") or note.get("tags")
    if tags and isinstance(tags, list) and len(tags) > 0:
        return "、".join(str(t) for t in tags[:5])

    # 使用标题作为话题
    title = note.get("title", "")
    if title:
        return title.strip()

    # 截取内容前 100 字作为话题
    content = extract_note_content(note)
    if content:
        return content[:100].strip()

    return "日常分享"


def generate_qlora_samples(
    notes: List[Dict[str, Any]],
    config: Dict[str, Any],
) -> List[Dict[str, str]]:
    """将笔记转换为 QLoRA 训练格式。

    每条笔记生成一条 instruction/input/output 训练样本。

    Args:
        notes: 清洗后的笔记列表
        config: convert 配置字典

    Returns:
        QLoRA 格式样本列表
    """
    template = config.get("qlora_template", {})
    instruction = template.get("instruction", "作为闺蜜，请回应以下话题")
    system_prompt = template.get("system_prompt", "你是Amie，一个温暖、贴心的AI闺蜜。")

    samples: List[Dict[str, str]] = []

    for note in tqdm(notes, desc="转换 QLoRA 格式", unit="条"):
        content = extract_note_content(note)
        if not content:
            continue

        topic = extract_topic(note)

        # 如果笔记已有回复（评论数据），用作 output；否则留空待 LLM 生成
        existing_reply = note.get("top_comment") or note.get("reply") or ""

        sample = {
            "instruction": instruction,
            "input": f"话题：{topic}\n内容：{content}",
            "output": existing_reply if existing_reply else "",
            "system": system_prompt,
        }
        samples.append(sample)

    logger.info("生成 %d 条 QLoRA 样本", len(samples))
    return samples


def generate_dpo_pairs(
    notes: List[Dict[str, Any]],
    config: Dict[str, Any],
) -> List[Dict[str, str]]:
    """将笔记转换为 DPO 偏好对格式。

    每条笔记生成一条 prompt/chosen/rejected 偏好对。
    chosen 和 rejected 回复通过 LLM 辅助生成（当前预留接口）。

    Args:
        notes: 清洗后的笔记列表
        config: convert 配置字典

    Returns:
        DPO 偏好对列表
    """
    dpo_template = config.get("dpo_template", {})
    system_prompt = dpo_template.get(
        "system_prompt",
        "你是Amie，一个温暖、贴心的AI闺蜜。请生成温暖、共情的回复。",
    )
    chosen_style = dpo_template.get("chosen_style", "温暖、共情、真诚、有帮助")
    rejected_style = dpo_template.get("rejected_style", "冷漠、敷衍、不相关、机械化")

    pairs: List[Dict[str, str]] = []

    for note in tqdm(notes, desc="转换 DPO 格式", unit="条"):
        content = extract_note_content(note)
        if not content:
            continue

        topic = extract_topic(note)
        prompt_text = f"话题：{topic}\n内容：{content}"

        # LLM 辅助生成 chosen/rejected 回复（预留接口）
        # 当前使用占位符，实际部署时替换为 LLM 调用
        chosen_reply = _generate_reply_placeholder(
            content, topic, style=chosen_style, is_chosen=True
        )
        rejected_reply = _generate_reply_placeholder(
            content, topic, style=rejected_style, is_chosen=False
        )

        pair = {
            "prompt": prompt_text,
            "chosen": chosen_reply,
            "rejected": rejected_reply,
            "system": system_prompt,
        }
        pairs.append(pair)

    logger.info("生成 %d 条 DPO 偏好对", len(pairs))
    return pairs


def _generate_reply_placeholder(
    content: str,
    topic: str,
    style: str = "温暖、共情",
    is_chosen: bool = True,
) -> str:
    """LLM 回复生成占位函数。

    实际部署时替换为调用 Qwen / OpenAI API 生成回复。
    当前返回模板占位文本。

    Args:
        content: 笔记内容
        topic: 话题
        style: 回复风格描述
        is_chosen: 是否为优选回复

    Returns:
        生成的回复文本（当前为占位符）
    """
    # TODO: 实际部署时替换为 LLM API 调用
    # 示例: response = llm_client.generate(prompt=..., system_prompt=...)
    if is_chosen:
        return f"[CHOSEN_REPLY_PLACEHOLDER] 话题：{topic[:30]}..."
    return f"[REJECTED_REPLY_PLACEHOLDER] 话题：{topic[:30]}..."


def save_jsonl(data: List[Dict[str, Any]], output_path: str) -> None:
    """将数据保存为 JSONL 格式。

    Args:
        data: 数据列表
        output_path: 输出文件路径
    """
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, "w", encoding="utf-8") as f:
        for item in data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    logger.info("JSONL 已保存至: %s (共 %d 条)", output_path, len(data))


def save_parquet(data: List[Dict[str, Any]], output_path: str) -> None:
    """将数据保存为 Parquet 格式。

    Args:
        data: 数据列表
        output_path: 输出文件路径
    """
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    df = pd.DataFrame(data)
    df.to_parquet(output_file, index=False, engine="pyarrow")

    logger.info("Parquet 已保存至: %s (共 %d 条)", output_path, len(data))


def convert_pipeline(
    input_path: str,
    output_dir: str,
    output_format: str = "jsonl",
    config_path: str = "config.yaml",
) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    """执行完整的格式转换流水线。

    Args:
        input_path: 清洗后的 JSON 文件路径
        output_dir: 输出目录
        output_format: 输出格式 (jsonl / parquet)
        config_path: 配置文件路径

    Returns:
        (qlora_samples, dpo_pairs) 元组
    """
    config = load_config(config_path)

    # 读取清洗后的数据
    with open(input_path, "r", encoding="utf-8") as f:
        notes = json.load(f)

    if not isinstance(notes, list):
        notes = [notes]

    logger.info("加载 %d 条清洗后笔记", len(notes))

    # 生成 QLoRA 格式
    qlora_samples = generate_qlora_samples(notes, config)

    # 生成 DPO 偏好对
    dpo_pairs = generate_dpo_pairs(notes, config)

    # 保存文件
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    save_fn = save_parquet if output_format == "parquet" else save_jsonl
    ext = ".parquet" if output_format == "parquet" else ".jsonl"

    qlora_output = str(output_path / f"qlora_train{ext}")
    dpo_output = str(output_path / f"dpo_train{ext}")

    save_fn(qlora_samples, qlora_output)
    save_fn(dpo_pairs, dpo_output)

    logger.info("格式转换完成")
    return qlora_samples, dpo_pairs


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    if len(sys.argv) < 3:
        print("用法: python convert.py <输入JSON路径> <输出目录> [jsonl|parquet] [配置文件路径]")
        sys.exit(1)

    in_path = sys.argv[1]
    out_dir = sys.argv[2]
    fmt = sys.argv[3] if len(sys.argv) > 3 else "jsonl"
    cfg_path = sys.argv[4] if len(sys.argv) > 4 else "config.yaml"

    convert_pipeline(in_path, out_dir, fmt, cfg_path)
