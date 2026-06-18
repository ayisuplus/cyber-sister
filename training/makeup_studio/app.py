import gradio as gr
import subprocess
import threading
import os

status = "等待开始训练..."
log_output = ""

def start_training():
    global status, log_output
    status = "🚀 训练中..."
    log_output = ""
    try:
        proc = subprocess.Popen(
            ["bash", "/workspace/run.sh"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd="/workspace",
        )
        for line in proc.stdout:
            log_output += line
            if len(log_output) > 50000:
                log_output = log_output[-50000:]
        proc.wait()
        status = "✅ 训练完成！" if proc.returncode == 0 else f"❌ 失败 (code={proc.returncode})"
    except Exception as e:
        status = f"❌ 错误: {e}"

def get_status():
    return status, log_output[-5000:] if log_output else "暂无日志"

with gr.Blocks(title="MakeupLLM Training") as demo:
    gr.Markdown("# 🌸 MakeupLLM 训练面板\nQwen2.5-VL-7B + LoRA 妆容风格识别模型训练")
    status_text = gr.Textbox(label="状态", value="等待开始训练...", interactive=False)
    log_box = gr.Textbox(label="训练日志", lines=20, max_lines=50, interactive=False)
    btn = gr.Button("🚀 开始训练", variant="primary")
    refresh = gr.Button("🔄 刷新状态")
    
    btn.click(fn=lambda: (threading.Thread(target=start_training, daemon=True).start(), "训练已启动..."), outputs=status_text)
    refresh.click(fn=get_status, outputs=[status_text, log_box])

demo.launch(server_name="0.0.0.0", server_port=7860)
