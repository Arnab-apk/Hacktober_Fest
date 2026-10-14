"""Real subprocess bridge tests with a deterministic local model endpoint."""
import json
import os
from pathlib import Path
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'skippy_paradox/backend'))
sys.path.insert(0, str(ROOT / 'Skippy_harness'))
from fastapi.testclient import TestClient
from main import app
from skippy_harness.web_worker import safe_path


class ModelServer(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, value):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(value).encode())

    def do_GET(self):
        self.reply({'models': [{'name': 'test:latest'}]})

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/api/show':
            self.reply({'capabilities': ['tools']})
            return
        tools = [m for m in data['messages'] if m['role'] == 'tool']
        if not tools:
            message = {'role': 'assistant', 'tool_calls': [{'function': {'name': 'write_file', 'arguments': {'path': 'src/test.txt', 'content': 'first'}}}]}
        elif len(tools) == 1:
            message = {'role': 'assistant', 'tool_calls': [{'function': {'name': 'write_file', 'arguments': {'path': 'src/test.txt', 'content': ''}}}]}
        else:
            message = {'role': 'assistant', 'content': 'Verified changes.'}
        self.reply({'message': message})


class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), ModelServer)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.env = patch.dict(os.environ, {'OLLAMA_BASE_URL': f'http://127.0.0.1:{cls.server.server_port}/v1', 'SKIPPY_ACCESS_TOKEN': ''})
        cls.env.start()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.env.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def test_real_worker_streams_incremental_and_empty_edits(self):
        response = self.client.post('/api/harness/runs', json={'provider': 'ollama', 'model': 'test:latest', 'prompt': 'make edits'})
        self.assertEqual(response.status_code, 200)
        events = [json.loads(line) for line in response.text.splitlines()]
        edits = [e for e in events if e['type'] == 'file']
        self.assertEqual([(e['previous'], e['content']) for e in edits], [(None, 'first'), ('first', '')])
        self.assertEqual(events[-1]['type'], 'done')
        self.assertFalse((ROOT / 'src/test.txt').exists())

    def test_model_discovery_uses_harness(self):
        response = self.client.post('/api/harness/models', json={'provider': 'ollama'})
        self.assertEqual(response.json()['models'], ['test:latest'])

    def test_path_escape_and_private_files_blocked(self):
        for path in ('../escape', 'C:/escape', '/escape', '.git/config', '.env', 'a/../../escape', 'a\\escape'):
            with self.assertRaises(ValueError, msg=path):
                safe_path(path)

    def test_remote_access_requires_token(self):
        response = self.client.post('/api/harness/models', json={}, headers={'Origin': 'http://remote.example:3100'})
        self.assertEqual(response.status_code, 403)

    def test_invalid_run_token_cannot_approve(self):
        response = self.client.post('/api/harness/runs/missing/approval', json={'approved': True}, headers={'X-Run-Token': 'wrong'})
        self.assertEqual(response.status_code, 404)

    def test_invalid_request_rejected(self):
        self.assertEqual(self.client.post('/api/harness/runs', json={'provider': 'unknown'}).status_code, 422)
        self.assertEqual(self.client.post('/api/harness/runs', json={}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
