# SRT Translator

A command-line tool to translate SRT subtitle files using AI (OpenAI).

## Features

- Translate SRT subtitle files to any language
- Preserve original formatting and timing
- Support for various OpenAI models
- Batch processing to handle large subtitle files
- Command-line interface for easy integration

## Installation

### Prerequisites

- Node.js (v14 or later)
- Yarn or npm
- OpenAI API key

### Setup

1. Clone this repository:

   ```
   git clone https://github.com/yourusername/srt-translator.git
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

4. Create a `.env` file with your OpenAI API key:
   ```
   cp .env.example .env
   ```
   Then edit the `.env` file and add your OpenAI API key.

### Global Installation

You can install the tool globally to use it from anywhere:

1. Link the package globally:

   ```
   yarn link
   ```

   Or if you prefer npm:

   ```
   npm link
   ```

2. Now you can use the `srt-translator` command from anywhere:

   ```
   srt-translator path/to/subtitles.srt -t Chinese
   ```

3. Alternatively, you can install directly from GitHub:
   ```
   npm install -g github:yourusername/srt-translator
   ```

## Usage

### Basic Usage

```bash
yarn translate path/to/subtitles.srt -t Chinese
```

This will translate the subtitles to Chinese and save the output to `path/to/subtitles.Chinese.srt`.

If installed globally:

```bash
srt-translator path/to/subtitles.srt -t Chinese
```

### Command-line Options

```
Usage: srt-translator [options] <input>

Translate SRT subtitle files using AI

Arguments:
  input                       Input SRT file path

Options:
  -o, --output <path>         Output SRT file path
  -s, --source-language <language>  Source language (auto-detect if not specified)
  -t, --target-language <language>  Target language
  -m, --model <model>         OpenAI model to use
  -p, --preserve-formatting   Preserve original formatting
  -k, --api-key <key>         OpenAI API key (overrides OPENAI_API_KEY environment variable)
  -b, --base-url <url>        OpenAI API base URL (overrides OPENAI_API_BASE_URL environment variable)
  -l, --max-batch-length <length>  Maximum character length per batch
  -v, --verbose               Enable verbose logging
  -h, --help                  Display help for command
  -V, --version               Output the version number

Default values:
  - Target language: English
  - Model: Value from DEFAULT_MODEL environment variable or gpt-3.5-turbo
  - Preserve formatting: true
  - Max batch length: 2000 characters
```

### Examples

Translate to Spanish:

```bash
yarn translate subtitles.srt -t Spanish
```

Specify source and target languages:

```bash
yarn translate subtitles.srt -s English -t French
```

Use a different OpenAI model:

```bash
yarn translate subtitles.srt -t German -m gpt-4
```

Specify output file:

```bash
yarn translate subtitles.srt -t Japanese -o translated_subtitles.srt
```

## Development

### Project Structure

```
srt-translator/
├── src/
│   ├── index.ts              # Main entry point
│   ├── services/
│   │   ├── srtService.ts     # SRT file handling
│   │   └── translationService.ts # AI translation
│   ├── types/
│   │   └── index.ts          # Type definitions
│   └── utils/
│       └── fileUtils.ts      # File utilities
├── dist/                     # Compiled JavaScript
├── .env.example              # Example environment variables
├── .env                      # Environment variables (create this)
├── package.json              # Project configuration
└── tsconfig.json             # TypeScript configuration
```

### Scripts

- `yarn build`: Build the project
- `yarn start`: Run the compiled code
- `yarn dev`: Run with ts-node (development)
- `yarn translate`: Alias for `yarn dev`

## License

MIT
