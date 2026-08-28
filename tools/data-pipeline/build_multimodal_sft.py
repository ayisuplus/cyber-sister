"""
多模态SFT训练数据构建脚本
=========================
将小红书爬虫Excel数据（图文+正文+标签+评论）转换为 Qwen3-VL 多模态SFT训练格式。

数据来源: LLM/data/待处理/笔记_*/笔记列表.xls
输出: LLM/data/dataset/multimodal_sft_v1.jsonl (ms-swift messages格式)

训练数据类型:
  1. 视觉描述SFT: 图片 + "描述穿搭/妆容" → 笔记正文+标签（天然图像描述）
  2. 闺蜜评价SFT: 图片 + "帮我看看怎么样" → 高赞评论（真实闺蜜语气）
  3. 文本闺蜜SFT: 复用已有 companion_sft_v1.jsonl（情感陪伴风格）

用法:
  python build_multimodal_sft.py                    # 构建全部数据
  python build_multimodal_sft.py --min_likes 100    # 只取点赞>=100的笔记
  python build_multimodal_sft.py --dry_run          # 只统计不写文件
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

# ── 路径配置 ──
LLM_ROOT = Path(__file__).resolve().parents[1]  # LLM/
DATA_PENDING = LLM_ROOT / "data" / "待处理"
DATA_PROCESSED = LLM_ROOT / "data" / "已处理"
OUTPUT_DIR = LLM_ROOT / "data" / "dataset"
COMPANION_SFT = DATA_PROCESSED / "companion_sft_v1.jsonl"

# ── 闺蜜评价提问模板 ──
EVAL_PROMPTS_OUTFIT = [
    "帮我看看这套穿搭怎么样？",
    "姐妹你觉得我今天这身搭配如何？",
    "这套衣服适合我吗？帮我评价一下",
    "看看我这身穿搭，给点建议呗",
    "你觉得这个搭配好看吗？",
    "帮我看看这个穿搭，有没有什么可以改进的？",
    "今天穿这身出门，你觉得怎么样？",
    "这套搭配适合什么场合穿？",
    "帮我看看这身搭配的颜色协调吗？",
    "闺蜜快帮我看看这套穿搭！",
]

EVAL_PROMPTS_MAKEUP = [
    "帮我看看这个妆容怎么样？",
    "姐妹你觉得我这个妆化得如何？",
    "这个妆容适合我吗？帮我看看",
    "看看我这个妆，给点建议呗",
    "你觉得这个妆好看吗？",
    "帮我评价一下这个妆容，有没有什么可以改进的？",
    "今天化了这个妆出门，你觉得怎么样？",
    "这个眼妆画得怎么样？帮我看看",
    "帮我看看这个底妆服不服帖？",
    "闺蜜快帮我看看这个妆容！",
]

EVAL_PROMPTS_GENERAL = [
    "帮我看看这张照片，你觉得怎么样？",
    "姐妹帮我看看这个造型如何？",
    "你觉得我今天这个形象怎么样？",
    "帮我看看这张自拍，给点建议呗",
    "看看我这个整体造型，好看吗？",
    "帮我评价一下这张照片的感觉",
    "你觉得这个风格适合我吗？",
    "帮我看看这个造型有没有什么可以改进的？",
    "今天拍了这张照片，你觉得怎么样？",
    "闺蜜快帮我看看这张照片！",
]

# ── 视觉描述提问模板 ──
DESC_PROMPTS = [
    "描述一下这张图片中的穿搭。",
    "这张图片里的人穿了什么？详细描述一下。",
    "描述一下这个妆容的特点。",
    "这张照片里的造型是什么样的？",
    "帮我描述一下图片中的穿搭风格和细节。",
    "这张图片展示了什么样的妆容？",
    "描述一下这个人的整体形象和穿搭。",
    "图片中的穿搭是什么风格的？具体描述一下。",
]

# ── 场景分类关键词 ──
OUTFIT_KEYWORDS = [
    "穿搭", "ootd", "搭配", "穿衣", " outfit", "衣服", "裙子", "裤子",
    "上衣", "外套", "衬衫", "连衣裙", "西装", "卫衣", "牛仔", "阔腿裤",
    "通勤穿搭", "约会穿搭", "日常穿搭", "cleanfit", "淡人穿搭", "松弛感",
    "高智感", "静奢风", "格雷系", "韩系穿搭", "法式", "新中式",
    "小个子穿搭", "显瘦", "叠穿", "一周穿搭", "每日穿搭",
]

MAKEUP_KEYWORDS = [
    "妆容", "化妆", "彩妆", "眼妆", "唇妆", "底妆", "腮红", "口红",
    "眼影", "眼线", "睫毛", "粉底", "遮瑕", "高光", "修容", "眉笔",
    "白开水妆", "粉彩妆", "伪素颜", "韩系淡妆", "淡颜", "奶杏妆",
    "妆越淡人越美", "妈生皮", "清透妆", "日常妆", "约会妆", "通勤妆",
    "仿妆", "妆教", "化妆教程", "新手化妆", "有效化妆", "无效化妆",
    "蝴蝶眼妆", "冰蓝眼妆", "水蜜桃妆", "轻烟熏", "碎钻眼妆",
]

APPEARANCE_KEYWORDS = [
    "颜值", "自拍", "氛围感", "好看", "评价", "打分", "形象",
    "纯欲风", "清冷感", "港风", "写真", "原相机", "无滤镜", "无美颜",
    "活人感", "反精致", "生命力", "气血感", "少女感", "轻熟风",
    "甜酷风", "御姐风", "高智感", "氛围感美女", "氛围感自拍",
    "求评价", "不玻璃心", "帮我看看", "怎么样", "好看吗",
]


def classify_note(title: str, content: str, tags: str) -> str:
    """将笔记分类为 outfit / makeup / appearance / general"""
    text = f"{title} {content} {tags}".lower()
    scores = {"outfit": 0, "makeup": 0, "appearance": 0}
    for kw in OUTFIT_KEYWORDS:
        if kw.lower() in text:
            scores["outfit"] += 1
    for kw in MAKEUP_KEYWORDS:
        if kw.lower() in text:
            scores["makeup"] += 1
    for kw in APPEARANCE_KEYWORDS:
        if kw.lower() in text:
            scores["appearance"] += 1
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "general"
    return best


def sanitize_dirname(name: str) -> str:
    """清理Windows文件名中的非法字符，与爬虫行为对齐"""
    # Windows非法字符: \ / : * ? " < > |
    name = re.sub(r'[\\/:*?"<>|]', "", name)
    # 去掉首尾空格和点
    name = name.strip().strip(".")
    return name


def find_images_for_note(batch_dir: Path, title: str) -> list[str]:
    """根据笔记标题查找对应的图片文件"""
    note_dir = batch_dir / "笔记"
    if not note_dir.exists():
        return []

    sanitized = sanitize_dirname(title)
    # 精确匹配
    target_dir = note_dir / sanitized
    if target_dir.exists() and target_dir.is_dir():
        imgs = sorted([
            str(target_dir / f)
            for f in os.listdir(target_dir)
            if f.lower().endswith((".webp", ".jpg", ".jpeg", ".png"))
        ])
        if imgs:
            return imgs

    # 模糊匹配：标题可能被截断或修改
    for d in os.listdir(note_dir):
        d_path = note_dir / d
        if not d_path.is_dir():
            continue
        # 检查目录名是否包含标题的关键部分
        d_clean = sanitize_dirname(d)
        if sanitized and (sanitized in d_clean or d_clean in sanitized):
            imgs = sorted([
                str(d_path / f)
                for f in os.listdir(d_path)
                if f.lower().endswith((".webp", ".jpg", ".jpeg", ".png"))
            ])
            if imgs:
                return imgs
        # 也检查前20个字符匹配
        if len(sanitized) >= 10 and sanitized[:20] == d_clean[:20]:
            imgs = sorted([
                str(d_path / f)
                for f in os.listdir(d_path)
                if f.lower().endswith((".webp", ".jpg", ".jpeg", ".png"))
            ])
            if imgs:
                return imgs

    return []


def parse_comments_sheet(xls_path: str) -> list[dict]:
    """
    解析评论列表sheet（固定列布局）。

    列布局 (header=None, 从row 2开始是数据):
      col 0-1: 笔记元数据（标题/内容/地区等，合并单元格，仅分组首行有值）
      col 2: 评论ID
      col 3: 用户名
      col 4: 用户主页
      col 5: 地区
      col 6: 评论时间
      col 7: 评论天数
      col 8: 评论内容
      col 9: 点赞数量
      col 10: 博主点赞
      col 11: 回复数量
      col 12: 互动数量
      col 13: 博主二维码
    """
    try:
        df = pd.read_excel(xls_path, sheet_name="评论列表", header=None)
    except Exception:
        return []

    comments = []
    current_note_title = ""

    for idx in range(2, len(df)):  # 跳过 row0(合并header) + row1(列名)
        row = df.iloc[idx]

        # 检测笔记分组标记（col 0 以"标题："开头）
        col0 = row.iloc[0] if pd.notna(row.iloc[0]) else ""
        col0_str = str(col0).strip()
        if col0_str.startswith("标题："):
            current_note_title = col0_str[3:].strip()

        # 从固定列提取评论数据
        comment_id = str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else ""
        username = str(row.iloc[3]).strip() if pd.notna(row.iloc[3]) else ""
        content = str(row.iloc[8]).strip() if pd.notna(row.iloc[8]) else ""
        likes_raw = row.iloc[9] if pd.notna(row.iloc[9]) else 0

        # 点赞数安全转换
        try:
            likes = int(float(likes_raw))
        except (ValueError, TypeError):
            likes = 0

        # 基本过滤
        if not comment_id or not content or len(content) < 2:
            continue
        # 跳过明显的非评论行（如笔记元数据泄漏到评论列）
        if content.startswith("标题：") or content.startswith("内容："):
            continue

        comments.append({
            "comment_id": comment_id,
            "username": username,
            "content": content,
            "likes": likes,
            "note_title": current_note_title,
        })

    return comments


def clean_xhs_text(text: str) -> str:
    """清理小红书文本中的平台标记。
    
    处理:
      - #xxx[话题]# → xxx
      - #xxx# → xxx  
      - 连续多余空格/换行
      - [话题] 残留
    """
    if not text:
        return ""
    # #xxx[话题]# 或 #xxx# → xxx
    text = re.sub(r"#([^#\[]+?)(?:\[话题\])?#", r"\1", text)
    # 残留的 [话题]
    text = re.sub(r"\[话题\]", "", text)
    # 多余空白
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" {2,}", " ", text)
    return text.strip()


def build_visual_desc_sample(
    image_path: str,
    title: str,
    content: str,
    tags: str,
    category: str,
) -> dict | None:
    """构建视觉描述SFT样本: 图片 → 笔记正文+标签"""
    if not content or len(content) < 15:
        return None

    # 组合正文+标签作为图像描述
    desc_parts = []
    if title and title.strip():
        desc_parts.append(clean_xhs_text(title))
    if content.strip():
        desc_parts.append(clean_xhs_text(content))
    if tags and str(tags) != "nan" and tags.strip():
        tag_str = clean_xhs_text(tags)
        if tag_str:
            desc_parts.append(f"标签：{tag_str}")

    description = "\n".join(desc_parts)
    if len(description) < 20:
        return None

    prompt = random.choice(DESC_PROMPTS)

    return {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image_path},
                    {"type": "text", "text": prompt},
                ],
            },
            {
                "role": "assistant",
                "content": description,
            },
        ],
    }


def is_quality_comment(text: str) -> bool:
    """判断评论是否适合作为闺蜜评价的训练目标。
    
    好评论特征: 有具体描述、有审美判断、有建设性建议、语气自然
    坏评论特征: 纯灌水、纯表情、广告、刻薄攻击、无意义短语
    """
    if not text or len(text) < 8:
        return False

    # 纯表情/纯数字/纯标点
    if re.match(r"^[\d\s\W\U0001F000-\U0001FFFF]+$", text):
        return False

    # 广告/引流
    ad_patterns = ["加v", "加微", "私聊", "店铺", "链接", "点击", "购买", "下单",
                   "优惠", "折扣", "领券", "复制", "淘宝", "拼多多", "闲鱼"]
    if any(p in text.lower() for p in ad_patterns):
        return False

    # 无意义短语 / 纯灌水（太短且无实质内容）
    low_effort = [
        "哈哈哈", "嘿嘿", "啊啊啊", "绝了", "牛", "6", "可以", "不错",
        "好看", "爱了", "蹲", "求链接", "求同款", "已入", "冲了",
        "美女你随便", "随便吧", "穷鬼版", "你开心就好",
    ]
    text_lower = text.lower().strip()
    if text_lower in low_effort:
        return False
    # 纯语气词堆砌（去掉标点后<6个汉字）
    chinese_chars = re.findall(r"[\u4e00-\u9fff]", text)
    if len(chinese_chars) < 6:
        return False

    # 刻薄/攻击性评论（不适合当训练目标）
    toxic_patterns = [
        "丑", "胖", "矮", "土", "廉价", "地摊", "穷", "恶心",
        "辣眼睛", "灾难", "失败", "劝退", "别穿了", "别化了",
        "不适合你", "显老", "显胖", "显矮", "像大妈", "像村姑",
    ]
    toxic_count = sum(1 for p in toxic_patterns if p in text)
    if toxic_count >= 2:
        return False

    return True


def build_eval_sample(
    image_path: str,
    comment_content: str,
    category: str,
    min_comment_likes: int = 10,
    comment_likes: int = 0,
) -> dict | None:
    """构建闺蜜评价SFT样本: 图片+提问 → 高赞评论"""
    if comment_likes < min_comment_likes:
        return None
    if not is_quality_comment(comment_content):
        return None

    if category == "outfit":
        prompt = random.choice(EVAL_PROMPTS_OUTFIT)
    elif category == "makeup":
        prompt = random.choice(EVAL_PROMPTS_MAKEUP)
    else:
        prompt = random.choice(EVAL_PROMPTS_GENERAL)

    return {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image_path},
                    {"type": "text", "text": prompt},
                ],
            },
            {
                "role": "assistant",
                "content": comment_content,
            },
        ],
    }


def convert_companion_sft(filepath: Path) -> list[dict]:
    """将已有的文本闺蜜SFT数据转换为messages格式。
    
    兼容两种格式:
      1. conversations: [{role: system, ...}, {role: user, ...}, {role: assistant, ...}]
      2. instruction/input/output (alpaca格式)
    """
    samples = []
    if not filepath.exists():
        return samples
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)

                # 格式1: conversations (ms-swift / sharegpt)
                if "conversations" in item:
                    convs = item["conversations"]
                    user_msg = None
                    asst_msg = None
                    for turn in convs:
                        if turn.get("role") == "user":
                            user_msg = clean_xhs_text(turn.get("content", ""))
                        elif turn.get("role") == "assistant":
                            asst_msg = clean_xhs_text(turn.get("content", ""))
                    if user_msg and asst_msg and len(asst_msg) >= 5:
                        samples.append({
                            "messages": [
                                {"role": "user", "content": user_msg},
                                {"role": "assistant", "content": asst_msg},
                            ],
                        })
                    continue

                # 格式2: instruction/input/output (alpaca)
                instruction = item.get("instruction", "")
                input_text = item.get("input", "")
                output_text = item.get("output", "")
                if not output_text or len(output_text) < 5:
                    continue
                user_msg = clean_xhs_text(input_text if input_text else instruction)
                output_text = clean_xhs_text(output_text)
                if not user_msg:
                    continue
                samples.append({
                    "messages": [
                        {"role": "user", "content": user_msg},
                        {"role": "assistant", "content": output_text},
                    ],
                })
            except json.JSONDecodeError:
                continue
    return samples


def main():
    parser = argparse.ArgumentParser(description="构建多模态SFT训练数据")
    parser.add_argument("--min_likes", type=int, default=50,
                        help="笔记最低点赞数（默认50）")
    parser.add_argument("--min_comment_likes", type=int, default=5,
                        help="评论最低点赞数（默认5，用于闺蜜评价SFT）")
    parser.add_argument("--max_images_per_note", type=int, default=3,
                        help="每条笔记最多使用的图片数（默认3）")
    parser.add_argument("--dry_run", action="store_true",
                        help="只统计不写文件")
    parser.add_argument("--output", type=str,
                        default=str(OUTPUT_DIR / "multimodal_sft_v1.jsonl"),
                        help="输出文件路径")
    args = parser.parse_args()

    random.seed(42)

    # ── 统计 ──
    stats = defaultdict(int)
    all_samples = []
    batch_dirs = sorted([
        d for d in DATA_PENDING.iterdir()
        if d.is_dir() and d.name.startswith("笔记_")
    ])

    print(f"发现 {len(batch_dirs)} 个数据批次")
    print(f"筛选条件: 笔记点赞>={args.min_likes}, 评论点赞>={args.min_comment_likes}")
    print("=" * 60)

    for batch_dir in batch_dirs:
        xls_path = batch_dir / "笔记列表.xls"
        if not xls_path.exists():
            stats["batches_no_xls"] += 1
            continue

        # 读取笔记列表
        try:
            df_notes = pd.read_excel(str(xls_path), sheet_name="笔记列表")
        except Exception as e:
            stats["batches_read_error"] += 1
            print(f"  [SKIP] {batch_dir.name}: 读取失败 - {e}")
            continue

        stats["batches_ok"] += 1

        # 按笔记标题分组评论（评论sheet中的note_title来自"标题：xxx"分组标记）
        comments_by_note = defaultdict(list)
        try:
            all_comments = parse_comments_sheet(str(xls_path))
            stats["comments_total"] += len(all_comments)
            for c in all_comments:
                nt = c.get("note_title", "").strip()
                if nt:
                    comments_by_note[nt].append(c)
        except Exception:
            all_comments = []

        # 处理每条笔记
        for _, row in df_notes.iterrows():
            stats["notes_total"] += 1

            title = str(row.get("标题", "")).strip()
            content = str(row.get("正文", "")).strip()
            tags = str(row.get("标签", "")).strip()
            likes = int(row.get("点赞数量", 0) or 0)
            note_type = str(row.get("类型", "")).strip()
            note_id = str(row.get("笔记ID", "")).strip()

            # 过滤: 点赞数
            if likes < args.min_likes:
                stats["notes_low_likes"] += 1
                continue

            # 分类
            category = classify_note(title, content, tags)
            stats[f"notes_cat_{category}"] += 1

            # 查找图片
            images = find_images_for_note(batch_dir, title)
            if not images:
                stats["notes_no_images"] += 1
                continue

            stats["notes_with_images"] += 1
            # 限制每笔记图片数
            images = images[:args.max_images_per_note]

            # === 1. 视觉描述SFT ===
            # 只对图文笔记生成（视频笔记的封面图描述价值低）
            if note_type == "图文" and len(content) >= 15:
                # 用第一张图做描述
                sample = build_visual_desc_sample(
                    image_path=images[0],
                    title=title,
                    content=content,
                    tags=tags,
                    category=category,
                )
                if sample:
                    all_samples.append(sample)
                    stats["samples_visual_desc"] += 1

                # 如果有多张图，额外的图也做描述（用不同prompt）
                for extra_img in images[1:]:
                    sample = build_visual_desc_sample(
                        image_path=extra_img,
                        title=title,
                        content=content,
                        tags=tags,
                        category=category,
                    )
                    if sample:
                        all_samples.append(sample)
                        stats["samples_visual_desc"] += 1

            # === 2. 闺蜜评价SFT ===
            # 只取该笔记自己的评论（通过标题匹配）
            note_comments = [
                c for c in comments_by_note.get(title, [])
                if c.get("likes", 0) >= args.min_comment_likes
                and len(c.get("content", "")) >= 5
            ]

            if note_comments and images:
                # 按点赞排序，取top评论
                note_comments.sort(key=lambda x: x["likes"], reverse=True)
                # 每条笔记最多取8条高赞评论做评价SFT
                for comment in note_comments[:8]:
                    # 随机选一张图
                    img = random.choice(images)
                    sample = build_eval_sample(
                        image_path=img,
                        comment_content=comment["content"],
                        category=category,
                        min_comment_likes=args.min_comment_likes,
                        comment_likes=comment.get("likes", 0),
                    )
                    if sample:
                        all_samples.append(sample)
                        stats["samples_eval"] += 1

    # === 3. 文本闺蜜SFT（复用已有数据）===
    companion_samples = convert_companion_sft(COMPANION_SFT)
    stats["samples_companion_text"] = len(companion_samples)

    # ── 统一content格式为array（PyArrow要求同列类型一致）──
    # 纯文本样本的content: "xxx" → [{"type": "text", "text": "xxx"}]
    for sample in all_samples:
        for msg in sample["messages"]:
            if isinstance(msg["content"], str):
                msg["content"] = [{"type": "text", "text": msg["content"]}]
    for sample in companion_samples:
        for msg in sample["messages"]:
            if isinstance(msg["content"], str):
                msg["content"] = [{"type": "text", "text": msg["content"]}]

    all_samples.extend(companion_samples)

    # ── 打乱 ──
    random.shuffle(all_samples)

    # ── 统计输出 ──
    print(f"\n{'=' * 60}")
    print(f"数据构建统计:")
    print(f"  批次数: {stats['batches_ok']} 成功 / {stats['batches_read_error']} 失败")
    print(f"  笔记总数: {stats['notes_total']}")
    print(f"    低点赞过滤: {stats['notes_low_likes']}")
    print(f"    无图片: {stats['notes_no_images']}")
    print(f"    有图片: {stats['notes_with_images']}")
    print(f"    分类: outfit={stats['notes_cat_outfit']}, makeup={stats['notes_cat_makeup']}, "
          f"appearance={stats['notes_cat_appearance']}, general={stats['notes_cat_general']}")
    print(f"  评论总数: {stats['comments_total']}")
    print(f"  训练样本:")
    print(f"    视觉描述SFT: {stats['samples_visual_desc']}")
    print(f"    闺蜜评价SFT: {stats['samples_eval']}")
    print(f"    文本闺蜜SFT: {stats['samples_companion_text']}")
    print(f"    总计: {len(all_samples)}")
    print(f"{'=' * 60}")

    if args.dry_run:
        print("\n[DRY RUN] 不写入文件")
        # 打印几个样本看看
        print("\n--- 样本预览 ---")
        for i, s in enumerate(all_samples[:3]):
            print(f"\n样本 {i+1}:")
            print(json.dumps(s, ensure_ascii=False, indent=2)[:500])
        return

    # ── 写入文件（统一content为array格式，单文件输出）──
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        for sample in all_samples:
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")

    print(f"\n已写入 {len(all_samples)} 条样本到: {output_path}")

    # 写入数据报告
    report_path = output_path.parent / "multimodal_sft_report.json"
    report = {
        "total_samples": len(all_samples),
        "visual_desc_samples": stats["samples_visual_desc"],
        "eval_samples": stats["samples_eval"],
        "companion_text_samples": stats["samples_companion_text"],
        "notes_total": stats["notes_total"],
        "notes_with_images": stats["notes_with_images"],
        "notes_by_category": {
            "outfit": stats["notes_cat_outfit"],
            "makeup": stats["notes_cat_makeup"],
            "appearance": stats["notes_cat_appearance"],
            "general": stats["notes_cat_general"],
        },
        "comments_total": stats["comments_total"],
        "batches_ok": stats["batches_ok"],
        "batches_failed": stats["batches_read_error"],
        "min_likes": args.min_likes,
        "min_comment_likes": args.min_comment_likes,
    }
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"数据报告: {report_path}")


if __name__ == "__main__":
    main()
