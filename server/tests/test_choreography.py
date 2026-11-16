import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.choreography import router


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'ffmpeg required')
class ChoreographyRenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.path = Path(cls.temp.name)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', str(cls.path / 'audio.m4a')], check=True)
        for color in ('red', 'blue'):
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', f'color={color}:s=64x64:d=1:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(cls.path / f'{color}.mp4')], check=True)
        app = FastAPI()
        app.include_router(router)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_mp4_has_music_video_and_black_gaps(self):
        clips = [{'start': .2, 'sourceStart': .1, 'duration': .6}, {'start': 1.2, 'sourceStart': 0, 'duration': .6}]
        files = [('audios', ('audio.m4a', (self.path / 'audio.m4a').read_bytes(), 'audio/mp4'))]
        files += [('videos', (f'{color}.mp4', (self.path / f'{color}.mp4').read_bytes(), 'video/mp4')) for color in ('red', 'blue')]
        response = self.client.post('/choreography/render', data={'timeline': json.dumps(clips)}, files=files)
        self.assertEqual(response.status_code, 200, response.text[:300] if response.status_code != 200 else '')
        output = self.path / 'result.mp4'
        output.write_bytes(response.content)
        streams = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', str(output)], text=True)
        self.assertIn('h264', streams)
        self.assertIn('aac', streams)
        def pixel(t):
            return tuple(subprocess.check_output(['ffmpeg', '-loglevel', 'error', '-ss', str(t), '-i', str(output), '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']))
        self.assertLess(max(pixel(.05)), 10)
        self.assertGreater(pixel(.4)[0], 100)
        self.assertLess(max(pixel(.95)), 10)
        self.assertGreater(pixel(1.4)[2], 100)

    def test_reject_overlapping_clips(self):
        clips = [{'start': 0, 'sourceStart': 0, 'duration': 1}, {'start': .5, 'sourceStart': 0, 'duration': 1}]
        files = [('audios', ('audio.m4a', b'x', 'audio/mp4')), ('videos', ('a.mp4', b'x', 'video/mp4')), ('videos', ('b.mp4', b'x', 'video/mp4'))]
        response = self.client.post('/choreography/render', data={'timeline': json.dumps(clips)}, files=files)
        self.assertEqual(response.status_code, 400)
        self.assertIn('overlap', response.json()['detail'])

    def test_slow_recording_is_retimed_to_music(self):
        clips = [{'start': .2, 'sourceStart': 0, 'duration': .5, 'sourceRate': .5}]
        files = [('audios', ('audio.m4a', (self.path / 'audio.m4a').read_bytes(), 'audio/mp4')),
                 ('videos', ('red.mp4', (self.path / 'red.mp4').read_bytes(), 'video/mp4'))]
        response = self.client.post('/choreography/render', data={'timeline': json.dumps(clips)}, files=files)
        self.assertEqual(response.status_code, 200)
        output = self.path / 'slow-result.mp4'
        output.write_bytes(response.content)
        def pixel(t):
            return tuple(subprocess.check_output(['ffmpeg', '-loglevel', 'error', '-ss', str(t), '-i', str(output), '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']))
        self.assertGreater(pixel(.6)[0], 100)
        self.assertLess(max(pixel(.9)), 10)

    def test_reject_invalid_recording_speed(self):
        clips = [{'start': 0, 'sourceStart': 0, 'duration': 1, 'sourceRate': 0}]
        files = [('audios', ('audio.m4a', b'x', 'audio/mp4')), ('videos', ('a.mp4', b'x', 'video/mp4'))]
        response = self.client.post('/choreography/render', data={'timeline': json.dumps(clips)}, files=files)
        self.assertEqual(response.status_code, 400)

if __name__ == '__main__':
    unittest.main()
