#!/usr/bin/env python3
"""
重新打包训练数据：把图片复制到统一目录，更新JSON路径为相对路径
"""
import json, os, shutil
from pathlib import Path

PROJECT_ROOT = Path("E:/projects/AI妆教")
DATA_DIR = PROJECT_ROOT / "data"
PACK_DIR = PROJECT_ROOT / "training" / "makeup_dataset"
IMAGES_DIR = PACK_DIR / "images"

def main():
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    
    # 加载原始 train/eval
    for split in ["train", "eval"]:
        src = DATA_DIR / "llamafactory" / f"{split}.json"
        with open(src, "r", encoding="utf-8") as f:
            records = json.load(f)
        
        new_records = []
        for i, r in enumerate(records):
            new_images = []
            for img_path in r.get("images", []):
                if not os.path.exists(img_path):
                    continue
                
                # 用 hash 命名避免冲突
                ext = Path(img_path).suffix
                new_name = f"{hash(img_path) & 0xFFFFFFFF:08x}{ext}"
                dst = IMAGES_DIR / new_name
                
                if not dst.exists():
                    shutil.copy2(img_path, dst)
                
                # 使用相对路径
                new_images.append(f"images/{new_name}")
            
            r["images"] = new_images
            new_records.append(r)
            
            if (i + 1) % 500 == 0:
                print(f"  {split}: {i+1}/{len(records)}")
        
        # 写入
        dst = PACK_DIR / f"{split}.json"
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(new_records, f, ensure_ascii=False, indent=2)
        print(f"✅ {split}: {len(new_records)} 条 → {dst}")
    
    # 复制 dataset_info.json
    shutil.copy2(DATA_DIR / "llamafactory" / "dataset_info.json", PACK_DIR / "dataset_info.json")
    
    # 复制训练脚本
    shutil.copy2(PROJECT_ROOT / "training" / "train_makeup_model.sh", PACK_DIR / "train.sh")
    
    # 统计
    total_images = len(list(IMAGES_DIR.glob("*")))
    total_size = sum(f.stat().st_size for f in IMAGES_DIR.glob("*"))
    print(f"\n📦 数据集打包完成:")
    print(f"   目录: {PACK_DIR}")
    print(f"   图片: {total_images} 张, {total_size/1024/1024:.0f} MB")

if __name__ == "__main__":
    main()
