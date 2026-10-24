import { chromium } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
const dir = process.argv[2], out = process.argv[3];
const imgs = readdirSync(dir).filter(f => f.endsWith('.png')).sort().map(f => `<figure><img src="data:image/png;base64,${readFileSync(`${dir}/${f}`).toString('base64')}"><figcaption>${f}</figcaption></figure>`).join('');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.setContent(`<body style="background:#222;color:#ddd;font:12px sans-serif;display:flex;flex-wrap:wrap;gap:12px;margin:8px">${imgs}<style>img{image-rendering:pixelated;zoom:${process.argv[4] ?? 3}}figure{margin:0}</style></body>`);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
