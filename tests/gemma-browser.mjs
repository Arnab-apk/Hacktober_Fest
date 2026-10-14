import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testPort = 3200 + process.pid % 10000;
const server = spawn(process.execPath, [root + '/skippy_paradox/frontend/node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(testPort), '--strictPort'], { cwd: root + '/skippy_paradox/frontend', windowsHide: true, stdio: 'ignore' });
let browser;
let page;
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${testPort}`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => fs.existsSync(path));
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('codecollab-v2-files', JSON.stringify([{ id: 'gemma-fixture', name: 'demo.py', content: 'print("hello")\n', language: 'python', contentLoaded: true, contentHash: '', lastModified: Date.now() }]));
    localStorage.setItem('codecollab-v2-active-file', 'gemma-fixture');
  });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  let emptyModels = false;
  let failNext = false;
  let delayNext = false;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if ((url.pathname.endsWith('/gemma/status') || url.pathname.endsWith('/harness/models')) && route.request().headers().authorization !== 'Bearer fixture-access') {
      await route.fulfill({ status: 401, json: {detail:'Enter the server access token in Harness settings.'} }); return;
    }
    if (url.pathname.endsWith('/harness/models') && emptyModels) { await route.fulfill({json:{models:[]}}); return; }

    if (url.pathname.endsWith('/gemma/status')) {
      const provider = url.searchParams.get('provider');
      await route.fulfill({ json: { configured: true, model: provider === 'ollama' ? 'gemma4:e4b' : 'gemma-4-26b-a4b-it', models: provider === 'ollama' ? ['gemma4:e4b'] : [], provider } });
    } else if (url.pathname.endsWith('/gemma/mentor')) {
      requests.push(route.request().postDataJSON());
      if (delayNext) { delayNext = false; await new Promise(resolve => setTimeout(resolve, 5000)); }
      if (failNext) { failNext = false; await route.fulfill({ status: 429, json: { detail: 'Provider quota reached. Try again shortly.' } }); }
      else await route.fulfill({ json: { text: 'Use a bounds check.\n```python\nprint("hello")\n```\n<img src=x onerror="window.gemmaInjected=true">', model: 'gemma-4-26b-a4b-it', finishReason: 'STOP' } });
    } else if (url.pathname.endsWith('/harness/models')) {
      const provider = route.request().postDataJSON().provider;
      await route.fulfill({ json: { models: provider === 'ollama' ? ['gemma4:e4b'] : provider === 'openrouter' ? ['google/gemma-4-26b-a4b-it'] : ['gemma-4-26b-a4b-it'] } });
    } else await route.fulfill({ json: { status: 'ok', models: [], providers: ['gemini', 'openrouter', 'ollama'] } });
  });
  await page.goto(`http://127.0.0.1:${testPort}`);
  const agent = page.locator('.ide-agent');
  await agent.getByLabel('Server access token').waitFor({state:'visible'});
  await agent.getByLabel('Server access token').fill('  fixture-access  ');
  await agent.getByRole('button',{name:'Connect',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('select[aria-label="AI model"]')?.value === 'gemma4:e4b');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('harness-access-token')), 'fixture-access');
  await page.getByRole('button', { name: 'Gemma Mentor', exact: true }).click();

  const mentor = page.getByRole('region', { name: 'Gemma Code Mentor' });
  const connectionSummary = mentor.locator('summary').filter({ hasText: 'Model & connection' });
  if (await connectionSummary.count() && !await mentor.getByLabel('Run Gemma with').isVisible()) await connectionSummary.click();
  await mentor.getByLabel('Run Gemma with').selectOption('gemini');
  await mentor.getByLabel('Your question').fill('Explain this code');
  await mentor.getByRole('button', { name: 'Ask Gemma', exact: true }).click();
  await mentor.getByRole('log').getByText('Use a bounds check.', { exact: false }).first().waitFor();
  assert.equal(requests[0].code.path, 'demo.py');
  assert.equal(requests[0].provider, 'gemini');
  assert.equal(await page.evaluate(() => window.gemmaInjected), undefined);
  await mentor.locator('input[type=file]').setInputFiles({ name: 'error.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64') });
  await mentor.getByRole('button', { name: 'Remove screenshot' }).waitFor();
  await mentor.getByLabel('What do you want to do?').selectOption('debug');
  await mentor.getByLabel('Your question').fill('What does this screenshot show?');
  await mentor.getByRole('button', { name: 'Ask Gemma', exact: true }).click();
  await mentor.getByRole('button', { name: 'Ask Gemma', exact: true }).waitFor();
  assert.equal(requests[1].image.mimeType, 'image/png');
  assert.equal(requests[1].history.length, 2);
  assert.equal(requests[1].mode, 'debug');
  await mentor.getByRole('button', { name: 'Remove screenshot' }).click();
  await mentor.getByLabel('Include active file').uncheck();
  failNext = true;
  await mentor.getByLabel('Your question').fill('Retry question');
  await mentor.getByRole('button', { name: 'Ask Gemma', exact: true }).click();
  await mentor.getByRole('alert').getByText(/quota reached/).waitFor();
  assert.equal(requests[2].code, undefined);
  assert.equal(requests[2].image, undefined);
  assert.equal(await mentor.getByLabel('Your question').inputValue(), 'Retry question');
  delayNext = true;
  await mentor.getByRole('button', { name: 'Ask Gemma', exact: true }).click();
  await mentor.getByRole('button', { name: 'Stop', exact: true }).click();
  await mentor.getByText(/Request stopped/).waitFor();
  await mentor.getByLabel('Run Gemma with').selectOption('ollama');
  await mentor.getByLabel('Installed Gemma model').waitFor();
  await mentor.getByLabel('Run Gemma with').selectOption('openrouter');
  await mentor.getByRole('button', { name: 'Ask Gemma', exact: true }).waitFor();
  await mentor.getByLabel('Your question').fill('Plan my feature');
  await mentor.getByRole('button', { name: 'Ask Gemma', exact: true }).click();
  await mentor.getByRole('button', { name: 'Ask Gemma', exact: true }).waitFor();
  assert.equal(requests.at(-1).provider, 'openrouter');
  fs.mkdirSync(root + '/artifacts', { recursive: true });
  const themeButton = page.getByRole('button', { name: /Switch to (light|dark) mode/ });
  const startsDark = (await themeButton.getAttribute('aria-label')) === 'Switch to light mode';
  await page.screenshot({ path: root + `/artifacts/gemma-mentor-${startsDark ? 'dark' : 'light'}.png` });
  await themeButton.click();
  await page.screenshot({ path: root + `/artifacts/gemma-mentor-${startsDark ? 'light' : 'dark'}.png` });
  await page.getByRole('button', { name: 'Skippy Agent', exact: true }).click();
  await page.getByLabel('AI provider').selectOption('gemini');
  await page.getByLabel('AI model').selectOption('gemma-4-26b-a4b-it');
  emptyModels = true;
  await agent.getByRole('button', {name:'Refresh models',exact:true}).click();
  await agent.getByRole('alert').filter({hasText:'No tool-capable models'}).waitFor();
  assert.equal(await agent.getByLabel('AI model').inputValue(), '');
  assert.equal(await agent.getByLabel('AI model').locator('option').count(), 1);
  emptyModels = false;
  await agent.getByRole('button', {name:'Refresh models',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('select[aria-label="AI model"]')?.value === 'gemma-4-26b-a4b-it');
  // Saving access in either panel must invalidate the other panel's model list.
  await agent.getByLabel('Server access token').fill('invalid-token');
  await agent.getByRole('button', {name:'Connect',exact:true}).click();
  await agent.getByRole('alert').filter({hasText:'server access token'}).waitFor();
  assert.equal(await agent.getByLabel('AI model').inputValue(), '');
  await page.getByRole('button', {name:'Gemma Mentor',exact:true}).click();
  await mentor.getByLabel('Server access token').waitFor({state:'visible'});
  assert.equal(await mentor.getByLabel('Server access token').inputValue(), 'invalid-token');
  await mentor.getByLabel('Server access token').fill('fixture-access');
  await mentor.getByRole('button', {name:'Connect',exact:true}).click();
  await page.getByRole('button', {name:'Skippy Agent',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('select[aria-label="AI model"]')?.value === 'gemma-4-26b-a4b-it');
  assert.deepEqual(errors, []);
  console.log('ACCESS PASS: visible auth recovery, trimmed token, automatic model reload, shared Agent/Mentor access, invalid-token model clearing, empty catalog recovery.');

  console.log('BROWSER PASS: code context, screenshot, follow-up, safe text rendering, quota error, stop, three providers, both themes, agent Gemini selector.');
} catch (error) {
  console.error(error.message);
  if (page && await page.locator('.gemma-panel').count()) console.log('MENTOR DOM:', await page.locator('.gemma-panel').innerText());
  await page?.screenshot({ path: root + '/artifacts/gemma-test-failure.png' });
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
