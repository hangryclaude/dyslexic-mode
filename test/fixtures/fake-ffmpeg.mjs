#!/usr/bin/env node
// Stands in for ffmpeg as the microphone, so a test never opens a real one. It writes its pid to
// FAKE_MIC_PID, sends no audio, and stays until it is killed.
import { writeFileSync } from 'node:fs';

if (process.env.FAKE_MIC_PID) writeFileSync(process.env.FAKE_MIC_PID, String(process.pid));
setInterval(() => {}, 1000);
