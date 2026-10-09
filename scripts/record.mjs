// Capture screenshots or an animated GIF of the simulation with headless Chrome.
//
//   npm run record -- shot docs/media/hero.png --wait 12 --hash "g=2&seed=7"
//   npm run record -- gif  docs/media/demo.gif --frames 90 --size 560
//
// Needs a local Chrome/Chromium/Edge; set CHROME_PATH if it isn't found.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';
import gifenc from 'gifenc';
import { startServer } from './serve.mjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const [mode = 'shot', out = 'docs/media/hero.png', ...rest] = process.argv.slice(2);
const opt = { wait: 10, hash: '', frames: 90, size: 900, every: 2, width: 0, height: 0, js: '' };
for (let i = 0; i < rest.length; i += 2) {
  const key = rest[i].replace(/^--/, '');
  opt[key] = typeof opt[key] === 'number' ? Number(rest[i + 1]) : rest[i + 1];
}

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chrome found — set CHROME_PATH.');

const server = await startServer(0);
const port = server.address().port;
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});

try {
  const page = await browser.newPage();
  const w = opt.width || opt.size, h = opt.height || opt.size;
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(`http://localhost:${port}/?intro=0&panel=${mode === 'ui' ? 1 : 0}#${opt.hash}`, { waitUntil: 'load' });
  if (opt.js) await page.evaluate(opt.js);
  await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; });
  await new Promise((r) => setTimeout(r, opt.wait * 1000));
  await mkdir(dirname(out), { recursive: true });

  if (mode === 'gif') {
    const gif = GIFEncoder();
    for (let f = 0; f < opt.frames; f++) {
      for (let k = 0; k < opt.every; k++) await page.evaluate(() => new Promise(requestAnimationFrame));
      const { data, width, height } = await page.evaluate(() => {
        const c = document.getElementById('view');
        hpl.renderNow(); // the WebGL buffer is only readable in the same task it was drawn in
        const tmp = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height });
        const ctx = tmp.getContext('2d');
        ctx.drawImage(c, 0, 0);
        const img = ctx.getImageData(0, 0, tmp.width, tmp.height);
        return { data: Array.from(img.data), width: img.width, height: img.height };
      });
      const rgba = new Uint8Array(data);
      const palette = quantize(rgba, 256);
      gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: 40 });
      process.stdout.write(`\rframe ${f + 1}/${opt.frames}`);
    }
    gif.finish();
    await writeFile(out, gif.bytes());
    console.log(`\nwrote ${out}`);
  } else {
    await page.screenshot({ path: out });
    console.log(`wrote ${out}`);
  }
  const stats = await page.evaluate(() => window.hpl && { steps: hpl.sim.steps, ghosts: hpl.sim.ghostCount, time: hpl.sim.time });
  console.log('stats', JSON.stringify(stats));
  if (errors.length) console.log('console:\n' + errors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
