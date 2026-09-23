// Regenerates the iOS app icon and splash images from public/icon.svg. Run from apps/ipad: `pnpm ios:icons`.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
// App icon: full-bleed square, no transparency (iOS applies its own corner mask).
await page.setContent(`<body style="margin:0;background:#1F3A5F">${svg.replace('rx="14"', 'rx="0"').replace('<svg ', '<svg width="1024" height="1024" ')}</body>`);
await page.screenshot({ path: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', omitBackground: false });
// Splash: brand colour with the mark centred.
await page.setViewportSize({ width: 2732, height: 2732 });
await page.setContent(`<body style="margin:0;background:#1F3A5F;display:grid;place-items:center;height:2732px"><div style="text-align:center;color:#fff;font-family:Helvetica Neue,Helvetica,Arial,sans-serif">${svg.replace('<svg ', '<svg width="480" height="480" ')}<div style="font-size:96px;font-weight:700;margin-top:48px;letter-spacing:2px">Buildline</div><div style="font-size:44px;opacity:.75;margin-top:16px">R. P. Valois &amp; Co.</div></div></body>`);
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) await page.screenshot({ path: `ios/App/App/Assets.xcassets/Splash.imageset/${name}` });
await browser.close();
console.log('icons written');
