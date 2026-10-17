"""GitHub import regressions using a local ASGI app and mocked upstream requests."""
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch
from urllib.parse import quote

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'skippy_paradox/backend'))
from routers import github


class GitHubImportTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(github.router, prefix='/api/github')
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {'Authorization': 'Bearer test-token'}

    def test_tree_import_accepts_slashes_and_escapes_branch_characters(self):
        data = {'tree': [{'path': 'src/app.ts', 'type': 'blob', 'size': 12, 'sha': 'blob'}], 'sha': 'tree', 'truncated': False}
        for branch in ('main', 'feature/fix', 'feature/fix#1%'):
            with self.subTest(branch=branch), patch('routers.github.httpx.AsyncClient.get', new_callable=AsyncMock, return_value=httpx.Response(200, json=data)) as get:
                result = self.client.get(f'/api/github/repos/alice/demo/tree/{quote(branch, safe="")}', headers=self.headers)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json(), data)
                get.assert_awaited_once()
                request = httpx.Request('GET', *get.call_args.args, **get.call_args.kwargs)
                self.assertEqual(request.url.path, f'/repos/alice/demo/git/trees/{branch}')
                self.assertEqual(dict(request.url.params), {'recursive': '1'})
                self.assertEqual(request.url.fragment, '')
                self.assertEqual(request.headers['Authorization'], self.headers['Authorization'])

    def test_contents_import_escapes_reserved_filename_characters(self):
        path = 'docs/café #1?%20.md'
        with patch('routers.github.httpx.AsyncClient.get', new_callable=AsyncMock, return_value=httpx.Response(200, json=[])) as get:
            result = self.client.get('/api/github/repos/alice/demo/contents', params={'path': path}, headers=self.headers)
            self.assertEqual(result.status_code, 200)
            get.assert_awaited_once()
            request = httpx.Request('GET', *get.call_args.args, **get.call_args.kwargs)
            self.assertEqual(request.url.path, f'/repos/alice/demo/contents/{path}')
            self.assertEqual(str(request.url.query, 'ascii'), '')
            self.assertEqual(request.url.fragment, '')
            self.assertEqual(request.headers['Authorization'], self.headers['Authorization'])


if __name__ == '__main__':
    unittest.main()
