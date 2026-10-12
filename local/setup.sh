#!/usr/bin/env bash
# 맥 로컬 파이프라인 환경 설치 (한 번만)
set -e
cd "$(dirname "$0")"
command -v ffmpeg >/dev/null || { echo "ffmpeg 필요: brew install ffmpeg"; exit 1; }
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
echo
echo "완료. 사용 예:"
echo "  source .venv/bin/activate"
echo "  python separate.py ~/Music/song.mp3"
