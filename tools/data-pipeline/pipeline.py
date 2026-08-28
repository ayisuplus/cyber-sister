"""
主控脚本 - 数据预处理 Pipeline

串联 clean → convert → evaluate 完整流程。
支持命令行参数配置、增量处理、详细日志输出。

用法:
    python pipeline.py --input ./raw_data --output ./processed
    python pipeline.py --input ./raw_data --output ./processed --format parquet
    python pipeline.py --input ./raw_data --output ./processed --skip-clean

Author: software-engineer
Date: 2025-07
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import yaml

from clean import clean_pipeline
from convert import convert_pipeline
from evaluate import evaluate_pipeline

logger = logging.getLogger(__name__)


def load_config(config_path: str = "config.yaml") -> Dict[str, Any]:
    """加载完整配置文件。

    Args:
        config_path: 配置文件路径

    Returns:
        完整配置字典
    """
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_processed_files(manifest_path: str) -> Set[str]:
    """加载已处理文件清单（用于增量处理）。

    Args:
        manifest_path: 清单文件路径

    Returns:
        已处理文件路径集合
    """
    manifest_file = Path(manifest_path)
    if not manifest_file.exists():
        return set()

    try:
        with open(manifest_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return set(data.get("processed_files", []))
    except (json.JSONDecodeError, IOError) as e:
        logger.warning("读取清单文件失败: %s", e)
        return set()


def save_processed_files(manifest_path: str, processed: Set[str]) -> None:
    """保存已处理文件清单。

    Args:
        manifest_path: 清单文件路径
        processed: 已处理文件路径集合
    """
    manifest_file = Path(manifest_path)
    manifest_file.parent.mkdir(parents=True, exist_ok=True)

    data = {
        "processed_files": sorted(processed),
        "last_updated": str(int(time.time())),
    }

    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    logger.info("清单已更新: %s (共 %d 个已处理文件)", manifest_path, len(processed))


def get_input_files(input_path: str) -> List[str]:
    """获取输入路径下的所有 JSON 文件。

    Args:
        input_path: 输入路径（文件或目录）

    Returns:
        文件路径列表
    """
    path = Path(input_path)

    if path.is_file():
        return [str(path)]

    if path.is_dir():
        files = sorted(path.glob("*.json"))
        return [str(f) for f in files]

    logger.error("输入路径不存在: %s", input_path)
    return []


def run_pipeline(args: argparse.Namespace) -> None:
    """执行完整的数据预处理 Pipeline。

    Args:
        args: 命令行参数
    """
    config_path = args.config
    input_path = args.input
    output_dir = args.output
    output_format = args.format
    skip_clean = args.skip_clean
    skip_convert = args.skip_convert
    skip_evaluate = args.skip_evaluate

    # 加载配置
    config = load_config(config_path)
    logger.info("配置已加载: %s", config_path)

    # 设置输出目录结构
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    intermediate_dir = output_path / "intermediate"
    intermediate_dir.mkdir(parents=True, exist_ok=True)

    # 增量处理清单
    manifest_path = str(output_path / "manifest.json")
    processed_files = load_processed_files(manifest_path)

    # 计时
    pipeline_start = time.time()
    results_summary: Dict[str, Any] = {}

    # ============ Step 1: 数据清洗 ============
    cleaned_path = str(intermediate_dir / "cleaned.json")

    if skip_clean:
        logger.info("跳过清洗步骤 (--skip-clean)")
        if not Path(cleaned_path).exists():
            # 如果跳过清洗但没有中间文件，尝试直接使用输入
            logger.warning("未找到清洗中间文件，将尝试直接使用输入数据")
            cleaned_path = input_path
    else:
        logger.info("=" * 50)
        logger.info("Step 1/3: 数据清洗")
        logger.info("=" * 50)

        step_start = time.time()
        cleaned_notes = clean_pipeline(input_path, cleaned_path, config_path)
        step_time = time.time() - step_start

        results_summary["clean"] = {
            "input_count": "见清洗日志",
            "output_count": len(cleaned_notes),
            "time_seconds": round(step_time, 2),
        }
        logger.info("清洗步骤完成，耗时 %.2f 秒", step_time)

    # ============ Step 2: 格式转换 ============
    convert_output_dir = str(output_path / "train_data")

    if skip_convert:
        logger.info("跳过转换步骤 (--skip-convert)")
    else:
        logger.info("=" * 50)
        logger.info("Step 2/3: 格式转换")
        logger.info("=" * 50)

        step_start = time.time()
        qlora_samples, dpo_pairs = convert_pipeline(
            cleaned_path, convert_output_dir, output_format, config_path
        )
        step_time = time.time() - step_start

        results_summary["convert"] = {
            "qlora_count": len(qlora_samples),
            "dpo_count": len(dpo_pairs),
            "output_format": output_format,
            "time_seconds": round(step_time, 2),
        }
        logger.info("转换步骤完成，耗时 %.2f 秒", step_time)

    # ============ Step 3: 质量评估 ============
    evaluate_output_dir = str(output_path / "evaluation")

    if skip_evaluate:
        logger.info("跳过评估步骤 (--skip-evaluate)")
    else:
        logger.info("=" * 50)
        logger.info("Step 3/3: 质量评估")
        logger.info("=" * 50)

        # 评估使用 QLoRA 训练数据
        ext = ".parquet" if output_format == "parquet" else ".jsonl"
        eval_input = str(Path(convert_output_dir) / f"qlora_train{ext}")

        if not Path(eval_input).exists():
            logger.warning("未找到训练数据文件 %s，使用清洗数据进行评估", eval_input)
            eval_input = cleaned_path

        step_start = time.time()
        eval_result = evaluate_pipeline(eval_input, evaluate_output_dir, config_path)
        step_time = time.time() - step_start

        results_summary["evaluate"] = {
            "overall_quality": eval_result.get("quality_scores", {}).get(
                "overall_quality", 0
            ),
            "time_seconds": round(step_time, 2),
        }
        logger.info("评估步骤完成，耗时 %.2f 秒", step_time)

    # ============ 更新增量处理清单 ============
    input_files = get_input_files(input_path)
    processed_files.update(input_files)
    save_processed_files(manifest_path, processed_files)

    # ============ 保存 Pipeline 运行摘要 ============
    total_time = time.time() - pipeline_start
    results_summary["total_time_seconds"] = round(total_time, 2)
    results_summary["output_directory"] = str(output_path)

    summary_path = str(output_path / "pipeline_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(results_summary, f, ensure_ascii=False, indent=2)

    logger.info("=" * 50)
    logger.info("Pipeline 执行完成!")
    logger.info("总耗时: %.2f 秒", total_time)
    logger.info("输出目录: %s", output_path)
    logger.info("运行摘要: %s", summary_path)
    logger.info("=" * 50)


def parse_args() -> argparse.Namespace:
    """解析命令行参数。

    Returns:
        解析后的参数命名空间
    """
    parser = argparse.ArgumentParser(
        description="赛博姐妹数据预处理 Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用示例:
  # 完整流程
  python pipeline.py --input ./raw_data --output ./processed

  # 使用 Parquet 格式输出
  python pipeline.py --input ./raw_data --output ./processed --format parquet

  # 跳过清洗（已清洗过的数据）
  python pipeline.py --input ./cleaned.json --output ./processed --skip-clean

  # 仅执行评估
  python pipeline.py --input ./train_data.jsonl --output ./eval_output --skip-clean --skip-convert
        """,
    )

    parser.add_argument(
        "--input",
        type=str,
        required=True,
        help="输入数据路径（JSON 文件或包含 JSON 文件的目录）",
    )
    parser.add_argument(
        "--output",
        type=str,
        required=True,
        help="输出目录路径",
    )
    parser.add_argument(
        "--config",
        type=str,
        default="config.yaml",
        help="配置文件路径（默认: config.yaml）",
    )
    parser.add_argument(
        "--format",
        type=str,
        choices=["jsonl", "parquet"],
        default="jsonl",
        help="输出格式（默认: jsonl）",
    )
    parser.add_argument(
        "--skip-clean",
        action="store_true",
        help="跳过数据清洗步骤",
    )
    parser.add_argument(
        "--skip-convert",
        action="store_true",
        help="跳过格式转换步骤",
    )
    parser.add_argument(
        "--skip-evaluate",
        action="store_true",
        help="跳过质量评估步骤",
    )

    return parser.parse_args()


def main() -> None:
    """主入口函数。"""
    # 配置日志
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )

    args = parse_args()
    logger.info("Pipeline 参数: input=%s, output=%s, format=%s", args.input, args.output, args.format)

    try:
        run_pipeline(args)
    except KeyboardInterrupt:
        logger.info("Pipeline 被用户中断")
        sys.exit(130)
    except Exception as e:
        logger.error("Pipeline 执行失败: %s", e, exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
