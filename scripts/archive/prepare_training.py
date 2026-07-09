#!/usr/bin/env python3
"""
把所有标注数据转成 LLaMA-Factory 的 alpaca 格式
输出：data/llamafactory/train.json + data/llamafactory/dataset_info.json
"""

import json
import os
import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = DATA_DIR / "llamafactory"
IMAGES_DIR = OUTPUT_DIR / "images"

SYSTEM_PROMPT = "你是一个专业的美妆分析师。根据用户提供的图片，分析妆容特征并以JSON格式返回结构化结果。"

INSTRUCTION = """分析这张美妆图片，提取以下属性并以JSON格式返回：
{
  "style": "妆容风格（如：白开水妆/蜜桃妆/纯欲妆/韩系妆/日系妆/欧美妆/复古妆/辣妹妆/伪素颜妆等）",
  "lip_color": "唇色描述",
  "eyeshadow": "眼影描述", 
  "blush": "腮红描述",
  "skin_finish": "底妆质感（光泽奶油肌/哑光雾面/水光肌/自然裸肌）",
  "techniques": ["使用的化妆技法列表"],
  "difficulty": "难度（easy/medium/hard）",
  "vibe": "整体氛围词"
}"""


def annotation_to_output(ann: dict) -> str:
    """把标注结果转成格式化的JSON字符串"""
    result = {
        "style": ann.get("style", ""),
        "lip_color": ann.get("lip_color", ""),
        "eyeshadow": ann.get("eyeshadow", ""),
        "blush": ann.get("blush", ""),
        "skin_finish": ann.get("skin_finish", ""),
        "techniques": ann.get("techniques", []),
        "difficulty": ann.get("difficulty", ""),
        "vibe": ann.get("vibe", ""),
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


def collect_image_paths() -> dict[str, str]:
    """收集所有图片路径，返回 {filename: absolute_path}"""
    paths = {}
    
    # 小红书图片
    xhs_dir = DATA_DIR / "xhs_raw"
    if xhs_dir.exists():
        for keyword_dir in xhs_dir.iterdir():
            if not keyword_dir.is_dir() or keyword_dir.name.startswith("."):
                continue
            for note_dir in keyword_dir.iterdir():
                if not note_dir.is_dir():
                    continue
                for img in note_dir.glob("*.jpg"):
                    paths[img.stem] = str(img)
    
    # 增强图片
    aug_dir = DATA_DIR / "augmented_images"
    if aug_dir.exists():
        for img in aug_dir.glob("*.jpg"):
            paths[img.stem] = str(img)
    
    # B站封面
    bili_dir = DATA_DIR / "bilibili" / "covers"
    if bili_dir.exists():
        for img in bili_dir.glob("*.jpg"):
            paths[img.stem] = str(img)
    
    return paths


def process_xhs_annotations(image_paths: dict) -> list[dict]:
    """处理小红书图片标注"""
    records = []
    ann_file = DATA_DIR / "annotations.jsonl"
    if not ann_file.exists():
        return records
    
    with open(ann_file, "r", encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except:
                continue
            
            ann = r.get("annotation", {})
            if not ann:
                continue
            
            # 找图片路径
            img_path = r.get("path", "")
            if not img_path or not os.path.exists(img_path):
                # 尝试从 note_id 找
                note_id = r.get("note_id", "")
                if note_id in image_paths:
                    img_path = image_paths[note_id]
                else:
                    continue
            
            records.append({
                "instruction": INSTRUCTION,
                "input": "",
                "output": annotation_to_output(ann),
                "images": [img_path],
                "system": SYSTEM_PROMPT,
            })
    
    return records


def process_augmented_annotations(image_paths: dict) -> list[dict]:
    """处理增强图片标注"""
    records = []
    aug_file = DATA_DIR / "augmented_annotations.jsonl"
    if not aug_file.exists():
        return records
    
    with open(aug_file, "r", encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except:
                continue
            
            ann = r.get("annotation", {})
            if not ann:
                continue
            
            img_path = r.get("path", "")
            if not img_path or not os.path.exists(img_path):
                continue
            
            records.append({
                "instruction": INSTRUCTION,
                "input": "",
                "output": annotation_to_output(ann),
                "images": [img_path],
                "system": SYSTEM_PROMPT,
            })
    
    return records


def process_video_annotations() -> list[dict]:
    """处理视频标注（纯文本，无图片）"""
    records = []
    vid_file = DATA_DIR / "video_annotations.jsonl"
    if not vid_file.exists():
        return records
    
    with open(vid_file, "r", encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except:
                continue
            
            ann = r.get("annotation", {})
            if not ann or "error" in ann:
                continue
            
            # 视频标注没有图片，用文字描述作为训练数据
            desc = f"视频妆容分析：风格={ann.get('style','')}, 步骤={','.join(ann.get('steps_summary',[''])[:3])}, 技法={','.join(ann.get('all_techniques',[]))}"
            
            records.append({
                "instruction": "根据以下视频妆容描述，提取妆容属性并以JSON格式返回。",
                "input": desc,
                "output": json.dumps({
                    "style": ann.get("style", ""),
                    "lip_color": ann.get("lip_color", ""),
                    "eyeshadow": ann.get("eyeshadow", ""),
                    "blush": ann.get("blush", ""),
                    "skin_finish": ann.get("skin_finish", ""),
                    "techniques": ann.get("all_techniques", []),
                    "difficulty": ann.get("difficulty", ""),
                    "vibe": ann.get("key_tips", ""),
                }, ensure_ascii=False, indent=2),
                "images": [],
                "system": SYSTEM_PROMPT,
            })
    
    return records


def process_bilibili_annotations(image_paths: dict) -> list[dict]:
    """处理B站封面标注"""
    records = []
    ann_file = DATA_DIR / "bilibili" / "annotations.jsonl"
    if not ann_file.exists():
        return records
    
    with open(ann_file, "r", encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except:
                continue
            
            ann = r.get("annotation", {})
            if not ann or not isinstance(ann, dict):
                continue
            
            img_path = r.get("cover_path", "")
            if not img_path or not os.path.exists(img_path):
                bvid = r.get("bvid", "")
                if bvid in image_paths:
                    img_path = image_paths[bvid]
                else:
                    continue
            
            records.append({
                "instruction": INSTRUCTION,
                "input": "",
                "output": annotation_to_output(ann),
                "images": [img_path],
                "system": SYSTEM_PROMPT,
            })
    
    return records


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    print("📦 收集图片路径...")
    image_paths = collect_image_paths()
    print(f"   找到 {len(image_paths)} 张图片")
    
    print("📝 处理小红书图片标注...")
    xhs_records = process_xhs_annotations(image_paths)
    print(f"   {len(xhs_records)} 条")
    
    print("📝 处理增强图片标注...")
    aug_records = process_augmented_annotations(image_paths)
    print(f"   {len(aug_records)} 条")
    
    print("📝 处理视频标注...")
    vid_records = process_video_annotations()
    print(f"   {len(vid_records)} 条")
    
    print("📝 处理B站封面标注...")
    bili_records = process_bilibili_annotations(image_paths)
    print(f"   {len(bili_records)} 条")
    
    # 合并
    all_records = xhs_records + aug_records + vid_records + bili_records
    print(f"\n📊 总训练数据: {len(all_records)} 条")
    
    # 打乱顺序
    import random
    random.seed(42)
    random.shuffle(all_records)
    
    # 分 train/eval (90/10)
    split = int(len(all_records) * 0.9)
    train_data = all_records[:split]
    eval_data = all_records[split:]
    
    # 写入
    train_file = OUTPUT_DIR / "train.json"
    eval_file = OUTPUT_DIR / "eval.json"
    
    with open(train_file, "w", encoding="utf-8") as f:
        json.dump(train_data, f, ensure_ascii=False, indent=2)
    
    with open(eval_file, "w", encoding="utf-8") as f:
        json.dump(eval_data, f, ensure_ascii=False, indent=2)
    
    print(f"   train: {len(train_data)} 条 → {train_file}")
    print(f"   eval:  {len(eval_data)} 条 → {eval_file}")
    
    # 生成 dataset_info.json
    dataset_info = {
        "makeup_vl_train": {
            "file_name": "train.json",
            "formatting": "alpaca",
            "columns": {
                "prompt": "instruction",
                "query": "input",
                "response": "output",
                "images": "images",
                "system": "system",
            },
        },
        "makeup_vl_eval": {
            "file_name": "eval.json",
            "formatting": "alpaca",
            "columns": {
                "prompt": "instruction",
                "query": "input",
                "response": "output",
                "images": "images",
                "system": "system",
            },
        },
    }
    
    info_file = OUTPUT_DIR / "dataset_info.json"
    with open(info_file, "w", encoding="utf-8") as f:
        json.dump(dataset_info, f, ensure_ascii=False, indent=2)
    print(f"   dataset_info → {info_file}")
    
    # 生成训练配置
    config = {
        "model_name_or_path": "Qwen/Qwen2.5-VL-7B-Instruct",
        "template": "qwen2_vl",
        "trust_remote_code": True,
        "stage": "sft",
        "do_train": True,
        "finetuning_type": "lora",
        "lora_target": "all",
        "lora_rank": 16,
        "lora_alpha": 16,
        "dataset": "makeup_vl_train",
        "eval_dataset": "makeup_vl_eval",
        "cutoff_len": 2048,
        "overwrite_cache": True,
        "preprocessing_num_workers": 4,
        "output_dir": "saves/qwen2.5-vl-makeup/lora/sft",
        "logging_steps": 10,
        "save_steps": 100,
        "plot_loss": True,
        "overwrite_output_dir": True,
        "per_device_train_batch_size": 2,
        "gradient_accumulation_steps": 8,
        "learning_rate": 1.0e-4,
        "num_train_epochs": 3.0,
        "lr_scheduler_type": "cosine",
        "warmup_ratio": 0.1,
        "bf16": True,
        "flash_attn": "fa2",
    }
    
    config_file = OUTPUT_DIR / "train_config.yaml"
    import yaml
    with open(config_file, "w", encoding="utf-8") as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False)
    print(f"   训练配置 → {config_file}")
    
    print(f"\n✅ LLaMA-Factory 数据集准备完成！")
    print(f"   目录: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
