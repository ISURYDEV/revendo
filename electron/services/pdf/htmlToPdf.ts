import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Render an HTML string to PDF via an offscreen BrowserWindow.
 * The window is hidden, loaded with the HTML, printed to PDF, then closed.
 */
export async function htmlToPdf(html: string, outputPath: string): Promise<{ path: string; size: number }> {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, javascript: false }
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const buf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    });
    fs.writeFileSync(outputPath, buf);
    return { path: outputPath, size: buf.length };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Shared CSS for facture / recap. Mirrors the app's dark glass visual language. */
export const PDF_CSS = `
  * { box-sizing: border-box; }
  html {
    background: #05060f;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    position: relative;
    min-height: 100vh;
    margin: 0;
    padding: 28px;
    color: #d8ecf8;
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    font-size: 10.5pt;
    letter-spacing: 0;
    background:
      radial-gradient(circle at 92% 0%, rgba(102, 58, 243, 0.26), transparent 250px),
      radial-gradient(circle at 10% 0%, rgba(182, 217, 252, 0.12), transparent 260px),
      linear-gradient(180deg, #070914 0%, #05060f 52%, #03040a 100%);
  }
  h1 {
    margin: 0 0 6px;
    color: #ffffff;
    font-size: 22pt;
    line-height: 1.05;
    letter-spacing: 0;
  }
  h2 {
    margin: 18px 0 8px;
    padding-bottom: 7px;
    color: #ffffff;
    font-size: 13pt;
    border-bottom: 1px solid rgba(216, 236, 248, 0.16);
  }
  strong { color: #ffffff; }
  em { color: #b6d9fc; }
  .muted {
    color: #9da7ba;
    font-size: 9.5pt;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 18px;
  }
  body > .row:first-of-type {
    align-items: flex-start;
    margin-bottom: 18px;
    padding: 18px;
    border: 1px solid rgba(216, 236, 248, 0.16);
    border-radius: 18px;
    background:
      linear-gradient(135deg, rgba(102, 58, 243, 0.22), rgba(186, 214, 247, 0.06)),
      rgba(8, 10, 22, 0.92);
    box-shadow: inset rgba(255, 255, 255, 0.08) 0 1px 0, rgba(0, 0, 0, 0.26) 0 14px 34px;
  }
  .box {
    margin-bottom: 12px;
    padding: 13px 14px;
    color: #d8ecf8;
    border: 1px solid rgba(216, 236, 248, 0.14);
    border-radius: 14px;
    background: rgba(8, 10, 22, 0.74);
    box-shadow: inset rgba(255, 255, 255, 0.05) 0 1px 0;
  }
  table {
    width: 100%;
    margin: 8px 0 12px;
    overflow: hidden;
    border-collapse: separate;
    border-spacing: 0;
    border: 1px solid rgba(216, 236, 248, 0.12);
    border-radius: 14px;
    background: rgba(5, 6, 15, 0.55);
  }
  th, td {
    padding: 8px 9px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid rgba(216, 236, 248, 0.1);
  }
  tr:last-child td { border-bottom: 0; }
  th {
    color: #ffffff;
    font-size: 9.5pt;
    font-weight: 700;
    background: rgba(186, 214, 247, 0.085);
  }
  td {
    color: #d1e4fa;
  }
  .right { text-align: right; }
  .total {
    color: #ffffff;
    font-weight: 800;
    background: linear-gradient(90deg, rgba(102, 58, 243, 0.24), rgba(182, 217, 252, 0.08));
  }
  .total td { color: #ffffff; }
  .mention {
    margin: 13px 0;
    padding: 11px 13px;
    color: #fff4cf;
    font-size: 10pt;
    border-left: 4px solid #f6c96f;
    border-radius: 12px;
    background: rgba(245, 158, 11, 0.14);
  }
  .mention strong { color: #fff6dd; }
  .footer {
    margin-top: 20px;
    padding-top: 12px;
    color: #81899b;
    font-size: 9pt;
    border-top: 1px solid rgba(216, 236, 248, 0.12);
  }
`;
