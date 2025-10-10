# File Structure Analyzer

A simple CLI tool to analyze and visualize the file and directory structure of any folder.  
Supports custom depth, ignore lists, and displays different icons for different file types.

## Features

- Recursively scans directories and files
- Displays an ASCII tree with icons for file types
- Supports depth limit and ignore patterns
- Outputs summary statistics (total files, size, etc.)
- Colorful output for better readability

## Installation

```bash
npm install -g file-structure-analyzer
```

## Usage

After installing globally from npm, you can use the `fsa` command directly:

```bash
fsa [directory] [options]
```

Or run locally:

```bash
node index.js [directory] [options]
```

Or make it executable:

```bash
chmod +x index.js
./index.js [directory] [options]
```

### Options

- `[directory]` : Directory path to scan (default is current directory)
- `-d, --depth <number>` : Recursion depth limit (default: unlimited)
- `-i, --ignore <items...>` : List of directories or files to ignore (default: node_modules, .git, .vscode, .idea, target)

### Example

```bash
fsa ./src -d 2 -i node_modules dist
```

## Output Example

```
📁 my-project (/path/to/my-project)
├── 📁 src
│   ├── 🟨 index.js (2.1 KB)
│   └── 📝 README.md (1.2 KB)
├── 📁 node_modules
└── 📄 package.json (0.8 KB)

--- Summary ---
Total Items Found: 5
Total Files Found: 3
Total Size: 4.1 KB
```

## License

MIT