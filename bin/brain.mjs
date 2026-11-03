#!/usr/bin/env node
// A full-screen spinning brain. Any key quits.
import { brainScreen } from '../lib/anim.mjs';

const { stdin, stdout } = process;
if (stdin.isTTY) stdin.setRawMode(true);
await brainScreen(stdout, new Promise(res => stdin.once('data', res)), 'press any key to quit');
process.exit(0);
