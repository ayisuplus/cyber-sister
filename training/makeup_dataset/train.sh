#!/bin/bash
# 一键训练脚本 - 在魔搭/PAI GPU 上运行
# 用法: bash train_makeup_model.sh

set -e

echo "=========================================="
echo "🌸 MakeupLLM 训练脚本"
echo "   模型: Qwen2.5-VL-7B-Instruct"
echo "   方法: LoRA (rank=16)"
echo "=========================================="

# 1. 安装依赖
echo "📦 安装依赖..."
pip install -q llamafactory[metrics] qwen-vl-utils
pip install -q flash-attn --no-build-isolation 2>/dev/null || echo "FlashAttn 安装跳过"

# 2. 下载基座模型
echo "📥 下载 Qwen2.5-VL-7B-Instruct..."
python -c "
from modelscope import snapshot_download
snapshot_download('Qwen/Qwen2.5-VL-7B-Instruct', local_dir='models/Qwen2.5-VL-7B')
print('✅ 模型下载完成')
"

# 3. 准备 LLaMA-Factory
echo "🔧 配置 LLaMA-Factory..."
cd /tmp
if [ ! -d "LLaMA-Factory" ]; then
    git clone --depth 1 https://github.com/hiyouga/LLaMA-Factory.git
fi
cd LLaMA-Factory
pip install -e .[metrics] -q

# 4. 复制数据
echo "📋 复制训练数据..."
mkdir -p data/makeup_images
cp -r /mnt/data/llamafactory/train.json data/
cp -r /mnt/data/llamafactory/eval.json data/
cp -r /mnt/data/llamafactory/dataset_info.json data/

# 复制图片（如果在 OSS 上）
if [ -d "/mnt/data/llamafactory/images" ]; then
    cp -r /mnt/data/llamafactory/images/* data/makeup_images/
fi

# 5. 复制模型
mkdir -p models
cp -r /mnt/models/Qwen2.5-VL-7B models/ 2>/dev/null || echo "模型已存在于 models/"

# 6. 创建训练配置
cat > train_makeup.yaml << 'EOF'
### Model
model_name_or_path: models/Qwen2.5-VL-7B
template: qwen2_vl
trust_remote_code: true

### Method
stage: sft
do_train: true
finetuning_type: lora
lora_target: all
lora_rank: 16
lora_alpha: 16

### Dataset
dataset: makeup_vl_train
eval_dataset: makeup_vl_eval
cutoff_len: 2048
overwrite_cache: true
preprocessing_num_workers: 4

### Output
output_dir: saves/qwen2.5-vl-makeup/lora/sft
logging_steps: 10
save_steps: 100
save_total_limit: 3
plot_loss: true
overwrite_output_dir: true

### Hyperparameters
per_device_train_batch_size: 2
gradient_accumulation_steps: 8
learning_rate: 1.0e-4
num_train_epochs: 3.0
lr_scheduler_type: cosine
warmup_ratio: 0.1
bf16: true
flash_attn: fa2
gradient_checkpointing: true
EOF

# 7. 开始训练
echo "🚀 开始训练..."
echo "   开始时间: $(date)"
llamafactory-cli train train_makeup.yaml

echo "✅ 训练完成！"
echo "   结束时间: $(date)"
echo "   模型保存在: saves/qwen2.5-vl-makeup/lora/sft"

# 8. 导出合并模型（可选）
echo "📦 导出合并模型..."
cat > merge.yaml << 'EOF'
model_name_or_path: models/Qwen2.5-VL-7B
adapter_name_or_path: saves/qwen2.5-vl-makeup/lora/sft
template: qwen2_vl
finetuning_type: lora
export_dir: models/MakeupLLM-7B
export_size: 5
export_device: cpu
EOF

llamafactory-cli export merge.yaml
echo "✅ 合并模型导出完成: models/MakeupLLM-7B"
echo "=========================================="
echo "🎉 全部完成！"
echo "=========================================="
