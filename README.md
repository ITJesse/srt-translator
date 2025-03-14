# SRT Translator

A command-line tool for translating SRT subtitle files using AI.

[简体中文](README_zh.md)

## Features

- Translate SRT subtitle files into any language
- Preserve original formatting and timecodes
- Support for various OpenAI models (default: gpt-4o)
- Automatic extraction and application of terminology glossaries for consistent translations
- Batch processing to handle large subtitle files
- Command-line interface for easy integration

## Installation

### Prerequisites

- Node.js (v20 or higher)
- Yarn
- OpenAI API compatible key

### Setup

1. Clone this repository:

   ```
   git clone https://github.com/ITJesse/srt-translator.git
   cd srt-translator
   ```

2. Install dependencies:

   ```
   yarn install
   ```

3. Build the project:

   ```
   yarn build
   ```

4. Set up environment variables (create a .env file in the project root):

   ```
   OPENAI_API_KEY=your_api_key_here
   OPENAI_API_BASE_URL=https://api.openai.com/v1  # Optional, if using another compatible service
   ```

## Usage

### Basic Usage

```bash
node dist/index.js path/to/subtitles.srt
```

This will translate the subtitles using default settings (English to Chinese) and save the output to `path/to/translated_subtitles.srt`.

### Command Line Options

```
Usage: srt-translator [options] <inputFile>

A command-line tool for translating SRT subtitle files using AI

Arguments:
  inputFile                  Path to the input SRT file

Options:
  -o, --output <file>        Path to the output SRT file (defaults to input filename with prefix)
  -s, --source <language>    Source language (default: "english")
  -t, --target <language>    Target language (default: "chinese")
  -m, --model <name>         AI model name (default: "gpt-4o")
  -l, --max-length <number>  Maximum characters per batch (default: 2000)
  -c, --concurrency <number> Number of batches to process concurrently (default: 10)
  -V, --version              Output the version number
  -h, --help                 Display help information
```

### Examples

Translate to Japanese:

```bash
node dist/index.js subtitles.srt -t japanese
```

Specify source and target languages:

```bash
node dist/index.js subtitles.srt -s english -t french
```

Use a different OpenAI model:

```bash
node dist/index.js subtitles.srt -t german -m gpt-3.5-turbo
```

Specify output file:

```bash
node dist/index.js subtitles.srt -t japanese -o translated_japanese.srt
```

Adjust batch size and concurrency:

```bash
node dist/index.js subtitles.srt -l 1500 -c 5
```

### Automatic Terminology Extraction

The tool automatically analyzes the subtitle file, extracts technical terms and specific vocabulary, and ensures translation consistency. This is especially useful for subtitles containing technical terms, proper nouns, or specific expressions that appear repeatedly.

## Development

### Project Structure

```
srt-translator/
├── src/
│   ├── index.ts           # Main entry point and CLI tool
│   └── lib/
│       ├── srt.ts         # SRT file processing
│       ├── translate.ts   # AI translation service
│       └── prompts.ts     # Translation prompt templates
├── dist/                  # Compiled JavaScript
├── .env.example           # Environment variables example
├── .env                   # Environment variables (to be created)
├── package.json           # Project configuration
└── tsconfig.json          # TypeScript configuration
```

### Scripts

- `yarn build`: Build the project
- `yarn start`: Run the compiled code
- `yarn dev`: Run using ts-node (development environment)

## How It Works

1. Parse the SRT file, preserving subtitle indexes, timestamps, and text
2. Use AI to analyze subtitle text and automatically extract terminology glossary
3. Send subtitles in batches to the OpenAI API for translation
4. Ensure terminology consistency throughout the translation process
5. Reassemble the translated subtitles into valid SRT format
6. Output to target file

## License

MIT
