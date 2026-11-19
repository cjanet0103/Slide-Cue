// Generates fixtures/sample-3p.pdf: a 3-page test deck for manual and browser testing.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";

const titles = ["1. Cover", "2. Customer problem", "3. Solution"];

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.HelveticaBold);
for (const title of titles) {
  const page = doc.addPage([960, 540]);
  page.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.96, 0.96, 0.95) });
  page.drawText(title, { x: 64, y: 260, size: 56, font, color: rgb(0, 0, 0) });
}

await mkdir(new URL("../fixtures/", import.meta.url), { recursive: true });
await writeFile(new URL("../fixtures/sample-3p.pdf", import.meta.url), await doc.save());
console.log("Wrote fixtures/sample-3p.pdf");
