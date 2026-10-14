"""Gemma API boundary tests; no credentials or paid model calls required."""
import base64
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'skippy_paradox/backend'))
from main import app


class GemmaTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'GEMINI_API_KEY': 'server-test-secret', 'GEMMA_MODEL': 'gemma-4-26b-a4b-it', 'SKIPPY_ACCESS_TOKEN': ''})
        self.env.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()

    def answer(self, status=200, data=None):
        return httpx.Response(status, json=data or {'candidates': [{'content': {'parts': [{'text': 'private reasoning', 'thought': True}, {'text': 'Try a bounds check.'}]}, 'finishReason': 'STOP'}]})

    def test_multimodal_request_and_history(self):
        image = base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()
        with patch('routers.gemma.httpx.AsyncClient.post', new_callable=AsyncMock, return_value=self.answer()) as post:
            response = self.client.post('/api/gemma/mentor', json={
                'prompt': 'Why this error?', 'mode': 'debug',
                'history': [{'role': 'user', 'content': 'Hello'}, {'role': 'assistant', 'content': 'Hi'}],
                'code': {'path': 'main.py', 'language': 'python', 'content': 'items[3]', 'truncated': True},
                'image': {'mimeType': 'image/png', 'data': image}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['text'], 'Try a bounds check.')
        self.assertEqual(response.json()['model'], 'gemma-4-26b-a4b-it')
        args = post.call_args
        self.assertIn('gemma-4-26b-a4b-it:generateContent', args.args[0])
        self.assertEqual(args.kwargs['headers']['x-goog-api-key'], 'server-test-secret')
        contents = args.kwargs['json']['contents']
        self.assertEqual([c['role'] for c in contents], ['user', 'model', 'user'])
        self.assertEqual(contents[-1]['parts'][1]['inlineData']['data'], image)
        self.assertIn('Truncated: True', contents[-1]['parts'][0]['text'])

    def test_status_does_not_expose_secret(self):
        response = self.client.get('/api/gemma/status')
        self.assertTrue(response.json()['configured'])
        self.assertNotIn('server-test-secret', response.text)

    def test_access_token(self):
        with patch.dict(os.environ, {'SKIPPY_ACCESS_TOKEN': 'room-secret'}):
            self.assertEqual(self.client.get('/api/gemma/status').status_code, 401)
            self.assertEqual(self.client.post('/api/gemma/mentor', json={'prompt': 'Hi'}).status_code, 401)
            self.assertEqual(self.client.get('/api/gemma/status', headers={'Authorization': 'Bearer room-secret'}).status_code, 200)

    def test_remote_requires_token(self):
        self.assertEqual(self.client.get('/api/gemma/status', headers={'Origin': 'https://remote.example'}).status_code, 403)

    def test_missing_key(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}):
            self.assertEqual(self.client.post('/api/gemma/mentor', json={'prompt': 'Hi'}).status_code, 503)

    def test_invalid_model(self):
        with patch.dict(os.environ, {'GEMMA_MODEL': 'invented-model'}):
            self.assertEqual(self.client.post('/api/gemma/mentor', json={'prompt': 'Hi'}).status_code, 503)

    def test_input_bounds(self):
        for body, expected in [({'prompt': '  '}, 400), ({'prompt': 'x' * 8001}, 422),
                               ({'prompt': 'Hi', 'mode': 'execute'}, 422),
                               ({'prompt': 'Hi', 'history': [{'role': 'user', 'content': 'Hi'}] * 11}, 422),
                               ({'prompt': 'Hi', 'code': {'path': 'a', 'content': 'x' * 24001}}, 422)]:
            with self.subTest(body=str(body)[:80]):
                self.assertEqual(self.client.post('/api/gemma/mentor', json=body).status_code, expected)

    def test_invalid_image(self):
        for data in ['not base64!', base64.b64encode(b'not a png').decode()]:
            self.assertEqual(self.client.post('/api/gemma/mentor', json={'prompt': 'Hi', 'image': {'mimeType': 'image/png', 'data': data}}).status_code, 400)

    def test_image_size(self):
        image = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'a' * (4 * 1024 * 1024 - 7)).decode()
        self.assertEqual(self.client.post('/api/gemma/mentor', json={'prompt': 'Hi', 'image': {'mimeType': 'image/png', 'data': image}}).status_code, 413)

    def test_provider_errors_are_sanitized(self):
        for status, expected in [(403, 502), (404, 502), (429, 429), (500, 502)]:
            with self.subTest(status=status), patch('routers.gemma.httpx.AsyncClient.post', new_callable=AsyncMock, return_value=self.answer(status, {'error': {'message': 'server-test-secret'}})):
                response = self.client.post('/api/gemma/mentor', json={'prompt': 'Hi'})
                self.assertEqual(response.status_code, expected)
                self.assertNotIn('server-test-secret', response.text)

    def test_timeout(self):
        with patch('routers.gemma.httpx.AsyncClient.post', new_callable=AsyncMock, side_effect=httpx.ReadTimeout('secret')):
            self.assertEqual(self.client.post('/api/gemma/mentor', json={'prompt': 'Hi'}).status_code, 504)

    def test_empty_response(self):
        with patch('routers.gemma.httpx.AsyncClient.post', new_callable=AsyncMock, return_value=self.answer(data={'candidates': []})):
            self.assertEqual(self.client.post('/api/gemma/mentor', json={'prompt': 'Hi'}).status_code, 502)


if __name__ == '__main__':
    unittest.main()
