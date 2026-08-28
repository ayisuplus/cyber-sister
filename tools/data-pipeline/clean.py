"""
数据清洗模块

对 MediaCrawler 采集的小红书笔记 JSON 数据进行清洗：
- 去重（基于 SimHash / 余弦相似度）
- 过滤低质量内容（长度、语言检测、垃圾内容）
- PII 脱敏（手机号、身份证、银行卡、邮箱、URL）
- 过滤不合规内容（色情、暴力、政治敏感关键词）

Author: software-engineer
Date: 2025-07
"""

import json
import logging
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd
import xxhash
import yaml
from tqdm import tqdm

logger = logging.getLogger(__name__)


def load_config(config_path: str = "config.yaml") -> Dict[str, Any]:
    """加载配置文件中的 clean 部分。

    Args:
        config_path: 配置文件路径

    Returns:
        clean 配置字典
    """
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return config.get("clean", {})


class SimHasher:
    """基于 SimHash 的文本相似度计算，用于去重。"""

    def __init__(self, hash_bits: int = 64) -> None:
        """初始化 SimHasher。

        Args:
            hash_bits: 哈希位数，默认 64 位
        """
        self.hash_bits = hash_bits

    def _string_hash(self, token: str) -> int:
        """将单个 token 哈希为整数。

        Args:
            token: 输入字符串

        Returns:
            哈希整数值
        """
        h = xxhash.xxh64(token.encode("utf-8")).intdigest()
        return h

    def compute(self, text: str, window_size: int = 3) -> int:
        """计算文本的 SimHash 指纹。

        Args:
            text: 输入文本
            window_size: 滑动窗口大小，用于生成 n-gram

        Returns:
            SimHash 指纹（整数）
        """
        if len(text) < window_size:
            return self._string_hash(text)

        # 生成 n-gram
        tokens: List[str] = []
        for i in range(len(text) - window_size + 1):
            tokens.append(text[i : i + window_size])

        # 初始化向量
        v = [0] * self.hash_bits

        for token in tokens:
            h = self._string_hash(token)
            for i in range(self.hash_bits):
                bitmask = 1 << i
                if h & bitmask:
                    v[i] += 1
                else:
                    v[i] -= 1

        # 生成最终指纹
        fingerprint = 0
        for i in range(self.hash_bits):
            if v[i] > 0:
                fingerprint |= 1 << i

        return fingerprint

    @staticmethod
    def hamming_distance(hash1: int, hash2: int) -> int:
        """计算两个哈希值的汉明距离。

        Args:
            hash1: 第一个哈希值
            hash2: 第二个哈希值

        Returns:
            汉明距离
        """
        xor = hash1 ^ hash2
        distance = bin(xor).count("1")
        return distance


class TextCleaner:
    """文本清洗器，负责 PII 脱敏、内容过滤等。"""

    def __init__(self, config: Dict[str, Any]) -> None:
        """初始化文本清洗器。

        Args:
            config: clean 配置字典
        """
        self.min_length: int = config.get("min_length", 50)
        self.max_length: int = config.get("max_length", 5000)
        self.chinese_ratio_min: float = config.get("chinese_ratio_min", 0.3)
        self.sensitive_keywords: List[str] = config.get("sensitive_keywords", [])
        self.spam_keywords: List[str] = config.get("spam_keywords", [])

        # 编译 PII 正则表达式
        # 按模式长度降序排列，确保更长/更精确的模式优先匹配，
        # 避免短模式误匹配长模式的子串（如 phone 匹配 id_card 中的子串）。
        pii_patterns: Dict[str, str] = config.get("pii_patterns", {})
        sorted_pii = sorted(pii_patterns.items(), key=lambda x: len(x[1]), reverse=True)
        self.pii_compiled: Dict[str, re.Pattern] = {}
        for name, pattern in sorted_pii:
            try:
                self.pii_compiled[name] = re.compile(pattern)
            except re.error as e:
                logger.warning("PII 正则编译失败 (%s): %s, 错误: %s", name, pattern, e)

        # 中文字符正则
        self.chinese_char_re = re.compile(r"[\u4e00-\u9fff]")

        # 预编译敏感关键词正则（使用 | 合并提高效率）
        if self.sensitive_keywords:
            escaped = [re.escape(kw) for kw in self.sensitive_keywords]
            self.sensitive_re = re.compile("|".join(escaped))
        else:
            self.sensitive_re = None

        if self.spam_keywords:
            escaped_spam = [re.escape(kw) for kw in self.spam_keywords]
            self.spam_re = re.compile("|".join(escaped_spam))
        else:
            self.spam_re = None

    def mask_pii(self, text: str) -> str:
        """对文本中的 PII 信息进行脱敏。

        Args:
            text: 原始文本

        Returns:
            脱敏后的文本
        """
        result = text
        for name, pattern in self.pii_compiled.items():
            mask_label = f"[{name.upper()}]"
            result = pattern.sub(mask_label, result)
        return result

    def check_length(self, text: str) -> bool:
        """检查文本长度是否在有效范围内。

        Args:
            text: 输入文本

        Returns:
            True 表示长度合格
        """
        length = len(text.strip())
        return self.min_length <= length <= self.max_length

    def check_chinese_ratio(self, text: str) -> bool:
        """检查中文字符占比是否满足最低要求。

        Args:
            text: 输入文本

        Returns:
            True 表示中文占比合格
        """
        if not text:
            return False
        chinese_count = len(self.chinese_char_re.findall(text))
        ratio = chinese_count / len(text)
        return ratio >= self.chinese_ratio_min

    def check_sensitive(self, text: str) -> bool:
        """检查文本是否包含敏感关键词。

        Args:
            text: 输入文本

        Returns:
            True 表示文本不含敏感关键词（通过检查）
        """
        if self.sensitive_re is None:
            return True
        return not self.sensitive_re.search(text)

    def check_spam(self, text: str) -> bool:
        """检查文本是否包含垃圾内容特征。

        Args:
            text: 输入文本

        Returns:
            True 表示文本非垃圾内容（通过检查）
        """
        if self.spam_re is None:
            return True
        return not self.spam_re.search(text)


def extract_text(note: Dict[str, Any]) -> str:
    """从笔记数据中提取用于清洗的文本内容。

    尝试多种字段名以兼容不同采集格式。

    Args:
        note: 单条笔记数据字典

    Returns:
        提取的文本内容
    """
    # 优先级：content > text > desc > title + content
    for field in ("content", "text", "desc"):
        val = note.get(field)
        if val and isinstance(val, str):
            return val.strip()

    # 尝试 title + 其他内容拼接
    title = note.get("title", "")
    body = note.get("note_content", "") or note.get("note_text", "")
    combined = f"{title} {body}".strip()
    if combined:
        return combined

    return ""


def deduplicate(
    notes: List[Dict[str, Any]],
    threshold: float = 0.85,
    simhash_distance: int = 3,
) -> List[Dict[str, Any]]:
    """对笔记列表进行去重。

    使用两阶段策略：
    1. 精确哈希去重（完全相同的内容）
    2. SimHash 近似去重（相似内容）

    Args:
        notes: 笔记数据列表
        threshold: 相似度阈值（保留供未来扩展，当前基于汉明距离）
        simhash_distance: SimHash 汉明距离阈值

        Returns:
            去重后的笔记列表
    """
    hasher = SimHasher()
    seen_exact: Set[int] = set()
    seen_fingerprints: List[Tuple[int, int]] = []  # (index, fingerprint)
    result: List[Dict[str, Any]] = []

    logger.info("开始去重，原始样本数: %d", len(notes))

    exact_removed = 0
    similar_removed = 0

    for idx, note in enumerate(tqdm(notes, desc="去重处理", unit="条")):
        text = extract_text(note)
        if not text:
            continue

        # 第一阶段：精确哈希去重
        exact_hash = xxhash.xxh64(text.encode("utf-8")).intdigest()
        if exact_hash in seen_exact:
            exact_removed += 1
            continue

        # 第二阶段：SimHash 近似去重
        fingerprint = hasher.compute(text)
        is_similar = False
        for _, existing_fp in seen_fingerprints:
            if hasher.hamming_distance(fingerprint, existing_fp) <= simhash_distance:
                is_similar = True
                similar_removed += 1
                break

        if is_similar:
            continue

        # 通过去重，记录
        seen_exact.add(exact_hash)
        seen_fingerprints.append((idx, fingerprint))
        result.append(note)

    logger.info(
        "去重完成: 精确去重 %d 条, 近似去重 %d 条, 保留 %d 条",
        exact_removed,
        similar_removed,
        len(result),
    )
    return result


def clean_pipeline(
    input_path: str,
    output_path: str,
    config_path: str = "config.yaml",
) -> List[Dict[str, Any]]:
    """执行完整的数据清洗流水线。

    Args:
        input_path: 输入 JSON 文件路径（可以是文件或目录）
        output_path: 输出清洗后 JSON 文件路径
        config_path: 配置文件路径

    Returns:
        清洗后的笔记列表
    """
    config = load_config(config_path)
    cleaner = TextCleaner(config)

    # 读取输入数据
    input_file = Path(input_path)
    raw_notes: List[Dict[str, Any]] = []

    if input_file.is_dir():
        json_files = sorted(input_file.glob("*.json"))
        logger.info("发现 %d 个 JSON 文件", len(json_files))
        for jf in json_files:
            try:
                with open(jf, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, list):
                    raw_notes.extend(data)
                elif isinstance(data, dict):
                    raw_notes.append(data)
            except (json.JSONDecodeError, IOError) as e:
                logger.warning("读取文件失败 %s: %s", jf, e)
    elif input_file.is_file():
        with open(input_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            raw_notes = data
        elif isinstance(data, dict):
            raw_notes = [data]
    else:
        logger.error("输入路径不存在: %s", input_path)
        sys.exit(1)

    logger.info("共加载 %d 条原始笔记", len(raw_notes))

    # Step 1: 去重
    dedup_threshold = config.get("dedup_threshold", 0.85)
    simhash_distance = config.get("simhash_distance", 3)
    deduped_notes = deduplicate(raw_notes, dedup_threshold, simhash_distance)

    # Step 2: 内容过滤与脱敏
    cleaned_notes: List[Dict[str, Any]] = []
    filter_stats = {
        "length_fail": 0,
        "chinese_fail": 0,
        "sensitive_fail": 0,
        "spam_fail": 0,
        "empty_content": 0,
    }

    for note in tqdm(deduped_notes, desc="内容清洗", unit="条"):
        text = extract_text(note)

        # 空内容过滤
        if not text:
            filter_stats["empty_content"] += 1
            continue

        # 长度过滤
        if not cleaner.check_length(text):
            filter_stats["length_fail"] += 1
            continue

        # 中文占比过滤
        if not cleaner.check_chinese_ratio(text):
            filter_stats["chinese_fail"] += 1
            continue

        # 敏感词过滤
        if not cleaner.check_sensitive(text):
            filter_stats["sensitive_fail"] += 1
            continue

        # 垃圾内容过滤
        if not cleaner.check_spam(text):
            filter_stats["spam_fail"] += 1
            continue

        # PII 脱敏
        cleaned_note = dict(note)
        for key in ("content", "text", "desc", "title", "note_content", "note_text"):
            if key in cleaned_note and isinstance(cleaned_note[key], str):
                cleaned_note[key] = cleaner.mask_pii(cleaned_note[key])

        # 标记已清洗
        cleaned_note["_cleaned"] = True
        cleaned_notes.append(cleaned_note)

    logger.info("过滤统计: %s", filter_stats)
    logger.info("清洗完成，保留 %d 条有效笔记", len(cleaned_notes))

    # 输出结果
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(cleaned_notes, f, ensure_ascii=False, indent=2)

    logger.info("清洗结果已保存至: %s", output_path)
    return cleaned_notes


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    if len(sys.argv) < 3:
        print("用法: python clean.py <输入JSON路径> <输出JSON路径> [配置文件路径]")
        sys.exit(1)

    in_path = sys.argv[1]
    out_path = sys.argv[2]
    cfg_path = sys.argv[3] if len(sys.argv) > 3 else "config.yaml"

    clean_pipeline(in_path, out_path, cfg_path)
