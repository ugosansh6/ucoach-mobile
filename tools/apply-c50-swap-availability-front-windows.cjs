const fs = require('fs');

const originalReadFileSync = fs.readFileSync.bind(fs);
const originalWriteFileSync = fs.writeFileSync.bind(fs);
const eolByFile = new Map();

fs.readFileSync = function patchedReadFileSync(file, options) {
  const value = originalReadFileSync(file, options);

  if (typeof value !== 'string') {
    return value;
  }

  const key = String(file);
  eolByFile.set(key, value.includes('\r\n') ? '\r\n' : '\n');

  return value.replace(/\r\n/g, '\n');
};

fs.writeFileSync = function patchedWriteFileSync(file, data, options) {
  let output = data;
  const key = String(file);

  if (
    typeof output === 'string' &&
    eolByFile.get(key) === '\r\n'
  ) {
    output = output.replace(/\n/g, '\r\n');
  }

  return originalWriteFileSync(file, output, options);
};

require('./apply-c50-swap-availability-front.cjs');
