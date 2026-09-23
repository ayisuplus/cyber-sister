"""asr_core 的纯函数单测（标准库 unittest，不加载模型）：在本目录运行 .venv\\Scripts\\python -m unittest test_asr_core"""
import unittest

from asr_core import split_rich_tags


class SplitRichTagsTest(unittest.TestCase):
    def test_text_has_no_tags_and_emotions_events_are_listed_apart(self):
        raw = "<|zh|><|SAD|><|Speech|><|withitn|>明早9点要汇报。<|zh|><|NEUTRAL|><|Cry|><|withitn|>好累。"
        self.assertEqual(
            split_rich_tags(raw),
            {"text": "明早9点要汇报。好累。", "emotions": ["SAD", "NEUTRAL"], "events": ["Speech", "Cry"]},
        )

    def test_no_emoji_ever_reaches_the_text(self):
        # 旧版用 rich_transcription_postprocess 会写成「哈哈，终于放假了。😊」这样
        out = split_rich_tags("<|zh|><|HAPPY|><|Laughter|><|withitn|>哈哈，终于放假了。")
        self.assertEqual(out["text"], "哈哈，终于放假了。")
        self.assertEqual(out["emotions"], ["HAPPY"])
        self.assertEqual(out["events"], ["Laughter"])

    def test_no_speech_gives_empty_text(self):
        self.assertEqual(split_rich_tags("<|nospeech|><|Event_UNK|>"), {"text": "", "emotions": [], "events": ["Event_UNK"]})

    def test_empty_or_missing_output(self):
        empty = {"text": "", "emotions": [], "events": []}
        self.assertEqual(split_rich_tags(""), empty)
        self.assertEqual(split_rich_tags(None), empty)


if __name__ == "__main__":
    unittest.main()
