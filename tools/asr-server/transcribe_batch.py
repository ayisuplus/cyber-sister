"""录音评测第一步：把一批录音转成文字（见 docs/04-开发/语音输入评测.md）。

  .venv\\Scripts\\python transcribe_batch.py --audio-dir D:\\某个仓库外的目录

文件名：<说话人代号>_<条件>_<句子 id>.<扩展名>，条件是 normal（正常）/ soft（小声）/ whisper（气声），
句子 id 取自 apps/api/tests/spoken-input/spoken.cases.json，例如 P1_whisper_e01-night-presentation.wav。
不合这个规则的文件照样转写，只是不计入指标。

录音是被试的声音，属于个人信息：--audio-dir 必须在仓库外，放在仓库里就拒绝运行。
结果写到 apps/api/eval-results/asr-<时间>/transcripts.jsonl（不进仓库），只有文字、情绪与事件标签、时长和耗时，
从不复制录音。转写参数与线上 sidecar 一致（asr_core.py）。
第二步：pnpm --filter cyber-sister-server eval:asr -- --run asr-<时间>
"""
import argparse
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import asr_core

REPO_ROOT = Path(__file__).resolve().parents[2]
RESULTS_ROOT = REPO_ROOT / "apps" / "api" / "eval-results"
AUDIO_SUFFIXES = {".wav", ".flac", ".ogg", ".mp3", ".m4a"}
NAME = re.compile(r"^(?P<speaker>[A-Za-z0-9]+)_(?P<condition>normal|soft|whisper)_(?P<caseId>[A-Za-z0-9-]+)$")


def parse_name(stem):
    """文件名（不含扩展名）→ 说话人、条件、句子 id；不合规则的三项都是 None。"""
    match = NAME.match(stem)
    return match.groupdict() if match else {"speaker": None, "condition": None, "caseId": None}


def inside(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def main():
    parser = argparse.ArgumentParser(description="把一批录音转成文字（录音评测第一步）")
    parser.add_argument("--audio-dir", required=True, type=Path, help="录音所在目录，必须在仓库外")
    parser.add_argument("--device", default=None, help="默认有 CUDA 就用，否则 CPU")
    args = parser.parse_args()

    audio_dir = args.audio_dir.resolve()
    if inside(audio_dir, REPO_ROOT):
        sys.exit("录音是个人信息，不要放在仓库里：请换一个仓库外的目录。")
    if not audio_dir.is_dir():
        sys.exit(f"找不到目录：{audio_dir}")
    files = sorted(p for p in audio_dir.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_SUFFIXES)
    if not files:
        sys.exit(f"{audio_dir} 里没有录音（支持 {'、'.join(sorted(AUDIO_SUFFIXES))}）。")

    import librosa  # 读常见格式，重采样成 16k 单声道

    model = asr_core.load_model(args.device or asr_core.pick_device())
    out_dir = RESULTS_ROOT / f"asr-{datetime.now():%Y%m%d-%H%M%S}"
    out_dir.mkdir(parents=True)
    written = 0
    with (out_dir / "transcripts.jsonl").open("w", encoding="utf-8") as out:
        for path in files:
            try:
                audio, _ = librosa.load(str(path), sr=asr_core.SAMPLE_RATE, mono=True)
            except Exception as error:  # m4a 等格式要装 ffmpeg 才读得了：跳过并说明，不中断整批
                print(f"跳过 {path.name}：读不了这个文件（{error}）。可以先转成 wav 再放进来。")
                continue
            started = time.perf_counter()
            result = asr_core.transcribe(model, audio)
            row = {
                "file": path.name,
                **parse_name(path.stem),
                **result,
                "durationSec": round(len(audio) / asr_core.SAMPLE_RATE, 2),
                "elapsedSec": round(time.perf_counter() - started, 3),
            }
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
            written += 1
            print(f"{path.name}：{result['text']}")
    print(f"\n转写了 {written} 条，写入 {out_dir / 'transcripts.jsonl'}")
    print(f"下一步：pnpm --filter cyber-sister-server eval:asr -- --run {out_dir.name}")


if __name__ == "__main__":
    main()
