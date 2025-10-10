# Log-Obfuscator

Before submitting user logs (such as Nginx logs or application error logs) to analysis tools or third parties for debugging, it is essential to remove sensitive information (IP addresses, emails, credit card numbers). Manually editing large log files is time-consuming and unsafe.

## 🚀 Tool Idea: Log-Obfuscator

### Features

- Accepts a log file path or directory.
- Identifies and obfuscates sensitive data using built-in or user-provided regular expression patterns, without affecting the log structure.  
  (For example, replaces IP addresses with `[IP_REDACTED]`, emails with `[EMAIL_REDACTED]`.)
- Outputs the obfuscated logs to a new file or stream.

### User Pain Point Solved

Automates the critical step of data privacy and compliance, ensuring sensitive information is not leaked to debugging environments or analysis services.

### Why Node.js

Node.js provides excellent stream processing capabilities, allowing efficient handling of very large log files (GB-level) without loading the entire file into memory.

---

## Usage

### Install

Clone this repo or copy the tool directory, then install dependencies if needed:

```bash
npm install
```

### Command Line

```bash
node index.js <input> [options]
```

Or, if you add a bin entry and install globally:

```bash
log-obfuscator <input> [options]
```

#### Arguments

- `<input>`: Path to a log file or directory to process.

#### Options

- `-o, --output <output>`: Output file or directory. If not specified, output will be printed to stdout.
- `-p, --patterns <patternFile>`: Path to a custom patterns JSON file for additional or custom obfuscation rules.

#### Examples

Obfuscate a single log file and print to console:

```bash
node index.js example.log
```

Obfuscate a log file and write to a new file:

```bash
node index.js example.log -o obfuscated.log
```

Obfuscate all logs in a directory and output to another directory:

```bash
node index.js ./logs -o ./logs-obfuscated
```

Use custom patterns:

```bash
node index.js example.log -p my-patterns.json -o obfuscated.log
```

#### Custom Patterns File Example

`my-patterns.json`:

```json
[
  {
    "name": "Phone Number",
    "regex": "\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b",
    "replacement": "[PHONE_REDACTED]"
  }
]
```

---

## Example

**Input:**

```
2023-10-08 12:00:01 INFO User login from 192.168.1.10, email: alice@example.com
2023-10-08 12:01:15 ERROR Payment failed for user bob@example.com, card: 4111 1111 1111 1111
```

**Output:**

```
2023-10-08 12:00:01 INFO User login from [IP_REDACTED], email: [EMAIL_REDACTED]
2023-10-08 12:01:15 ERROR Payment failed for user [EMAIL_REDACTED], card: [CREDIT_CARD_REDACTED]
```