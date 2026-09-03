/**
 * Ensure media/icon.png (128x128) for VS Marketplace — generates via PowerShell/.NET if missing.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconPath = path.join(__dirname, "..", "media", "icon.png");

if (fs.existsSync(iconPath) && fs.statSync(iconPath).size > 100) {
  console.log("icon ok", iconPath);
  process.exit(0);
}

const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 128, 128
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 11, 16, 32))
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 212, 163, 92))
$pts = @(
  (New-Object System.Drawing.Point 64, 22),
  (New-Object System.Drawing.Point 104, 100),
  (New-Object System.Drawing.Point 24, 100)
)
$g.FillPolygon($brush, $pts)
$g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 240, 194, 122))), 56, 62, 16, 16)
$g.Dispose()
$bmp.Save('${iconPath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output 'wrote icon'
`;

const r = spawnSync(
  "powershell",
  ["-NoProfile", "-Command", ps],
  { encoding: "utf8" }
);
if (r.status !== 0 || !fs.existsSync(iconPath)) {
  console.error(r.stdout || "", r.stderr || "");
  console.error("ensure-icon failed — add media/icon.png (128x128) manually");
  process.exit(1);
}
console.log("wrote", iconPath);
