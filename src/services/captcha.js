'use strict';

const CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

function randomCaptchaCode(length = 4) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

function renderCaptchaSvg(code) {
  const width = 120;
  const height = 40;
  const chars = String(code || '').split('');
  let decorations = '';

  for (let i = 0; i < 5; i += 1) {
    const x1 = (Math.random() * width).toFixed(1);
    const y1 = (Math.random() * height).toFixed(1);
    const x2 = (Math.random() * width).toFixed(1);
    const y2 = (Math.random() * height).toFixed(1);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    decorations += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1" opacity="0.5"/>`;
  }
  for (let i = 0; i < 30; i += 1) {
    const x = (Math.random() * width).toFixed(1);
    const y = (Math.random() * height).toFixed(1);
    decorations += `<circle cx="${x}" cy="${y}" r="1" fill="#999" opacity="0.4"/>`;
  }

  let letters = '';
  const step = width / (chars.length + 1);
  chars.forEach((ch, idx) => {
    const x = Math.round(step * (idx + 1));
    const y = 28 + Math.round(Math.random() * 4 - 2);
    const rotate = (Math.random() * 40 - 20).toFixed(1);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    letters += `<text x="${x}" y="${y}" font-family="Verdana,Arial,sans-serif" font-size="22" font-weight="bold" fill="${color}" transform="rotate(${rotate} ${x} ${y})">${ch}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${decorations}${letters}</svg>`;
}

function normalizeCaptchaInput(value) {
  return String(value || '').trim().toUpperCase();
}

module.exports = { randomCaptchaCode, renderCaptchaSvg, normalizeCaptchaInput };
