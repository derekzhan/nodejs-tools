#!/usr/bin/env node

import fs, { readFileSync } from 'fs';
import path from 'path';
import { program } from 'commander';

// Default regex patterns for sensitive data
const defaultPatterns = [
    { name: 'IP Address', regex: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g, replacement: '[IP_REDACTED]' },
    { name: 'Email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]' },
    { name: 'Credit Card', regex: /\b(?:\d[ -]*?){13,16}\b/g, replacement: '[CREDIT_CARD_REDACTED]' }
];

// Load user patterns from file if provided
function loadUserPatterns(patternFilePath) {
    const fileContent = readFileSync(patternFilePath, 'utf8');  
    try {
        const userPatterns = JSON.parse(fileContent);
        return userPatterns.map(p => ({
            name: p.name,
            regex: new RegExp(p.regex, 'g'),
            replacement: p.replacement
        }));
    } catch (err) {
        console.error(`Error loading patterns from file: ${err.message}`);
        process.exit(1);
    }
}

// Obfuscate a single line using patterns
function obfuscateLine(line, patterns) {
    patterns.forEach(pattern => {
        line = line.replace(pattern.regex, pattern.replacement);
    }); 
    return line;
}

// Process a single file (streaming)
function processLogFile(inputPath, outputPath, patterns) {
    // Implement streaming read and write, line by line obfuscation
    const readStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
    const writeStream = outputPath ? fs.createWriteStream(outputPath, { encoding: 'utf8' }) : process.stdout;

    let leftover = '';
    readStream.on('data', chunk => {
        const lines = (leftover + chunk).split('\n');
        leftover = lines.pop(); // Save the last partial line
        lines.forEach(line => {
            const obfuscatedLine = obfuscateLine(line, patterns);
            writeStream.write(obfuscatedLine + '\n');
        });
    });

    readStream.on('end', () => {
        if (leftover) {
            const obfuscatedLine = obfuscateLine(leftover, patterns);
            writeStream.write(obfuscatedLine + '\n');
        }
        if (outputPath) writeStream.end();
    });

    readStream.on('error', err => {
        console.error(`Error reading file: ${err.message}`);
        process.exit(1);
    });

    writeStream.on('error', err => {
        console.error(`Error writing file: ${err.message}`);
        process.exit(1);
    });
}

// Process a directory recursively
function processDirectory(dirPath, outputDir, patterns) {
    fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
        if (err) {
            console.error(`Error reading directory: ${err.message}`);
            process.exit(1);
        }
        entries.forEach(entry => {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isFile()) {
                const outputPath = outputDir ? path.join(outputDir, entry.name) : undefined;
                processLogFile(fullPath, outputPath, patterns);
            } else if (entry.isDirectory()) {
                const newOutputDir = outputDir ? path.join(outputDir, entry.name) : undefined;
                if (newOutputDir && !fs.existsSync(newOutputDir)) {
                    fs.mkdirSync(newOutputDir, { recursive: true });
                }
                processDirectory(fullPath, newOutputDir, patterns);
            }
        });
    });
}

// CLI setup
program
    .name('obfu')
    .description('Obfuscate sensitive information in log files before sharing.')
    .argument('<input>', 'Log file or directory to process')
    .option('-o, --output <output>', 'Output file or directory')
    .option('-p, --patterns <patternFile>', 'Path to custom patterns file')
    .action((input, options) => {
        if (!input || input === 'help') {
            program.help();
            return;
        }
        const inputPath = path.resolve(input);
        const outputPath = options.output ? path.resolve(options.output) : undefined;
        let patterns = [...defaultPatterns];

        if (options.patterns) {
            const userPatterns = loadUserPatterns(options.patterns);
            patterns = patterns.concat(userPatterns);
        }

        fs.stat(inputPath, (err, stats) => {
            if (err) {
                console.error(`Input path error: ${err.message}`);
                process.exit(1);
            }
            if (stats.isFile()) {
                processLogFile(inputPath, outputPath, patterns);
            } else if (stats.isDirectory()) {
                processDirectory(inputPath, outputPath, patterns);
            } else {
                console.error('Input must be a file or directory.');
                process.exit(1);
            }
        });
    });

program.parse(process.argv);