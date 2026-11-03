#!/usr/bin/env node
// Stands in for ffplay as the speaker, so a test never makes a sound. It takes the audio, plays
// nothing, and leaves when the audio ends.
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
