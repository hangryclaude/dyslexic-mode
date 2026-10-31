#!/usr/bin/env node
// Stands in for the `claude` CLI: echoes stdin back as a stream-json result,
// and records its argv so tests can check the flags.
import { readFileSync, appendFileSync } from 'node:fs';

const prompt = readFileSync(0, 'utf8');
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify(process.argv.slice(2)) + '\n');
const emit = o => process.stdout.write(JSON.stringify(o) + '\n');
emit({ type: 'system', subtype: 'init', session_id: 'sess-1' });
if (prompt.startsWith('FAIL')) emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' });
else emit({ type: 'result', subtype: 'success', is_error: false, result: `echo: ${prompt}`, session_id: 'sess-1' });
