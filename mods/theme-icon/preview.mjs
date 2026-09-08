import fs from 'node:fs';
import path from 'node:path';
import {PNG} from 'pngjs';
import {tintIcon} from './tint.mjs';

const [resources = '/Applications/ChatGPT.app/Contents/Resources', destination = 'work/theme-icon-preview', accent] = process.argv.slice(2);
const colors = accent ? [accent] : ['#6680ff','#d99b42','#4ca982','#dc759c','#9c7be8','#888888'];
fs.mkdirSync(destination, {recursive:true});
const size = 256, gap = 16, width = colors.length * (size + gap) + gap;
const sheet = new PNG({width, height: 2 * (size + gap + 12) + gap});
sheet.data.fill(0);
for (const [row, mode] of ['dark','light'].entries()) {
  const filename = mode === 'dark' ? 'icon-codex-dark-color.png' : 'icon-codex-light.png';
  const source = PNG.sync.read(fs.readFileSync(path.join(resources, filename)));
  for (const [col, color] of colors.entries()) {
    const data = tintIcon(source.data, color);
    const output = new PNG({width:source.width, height:source.height});
    output.data = Buffer.from(data);
    fs.writeFileSync(path.join(destination, `${mode}-${color.slice(1)}.png`), PNG.sync.write(output));
    const originX = gap + col * (size + gap), originY = gap + row * (size + gap + 12);
    for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
      const from = (Math.floor(y*source.height/size)*source.width+Math.floor(x*source.width/size))*4;
      const to = ((originY+y)*width+originX+x)*4;
      sheet.data.set(data.subarray(from,from+4),to);
    }
    const swatch = color.length === 4 ? [...color.slice(1)].map(c=>c+c).join('') : color.slice(1);
    for (let y=0;y<6;y++) for(let x=32;x<size-32;x++) {
      const to = ((originY+size+4+y)*width+originX+x)*4;
      sheet.data.set([parseInt(swatch.slice(0,2),16),parseInt(swatch.slice(2,4),16),parseInt(swatch.slice(4,6),16),255],to);
    }
  }
}
const preview = path.resolve(destination,'preview.png');
fs.writeFileSync(preview,PNG.sync.write(sheet));
console.log(preview);
