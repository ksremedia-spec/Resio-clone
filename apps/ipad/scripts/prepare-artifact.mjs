// Post-processes dist-standalone for hosting as a claude.ai artifact:
//  - artifact.html: the page content without the document skeleton (the host adds it)
//  - PGlite's *.data image renamed to a served extension (.wasm) and references rewritten
//  - artifact-files.json: published path → source path map for the publish call
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = new URL('../dist-standalone/', import.meta.url).pathname;
const assets = join(dist, 'assets');
for (const name of readdirSync(assets)) {
  if (!name.endsWith('.data')) continue;
  const renamed = name.replace(/\.data$/, '-data.wasm');
  renameSync(join(assets, name), join(assets, renamed));
  for (const js of readdirSync(assets).filter((f) => f.endsWith('.js'))) {
    const p = join(assets, js);
    const src = readFileSync(p, 'utf8');
    if (src.includes(name)) writeFileSync(p, src.split(name).join(renamed));
  }
  console.log(`renamed ${name} -> ${renamed}`);
}
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const title = /<title>(.*?)<\/title>/.exec(html)[1];
const headTags = html.match(/<(?:link|script)[^>]*>(?:<\/script>)?/g).filter((t) => !t.includes('rel="icon"') || true);
const body = /<body>([\s\S]*?)<\/body>/.exec(html)[1].trim();
writeFileSync(join(dist, 'artifact.html'), `<title>${title}</title>\n${headTags.join('\n')}\n${body}\n`);
const files = {};
const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (!['index.html', 'artifact.html', 'artifact-files.json'].includes(n)) files[relative(dist, p)] = 'apps/ipad/dist-standalone/' + relative(dist, p); } };
walk(dist);
writeFileSync(join(dist, 'artifact-files.json'), JSON.stringify(files));
console.log(`${Object.keys(files).length} files, ${(Object.values(files).reduce((n, f) => n + statSync(join(dist, '..', '..', '..', f)).size, 0) / 1024 / 1024).toFixed(1)} MB`);
