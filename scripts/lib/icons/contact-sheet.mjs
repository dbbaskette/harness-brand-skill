// Every icon in a library on one SVG sheet, labelled, for a person to look over.
const COLUMNS = 12;
const CELL = 120;
const ROW = 150;
const TOP = 50;
const INK = '#1b1d36';

// Characters XML cannot hold (controls other than tab, newline and return, and the two noncharacters) are dropped.
const xml = (text) => String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const short = (text) => (text.length > 22 ? `${text.slice(0, 21)}…` : text);
const middle = (text) => (text.length > 22 ? `${text.slice(0, 10)}…${text.slice(-11)}` : text);

/** The sheet as SVG text. `svgs` holds a picture library's drawings by path. */
export function contactSheet(library, icons, svgs) {
  const rows = Math.max(1, Math.ceil(icons.length / COLUMNS));
  const width = COLUMNS * CELL;
  const height = TOP + rows * ROW;
  const cells = icons.map((icon, n) => {
    const x = (n % COLUMNS) * CELL + 10;
    const y = TOP + Math.floor(n / COLUMNS) * ROW;
    const frame = `<rect x="${x}" y="${y}" width="100" height="100" fill="none" stroke="#d0d3d9"/>`;
    const drawing = Array.isArray(icon.paths)
      ? `<g transform="translate(${x} ${y})" fill="${INK}" fill-rule="evenodd">${
        icon.paths.map((d) => `<path d="${xml(d)}"/>`).join('')}</g>`
      : `<image x="${x}" y="${y}" width="100" height="100" href="data:image/svg+xml;base64,${
        Buffer.from(svgs.get(icon.file) ?? '').toString('base64')}"/>`;
    const label = `<text x="${x + 50}" y="${y + 118}" text-anchor="middle" font-size="10">${xml(short(icon.name ?? icon.slug))}</text>`
      + `<text x="${x + 50}" y="${y + 132}" text-anchor="middle" font-size="9" fill="#5a6170">${xml(middle(icon.slug))}</text>`;
    return `<g><title>${xml(`${icon.name ?? icon.slug} (${icon.slug})`)}</title>${frame + drawing + label}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" `
    + `font-family="Arial, Helvetica, sans-serif"><rect width="${width}" height="${height}" fill="#ffffff"/>`
    + `<text x="10" y="30" font-size="18" fill="${INK}">${xml(`${library.name}: ${icons.length} ${icons.length === 1 ? 'icon' : 'icons'}`)}</text>`
    + `${cells.join('')}</svg>\n`;
}
