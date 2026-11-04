#!/usr/bin/env node
// Stands in for macOS `pbcopy`: writes what it is given to the file named by FAKE_CLIP,
// so a test can read back what would have gone to the clipboard.
import { readFileSync, writeFileSync } from 'node:fs';

writeFileSync(process.env.FAKE_CLIP, readFileSync(0, 'utf8'));
