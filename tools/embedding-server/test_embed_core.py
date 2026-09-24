"""embed_core 的纯函数单测（标准库 unittest，不加载模型）：在本目录运行 .venv\\Scripts\\python -m unittest test_embed_core"""
import unittest

from embed_core import authorized, build_response, parse_request

MODEL = "BAAI/bge-small-zh-v1.5"


class ParseRequestTest(unittest.TestCase):
    def test_single_string_and_list_both_work(self):
        self.assertEqual(parse_request({"model": MODEL, "input": "看她过得那么好"}, MODEL), (["看她过得那么好"], None))
        self.assertEqual(parse_request({"input": ["a", "b"]}, MODEL), (["a", "b"], None))

    def test_wrong_model_or_empty_input_is_refused(self):
        self.assertIsNone(parse_request({"model": "other", "input": "a"}, MODEL)[0])
        self.assertIsNone(parse_request({"model": MODEL, "input": ""}, MODEL)[0])
        self.assertIsNone(parse_request({"model": MODEL, "input": ["a", 3]}, MODEL)[0])
        self.assertIsNone(parse_request(["a"], MODEL)[0])

    def test_oversized_request_is_refused(self):
        self.assertIsNone(parse_request({"input": ["a"] * 65}, MODEL)[0])
        self.assertIsNone(parse_request({"input": "字" * 8001}, MODEL)[0])


class AuthorizedTest(unittest.TestCase):
    def test_bearer_token_must_match(self):
        self.assertTrue(authorized("Bearer secret-token", "secret-token"))
        self.assertFalse(authorized("Bearer wrong", "secret-token"))
        self.assertFalse(authorized("secret-token", "secret-token"))
        self.assertFalse(authorized(None, "secret-token"))


class BuildResponseTest(unittest.TestCase):
    def test_openai_shape_with_model_echoed(self):
        out = build_response([[0.6, 0.8], [1.0, 0.0]], MODEL)
        self.assertEqual(out["model"], MODEL)
        self.assertEqual([item["index"] for item in out["data"]], [0, 1])
        self.assertEqual(out["data"][0]["embedding"], [0.6, 0.8])


if __name__ == "__main__":
    unittest.main()
