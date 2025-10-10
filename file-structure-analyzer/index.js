#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import { program } from 'commander';
import chalk from 'chalk';

// File type to icon mapping
const fileTypeIcons = {
    // Documents
    'pdf': '📕',
    'doc': '📄', 'docx': '📄',
    'xls': '📊', 'xlsx': '📊',
    'ppt': '📈', 'pptx': '📈',
    'txt': '📄', 'md': '📝',
    // Code
    'js': '🟨', 'ts': '🟦', 'json': '🟫',
    'html': '🌐', 'css': '🎨', 'scss': '🎨',
    'py': '🐍', 'java': '☕', 'c': '🔵', 'cpp': '🔷', 'cs': '⚙️',
    'go': '🐹', 'rb': '💎', 'php': '🐘', 'sh': '💻',
    // Images
    'png': '🖼️', 'jpg': '🖼️', 'jpeg': '🖼️', 'gif': '🖼️', 'svg': '🖼️',
    // Audio/Video
    'mp3': '🎵', 'wav': '🎵', 'mp4': '🎬', 'mov': '🎬', 'avi': '🎬',
    // Archives
    'zip': '🗜️', 'rar': '🗜️', '7z': '🗜️', 'tar': '🗜️', 'gz': '🗜️',
    // Default
    'default': '📄'
};
function getFileIcon(filename, isDir) {
    if (isDir) return '📁';
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    return fileTypeIcons[ext] || fileTypeIcons['default'];
}

// --- Core Logic Functions ---

/**
 * Recursively traverse a directory and collect file information
 * @param {string} currentPath - The path to scan
 * @param {number} depth - Current recursion depth (root is 0)
 * @param {string[]} ignoreList - List of file or directory names to ignore
 * @param {number} maxDepthLimit - Maximum allowed recursion depth (e.g. user input 1)
 * @returns {Promise<object[]>} - Array containing all file information
 */
async function traverseDirectory(currentPath, depth, ignoreList = [], maxDepthLimit) {
    const results = [];
    const promises = [];
    
    const nextDepth = depth + 1;
    if (nextDepth > maxDepthLimit) {
        return results;
    }

    try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
            
            // Ignore list check (robust handling)
            if (ignoreList.includes(entry.name)) {
                continue;
            }
            
            const fullPath = path.join(currentPath, entry.name);

            if (entry.isDirectory()) {
                // Record directory path info
                results.push({
                    name: entry.name,
                    path: fullPath,
                    depth: nextDepth,
                    type: 'directory',
                    isDir: true
                });
                
                // Recursive call, increase depth
                const subDirPromise = traverseDirectory(fullPath, nextDepth, ignoreList, maxDepthLimit)
                    .then(subResults => {
                        results.push(...subResults);
                    });
                promises.push(subDirPromise);

            } else if (entry.isFile()) {
                // Record file info
                try {
                    const stats = await fs.stat(fullPath);
                    results.push({
                        name: entry.name,
                        path: fullPath,
                        size: stats.size,
                        depth: nextDepth,
                        type: 'file',
                        isDir: false
                    });
                } catch (error) {
                    // Ignore file read errors
                }
            }
        }

        // Wait for all async recursive operations to finish
        await Promise.all(promises);
    } catch (error) {
        // Gracefully handle directory read errors (e.g. insufficient permissions)
        console.warn(`[WARNING] Skipping directory ${currentPath} due to error: ${error.message}`);
    }
    return results;
}

// --- Formatting and Helper Functions ---

const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * Format output as ASCII tree structure
 * Fixed sorting and precise connector logic.
 * @param {object[]} entries - File/directory info from traverseDirectory
 */
function formatAsTree(entries) {
    
    entries.sort((a, b) => {
        // 1. Sort by full path (ensure parent-child continuity)
        const pathCompare = a.path.localeCompare(b.path);
        if (pathCompare !== 0) return pathCompare;
        
        // 2. Directories before files (for aesthetics)
        return a.isDir === b.isDir ? 0 : (a.isDir ? -1 : 1);
    });
    
    let output = '';
    const isLastMap = {}; // Store whether each entry is the last among its siblings

    // 1. Precompute 'isLast' property
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const nextEntry = entries[i + 1];

        // If next entry doesn't exist, or its depth is less than or equal to current, this is last.
        if (!nextEntry || nextEntry.depth <= entry.depth) {
            isLastMap[entry.path] = true;
        } else {
            isLastMap[entry.path] = false;
        }
    }

    // 2. Draw structure
    for (const entry of entries) {
        const currentDepth = entry.depth;
        let prefix = '';

        // Draw vertical lines or spaces for ancestors (start from first ancestor)
        let parentPath = path.dirname(entry.path);

        
        // Trace up from current depth - 1
        for (let j = currentDepth - 1; j >= 1; j--) {
            
            // Check if ancestor is last among its siblings
            const ancestorIsLast = isLastMap[parentPath];
            
            // If ancestor is last sibling, draw space ('    '), else draw vertical line ('│   ')
            prefix = (ancestorIsLast ? '    ' : '│   ') + prefix;
            
            // Move up to grandparent path
            parentPath = path.dirname(parentPath);
        }

        // Draw connector for current level (├── or └──)
        const isLast = isLastMap[entry.path];
        const connector = chalk.gray(isLast ? '└── ' : '├── '); 

        // Draw icon, name, and size
        const icon = getFileIcon(entry.name, entry.isDir);
        
        const sizeDisplay = entry.type === 'file' ? ` (${formatBytes(entry.size)})` : '';
        
        let coloredName;
        if (entry.type === 'directory') {
            coloredName = chalk.blue.bold(`${icon} ${entry.name}`);
        } else {
            coloredName = chalk.white(`${icon} ${entry.name}${sizeDisplay}`);
        }

        output += `${prefix}${connector}${coloredName}\n`;
    }
    
    console.log(output);
}

// --- Command Line Interface (CLI) Definition ---

program
    .name('fsa')
    .description('File/Directory Structure Analyzer')
    .version('1.0.0');

program
    .argument('[dirPath]', 'Directory path to scan (default is current directory)')
    .option('-d, --depth <number>', 'Recursion depth limit (starting from root)')
    .option('-i, --ignore <items...>', 'List of directories or files to ignore', ['node_modules', '.git','.vscode','.idea','target'])
    
    .action(async (dirPath, options) => {

        // --- 1. Handle help command ---
        // If user enters fsa help
        if (dirPath === 'help') {
             // Output usage info and exit
            program.help(); 
            return; 
        }
        
        // --- 2. Handle dirPath default value ---
        // If dirPath is undefined or null, use '.' (current directory)
        const targetPath = dirPath || '.'; 
        const fullPath = path.resolve(targetPath);

        // --- 3. Main logic execution ---
        try {
            // Depth handling: ensure depthLimit is a number
            const userDepth = options.depth; 
            const depthLimit = parseInt(userDepth) || 1000000; 
            
            console.log(`Scanning: ${fullPath}`);
            console.log(`Options: Depth Limit=${depthLimit}, Ignore=[${options.ignore.join(', ')}]\n`);

            
            // 1. Call core traversal function
            const results = await traverseDirectory(fullPath, 0, options.ignore, depthLimit);

            // 2. Output root directory info (handled separately to avoid affecting formatAsTree sorting)
            const rootName = path.basename(fullPath);
            console.log(`📁 ${rootName} (${fullPath})`);

            // 3. Call formatting output function
            if (results.length > 0) {
                formatAsTree(results);
            }

            // 4. Output summary report
            const totalFiles = results.filter(item => item.type === 'file').length;
            const totalSize = results.reduce((sum, item) => sum + (item.size || 0), 0);
            
            console.log(`\n--- Summary ---`);
            console.log(`Total Items Found: ${results.length}`);
            console.log(`Total Files Found: ${totalFiles}`);
            console.log(`Total Size: ${formatBytes(totalSize)}`);

        } catch (error) {
            console.error(`\nOperation failed: ${error.message}`);
            process.exit(1);
        }
    });

program.parse(process.argv);