import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = process.cwd();
const source = path.join(root, 'build', 'icon.svg');
const pngPath = path.join(root, 'build', 'icon.png');
const icoPath = path.join(root, 'build', 'icon.ico');

await fs.mkdir(path.dirname(pngPath), { recursive: true });
const png = await sharp(source, { density: 384 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
await fs.writeFile(pngPath, png);
const ico = await pngToIco(pngPath);
await fs.writeFile(icoPath, ico);
console.log('Generated transparent app icons: build/icon.png and build/icon.ico');
