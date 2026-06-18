#!/bin/bash
# MakeupLLM 训练启动脚本
# 在 ModelScope 创空间 GPU 实例中运行

set -e
echo "=========================================="
echo "🌸 MakeupLLM 训练脚本"
echo "=========================================="

# 1. 安装依赖
echo "📦 安装依赖..."
pip install -q llamafactory[metrics] qwen-vl-utils flash-attn --no-build-isolation 2>/dev/null || \
pip install -q llamafactory[metrics] qwen-vl-utils

# 2. 下载模型
echo "📥 下载 Qwen2.5-VL-7B..."
python -c "
from modelscope import snapshot_download
snapshot_download('Qwen/Qwen2.5-VL-7B-Instruct', local_dir='models/Qwen2.5-VL-7B')
print('✅ 模型下载完成')
"

# 3. 下载数据
echo "📥 下载训练数据..."
pip install -q oss2
python -c "
import oss2, json, os
auth = oss2.Auth('', '')  # 匿名访问或用环境变量
bucket = oss2.Bucket(auth, 'oss-cn-beijing.aliyuncs.com', 'makeup-training-data')
os.makedirs('data', exist_ok=True)
for obj in oss2.ObjectIterator(bucket, prefix='makeup_dataset/'):
    if obj.key.endswith('/'): continue
    local = obj.key.replace('makeup_dataset/', 'data/')
    os.makedirs(os.path.dirname(local), exist_ok=True)
    bucket.get_object_to_file(obj.key, local)
    print(f'  ✅ {local}')
print('✅ 数据下载完成')
"

# 4. 克隆 LLaMA-Factory
echo "🔧 配置 LLaMA-Factory..."
if [ ! -d "LLaMA-Factory" ]; then
    git clone --depth 1 https://github.com/hiyouga/LLaMA-Factory.git
fi
cd LLaMA-Factory
pip install -e .[metrics] -q

# 复制数据
mkdir -p data
cp /workspace/data/train.json data/
cp /workspace/data/eval.json data/
cp /workspace/data/dataset_info.json data/

# 5. 创建训练配置
cat > train_makeup.yaml << 'EOF'
model_name_or_path: /workspace/models/Qwen2.5-VL-7B
template: qwen2_vl
trust_remote_code: true
stage: sft
do_train: true
finetuning_type: lora
lora_target: all
lora_rank: 16
lora_alpha: 16
dataset: makeup_vl_train
eval_dataset: makeup_vl_eval
cutoff_len: 2048
overwrite_cache: true
preprocessing_num_workers: 4
output_dir: /workspace/saves/makeup-llm/lora
logging_steps: 10
save_steps: 100
save_total_limit: 3
plot_loss: true
overwrite_output_dir: true
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

# 6. 开始训练
echo "🚀 开始训练..."
echo "   时间: $(date)"
llamafactory-cli train train_makeup.yaml

echo "✅ 训练完成！"
echo "   时间: $(date)"
echo "   模型: /workspace/saves/makeup-llm/lora"
