# Amie数据预处理 Pipeline

面向 Qwen3-8B + QLoRA + DPO 微调的数据预处理工具链。

## 目录结构

```
data_pipeline/
├── pipeline.py        # 主控脚本（入口）
├── clean.py           # 数据清洗模块
├── convert.py         # 格式转换模块
├── evaluate.py        # 数据质量评估模块
├── config.yaml        # 配置文件
├── requirements.txt   # Python 依赖
└── README.md          # 使用说明
```

## 环境准备

```bash
# 安装依赖
pip install -r requirements.txt
```

## 快速开始

原始采集数据属于仓库外私有输入，不要复制回 `sources/raw-corpus/`。运行时直接通过现有 `--input` 参数传入私有文件或目录：

```bash
python pipeline.py --input <private-data-root>/input.json --output ./processed
```

### 完整流程

```bash
python pipeline.py --input ./raw_data --output ./processed
```

### 指定输出格式（默认 JSONL）

```bash
python pipeline.py --input ./raw_data --output ./processed --format parquet
```

### 跳过某个步骤

```bash
# 跳过清洗（数据已清洗过）
python pipeline.py --input ./cleaned.json --output ./processed --skip-clean

# 跳过评估
python pipeline.py --input ./raw_data --output ./processed --skip-evaluate

# 仅执行转换
python pipeline.py --input ./cleaned.json --output ./processed --skip-clean --skip-evaluate
```

## 命令行参数

| 参数 | 必选 | 默认值 | 说明 |
|------|------|--------|------|
| `--input` | 是 | - | 输入数据路径（JSON 文件或目录） |
| `--output` | 是 | - | 输出目录路径 |
| `--config` | 否 | `config.yaml` | 配置文件路径 |
| `--format` | 否 | `jsonl` | 输出格式：`jsonl` / `parquet` |
| `--skip-clean` | 否 | - | 跳过数据清洗步骤 |
| `--skip-convert` | 否 | - | 跳过格式转换步骤 |
| `--skip-evaluate` | 否 | - | 跳过质量评估步骤 |

## 输入格式

MediaCrawler 采集的小红书笔记 JSON，每条记录至少包含以下字段之一：
- `content` / `text` / `desc`：笔记正文
- `title`：笔记标题
- `note_content` / `note_text`：备选正文字段
- `tag_list` / `topics` / `tags`：话题标签（可选）

示例：
```json
{
  "title": "今天心情真好",
  "content": "和闺蜜一起逛街，买到了超喜欢的裙子！感觉整个人都在发光✨",
  "tag_list": ["闺蜜", "逛街", "穿搭"],
  "top_comment": "太美了！求裙子链接～"
}
```

## 输出结构

```
processed/
├── intermediate/
│   └── cleaned.json          # 清洗后的中间数据
├── train_data/
│   ├── qlora_train.jsonl     # QLoRA 训练数据
│   └── dpo_train.jsonl       # DPO 偏好对数据
├── evaluation/
│   ├── quality_report.md     # Markdown 质量报告
│   └── evaluation_result.json # 评估结果 JSON
├── manifest.json             # 增量处理清单
└── pipeline_summary.json     # 运行摘要
```

## 训练数据格式

### QLoRA 格式

```json
{"instruction": "作为闺蜜，请回应以下话题", "input": "话题：闺蜜\n内容：...", "output": "...", "system": "你是Amie..."}
```

### DPO 偏好对格式

```json
{"prompt": "话题：...\n内容：...", "chosen": "（优质回复）", "rejected": "（劣质回复）", "system": "你是Amie..."}
```

## 配置说明

编辑 `config.yaml` 可调整：
- 清洗规则（长度阈值、去重灵敏度、PII 模式、敏感词列表）
- 转换模板（instruction 文本、system prompt）
- 评估参数（质量阈值、关键词数量、长度分布桶）

## 单独运行各模块

```bash
# 单独清洗
python clean.py input.json cleaned.json

# 单独转换
python convert.py cleaned.json ./train_data jsonl

# 单独评估
python evaluate.py ./train_data/qlora_train.jsonl ./evaluation
```
