"""
数据质量评估模块

对预处理后的数据集进行质量评估：
- 统计分析：样本数量、平均长度、长度分布
- 多样性分析：话题覆盖度、词汇丰富度（TTR、MTLD）
- 质量评分：可读性、信息密度、情感丰富度
- 生成 Markdown 格式质量报告

Author: software-engineer
Date: 2025-07
"""

import json
import logging
import math
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import jieba
import jieba.analyse
import pandas as pd
import yaml
from tqdm import tqdm

logger = logging.getLogger(__name__)


def load_config(config_path: str = "config.yaml") -> Dict[str, Any]:
    """加载配置文件中的 evaluate 部分。

    Args:
        config_path: 配置文件路径

    Returns:
        evaluate 配置字典
    """
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return config.get("evaluate", {})


class DataAnalyzer:
    """数据分析器，负责统计和质量评估。"""

    def __init__(self, config: Dict[str, Any]) -> None:
        """初始化数据分析器。

        Args:
            config: evaluate 配置字典
        """
        self.min_quality_score: float = config.get("min_quality_score", 0.6)
        self.top_keywords_count: int = config.get("top_keywords_count", 50)
        self.length_buckets: List[int] = config.get(
            "length_buckets", [0, 100, 200, 500, 1000, 2000, 5000]
        )

    def compute_statistics(self, texts: List[str]) -> Dict[str, Any]:
        """计算基础统计信息。

        Args:
            texts: 文本列表

        Returns:
            统计信息字典
        """
        if not texts:
            return {
                "total_samples": 0,
                "avg_length": 0,
                "median_length": 0,
                "min_length": 0,
                "max_length": 0,
                "std_length": 0,
                "length_distribution": {},
            }

        lengths = [len(t) for t in texts]
        length_series = pd.Series(lengths)

        # 长度分布
        buckets = self.length_buckets
        dist_labels = []
        dist_counts = []
        for i in range(len(buckets) - 1):
            low, high = buckets[i], buckets[i + 1]
            label = f"{low}-{high}"
            count = sum(1 for l in lengths if low <= l < high)
            dist_labels.append(label)
            dist_counts.append(count)
        # 超过最大桶的
        if buckets:
            over_max = sum(1 for l in lengths if l >= buckets[-1])
            dist_labels.append(f"{buckets[-1]}+")
            dist_counts.append(over_max)

        length_dist = dict(zip(dist_labels, dist_counts))

        stats = {
            "total_samples": len(texts),
            "avg_length": round(float(length_series.mean()), 2),
            "median_length": round(float(length_series.median()), 2),
            "min_length": int(length_series.min()),
            "max_length": int(length_series.max()),
            "std_length": round(float(length_series.std()), 2),
            "length_distribution": length_dist,
        }

        logger.info("统计信息: 总样本 %d, 平均长度 %.1f", stats["total_samples"], stats["avg_length"])
        return stats

    def compute_topic_coverage(
        self, texts: List[str], top_n: int = 50
    ) -> Dict[str, Any]:
        """分析话题覆盖度（基于 TF-IDF 关键词提取）。

        Args:
            texts: 文本列表
            top_n: 提取前 N 个关键词

        Returns:
            话题覆盖分析结果
        """
        if not texts:
            return {"top_keywords": [], "topic_count": 0}

        # 合并所有文本进行关键词提取
        combined_text = "\n".join(texts)

        # 使用 jieba TF-IDF 提取关键词
        keywords = jieba.analyse.extract_tags(
            combined_text, topK=top_n, withWeight=True
        )

        top_keywords = [
            {"keyword": kw, "weight": round(weight, 4)} for kw, weight in keywords
        ]

        result = {
            "top_keywords": top_keywords,
            "topic_count": len(top_keywords),
        }

        logger.info("提取到 %d 个话题关键词", len(top_keywords))
        return result

    def compute_lexical_diversity(self, texts: List[str]) -> Dict[str, float]:
        """计算词汇丰富度指标。

        Args:
            texts: 文本列表

        Returns:
            词汇丰富度指标字典 (TTR, MTLD)
        """
        if not texts:
            return {"ttr": 0.0, "mtld": 0.0, "total_tokens": 0, "unique_tokens": 0}

        # 分词
        all_tokens: List[str] = []
        for text in tqdm(texts, desc="分词处理", unit="条", leave=False):
            tokens = list(jieba.cut(text))
            all_tokens.extend(tokens)

        total_tokens = len(all_tokens)
        unique_tokens = len(set(all_tokens))

        # TTR (Type-Token Ratio)
        ttr = unique_tokens / total_tokens if total_tokens > 0 else 0.0

        # MTLD (Measure of Textual Lexical Diversity)
        mtld = self._compute_mtld(all_tokens)

        result = {
            "ttr": round(ttr, 4),
            "mtld": round(mtld, 2),
            "total_tokens": total_tokens,
            "unique_tokens": unique_tokens,
        }

        logger.info("词汇丰富度: TTR=%.4f, MTLD=%.2f", ttr, mtld)
        return result

    @staticmethod
    def _compute_mtld(tokens: List[str], threshold: float = 0.72) -> float:
        """计算 MTLD 指标。

        MTLD 将文本分成 TTR >= threshold 的片段，计算平均片段长度。

        Args:
            tokens: 分词后的 token 列表
            threshold: TTR 阈值，默认 0.72

        Returns:
            MTLD 值
        """
        if len(tokens) < 10:
            return float(len(tokens))

        def _mtld_one_direction(token_list: List[str], t_threshold: float) -> float:
            """单向计算 MTLD。"""
            factor_count = 0
            factor_length = 0
            current_types: set = set()
            current_count = 0

            for token in token_list:
                current_types.add(token)
                current_count += 1
                current_ttr = len(current_types) / current_count

                if current_ttr <= t_threshold:
                    factor_count += 1
                    factor_length += current_count
                    current_types = set()
                    current_count = 0

            # 处理未完成的片段
            if current_count > 0:
                # 部分因子
                partial = (1 - (len(current_types) / current_count)) / (1 - t_threshold)
                factor_count += partial
                factor_length += current_count

            if factor_count == 0:
                return float(len(token_list))

            return factor_length / factor_count

        forward_mtld = _mtld_one_direction(tokens, threshold)
        reverse_mtld = _mtld_one_direction(list(reversed(tokens)), threshold)
        mtld = (forward_mtld + reverse_mtld) / 2.0

        return mtld

    def compute_quality_scores(self, texts: List[str]) -> Dict[str, float]:
        """计算数据集的质量评分。

        评估维度：
        - 可读性：基于平均句长和词汇难度
        - 信息密度：基于信息量（非停用词占比）
        - 情感丰富度：基于情感词汇出现频率

        Args:
            texts: 文本列表

        Returns:
            质量评分字典 (0-1)
        """
        if not texts:
            return {
                "readability": 0.0,
                "information_density": 0.0,
                "emotional_richness": 0.0,
                "overall_quality": 0.0,
            }

        # 简单停用词列表（用于信息密度计算）
        stopwords = set(
            "的 了 在 是 我 有 和 就 不 人 都 一 一个 上 也 很 到 说 要 去 你 会 着 没有 看 好 "
            "自己 这 他 她 它 们 那 被 从 把 让 用 对 为 与 而 但 如果 因为 所以 虽然 可以 "
            "这个 那个 什么 怎么 为什么 还 又 再 已经 或者 而且 只是 可能 应该".split()
        )

        # 情感词汇（正向和负向）
        positive_words = set(
            "开心 快乐 幸福 感动 温暖 美好 甜蜜 喜欢 爱 感谢 赞 好看 漂亮 优秀 "
            "棒 超棒 绝绝子 YYDS 太好了 真好 好棒 太爱了 心动 惊喜 温柔 舒服 惬意".split()
        )
        negative_words = set(
            "难过 伤心 痛苦 失望 委屈 焦虑 担心 害怕 孤独 无聊 烦躁 崩溃 累 "
            "无语 尴尬 后悔 纠结 纠 结 烦 累死 想哭 太难了".split()
        )

        readability_scores: List[float] = []
        density_scores: List[float] = []
        emotion_scores: List[float] = []

        for text in tqdm(texts, desc="质量评分", unit="条", leave=False):
            tokens = list(jieba.cut(text))
            if not tokens:
                continue

            # 可读性：句子平均长度越接近理想范围（10-25字）越好
            # 按句号/感叹号/问号分句
            sentences = []
            for sep in ["。", "！", "？", "\n"]:
                if not sentences:
                    sentences = text.split(sep)
                else:
                    new_sentences = []
                    for s in sentences:
                        new_sentences.extend(s.split(sep))
                    sentences = new_sentences
            sentences = [s.strip() for s in sentences if s.strip()]

            if sentences:
                avg_sent_len = sum(len(s) for s in sentences) / len(sentences)
                # 理想句长 10-25 字，越接近越好
                if avg_sent_len < 10:
                    readability = avg_sent_len / 10.0
                elif avg_sent_len > 30:
                    readability = max(0.3, 1.0 - (avg_sent_len - 30) / 50.0)
                else:
                    readability = 1.0
            else:
                readability = 0.5

            # 信息密度：非停用词占比
            content_tokens = [t for t in tokens if t not in stopwords and len(t) > 1]
            density = len(content_tokens) / len(tokens) if tokens else 0.0

            # 情感丰富度：情感词汇出现比例
            emotion_tokens = [
                t for t in tokens if t in positive_words or t in negative_words
            ]
            emotion_ratio = len(emotion_tokens) / len(tokens) if tokens else 0.0
            # 情感丰富度在 0-15% 之间为最佳
            emotion_score = min(1.0, emotion_ratio / 0.15) if emotion_ratio > 0 else 0.0

            readability_scores.append(readability)
            density_scores.append(density)
            emotion_scores.append(emotion_score)

        avg_readability = (
            sum(readability_scores) / len(readability_scores)
            if readability_scores
            else 0.0
        )
        avg_density = (
            sum(density_scores) / len(density_scores) if density_scores else 0.0
        )
        avg_emotion = (
            sum(emotion_scores) / len(emotion_scores) if emotion_scores else 0.0
        )

        # 综合质量评分（加权平均）
        overall = avg_readability * 0.3 + avg_density * 0.4 + avg_emotion * 0.3

        result = {
            "readability": round(avg_readability, 4),
            "information_density": round(avg_density, 4),
            "emotional_richness": round(avg_emotion, 4),
            "overall_quality": round(overall, 4),
        }

        logger.info(
            "质量评分: 可读性=%.4f, 信息密度=%.4f, 情感丰富度=%.4f, 综合=%.4f",
            result["readability"],
            result["information_density"],
            result["emotional_richness"],
            result["overall_quality"],
        )
        return result


def generate_report(
    stats: Dict[str, Any],
    topics: Dict[str, Any],
    diversity: Dict[str, float],
    quality: Dict[str, float],
    config: Dict[str, Any],
    output_path: str,
) -> str:
    """生成 Markdown 格式的质量评估报告。

    Args:
        stats: 基础统计信息
        topics: 话题覆盖分析结果
        diversity: 词汇丰富度指标
        quality: 质量评分
        config: evaluate 配置
        output_path: 报告输出路径

    Returns:
        报告内容字符串
    """
    min_quality = config.get("min_quality_score", 0.6)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 构建报告
    lines = [
        "# Amie数据集质量评估报告",
        "",
        f"**生成时间**: {now}",
        "",
        "---",
        "",
        "## 1. 基础统计信息",
        "",
        f"| 指标 | 值 |",
        f"|------|-----|",
        f"| 总样本数 | {stats['total_samples']} |",
        f"| 平均长度 | {stats['avg_length']} 字符 |",
        f"| 中位数长度 | {stats['median_length']} 字符 |",
        f"| 最短长度 | {stats['min_length']} 字符 |",
        f"| 最长长度 | {stats['max_length']} 字符 |",
        f"| 长度标准差 | {stats['std_length']} 字符 |",
        "",
        "### 长度分布",
        "",
        "| 长度区间 | 样本数 | 占比 |",
        "|----------|--------|------|",
    ]

    total = stats["total_samples"]
    for bucket, count in stats.get("length_distribution", {}).items():
        pct = f"{count / total * 100:.1f}%" if total > 0 else "0%"
        lines.append(f"| {bucket} | {count} | {pct} |")

    lines.extend(
        [
            "",
            "## 2. 话题覆盖度",
            "",
            f"共提取 **{topics.get('topic_count', 0)}** 个话题关键词：",
            "",
        ]
    )

    # 话题关键词表格
    kw_list = topics.get("top_keywords", [])
    if kw_list:
        lines.append("| 排名 | 关键词 | 权重 |")
        lines.append("|------|--------|------|")
        for i, kw in enumerate(kw_list[:30], 1):
            lines.append(f"| {i} | {kw['keyword']} | {kw['weight']} |")

    lines.extend(
        [
            "",
            "## 3. 词汇丰富度",
            "",
            f"| 指标 | 值 | 说明 |",
            f"|------|-----|------|",
            f"| TTR (Type-Token Ratio) | {diversity['ttr']} | 词汇多样性比率（越高越丰富） |",
            f"| MTLD | {diversity['mtld']} | 文本词汇多样性度量 |",
            f"| 总词数 | {diversity['total_tokens']} | 分词后总 token 数 |",
            f"| 唯一词数 | {diversity['unique_tokens']} | 不重复 token 数 |",
            "",
            "## 4. 质量评分",
            "",
            "| 维度 | 评分 | 说明 |",
            "|------|------|------|",
            f"| 可读性 | {quality['readability']} | 基于平均句长评估 |",
            f"| 信息密度 | {quality['information_density']} | 非停用词占比 |",
            f"| 情感丰富度 | {quality['emotional_richness']} | 情感词汇出现频率 |",
            f"| **综合质量** | **{quality['overall_quality']}** | 加权平均 (可读性×0.3 + 信息密度×0.4 + 情感×0.3) |",
            "",
            f"**质量阈值**: {min_quality}",
            "",
        ]
    )

    # 质量结论
    overall = quality["overall_quality"]
    if overall >= min_quality:
        lines.append(f"**结论**: 数据集质量合格 (综合评分 {overall} >= 阈值 {min_quality})")
    else:
        lines.append(
            f"**结论**: 数据集质量不达标 (综合评分 {overall} < 阈值 {min_quality})，建议进一步清洗或补充数据"
        )

    lines.extend(
        [
            "",
            "---",
            "",
            f"*报告由Amie数据 Pipeline 自动生成*",
        ]
    )

    report = "\n".join(lines)

    # 保存报告
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, "w", encoding="utf-8") as f:
        f.write(report)

    logger.info("质量报告已保存至: %s", output_path)
    return report


def evaluate_pipeline(
    input_path: str,
    output_dir: str,
    config_path: str = "config.yaml",
) -> Dict[str, Any]:
    """执行完整的数据质量评估流水线。

    Args:
        input_path: 输入数据文件路径（JSONL 或 JSON）
        output_dir: 输出目录
        config_path: 配置文件路径

    Returns:
        包含所有评估结果的字典
    """
    config = load_config(config_path)
    analyzer = DataAnalyzer(config)

    # 读取数据
    input_file = Path(input_path)
    texts: List[str] = []

    if input_path.endswith(".jsonl"):
        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    item = json.loads(line)
                    # 提取文本内容
                    text = ""
                    for key in ("input", "content", "text", "prompt"):
                        val = item.get(key)
                        if val and isinstance(val, str):
                            text = val
                            break
                    if text:
                        texts.append(text)
    elif input_path.endswith(".parquet"):
        df = pd.read_parquet(input_file)
        for _, row in df.iterrows():
            text = ""
            for key in ("input", "content", "text", "prompt"):
                if key in row and isinstance(row[key], str):
                    text = row[key]
                    break
            if text:
                texts.append(text)
    else:
        # JSON 格式
        with open(input_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            for item in data:
                text = ""
                for key in ("input", "content", "text", "prompt"):
                    val = item.get(key)
                    if val and isinstance(val, str):
                        text = val
                        break
                if text:
                    texts.append(text)

    logger.info("加载 %d 条文本用于评估", len(texts))

    # 执行各项评估
    stats = analyzer.compute_statistics(texts)
    topics = analyzer.compute_topic_coverage(texts, config.get("top_keywords_count", 50))
    diversity = analyzer.compute_lexical_diversity(texts)
    quality = analyzer.compute_quality_scores(texts)

    # 生成报告
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    report_path = str(output_path / "quality_report.md")
    report = generate_report(stats, topics, diversity, quality, config, report_path)

    # 保存评估结果 JSON（便于程序读取）
    eval_result = {
        "statistics": stats,
        "topic_coverage": topics,
        "lexical_diversity": diversity,
        "quality_scores": quality,
    }

    result_path = str(output_path / "evaluation_result.json")
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(eval_result, f, ensure_ascii=False, indent=2)

    logger.info("评估结果 JSON 已保存至: %s", result_path)
    logger.info("质量评估完成")

    return eval_result


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    if len(sys.argv) < 3:
        print("用法: python evaluate.py <输入数据路径> <输出目录> [配置文件路径]")
        sys.exit(1)

    in_path = sys.argv[1]
    out_dir = sys.argv[2]
    cfg_path = sys.argv[3] if len(sys.argv) > 3 else "config.yaml"

    evaluate_pipeline(in_path, out_dir, cfg_path)
