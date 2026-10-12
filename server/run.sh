#!/usr/bin/env bash
# 맥에서 분석 서버 실행. 폰에서 접속하려면 같은 Wi-Fi에서 http://<맥 IP>:8000
set -e
cd "$(dirname "$0")"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
fi
export PYTORCH_ENABLE_MPS_FALLBACK=1  # MPS에서 미지원 op(FFT 등)는 CPU로 자동 fallback
command -v ffmpeg >/dev/null || { echo "ffmpeg 필요: brew install ffmpeg"; exit 1; }
IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
echo "▶ 앱의 서버 주소에 입력:  http://${IP}:8000"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
