# SRT Translator

A command-line tool for translating SRT subtitle files using AI.

[简体中文](README_zh.md)

## Features

- Translate SRT subtitle files into any language
- Preserve original formatting and timecodes
- Support for various OpenAI models (default: gpt-4o)
- Automatic extraction and application of terminology glossaries for consistent translations
- Export and import terminology glossaries for reuse between translation projects
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

To translate a single file:
```bash
node dist/index.js path/to/subtitles.srt
```

To translate multiple files using a glob pattern (e.g., all SRT files in a directory):
```bash
node dist/index.js "path/to/your_directory/*.srt"
```
When processing multiple files, a unified glossary will be extracted from all input files first, ensuring consistency. Then, each file will be translated using this master glossary.

This will translate the subtitles using default settings (English to Chinese).
- For a single input file, the output is saved to `path/to/subtitles-chinese-gpt-4o.srt` by default.
- For multiple input files, each translated file is saved in its original directory with a similar naming convention (e.g., `filename-chinese-gpt-4o.srt`).

### Command Line Options

```
Usage: srt-translator [options] <inputFiles...>

A command-line tool for translating SRT subtitle files using AI

Arguments:
  inputFiles...              Path(s) or glob pattern(s) for input SRT file(s)

Options:
  -o, --output <path>        Path to the output file or directory.
                             - For a single input file, this is the output file path.
                             - For multiple input files, this is the output directory path.
                             (Defaults to input filename with language/model suffix, or input directory for multiple files)
  -s, --source <language>    Source language (default: "english")
  -t, --target <language>    Target language (default: "chinese")
  -m, --model <name>         AI model name (default: "gpt-4o")
  -l, --max-length <number>  Maximum characters per batch (default: 2000)
  -c, --concurrency <number> Number of batches to process concurrently (default: 10)
  --glossary-in <file>       Path to input glossary JSON file
  --glossary-out <file>      Path to output glossary JSON file
  --no-extract-glossary      Skip glossary extraction, use glossary-in directly if provided
  -V, --version              Output the version number
  -h, --help                 Display help information
```

Note: When `--glossary-out` is specified, the program will extract the glossary and exit without performing translation. When `--no-extract-glossary` is specified, the program will skip glossary extraction and use the glossary-in directly if provided.

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

Specify output file (for single input) or output directory (for multiple inputs):

```bash
# Single input, specific output file
node dist/index.js subtitles.srt -t japanese -o translated_japanese.srt

# Multiple inputs, specific output directory
node dist/index.js "episodes/*.srt" -t spanish -o "translated_episodes_spanish/"
```

Translate all SRT files in the current directory and save them to a `translated` subdirectory:
```bash
node dist/index.js "*.srt" -o translated/
```

Adjust batch size and concurrency:

```bash
node dist/index.js subtitles.srt -l 1500 -c 5
```

Export terminology glossary without translation:

```bash
node dist/index.js subtitles.srt --glossary-out glossary.json
```

Use existing terminology glossary for translation:

```bash
node dist/index.js subtitles.srt --glossary-in glossary.json
```

Use existing terminology glossary as a base and extract additional terms:

```bash
node dist/index.js subtitles.srt --glossary-in base-glossary.json --glossary-out extended-glossary.json
```

Skip glossary extraction and use existing glossary directly:

```bash
node dist/index.js subtitles.srt --glossary-in glossary.json --no-extract-glossary
```

Skip glossary extraction entirely (no glossary will be used):

```bash
node dist/index.js subtitles.srt --no-extract-glossary
```

### Automatic Terminology Extraction

The tool automatically analyzes the subtitle file, extracts technical terms and specific vocabulary, and ensures translation consistency. This is especially useful for subtitles containing technical terms, proper nouns, or specific expressions that appear repeatedly.

### Terminology Glossary Management

The tool supports exporting and importing terminology glossaries in JSON format:

- **Export**: Use `--glossary-out` to extract and save terminology from a subtitle file without performing translation
- **Import**: Use `--glossary-in` to apply a previously extracted terminology glossary during translation
- **Extend**: Use both `--glossary-in` and `--glossary-out` to load a base glossary, extract additional terms, and save the extended glossary
- **Skip Extraction**: Use `--no-extract-glossary` to skip the glossary extraction process and use the provided glossary directly

This feature allows you to maintain terminology consistency across multiple subtitle files or translation projects.

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
