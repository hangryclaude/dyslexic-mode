#!/usr/bin/env node
// A full-screen spinning brain, written in the name of every model you can reach. Any key quits.
import { brainScreen, brainCaption } from '../lib/anim.mjs';
import { brainOf } from '../lib/modelmenu.mjs';

const { stdin, stdout } = process;
if (stdin.isTTY) stdin.setRawMode(true);
const { words, tally } = brainOf();
await brainScreen(stdout, new Promise(res => stdin.once('data', res)), 'press any key to quit', { words, caption: brainCaption(tally) });
process.exit(0);
