import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const errors = [];
const hostContext = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
const guestContext = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
await hostContext.addInitScript(() => {
  localStorage.setItem('codecollab-v2-files', JSON.stringify([{ id: 'browser-file', name: 'hello.py', content: 'print("original")\n', language: 'Python', contentLoaded: true, contentHash: '', lastModified: Date.now() }]));
  localStorage.setItem('codecollab-v2-active-file', 'browser-file');
});
const host = await hostContext.newPage(), guest = await guestContext.newPage();
host.on('pageerror', e => errors.push('host: ' + e.message));
guest.on('pageerror', e => errors.push('guest: ' + e.message));
try {
  await host.goto('http://localhost:3100');
  await host.getByRole('button', { name: 'Collab', exact: true }).click();
  await host.getByPlaceholder('e.g. John').fill('Alice');
  await host.getByRole('button', { name: 'Create & Host Room' }).click();
  const room = (await host.getByTitle('Copy Room ID').first().innerText()).trim();
  await guest.goto('http://localhost:3100');
  await guest.getByRole('button', { name: 'Collab', exact: true }).click();
  await guest.getByRole('button', { name: 'Join Room', exact: true }).click();
  await guest.getByPlaceholder('e.g. John').fill('Bob');
  await guest.getByPlaceholder('e.g. A3K7M2').fill(room);
  await guest.getByRole('button', { name: 'Request to Join' }).click();
  // Open the membership popover if approval isn't exposed yet.
  await host.waitForTimeout(500);
  const approve = host.getByTitle('Approve');
  if (!(await approve.isVisible())) {
    const buttons = await host.locator('button').evaluateAll(nodes => nodes.map(n => ({ text: n.innerText, title: n.title })));
    console.log('HOST BUTTONS', JSON.stringify(buttons));
    const memberButton = host.locator('button').filter({ has: host.locator('[title="Alice"]') }).first();
    await memberButton.click();
  }
  await approve.click();
  await guest.waitForFunction(() => JSON.parse(localStorage.getItem('codecollab-v2-files') || '[]').some(f => f.id === 'browser-file' && f.content.includes('original')));
  
  await guest.getByLabel('AI model').first().selectOption('qwen3.5:2b');
  await guest.getByLabel('Ask Skippy').first().fill('Change hello.py to exactly print("collaboration verified") followed by a newline. Use read_file first, then write_file, then read_file to verify. Do not create any other files.');
  await guest.getByRole('button', { name: 'Run harness' }).first().click();
  await host.waitForFunction(() => JSON.parse(localStorage.getItem('codecollab-v2-files') || '[]').some(f => f.id === 'browser-file' && f.content.includes('collaboration verified')), undefined, { timeout: 180000 });
  await guest.getByRole('button', { name: 'Run harness' }).first().waitFor({ timeout: 180000 });
  const hostFile = await host.evaluate(() => JSON.parse(localStorage.getItem('codecollab-v2-files')).find(f => f.id === 'browser-file'));
  const guestFile = await guest.evaluate(() => JSON.parse(localStorage.getItem('codecollab-v2-files')).find(f => f.id === 'browser-file'));
  assert.equal(hostFile.content, guestFile.content);
  assert.match(await host.getByRole('log', { name: 'Harness activity' }).first().innerText(), /write_file/);
  fs.mkdirSync('artifacts', { recursive: true });
  await host.screenshot({ path: 'artifacts/collaboration-host.png' });
  await guest.screenshot({ path: 'artifacts/collaboration-guest.png' });
  console.log('BROWSER PASS: approved guest ran real Qwen; both browsers persisted identical edited content and shared activity.');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
