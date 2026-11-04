#!/usr/bin/env node
// Stands in for the macOS `security` command, so a test never reads or writes the real Keychain.
// Generic passwords live in the JSON file named by FAKE_KEYCHAIN, keyed "service/account", and every
// call's arguments are appended to FAKE_SECURITY_LOG. `find-generic-password -w` prints the secret,
// or fails with 44 the way the real one does when there is no such item.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
if (process.env.FAKE_SECURITY_LOG) appendFileSync(process.env.FAKE_SECURITY_LOG, JSON.stringify(argv) + '\n');
const file = process.env.FAKE_KEYCHAIN;
const items = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const after = name => argv[argv.indexOf(name) + 1];
const id = `${after('-s')}/${after('-a')}`;

if (argv[0] === 'find-generic-password') {
  if (!(id in items)) {
    console.error('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.');
    process.exit(44);
  }
  console.log(items[id]);
} else if (argv[0] === 'add-generic-password') {
  items[id] = after('-w');
  writeFileSync(file, JSON.stringify(items));
} else {
  console.error(`fake security: no such command ${argv[0]}`);
  process.exit(1);
}
