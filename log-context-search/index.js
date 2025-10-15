#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { once } from 'events';
import { Command, InvalidOptionArgumentError } from 'commander';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let loadYaml = null;
try {
  ({ load: loadYaml } = require('yaml-js'));
} catch (err) {
  loadYaml = null;
}

if (process.stdout && typeof process.stdout.on === 'function') {
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') {
      process.exit(0);
    }
    throw err;
  });
}

const TIMESTAMP_FALLBACK = '\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(?:[.,]\\d{3})?';

const program = new Command();

program
  .name('logctx')
  .description('Context-aware log search for large log files')
  .requiredOption('-f, --file <path>', 'Path to the log file to search')
  .option('-c, --config <path>', 'Parser config (JSON or YAML)', 'config.json')
  .option('-l, --level <levels...>', 'Require log level to be one of the provided values (case-insensitive)')
  .option('-k, --keyword <keywords...>', 'Require that any keyword appears in the log record')
  .option('--thread <name>', 'Require thread name (substring match)')
  .option('--from <datetime>', 'Earliest timestamp (inclusive)')
  .option('--to <datetime>', 'Latest timestamp (inclusive)')
  .option('--context-before <count>', 'Records to include before each match', parseNonNegativeInt('--context-before'), 0)
  .option('--context-after <count>', 'Records to include after each match', parseNonNegativeInt('--context-after'), 0)
  .option('--json', 'Emit JSON lines instead of formatted text', false)
  .option('-i, --ignore-case', 'Case-insensitive keyword and thread matching', true)
  .option('--read-index <path>', 'Load prebuilt JSONL index instead of scanning the raw log file')
  .option('--write-index <path>', 'Persist parsed records to a JSONL index for faster subsequent queries');

function parseNonNegativeInt(flag) {
  return (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new InvalidOptionArgumentError(`${flag} expects a non-negative integer, got "${value}"`);
    }
    return parsed;
  };
}

function parseDateOption(value, flag) {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }
  const isoGuess = new Date(value.replace(' ', 'T'));
  if (!Number.isNaN(isoGuess.getTime())) {
    return isoGuess;
  }
  throw new InvalidOptionArgumentError(`${flag} expects a valid datetime, got "${value}"`);
}

async function loadConfigFile(configPath, { optional } = {}) {
  try {
    const raw = await fs.promises.readFile(configPath, 'utf8');
    if (/\.ya?ml$/i.test(configPath)) {
      if (!loadYaml) {
        throw new Error('YAML parser not available. Install yaml-js to use YAML config files.');
      }
      return loadYaml(raw);
    }
    if (/\.json$/i.test(configPath)) {
      return JSON.parse(raw);
    }
    try {
      return JSON.parse(raw);
    } catch (jsonErr) {
      if (!loadYaml) {
        throw jsonErr;
      }
      return loadYaml(raw);
    }
  } catch (err) {
    if (optional && err.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to read config at ${configPath}: ${err.message}`);
  }
}

function buildParser(config) {
  const dateField = config?.fields?.find((field) => field?.type === 'datetime' && field.pattern);
  const startRegex = dateField
    ? new RegExp(dateField.pattern.startsWith('^') ? dateField.pattern : `^${dateField.pattern}`)
    : new RegExp(`^(${TIMESTAMP_FALLBACK})`);
  const headerRegex = new RegExp(`^(${TIMESTAMP_FALLBACK})\\s+([A-Z]+)\\s+(\\d+)\\s+-+\\s+\\[([^\\]]+)\\]\\s+(.*)$`);

  const parseTimestamp = (raw) => {
    if (!raw) {
      return { date: null, ms: null };
    }
    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime())) {
      return { date: direct, ms: direct.getTime() };
    }
    const isoGuess = new Date(raw.replace(' ', 'T'));
    if (!Number.isNaN(isoGuess.getTime())) {
      return { date: isoGuess, ms: isoGuess.getTime() };
    }
    return { date: null, ms: null };
  };

  const splitLocationMessage = (rest) => {
    if (!rest) {
      return { location: null, message: '' };
    }
    let separatorIndex = rest.indexOf(' : ');
    let separatorLength = 3;
    if (separatorIndex === -1) {
      separatorIndex = rest.indexOf(': ');
      separatorLength = separatorIndex === -1 ? 0 : 2;
    }
    if (separatorIndex === -1) {
      return { location: rest.trim() || null, message: '' };
    }
    const location = rest.slice(0, separatorIndex).trim() || null;
    const message = rest.slice(separatorIndex + separatorLength).trim();
    return { location, message };
  };

  const createRecord = (line, lineNumber) => {
    const headerMatch = line.match(headerRegex);
    let timestampRaw = null;
    let level = null;
    let pid = null;
    let thread = null;
    let location = null;
    let message = '';
    if (headerMatch) {
      [, timestampRaw, level, pid, thread] = headerMatch;
      const rest = headerMatch[5] ?? '';
      const split = splitLocationMessage(rest);
      location = split.location;
      message = split.message;
    } else {
      const timestampMatch = line.match(startRegex);
      timestampRaw = timestampMatch ? timestampMatch[0] : null;
      if (timestampRaw) {
        message = line.slice(timestampRaw.length).trim();
      } else {
        message = line;
      }
    }
    const { date, ms } = parseTimestamp(timestampRaw);
    const messageLines = [];
    if (message) {
      messageLines.push(message);
    }
    return {
      index: 0,
      startLine: lineNumber,
      endLine: lineNumber,
      timestamp: date,
      timestampRaw,
      timestampMs: ms,
      level,
      pid,
      thread,
      location,
      message,
      messageLines,
      lines: [line],
      _textCache: null,
      _lowerCache: null,
      _printed: false,
    };
  };

  const appendLine = (record, line, lineNumber) => {
    record.lines.push(line);
    record.messageLines.push(line);
    record.endLine = lineNumber;
    record._textCache = null;
    record._lowerCache = null;
  };

  return {
    isStart: (line) => startRegex.test(line),
    createRecord,
    appendLine,
  };
}

function createFilter({ levels, keywords, thread, fromMs, toMs, ignoreCase }) {
  const levelSet = Array.isArray(levels) && levels.length > 0
    ? new Set(levels.map((lvl) => lvl.toUpperCase()))
    : null;
  const keywordNeedles = Array.isArray(keywords) && keywords.length > 0
    ? keywords.map((kw) => (ignoreCase ? kw.toLowerCase() : kw))
    : [];
  const threadNeedle = thread ? (ignoreCase ? thread.toLowerCase() : thread) : null;

  return (record, getText) => {
    if (fromMs !== null) {
      if (record.timestampMs === null || record.timestampMs < fromMs) {
        return false;
      }
    }
    if (toMs !== null) {
      if (record.timestampMs === null || record.timestampMs > toMs) {
        return false;
      }
    }
    if (levelSet) {
      const normalizedLevel = record.level ? record.level.toUpperCase() : null;
      if (!normalizedLevel || !levelSet.has(normalizedLevel)) {
        return false;
      }
    }
    if (threadNeedle) {
      const haystack = record.thread ? (ignoreCase ? record.thread.toLowerCase() : record.thread) : '';
      if (!haystack.includes(threadNeedle)) {
        return false;
      }
    }
    if (keywordNeedles.length > 0) {
      const haystack = getText(record, ignoreCase);
      if (!keywordNeedles.some((needle) => haystack.includes(needle))) {
        return false;
      }
    }
    return true;
  };
}

function createPrinter({ jsonOutput }) {
  const labelForRole = {
    match: '',
    'context-before': '[BEFORE]',
    'context-after': '[AFTER]',
  };

  return (record, role) => {
    if (jsonOutput) {
      const payload = {
        role,
        index: record.index,
        startLine: record.startLine,
        endLine: record.endLine,
        time: record.timestampRaw,
        level: record.level,
        thread: record.thread,
        location: record.location,
        message: record.message,
        lines: record.lines,
      };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return;
    }

    const label = labelForRole[role] ?? '[LOG]';
    const [firstLine, ...rest] = record.lines;
    process.stdout.write(`${label}${firstLine}\n`);
    for (const line of rest) {
      process.stdout.write(`${line}\n`);
    }
    //process.stdout.write('\n');
  };
}

function serializeRecordForIndex(record) {
  return {
    index: record.index,
    startLine: record.startLine,
    endLine: record.endLine,
    timestampRaw: record.timestampRaw ?? null,
    timestampMs: record.timestampMs ?? null,
    level: record.level ?? null,
    pid: record.pid ?? null,
    thread: record.thread ?? null,
    location: record.location ?? null,
    message: record.message ?? '',
    lines: Array.isArray(record.lines) ? record.lines : [],
  };
}

async function processFile(filePath, parser, filter, printer, { contextBefore, contextAfter, writeIndexPath, fileStat }) {
  const readStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });

  const beforeBuffer = [];
  const contextBeforeCount = Number.isFinite(contextBefore) ? contextBefore : 0;
  const contextAfterCount = Number.isFinite(contextAfter) ? contextAfter : 0;

  let afterCountdown = 0;
  let recordIndex = 0;
  let totalRecords = 0;
  let matchCount = 0;
  let current = null;
  let lineNumber = 0;
  let indexStream = null;

  if (writeIndexPath) {
    indexStream = fs.createWriteStream(writeIndexPath, { encoding: 'utf8' });
    const meta = {
      type: 'meta',
      file: path.resolve(filePath),
      size: fileStat?.size ?? null,
      mtimeMs: fileStat?.mtimeMs ?? null,
      generatedAt: new Date().toISOString(),
    };
    indexStream.write(`${JSON.stringify(meta)}\n`);
  }

  const getText = (record, lowercase) => {
    if (lowercase) {
      if (record._lowerCache === null) {
        record._lowerCache = record.lines.join('\n').toLowerCase();
      }
      return record._lowerCache;
    }
    if (record._textCache === null) {
      record._textCache = record.lines.join('\n');
    }
    return record._textCache;
  };

  const finalizeRecord = async (record) => {
    if (!record) {
      return;
    }
    recordIndex += 1;
    totalRecords += 1;
    record.index = recordIndex;
    record.message = record.messageLines.length > 0 ? record.messageLines.join('\n') : '';

    const isMatch = filter(record, getText);
    if (isMatch && contextBeforeCount > 0) {
      for (const ctx of beforeBuffer) {
        if (!ctx._printed) {
          printer(ctx, 'context-before');
          ctx._printed = true;
        }
      }
    }

    const shouldPrintAsAfter = !isMatch && afterCountdown > 0;
    if ((isMatch || shouldPrintAsAfter) && !record._printed) {
      printer(record, isMatch ? 'match' : 'context-after');
      record._printed = true;
    }

    if (isMatch) {
      matchCount += 1;
      afterCountdown = contextAfterCount;
    } else if (afterCountdown > 0) {
      afterCountdown -= 1;
    }

    if (contextBeforeCount > 0) {
      beforeBuffer.push(record);
      if (beforeBuffer.length > contextBeforeCount) {
        beforeBuffer.shift();
      }
    }

    if (indexStream) {
      const payload = serializeRecordForIndex(record);
      if (!indexStream.write(`${JSON.stringify(payload)}\n`)) {
        await once(indexStream, 'drain');
      }
    }
  };

  try {
    for await (const line of rl) {
      lineNumber += 1;
      if (parser.isStart(line)) {
        await finalizeRecord(current);
        current = parser.createRecord(line, lineNumber);
      } else if (current) {
        parser.appendLine(current, line, lineNumber);
      } else {
        current = parser.createRecord(line, lineNumber);
      }
    }
    await finalizeRecord(current);
  } finally {
    rl.close();
    readStream.destroy();
    if (indexStream) {
      await new Promise((resolve, reject) => {
        indexStream.end((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
  }

  return { totalRecords, matchCount };
}

async function processIndex(indexPath, filter, printer, { contextBefore, contextAfter, expectedFile, expectedStat }) {
  const readStream = fs.createReadStream(indexPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });

  const beforeBuffer = [];
  const contextBeforeCount = Number.isFinite(contextBefore) ? contextBefore : 0;
  const contextAfterCount = Number.isFinite(contextAfter) ? contextAfter : 0;

  let afterCountdown = 0;
  let recordIndex = 0;
  let totalRecords = 0;
  let matchCount = 0;
  let meta = null;
  let lineNumber = 0;

  const getText = (record, lowercase) => {
    if (lowercase) {
      if (record._lowerCache === null) {
        record._lowerCache = record.lines.join('\n').toLowerCase();
      }
      return record._lowerCache;
    }
    if (record._textCache === null) {
      record._textCache = record.lines.join('\n');
    }
    return record._textCache;
  };

  const finalizeRecord = (record) => {
    if (!record) {
      return;
    }
    recordIndex += 1;
    totalRecords += 1;
    record.index = recordIndex;

    const isMatch = filter(record, getText);
    if (isMatch && contextBeforeCount > 0) {
      for (const ctx of beforeBuffer) {
        if (!ctx._printed) {
          printer(ctx, 'context-before');
          ctx._printed = true;
        }
      }
    }

    const shouldPrintAsAfter = !isMatch && afterCountdown > 0;
    if ((isMatch || shouldPrintAsAfter) && !record._printed) {
      printer(record, isMatch ? 'match' : 'context-after');
      record._printed = true;
    }

    if (isMatch) {
      matchCount += 1;
      afterCountdown = contextAfterCount;
    } else if (afterCountdown > 0) {
      afterCountdown -= 1;
    }

    if (contextBeforeCount > 0) {
      beforeBuffer.push(record);
      if (beforeBuffer.length > contextBeforeCount) {
        beforeBuffer.shift();
      }
    }
  };

  try {
    for await (const line of rl) {
      lineNumber += 1;
      if (!line) {
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new Error(`Malformed index entry at ${indexPath}:${lineNumber}: ${err.message}`);
      }

      if (parsed && parsed.type === 'meta') {
        meta = parsed;
        continue;
      }

      const record = {
        index: parsed.index ?? 0,
        startLine: parsed.startLine ?? 0,
        endLine: parsed.endLine ?? parsed.startLine ?? 0,
        timestampRaw: parsed.timestampRaw ?? parsed.time ?? null,
        timestampMs: typeof parsed.timestampMs === 'number' ? parsed.timestampMs : null,
        level: parsed.level ?? null,
        pid: parsed.pid ?? null,
        thread: parsed.thread ?? null,
        location: parsed.location ?? null,
        message: parsed.message ?? '',
        messageLines: Array.isArray(parsed.messageLines)
          ? parsed.messageLines
          : (parsed.message ? String(parsed.message).split('\n') : []),
        lines: Array.isArray(parsed.lines) ? parsed.lines : [],
        _textCache: null,
        _lowerCache: null,
        _printed: false,
      };

      finalizeRecord(record);
    }
  } finally {
    rl.close();
    readStream.destroy();
  }

  if (meta && expectedFile) {
    const normalizedMetaFile = meta.file ? path.resolve(meta.file) : null;
    if (normalizedMetaFile && normalizedMetaFile !== expectedFile) {
      console.warn(`Index file ${indexPath} was generated for ${normalizedMetaFile}, but current log is ${expectedFile}. Results may be inconsistent.`);
    } else if (expectedStat && meta.mtimeMs && Math.abs(meta.mtimeMs - expectedStat.mtimeMs) > 1) {
      console.warn(`Index file ${indexPath} may be stale; log file modified after index creation.`);
    }
  }

  return { totalRecords, matchCount };
}

async function main() {
  program.parse(process.argv);
  const options = program.opts();

  const readIndexPath = options.readIndex ? path.resolve(process.cwd(), options.readIndex) : null;
  const writeIndexPath = options.writeIndex ? path.resolve(process.cwd(), options.writeIndex) : null;

  if (readIndexPath && writeIndexPath) {
    console.error('Cannot use --read-index and --write-index together. Choose one.');
    process.exitCode = 1;
    return;
  }

  if (readIndexPath && !fs.existsSync(readIndexPath)) {
    console.error(`Index file not found: ${readIndexPath}`);
    process.exitCode = 1;
    return;
  }

  const filePath = path.resolve(process.cwd(), options.file);
  const usingIndexOnly = Boolean(readIndexPath);
  let fileStat = null;

  if (!usingIndexOnly) {
    if (!fs.existsSync(filePath)) {
      console.error(`Log file not found: ${filePath}`);
      process.exitCode = 1;
      return;
    }
    try {
      fileStat = await fs.promises.stat(filePath);
    } catch (err) {
      console.error(`Failed to stat log file ${filePath}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
  } else if (fs.existsSync(filePath)) {
    try {
      fileStat = await fs.promises.stat(filePath);
    } catch (err) {
      fileStat = null;
    }
  }

  let config = null;
  if (!usingIndexOnly) {
    const configProvided = program.getOptionValueSource('config') !== 'default';
    const resolvedConfigPath = path.resolve(process.cwd(), options.config);
    try {
      config = await loadConfigFile(resolvedConfigPath, { optional: !configProvided });
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
  }

  let fromDate = null;
  let toDate = null;
  try {
    fromDate = options.from ? parseDateOption(options.from, '--from') : null;
    toDate = options.to ? parseDateOption(options.to, '--to') : null;
  } catch (err) {
    if (err instanceof InvalidOptionArgumentError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    console.error('--from must be earlier than or equal to --to');
    process.exitCode = 1;
    return;
  }

  const parser = usingIndexOnly ? null : buildParser(config ?? {});
  const filter = createFilter({
    levels: options.level ?? [],
    keywords: options.keyword ?? [],
    thread: options.thread ?? null,
    fromMs: fromDate ? fromDate.getTime() : null,
    toMs: toDate ? toDate.getTime() : null,
    ignoreCase: Boolean(options.ignoreCase),
  });

  const printer = createPrinter({ jsonOutput: Boolean(options.json) });

  try {
    if (usingIndexOnly) {
      await processIndex(readIndexPath, filter, printer, {
        contextBefore: options.contextBefore,
        contextAfter: options.contextAfter,
        expectedFile: fs.existsSync(filePath) ? path.resolve(filePath) : null,
        expectedStat: fileStat,
      });
    } else {
      await processFile(filePath, parser, filter, printer, {
        contextBefore: options.contextBefore,
        contextAfter: options.contextAfter,
        writeIndexPath,
        fileStat,
      });
    }
  } catch (err) {
    console.error(`Failed to process log file: ${err.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
