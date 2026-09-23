"""SenseVoice 转写的共用部分：线上 sidecar（server.py）与录音评测（transcribe_batch.py）用同一套参数。

只把文字交给她（路线图 C17）：SenseVoice 会在每段文字前标上语种、情绪、事件与是否规整
（<|zh|><|SAD|><|Cry|><|withitn|>……）。这里把标签全部拿掉，情绪与事件单独成列表：
线上 API 只转交文字，标签只在录音评测里用来量它准不准。
torch 与 funasr 在加载模型时才导入，单测不用装模型。
"""
import re

MODEL_ID = "iic/SenseVoiceSmall"
VAD_MODEL = "fsmn-vad"
SAMPLE_RATE = 16000

EMOTIONS = frozenset({"HAPPY", "SAD", "ANGRY", "NEUTRAL", "FEARFUL", "DISGUSTED", "SURPRISED", "EMO_UNKNOWN"})
EVENTS = frozenset({"Speech", "BGM", "Applause", "Laughter", "Cry", "Sneeze", "Breath", "Cough", "Sing", "Speech_Noise", "Event_UNK"})
_TAG = re.compile(r"<\|([^|]*)\|>")


def split_rich_tags(raw):
    """SenseVoice 原始输出 → {"text", "emotions", "events"}。

    文字里不留任何标签或表情；情绪、事件按出现顺序列出（每段各一个），语种与规整标记丢掉。
    """
    raw = raw or ""
    emotions, events = [], []
    for tag in _TAG.findall(raw):
        if tag in EMOTIONS:
            emotions.append(tag)
        elif tag in EVENTS:
            events.append(tag)
    return {"text": _TAG.sub("", raw).strip(), "emotions": emotions, "events": events}


def pick_device():
    import torch

    return "cuda:0" if torch.cuda.is_available() else "cpu"


def load_model(device):
    """SenseVoiceSmall + fsmn-vad。首跑从 ModelScope 下载，之后读 MODELSCOPE_CACHE 里的缓存。"""
    from funasr import AutoModel

    return AutoModel(
        model=MODEL_ID,
        vad_model=VAD_MODEL,
        vad_kwargs={"max_single_segment_time": 30000},
        device=device,
        disable_update=True,
    )


def transcribe(model, audio):
    """16kHz 单声道 float32 采样 → {"text", "emotions", "events"}。

    use_itn 同时管标点与数字规整（说「九点」写成「9点」）：关掉就没有标点，所以保持开着，
    数字写法的差别由倾诉识别那边统一处理（路线图 C17）。
    """
    result = model.generate(
        input=audio,
        cache={},
        language="auto",
        use_itn=True,
        batch_size_s=60,
        merge_vad=True,
        merge_length_s=15,
    )
    return split_rich_tags(result[0]["text"] if result else "")
