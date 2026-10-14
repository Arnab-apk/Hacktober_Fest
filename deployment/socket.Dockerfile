FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv build-essential git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
COPY Skippy_harness ./Skippy_harness
COPY skippy_paradox/backend ./skippy_paradox/backend
RUN python3 -m venv /opt/skippy && /opt/skippy/bin/pip install --no-cache-dir -r requirements.txt
COPY skippy_paradox/backend-socket ./skippy_paradox/backend-socket
RUN cd skippy_paradox/backend-socket && npm ci
ENV PATH="/opt/skippy/bin:$PATH" SKIPPY_PYTHON=/opt/skippy/bin/python SKIPPY_ALLOW_SHELL=false PYTHONIOENCODING=utf-8
WORKDIR /app/skippy_paradox/backend-socket
CMD ["node", "server.js"]
