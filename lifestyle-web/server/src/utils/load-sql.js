const fs = require('fs');

/**
 * Reads a SQL seed file and returns executable statements.
 * Handles multi-statement blocks (e.g. triggers) so we only split
 * when we're not inside a BEGIN...END block.
 */
function loadSqlStatements(filePath) {
  const sql = fs.readFileSync(filePath, 'utf-8');
  const lines = sql.split(/\r?\n/);
  const statements = [];
  let buffer = [];
  let blockDepth = 0;

  const flush = () => {
    const statement = buffer.join('\n').trim();
    if (statement.length && !statement.startsWith('--')) {
      statements.push(statement);
    }
    buffer = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      if (buffer.length) {
        buffer.push('');
      }
      return;
    }

    if (trimmed.startsWith('--')) {
      if (buffer.length) {
        buffer.push(line);
      }
      return;
    }

    buffer.push(line);

    const upper = trimmed.toUpperCase();
    if (/^BEGIN\b/.test(upper)) {
      blockDepth += 1;
    } else if (/^END\b/.test(upper)) {
      blockDepth = Math.max(0, blockDepth - 1);
    }

    if (blockDepth === 0 && /;\s*$/.test(trimmed)) {
      flush();
    }
  });

  if (buffer.length) {
    flush();
  }

  return statements;
}

module.exports = loadSqlStatements;
