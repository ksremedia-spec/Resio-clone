import type { contracts } from '@buildline/core';

const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const tick = (on: boolean) => (on ? '&#9745;' : '&#9744;');
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/** Self-contained HTML of the selections sheet, published into the project's documents so every account with document access can read the finished picks. */
export function renderSelectionSheetHtml(sheet: contracts.SelectionSheet): string {
  const sections = sheet.sections.map((sec) => `
    <section>
      <h2>${esc(sec.label)}</h2>
      ${sec.note ? `<p class="note">${esc(sec.note)}</p>` : ''}
      ${sec.items.map((s) => {
        const chosen = s.options.find((o) => o.id === s.selectedOptionId);
        const answers = Object.entries(s.answers ?? {}).filter(([, v]) => v && v.trim());
        return `<div class="item ${esc(s.status)}">
          <div class="name"><strong>${esc(s.name)}</strong>${s.room ? `<div class="sub">${esc(s.room)}</div>` : ''}${s.byAllowance ? '<div class="sub">By allowance</div>' : ''}</div>
          <div class="body">
            ${s.matchExisting ? '<div class="match">&#9745; Match existing</div>' : ''}
            ${s.options.length ? `<div class="ticks">${s.options.map((o) => `<span class="${chosen?.id === o.id ? 'on' : ''}">${tick(chosen?.id === o.id)} ${esc(o.name)}</span>`).join('')}</div>` : ''}
            ${s.areas.length ? `<div class="ticks">${s.areas.map((a) => `<span class="${s.chosenAreas.includes(a) ? 'on' : ''}">${tick(s.chosenAreas.includes(a))} ${esc(a)}</span>`).join('')}</div>` : ''}
            ${s.fields.length ? `<table class="fields">${s.fields.map((f) => `<tr><th>${esc(f)}</th><td>${esc(s.answers?.[f] ?? '')}</td></tr>`).join('')}</table>` : ''}
            ${!s.fields.length && answers.length ? `<table class="fields">${answers.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
            ${s.defaultSpec ? `<div class="default"><span class="label">Default</span> ${esc(s.defaultSpec)}</div>` : ''}
            ${s.comment ? `<div class="comment"><span class="label">Comments</span> ${esc(s.comment)}</div>` : ''}
          </div>
          <div class="status">${s.status === 'decided' ? `Decided${s.decidedByName ? ` by ${esc(s.decidedByName)}` : ''}${s.decidedAt ? `<br>${fmtDate(s.decidedAt)}` : ''}` : s.status === 'released' ? 'Awaiting client' : 'Not released'}</div>
        </div>`;
      }).join('')}
    </section>`).join('');
  const signoffs = sheet.signoffs.length
    ? sheet.signoffs.map((x) => `<div class="signed"><div class="sig">${esc(x.signatureText || x.signerName)}</div><div><strong>${esc(x.signerName)}</strong>${x.byClient ? ' (client)' : ' (recorded by the builder)'} &middot; ${fmtDate(x.signedAt)} &middot; ${x.decidedCount} items decided${x.note ? ` &middot; &ldquo;${esc(x.note)}&rdquo;` : ''}</div></div>`).join('')
    : '<div class="blank"><div><span class="label">Client signature</span><span class="line"></span></div><div><span class="label">Date</span><span class="line"></span></div></div>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Selections — ${esc(sheet.project.name)}</title>
<style>
  body { font: 13px/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; margin: 32px auto; max-width: 900px; padding: 0 16px; }
  header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 18px; flex-wrap: wrap; }
  .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #555; font-weight: 600; }
  h1 { font-size: 24px; margin: 2px 0; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin: 22px 0 6px; }
  .meta { text-align: right; } .meta div { margin-bottom: 2px; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #555; font-weight: 600; margin-right: 6px; }
  .note { color: #555; margin: 0 0 6px; }
  .item { display: grid; grid-template-columns: 170px 1fr 140px; gap: 12px; padding: 7px 0; border-bottom: 1px dotted #ccc; break-inside: avoid; }
  .sub { color: #666; font-size: 12px; }
  .ticks span { display: inline-block; margin: 2px 14px 2px 0; color: #444; } .ticks span.on { color: #000; font-weight: 700; }
  .fields { border-collapse: collapse; margin-top: 4px; } .fields th { text-align: left; font-weight: 600; color: #555; padding: 2px 14px 2px 0; font-size: 12px; white-space: nowrap; vertical-align: top; } .fields td { padding: 2px 0; min-width: 160px; border-bottom: 1px solid #ddd; }
  .default, .comment { font-size: 12px; color: #444; margin-top: 4px; } .match { font-weight: 700; margin-bottom: 4px; }
  .status { text-align: right; font-size: 11px; color: #333; }
  footer { margin-top: 28px; border-top: 2px solid #111; padding-top: 14px; }
  .sig { font-family: "Snell Roundhand", "Brush Script MT", cursive; font-size: 28px; }
  .signed + .signed { margin-top: 12px; }
  .blank { display: grid; grid-template-columns: 2fr 1fr; gap: 28px; } .blank > div { display: flex; align-items: flex-end; gap: 8px; } .line { flex: 1; border-bottom: 1px solid #111; height: 26px; }
  @media print { body { margin: 0; } }
</style></head><body>
<header>
  <div><div class="eyebrow">${esc(sheet.company)} &middot; Design / build services</div><h1>Selections</h1><div class="sub">${esc(sheet.project.number)} &middot; ${esc(sheet.project.name)}</div></div>
  <div class="meta"><div><span class="label">Client</span>${esc(sheet.project.clientName ?? '—')}</div><div><span class="label">Address</span>${esc(sheet.project.addressLine || '—')}</div><div><span class="label">Date</span>${fmtDate(sheet.generatedAt)}</div><div><span class="label">Progress</span>${sheet.counts.decided} of ${sheet.counts.total} decided</div></div>
</header>
${sections}
<footer>${signoffs}</footer>
</body></html>`;
}
