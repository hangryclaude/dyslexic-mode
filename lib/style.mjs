import { grad } from './palette.mjs';

export const ESC = '\x1b[';
// Always a real boolean, because an undefined here falls through to a `styled = true` default.
export const fancy = out => Boolean(out.isTTY) && !process.env.NO_COLOR;

export const fg = ([r, g, b], s) => `${ESC}38;2;${r};${g};${b}m${s}${ESC}0m`;
export const dim = s => `${ESC}2m${s}${ESC}0m`;
export const bold = s => `${ESC}1m${s}${ESC}0m`;
export const plain = s => s;
// Code takes the far end of the palette, list markers sit near it, headings take the near end.
export const code = s => fg(grad(1), s);
export const marker = s => fg(grad(0.85), s);
export const heading = s => bold(fg(grad(0.1), s));
export const link = s => fg(grad(0.6), s);

export const visible = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
