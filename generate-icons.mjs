
import { Buffer } from "node:buffer";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const outputDir = join("public", "icons");

const logoSvg = `
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 100 120">
  <path
    d="M50 4C25 4 7 22 7 46c0 29 43 70 43 70s43-41 43-70C93 22 75 4 50 4Z"
    fill="#159447"/>
  <path
    d="M34 30v25c0 21 32 21 32 0V30"
    fill="none"
    stroke="#FFFFFF"
    stroke-width="10"
    stroke-linecap="round"/>
</svg>`;

async function createIcon(filename, size, maskable = false) {
  const padding = maskable ? 0.25 : 0.12;
  const logoWidth = Math.round(size * (1 - padding * 2));
  const logoHeight = Math.round(logoWidth * 1.2);

  const logo = await sharp(Buffer.from(logoSvg))
    .resize(logoWidth, logoHeight)
    .png()
    .toBuffer();

  const background = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite([{
      input: logo,
      gravity: "centre"
    }])
    .png()
    .toBuffer();

  await sharp(background)
    .png()
    .toFile(join(outputDir, filename));

  console.log(`Created ${filename} (${size}x${size})`);
}

await mkdir(outputDir, { recursive: true });

await createIcon("icon-192.png", 192);
await createIcon("icon-512.png", 512);
await createIcon("icon-maskable-512.png", 512, true);
await createIcon("apple-touch-icon.png", 180);

console.log("All UBAmoto icons generated successfully!");
