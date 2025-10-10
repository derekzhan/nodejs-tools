# logctx

Context-aware CLI for mining large Java-style log files without sacrificing stack traces or threading context. The tool streams data so it can handle huge files, groups multi-line records into structured entries, and lets you filter by level, keyword, time range, or thread. Optional JSON output and an on-disk index make it easy to automate queries or speed up repeat searches.

## Requirements
- Node.js 18 or newer (tested with Node 22)
- macOS or Linux shell (Windows users can rely on WSL)

## Installation
```bash
npm install
# Optional: expose the CLI globally during development
npm link
```

If you do not want to link globally, invoke the tool with `node index.js`.

## Quick Start
```bash
# Find ERROR records and include one record of context before and after each match
node index.js --file example.log --level ERROR --context-before 1 --context-after 1

# Search for a keyword inside multi-line stack traces
node index.js --file example.log --keyword RuntimeException

# Filter by time range and thread name (substring match)
node index.js --file example.log --from "2025-10-06 13:00" --to "2025-10-06 13:45" --thread http-nio-9080-exec-2
```

Use `--json` when you need machine-readable output:
```bash
node index.js --file example.log --level ERROR --json | jq .
```

## Command Line Options
Run `node index.js --help` to see the live help. The following table summarises the most useful switches:

| Option | Description |
| --- | --- |
| `-f, --file <path>` | Log file to inspect (required). |
| `-c, --config <path>` | Parser definition (JSON or YAML). Defaults to `config.json`. |
| `-l, --level <values...>` | Only keep records whose level matches one of the provided values (case-insensitive). |
| `-k, --keyword <words...>` | Require at least one keyword to appear in the full record (including stack trace). |
| `--thread <name>` | Require the thread field to contain the provided substring. |
| `--from <datetime>` / `--to <datetime>` | Inclusive time window; accepts common formats like `2025-10-06 13:00:00`. |
| `--context-before <n>` / `--context-after <n>` | Emit surrounding records when a match is found. Context is record-based, not line-based. |
| `--json` | Emit JSON Lines objects instead of annotated text. |
| `-i, --ignore-case` | Force case-insensitive keyword and thread searches. |
| `--write-index <path>` | Persist parsed records to a JSONL index for faster follow-up queries. |
| `--read-index <path>` | Reuse a previously created index instead of rescanning the raw log. |

## Indexing for Faster Re-runs
When a log file is large but queried repeatedly with different filters, create a JSONL index once and reuse it:

```bash
# First run: build the index while performing a query
node index.js --file example.log --write-index cache/example.idx --level ERROR

# Later runs: load the index directly (must match the same log file)
node index.js --file example.log --read-index cache/example.idx --keyword "SQLSyntaxErrorException"
```

Each index begins with a metadata line that records the source file path, size, and modification timestamp. The CLI warns if the index no longer matches the underlying log.

## Customising the Parser
The default configuration in `config.json` targets Spring Boot style logs with timestamps, levels, process IDs, and thread names. You can adapt the parser by editing the `fields` array:

```json
{
  "fields": [
    { "name": "time", "type": "datetime", "pattern": "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3}" },
    { "name": "level", "type": "string", "delimiter": " " },
    { "name": "pid", "type": "string", "delimiter": " " },
    { "name": "dash", "type": "string", "delimiter": " " },
    { "name": "thread", "type": "string", "delimiter": "] " },
    { "name": "logger_method_line", "type": "string", "delimiter": " :" },
    { "name": "colon", "type": "string", "delimiter": " " },
    { "name": "message", "type": "rest" }
  ]
}
```

- The first field with `type: "datetime"` supplies the regex that detects the start of a new record.
- Additional fields help split out thread names, logger identifiers, and the initial message text.
- Any trailing lines not matching the header (for example stack traces) are automatically attached to the active record.

You can point to an alternative configuration at runtime:
```bash
node index.js --file app.log --config path/to/logback.json --level WARN
```

## Fixtures and Sample Logs
The repository ships with:
- `example.log`: a full Spring Boot application log borrowed from real-world traces.
- `fixtures/spring-sample.log` and `fixtures/threaded.log`: concise fixtures used in automated tests to validate parsing behaviour across header variants.

Feel free to drop in your own fixtures under `fixtures/` when extending the parser.

## Running the Test Suite
Node 18+ provides a built-in test runner. Execute:
```bash
npm test
```

The tests cover:
- Preserving context around Spring-style stack traces.
- Thread filtering in single-dash log headers.
- Parity between direct scans and queries routed through a cached JSONL index.

## Development Notes
- The CLI streams logs using `fs.createReadStream` and `readline`, so it scales to large files without loading them into memory.
- `--context-before` and `--context-after` operate on parsed records, ensuring stack traces remain intact.
- Keyword searches run against the entire record content; add `--json` when you need to pipe results into other tools.
- When piping to commands such as `head`, the CLI traps `EPIPE` errors to avoid noisy stack traces.

## Roadmap Ideas
- Document additional parser presets for common logging frameworks (log4j, JSON logs).
- Support byte-offset indexes for random access against original log files.
- Expose a small HTTP or TUI wrapper for interactive browsing.

Contributions, ideas, or bug reports are welcome—open an issue or start a discussion.
