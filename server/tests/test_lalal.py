"""LALAL.AI contract + app pipeline tests, offline and without API credits.

Run from server: .venv/bin/python -m unittest tests.test_lalal -v
"""
import io
import json
import logging
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import requests
import soundfile as sf
from fastapi.testclient import TestClient

TEST_DATA = tempfile.TemporaryDirectory(prefix="choreo-test-")
os.environ["DATA_DIR"] = TEST_DATA.name

from app import main
from app.lalal import ALL_STEMS, MULTISTEM_STEMS, LalalClient, LalalError, LalalSeparator
from app.separation import SeparationConfig
from tests.synth import make_song, SR

logging.getLogger("httpx").setLevel(logging.WARNING)


def response(payload=None, status=200, content=None):
    result = MagicMock()
    result.__enter__.return_value = result
    result.ok = 200 <= status < 300
    result.status_code = status
    result.json.return_value = payload
    result.iter_content.return_value = [content] if content else []
    return result


def wav_bytes(audio):
    buf = io.BytesIO()
    sf.write(buf, audio.T, SR, format="WAV", subtype="FLOAT")
    return buf.getvalue()


class LalalTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"LALAL_API_KEY": "test-license"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = TestClient(main.app)

    def test_upload_and_split_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "노래.wav"
            path.write_bytes(b"audio-data")
            seen = []

            def post(url, **kw):
                if "data" in kw:
                    seen.append(kw["data"].read())
                return response({"id": "source"} if url.endswith("upload/") else {"task_id": "task"})

            with patch("app.lalal.requests.post", side_effect=post) as mocked:
                api = LalalClient("test-license")
                self.assertEqual(api.upload(path), "source")
                self.assertEqual(api.split("source", "vocals", "clear_cut"), "task")
                api.split_multiple("source", "clear_cut")
                calls = mocked.call_args_list
                self.assertEqual(seen, [b"audio-data"])
                self.assertIn("filename*=UTF-8''", calls[0].kwargs["headers"]["Content-Disposition"])
                self.assertNotIn("files", calls[0].kwargs)
                self.assertEqual(calls[1].kwargs["json"], {"source_id": "source", "presets": {
                    "stem": "vocals", "splitter": "auto", "extraction_level": "clear_cut"}})
                self.assertTrue(calls[2].args[0].endswith("split/multistem/"))
                self.assertEqual(calls[2].kwargs["json"]["presets"]["stem_list"], ["vocals", "drum", "bass"])

    def test_polling_failures_and_timeout(self):
        api = LalalClient("test-license", poll_interval=0)
        with patch("app.lalal.requests.post", side_effect=[
            response({"result": {"task": {"status": "progress", "progress": 42}}}),
            response({"result": {"task": {"status": "success", "result": {"tracks": [{"label": "vocals"}]}}}}),
        ]):
            progress = []
            self.assertEqual(api.wait("task", progress.append), [{"label": "vocals"}])
            self.assertEqual(progress, [0.42, 1.0])
        for task in [{"status": "cancelled"}, {"status": "server_error"}, {"status": "error"},
                     {"status": "success", "result": {"tracks": []}}, None]:
            with self.subTest(task=task), patch("app.lalal.requests.post", return_value=response({"result": {"task": task}})):
                with self.assertRaises(LalalError):
                    api.wait("task")
        with patch("app.lalal.requests.post", return_value=response(status=403)):
            with self.assertRaisesRegex(LalalError, "403"):
                api.split("source", "vocals", "clear_cut")
        with patch("app.lalal.requests.post", side_effect=requests.Timeout):
            with self.assertRaises(LalalError):
                api.split("source", "vocals", "clear_cut")
        api.timeout = 0
        with self.assertRaisesRegex(LalalError, "초과"):
            api.wait("task")

    def test_missing_key_and_invalid_options_are_rejected_before_queueing(self):
        count = len(main.JOBS)
        with patch.dict(os.environ, {"LALAL_API_KEY": ""}):
            self.assertFalse(self.client.get("/health").json()["providers"]["lalal"]["ready"])
            result = self.client.post("/jobs", files={"file": ("x.wav", b"x")}, data={"provider": "lalal"})
            self.assertEqual(result.status_code, 503)
        for data in [{"provider": "unknown"}, {"provider": "lalal", "lalal_mode": "bad"},
                     {"provider": "lalal", "extraction_level": "bad"}, {"model": "bad"},
                     *[{"provider": "lalal", "lalal_mode": "multistem", "lalal_stems": value}
                       for value in ['[]', '["drum", "drum"]', '["no_vocals"]', '[{}]', 'oops']],
                     {"provider": "lalal", "lalal_mode": "multistem", "lalal_stems": '["piano"]', "split_vocals": "true"}]:
            result = self.client.post("/jobs", files={"file": ("x.wav", b"x")}, data=data)
            self.assertEqual(result.status_code, 400)
        self.assertEqual(len(main.JOBS), count)
        self.assertNotIn("test-license", json.dumps(self.client.get("/health").json()))

    def test_download_does_not_send_credentials(self):
        api = LalalClient("test-license")
        with tempfile.TemporaryDirectory() as tmp, patch("app.lalal.requests.get", return_value=response(content=b"wav")) as get:
            path = Path(tmp) / "out.wav"
            api.download("http://d.lalal.ai/result", path)
            self.assertEqual(path.read_bytes(), b"wav")
            self.assertEqual(get.call_args.args[0], "https://d.lalal.ai/result")
            self.assertNotIn("headers", get.call_args.kwargs)
            for url in ["https://evil.test/result", "file:///etc/passwd", "https://lalal.ai.evil.test/result"]:
                with self.assertRaises(LalalError):
                    api.download(url, path)

    def test_rejects_truncated_stems(self):
        separator = LalalSeparator(SeparationConfig(provider="lalal"))
        with patch("app.lalal.load_audio", return_value=np.zeros((2, 100), np.float32)):
            with self.assertRaises(LalalError):
                separator._decode(Path("ignored.wav"), 44100)

    def test_two_four_and_ten_stem_jobs_finish_with_playable_files_and_analysis(self):
        mix, _, _ = make_song(bars_per_sec=4)
        mix = (mix / max(1, np.abs(mix).max())).astype(np.float32)
        for mode, names in [("vocals", ["vocals", "instrumental"]),
                            ("four_stem", ["vocals", "drums", "bass", "other"]),
                            ("multistem", ["vocals", "drums", "bass", "piano", "electric_guitar", "acoustic_guitar", "synthesizer", "strings", "wind", "other"])]:
            with self.subTest(mode=mode):
                groups = ([["vocals", "no_vocals"]] if mode == "vocals" else
                          [["vocals", "drum", "bass", "no_multistem"]] if mode == "four_stem" else
                          [[*MULTISTEM_STEMS, "no_multistem"], ["synthesizer", "no_synthesizer"],
                           ["strings", "no_strings"], ["wind", "no_wind"]])
                posts = []
                for stage, labels in enumerate(groups):
                    tracks = [{"label": label, "type": "back" if label.startswith("no_") else "stem",
                               "url": f"https://d.lalal.ai/{label}"} for label in reversed(labels)]
                    posts.extend([response({"id": f"source{stage}"}), response({"task_id": "task"}),
                                  response({"result": {"task": {"status": "success", "result": {"tracks": tracks}}}})])
                audio = wav_bytes(mix / len(names))
                with patch("app.lalal.requests.post", side_effect=posts), \
                     patch("app.lalal.requests.get", side_effect=lambda *a, **kw: response(content=audio)), \
                     patch("app.analysis._beats_beat_this", side_effect=RuntimeError("offline test")):
                    uploaded = self.client.post("/jobs", files={"file": ("song.wav", wav_bytes(mix), "audio/wav")},
                                                data={"provider": "lalal", "lalal_mode": mode})
                    self.assertEqual(uploaded.status_code, 200, uploaded.text)
                    job_id = uploaded.json()["id"]
                    deadline = time.monotonic() + 180  # first librosa/numba compilation can take a minute
                    while time.monotonic() < deadline:
                        job = self.client.get(f"/jobs/{job_id}").json()
                        if job["status"] in ("done", "error"):
                            break
                        time.sleep(0.05)
                    self.assertEqual(job["status"], "done", job.get("error"))
                self.assertEqual(job["stems"], names)
                analysis = self.client.get(f"/jobs/{job_id}/analysis").json()
                self.assertEqual(analysis["separation"]["provider"], "lalal")
                self.assertEqual(analysis["separation"]["device"], "cloud")
                self.assertGreater(len(analysis["beats"]), 8)
                self.assertEqual(set(analysis["envelope"]["stems"]), set(names))
                for url in job["files"].values():
                    result = self.client.get(url)
                    self.assertEqual(result.status_code, 200)
                    self.assertGreater(len(result.content), 1000)
                self.assertNotIn("test-license", json.dumps(job))
                self.assertEqual(self.client.delete(f"/jobs/{job_id}").status_code, 200)

    def test_all_instruments_extract_from_remainder_and_keep_full_length(self):
        audio = np.full((2, SR), 0.8, dtype=np.float32)
        stages = []
        uploads = []
        current = {}
        payloads = {}

        def post(url, **kw):
            if url.endswith("upload/"):
                decoded, _ = sf.read(io.BytesIO(kw["data"].read()), dtype="float32")
                uploads.append(float(decoded.mean()))
                return response({"id": "source"})
            if "/split/" in url:
                presets = kw["json"]["presets"]
                stages.append(presets)
                labels = presets.get("stem_list", [presets.get("stem")])
                tracks = []
                for label in labels:
                    result_url = f"https://d.lalal.ai/{len(stages)}/{label}"
                    payloads[result_url] = wav_bytes(audio * 0.05)
                    tracks.append({"label": label, "type": "stem", "url": result_url})
                back = "no_multistem" if len(labels) > 1 else f"no_{labels[0]}"
                result_url = f"https://d.lalal.ai/{len(stages)}/{back}"
                payloads[result_url] = wav_bytes(audio * (1 - 0.15 * len(stages)))
                tracks.append({"label": back, "type": "back", "url": result_url})
                current["tracks"] = tracks
                return response({"task_id": "task"})
            return response({"result": {"task": {"status": "success", "result": current}}})

        with patch("app.lalal.requests.post", side_effect=post), patch("app.lalal.requests.get", side_effect=lambda url, **kw: response(content=payloads[url])):
            progress = []
            stems = LalalSeparator(SeparationConfig(provider="lalal", lalal_mode="multistem")).separate(audio, SR, progress.append)
        self.assertEqual(set(stems), (set(ALL_STEMS) - {"drum"}) | {"drums", "other"})
        self.assertEqual(stages[0]["stem_list"], list(MULTISTEM_STEMS))
        self.assertEqual([stage["stem"] for stage in stages[1:]], ["synthesizer", "strings", "wind"])
        self.assertTrue(all(stage["splitter"] == "phoenix" for stage in stages[1:]))
        np.testing.assert_allclose(uploads, [0.8, 0.68, 0.56, 0.44], atol=0.001)
        self.assertTrue(all(value.shape == audio.shape for value in stems.values()))
        self.assertEqual(progress[-1], 1)
        self.assertEqual(progress, sorted(progress))

    def test_lead_backing_optional_and_custom_subset(self):
        audio = np.zeros((2, SR), dtype=np.float32)
        for has_backing in (True, False):
            labels = ["vocals@0", "no_vocals", "mix_no_lead"] + (["vocals@1"] if has_backing else [])
            vocals = [{"label": name, "type": "stem" if name.startswith("vocals@") else "back", "url": f"https://d.lalal.ai/{name}"} for name in labels]
            piano = [{"label": name, "type": kind, "url": f"https://d.lalal.ai/{name}"} for name, kind in [("piano", "stem"), ("no_piano", "back")]]
            cfg = SeparationConfig(provider="lalal", lalal_mode="multistem", lalal_stems=["vocals", "piano"], split_vocals=True)
            separator = LalalSeparator(cfg)
            with patch.object(separator.client, "upload", return_value="source"), patch.object(separator.client, "split", return_value="task") as split, patch.object(separator.client, "wait", side_effect=[vocals, piano]), patch.object(separator.client, "download"), patch.object(separator, "_decode", return_value=audio):
                stems = separator.separate(audio, SR)
            expected = {"lead_vocals", "piano", "other"} | ({"backing_vocals"} if has_backing else set())
            self.assertEqual(set(stems), expected)
            self.assertEqual(split.call_args_list[0].args, ("source", "vocals", "clear_cut", True))
            self.assertEqual(split.call_args_list[1].args, ("source", "piano", "clear_cut", False))

    def test_original_picked_filename_is_preserved(self):
        with patch.object(main.POOL, "submit"):
            result = self.client.post("/jobs", files={"file": ("cache-uuid.mp3", b"audio", "audio/mpeg")},
                                      data={"original_name": "내 노래.mp3"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["name"], "내 노래.mp3")
        job_id = result.json()["id"]
        main._update(job_id, status="error")
        self.assertEqual(self.client.delete(f"/jobs/{job_id}").status_code, 200)

    def test_old_clients_keep_demucs_and_busy_jobs_cannot_be_deleted(self):
        with patch.object(main.POOL, "submit") as submit:
            result = self.client.post("/jobs", files={"file": ("song.wav", b"placeholder", "audio/wav")})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["config"]["provider"], "demucs")
        self.assertEqual(submit.call_args.args[3].model, "htdemucs")
        job_id = result.json()["id"]
        self.assertEqual(self.client.delete(f"/jobs/{job_id}").status_code, 409)
        main._update(job_id, status="error")
        self.assertEqual(self.client.delete(f"/jobs/{job_id}").status_code, 200)


if __name__ == "__main__":
    unittest.main()
