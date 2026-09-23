"""手帐小装饰的后期处理（路线图 C18，见 docs/02-设计/手帐装饰.md）。

贴纸由本机 ComfyUI + Qwen-Image 2.1 直接出透明底 PNG（1024×1024）。本脚本只用 Pillow 与 numpy，
用 ComfyUI 自带环境跑（不另装依赖）：

  G:\\comfyui\\ComfyUI\\standalone-env\\python.exe tools/decor/process_stickers.py board --runs <runs.jsonl> --out <联系表.png>
  G:\\comfyui\\ComfyUI\\standalone-env\\python.exe tools/decor/process_stickers.py build --runs <runs.jsonl> --pick daisy=1001 sage=2002 ...

board：把候选一张张铺在信纸色上，标上物件名与 seed，拼成一张联系表给人挑。
build：把挑中的那张处理成网页素材，写进 apps/web/public/design-assets/decor/，并生成来源记录 decor-assets.json：
  1. 透明度低于 16 的归零——模型在背景里留了一层几乎看不见的底雾；
  2. 半透明边缘的颜色换成相邻不透明像素的颜色——透明处底下的颜色不一定干净，别让它渗成一圈杂色边；
  3. 裁掉多余的透明边；
  4. 描一圈白色模切边，像真的贴纸，日间夜间都从底上跳出来；
  5. 缩到显示尺寸的 2 倍，存成带透明的 WebP。
"""
import argparse
import hashlib
import json
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "apps" / "web" / "public" / "design-assets" / "decor"
PAPER = (250, 246, 236)
ALPHA_FLOOR = 16

# 每件的用途与输出长边（像素，= 最大显示尺寸的 2 倍左右）；显示尺寸在 apps/web/src/components/letter/Decor.jsx
TARGETS = {
    "daisy": {"longSide": 96, "use": "封面左下角的压花（46px）；页码那一行（30px）"},
    "forget-me-not": {"longSide": 64, "use": "页码那一行（30px）"},
    "sage": {"longSide": 64, "use": "页码那一行（30px）"},
    "ginkgo": {"longSide": 64, "use": "页码那一行（30px）"},
    "clover": {"longSide": 64, "use": "页码那一行（30px）"},
    "lavender": {"longSide": 64, "use": "页码那一行（30px）"},
    "wax-seal": {"longSide": 72, "use": "来信便签右上角（36px）；看信页信尾（34px）"},
    "stamp": {"longSide": 120, "use": "看信页信头（58px）"},
}
BORDER_AT_TARGET = 2.5  # 模切白边在成品上约多宽（像素）


def load_runs(path):
    rows = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    ok = {}
    for row in rows:
        if row.get("ok") and row.get("outputs"):
            ok[(row["item"], row["seed"])] = row  # 同一件同一个 seed 以最后一次为准
    return ok


def clean_alpha(image):
    """去底雾：透明度低于 ALPHA_FLOOR 的像素归零。"""
    rgba = np.array(image.convert("RGBA"))
    rgba[rgba[:, :, 3] < ALPHA_FLOOR, 3] = 0
    return rgba


def decontaminate(rgba, radius=8):
    """半透明像素的颜色，换成向外扩散的不透明像素颜色（逐像素一圈圈往外推）。"""
    alpha = rgba[:, :, 3]
    solid = alpha >= 230
    color = rgba[:, :, :3].astype(np.float32)
    known = solid.copy()
    filled = np.where(known[:, :, None], color, 0)
    for _ in range(radius):
        total = np.zeros_like(filled)
        count = np.zeros(known.shape, dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            shifted_known = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
            shifted_color = np.roll(np.roll(filled, dy, axis=0), dx, axis=1)
            total += np.where(shifted_known[:, :, None], shifted_color, 0)
            count += shifted_known
        grow = (~known) & (count > 0)
        filled[grow] = total[grow] / count[grow][:, None]
        known = known | grow
    edge = (alpha > 0) & ~solid & known
    out = rgba.copy()
    out[edge, :3] = np.clip(filled[edge], 0, 255).astype(np.uint8)
    return out


def trim(image, pad_ratio=0.04):
    box = image.getchannel("A").getbbox()
    if not box:
        raise SystemExit("整张都是透明的，没东西可裁")
    left, top, right, bottom = box
    pad = int(max(right - left, bottom - top) * pad_ratio)
    return image.crop((max(0, left - pad), max(0, top - pad), min(image.width, right + pad), min(image.height, bottom + pad)))


def die_cut(image, border):
    """外面描一圈白色模切边：把透明度往外扩 border 像素，填成白色，再把原图盖在上面。"""
    canvas = Image.new("RGBA", (image.width + border * 2, image.height + border * 2), (0, 0, 0, 0))
    canvas.alpha_composite(image, (border, border))
    mask = Image.fromarray(np.where(np.array(canvas.getchannel("A")) > 24, 255, 0).astype(np.uint8), "L")
    size = 3
    grown = mask
    for _ in range(max(1, border // 1)):
        grown = grown.filter(ImageFilter.MaxFilter(size))
    grown = grown.filter(ImageFilter.GaussianBlur(0.8))
    white = Image.new("RGBA", canvas.size, (255, 253, 248, 0))
    white.putalpha(grown)
    white.alpha_composite(canvas)
    return white


def build_one(source, long_side):
    image = Image.fromarray(decontaminate(clean_alpha(Image.open(source))), "RGBA")
    image = trim(image)
    scale = max(image.size) / long_side
    border = max(2, round(BORDER_AT_TARGET * scale))
    image = die_cut(image, border)
    ratio = long_side / max(image.size)
    return image.resize((max(1, round(image.width * ratio)), max(1, round(image.height * ratio))), Image.Resampling.LANCZOS)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command_board(args):
    runs = load_runs(args.runs)
    items = list(dict.fromkeys(item for item, _ in runs))
    seeds = sorted({seed for _, seed in runs})
    cell, label_h, gap = 220, 34, 12
    sheet = Image.new("RGB", (gap + len(seeds) * (cell + gap), gap + len(items) * (cell + label_h + gap)), PAPER)
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 16)
    except OSError:
        font = ImageFont.load_default()
    for row, item in enumerate(items):
        for col, seed in enumerate(seeds):
            x = gap + col * (cell + gap)
            y = gap + row * (cell + label_h + gap)
            run = runs.get((item, seed))
            if run:
                sticker = build_one(run["outputs"][-1], cell - 20)
                sheet.paste(sticker, (x + (cell - sticker.width) // 2, y + (cell - sticker.height) // 2), sticker)
            draw.rectangle((x, y, x + cell, y + cell), outline=(226, 218, 200))
            draw.text((x + 4, y + cell + 6), f"{item}  ·  seed {seed}", fill=(90, 84, 70), font=font)
    sheet.save(args.out)
    print(f"联系表：{args.out}（{len(items)} 件 × {len(seeds)} 个 seed）")


def command_build(args):
    runs = load_runs(args.runs)
    picks = dict(pair.split("=", 1) for pair in args.pick)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files, candidates = [], []
    for item, seed_text in picks.items():
        run = runs[(item, int(seed_text))]
        target = OUT_DIR / f"{item}.webp"
        sticker = build_one(run["outputs"][-1], TARGETS[item]["longSide"])
        sticker.save(target, "WEBP", quality=90, method=6)
        files.append({
            "file": target.name, "use": TARGETS[item]["use"], "width": sticker.width, "height": sticker.height,
            "bytes": target.stat().st_size, "sha256": sha256(target),
            "seed": run["seed"], "promptId": run["promptId"], "prompt": run["prompt"],
        })
        print(f"{target.name}: {sticker.width}×{sticker.height}, {target.stat().st_size} B")
    for (item, seed), run in sorted(runs.items()):
        if picks.get(item) != str(seed):
            candidates.append({"item": item, "seed": seed, "promptId": run["promptId"], "reason": "风格板上没被选中"})
    manifest = {
        "version": 1,
        "created": date.today().isoformat(),
        "status": "implemented_pending_user_acceptance",
        "purpose": "手帐小装饰（路线图 C18）：页边的压花、叶子、火漆印与邮票，纯装饰，alt 为空",
        "generator": "本机 ComfyUI 0.37.0",
        "workflow": "Qwen-Image 2.1 文生图（作者本机 ComfyUI 工作流，界面格式；经 comfy-cli 1.20.0 转成接口格式后提交），30 步，euler / simple，cfg 1，1024×1024，直接出 RGBA 透明底",
        "model": {
            "diffusion": "qwen_image_2.1_bf16.safetensors", "textEncoder": "qwen3vl_8b_fp8_scaled.safetensors", "vae": "qwen_image_2.1_vae_bf16.safetensors",
            "source": "https://huggingface.co/Comfy-Org/Qwen-Image-2.1（原模型 Qwen/Qwen-Image-2.1）",
            "license": "Qwen Research License：只许非商业用途；对生成的图没有另加限制。本项目是课程作业与论文原型，属非商业用途；若日后商用，须换掉这批贴纸或另取授权",
        },
        "processing": "tools/decor/process_stickers.py build：透明度 <16 归零去底雾 → 半透明边缘换成相邻不透明像素的颜色 → 裁透明边 → 约 2.5px 白色模切边 → 缩到显示尺寸的 2 倍 → WebP（quality 90）",
        "qa": "作者在风格板联系表上逐件挑选；成品在日间与夜间信纸上人工看过",
        "files": files,
        "rejectedCandidates": candidates,
    }
    (OUT_DIR / "decor-assets.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(entry["bytes"] for entry in files)
    print(f"共 {len(files)} 件，{total} B；来源记录写进 {OUT_DIR / 'decor-assets.json'}")


def main():
    parser = argparse.ArgumentParser(description="手帐小装饰的后期处理")
    sub = parser.add_subparsers(dest="command", required=True)
    board = sub.add_parser("board", help="拼一张候选联系表")
    board.add_argument("--runs", required=True)
    board.add_argument("--out", required=True)
    build = sub.add_parser("build", help="把挑中的候选做成网页素材并写来源记录")
    build.add_argument("--runs", required=True)
    build.add_argument("--pick", nargs="+", required=True, help="物件=seed，例如 daisy=1001")
    args = parser.parse_args()
    (command_board if args.command == "board" else command_build)(args)


if __name__ == "__main__":
    main()
