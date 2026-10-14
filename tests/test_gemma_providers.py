import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch
import httpx
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'skippy_paradox/backend'))
from main import app
from routers import gemma, harness


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'GEMINI_API_KEY': 'server-gemini', 'OPENROUTER_API_KEY': 'server-router', 'SKIPPY_ACCESS_TOKEN': '', 'GEMMA_LOCAL_MODEL': ''})
        self.env.start()
        gemma.LOCAL_CATALOG = None
        harness.MODEL_CACHE.clear()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        gemma.LOCAL_CATALOG = None

    def test_local_multimodal_and_catalog_cache(self):
        import base64
        image = base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()
        tags = httpx.Response(200, json={'models': [{'name': 'gemma4:e4b'}, {'name': 'qwen:latest'}]}, request=httpx.Request('GET', 'http://localhost/api/tags'))
        with patch('routers.gemma.httpx.AsyncClient.get', new_callable=AsyncMock, return_value=tags) as get, patch('routers.gemma.httpx.AsyncClient.post', new_callable=AsyncMock, return_value=httpx.Response(200, json={'message': {'content': 'Local answer'}, 'done_reason': 'stop'})) as post:
            status = self.client.get('/api/gemma/status?provider=ollama').json()
            self.assertEqual(status['models'], ['gemma4:e4b'])
            response = self.client.post('/api/gemma/mentor', json={'provider': 'ollama', 'model': status['model'], 'prompt': 'Explain', 'image': {'mimeType': 'image/png', 'data': image}})
            self.assertEqual(response.json()['text'], 'Local answer')
            self.assertEqual(get.call_count, 1)
            self.assertTrue(post.call_args.args[0].endswith('/api/chat'))
            self.assertNotIn('headers', post.call_args.kwargs)
            self.assertFalse(post.call_args.kwargs['json']['think'])
            self.assertEqual(post.call_args.kwargs['json']['messages'][-1]['images'], [image])

    def test_local_thinking_only_and_empty_final_answers(self):
        tags = httpx.Response(200, json={'models': [{'name': 'gemma4:e4b'}]}, request=httpx.Request('GET', 'http://localhost/api/tags'))
        for result, expected in [({'message': {'content': '', 'thinking': 'private reasoning'}, 'done_reason': 'length'}, 'output limit'), ({'message': {'content': '   '}, 'done_reason': 'stop'}, 'empty final answer')]:
            with self.subTest(result=result), patch('routers.gemma.httpx.AsyncClient.get', new_callable=AsyncMock, return_value=tags), patch('routers.gemma.httpx.AsyncClient.post', new_callable=AsyncMock, return_value=httpx.Response(200, json=result)):
                response = self.client.post('/api/gemma/mentor', json={'provider': 'ollama', 'model': 'gemma4:e4b', 'prompt': 'Explain this code'})
                self.assertEqual(response.status_code, 502)
                self.assertIn(expected, response.json()['detail'])
                self.assertNotIn('private reasoning', response.text)

    def test_openrouter_server_key_and_payload(self):
        with patch('routers.gemma.httpx.AsyncClient.post', new_callable=AsyncMock, return_value=httpx.Response(200, json={'choices': [{'message': {'content': 'Router answer'}, 'finish_reason': 'stop'}]})) as post:
            response = self.client.post('/api/gemma/mentor', json={'provider': 'openrouter', 'prompt': 'Explain'})
            self.assertEqual(response.json()['text'], 'Router answer')
            self.assertEqual(post.call_args.kwargs['headers']['Authorization'], 'Bearer server-router')
            self.assertEqual(post.call_args.kwargs['json']['model'], 'google/gemma-4-26b-a4b-it')
            self.assertNotIn('server-router', response.text)

    def test_agent_resolves_server_credentials(self):
        self.assertEqual(harness.server_body(harness.RunRequest(provider='gemini', apiKey='browser-key'))['apiKey'], 'server-gemini')
        self.assertEqual(harness.server_body(harness.RunRequest(provider='openrouter'))['apiKey'], 'server-router')

    def test_local_unreachable_status(self):
        with patch('routers.gemma.httpx.AsyncClient.get', new_callable=AsyncMock, side_effect=httpx.ConnectError('offline')):
            response = self.client.get('/api/gemma/status?provider=ollama')
            self.assertEqual(response.status_code, 503)

    def test_openrouter_tutor_honors_selected_model(self):
        answer = httpx.Response(200, json={'choices': [{'message': {'content': 'Selected model answer'}, 'finish_reason': 'stop'}]})
        with patch('routers.gemma.httpx.AsyncClient.post', new_callable=AsyncMock, return_value=answer) as post:
            response = self.client.post('/api/gemma/mentor', json={'provider': 'openrouter', 'model': 'google/gemma-4-31b-it:free', 'prompt': 'Explain'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(post.call_args.kwargs['json']['model'], 'google/gemma-4-31b-it:free')
            self.assertFalse(post.call_args.kwargs['json']['reasoning']['enabled'])
        self.assertEqual(self.client.post('/api/gemma/mentor', json={'provider': 'openrouter', 'model': 'unlisted-model', 'prompt': 'Explain'}).status_code, 400)

    def test_openrouter_catalog_offers_both_gemma_sizes(self):
        response = self.client.get('/api/gemma/status?provider=openrouter')
        self.assertIn('google/gemma-4-26b-a4b-it', response.json()['models'])
        self.assertIn('google/gemma-4-31b-it:free', response.json()['models'])

    def test_gemma_provider_errors_offer_recovery(self):
        for provider, upstream_status, expected, hint in [('gemini', 500, 502, 'OpenRouter'), ('openrouter', 402, 402, 'credits'), ('openrouter', 429, 429, 'another Gemma model')]:
            with self.subTest(provider=provider, status=upstream_status), patch('routers.gemma.httpx.AsyncClient.post', new_callable=AsyncMock, return_value=httpx.Response(upstream_status, json={'error': {'message': 'server-router'}})):
                response = self.client.post('/api/gemma/mentor', json={'provider': provider, 'prompt': 'Explain'})
                self.assertEqual(response.status_code, expected)
                self.assertIn(hint, response.json()['detail'])
                self.assertNotIn('server-router', response.text)


if __name__ == '__main__':
    unittest.main()
