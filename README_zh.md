# SRT Translator

一个使用AI翻译SRT字幕文件的命令行工具。

## 功能特点

- 将SRT字幕文件翻译成任何语言
- 保留原始格式和时间轴
- 支持各种OpenAI模型（默认使用gpt-4o）
- 自动提取和应用专业术语表，确保翻译一致性
- 支持导出和导入术语表，便于在不同翻译项目间复用
- 批处理以处理大型字幕文件
- 命令行界面，便于集成

## 安装

### 前提条件

- Node.js (v20或更高版本)
- Yarn
- OpenAI API 兼容的 API Key

### 设置

1. 克隆此仓库:

   ```
   git clone https://github.com/ITJesse/srt-translator.git
   cd srt-translator
   ```

2. 安装依赖:

   ```
   yarn install
   ```

3. 构建项目:

   ```
   yarn build
   ```

4. 设置环境变量（创建一个.env文件在项目根目录）:

   ```
   OPENAI_API_KEY=your_api_key_here
   OPENAI_API_BASE_URL=https://api.openai.com/v1  # 可选，如使用其他兼容服务
   ```

## 使用方法

### 基本用法

```bash
node dist/index.js path/to/subtitles.srt
```

这将使用默认设置（从英文翻译到中文）翻译字幕，并将输出保存到`path/to/translated_subtitles.srt`。

### 命令行选项

```
用法: srt-translator [选项] <inputFile>

使用AI翻译SRT字幕文件的命令行工具

参数:
  inputFile                  输入的SRT文件路径

选项:
  -o, --output <file>        输出的SRT文件路径（默认为输入文件名加前缀）
  -s, --source <language>    源语言 (默认: "english")
  -t, --target <language>    目标语言 (默认: "chinese")
  -m, --model <name>         AI模型名称 (默认: "gpt-4o")
  -l, --max-length <number>  每批次的最大字符数 (默认: 2000)
  -c, --concurrency <number> 并发处理的批次数 (默认: 10)
  --glossary-in <file>       输入术语表JSON文件路径
  --glossary-out <file>      输出术语表JSON文件路径
  --no-extract-glossary      跳过术语表提取，如果提供了glossary-in则直接使用
  -V, --version              输出版本号
  -h, --help                 显示帮助信息
```

注意：当指定 `--glossary-out` 时，程序将提取术语表并退出，不执行翻译。当指定 `--no-extract-glossary` 时，程序将跳过术语表提取，如果提供了 `--glossary-in` 则直接使用该术语表。

### 示例

翻译为日语:

```bash
node dist/index.js subtitles.srt -t japanese
```

指定源语言和目标语言:

```bash
node dist/index.js subtitles.srt -s english -t french
```

使用不同的OpenAI模型:

```bash
node dist/index.js subtitles.srt -t german -m gpt-3.5-turbo
```

指定输出文件:

```bash
node dist/index.js subtitles.srt -t japanese -o translated_japanese.srt
```

调整批处理大小和并发数:

```bash
node dist/index.js subtitles.srt -l 1500 -c 5
```

导出术语表（不执行翻译）:

```bash
node dist/index.js subtitles.srt --glossary-out glossary.json
```

使用已有术语表进行翻译:

```bash
node dist/index.js subtitles.srt --glossary-in glossary.json
```

使用已有术语表作为基础并提取额外术语:

```bash
node dist/index.js subtitles.srt --glossary-in base-glossary.json --glossary-out extended-glossary.json
```

跳过术语表提取并直接使用已有术语表:

```bash
node dist/index.js subtitles.srt --glossary-in glossary.json --no-extract-glossary
```

完全跳过术语表提取（不使用任何术语表）:

```bash
node dist/index.js subtitles.srt --no-extract-glossary
```

### 术语表管理

工具支持以JSON格式导出和导入术语表：

- **导出**：使用 `--glossary-out` 从字幕文件中提取并保存术语表，此操作不会执行翻译
- **导入**：使用 `--glossary-in` 在翻译过程中应用之前提取的术语表
- **扩展**：同时使用 `--glossary-in` 和 `--glossary-out` 加载基础术语表，提取额外术语，并保存扩展后的术语表
- **跳过提取**：使用 `--no-extract-glossary` 跳过术语表提取过程，直接使用提供的术语表

此功能允许您在多个字幕文件或翻译项目之间保持术语一致性。

## 开发

### 项目结构

```
srt-translator/
├── src/
│   ├── index.ts           # 主入口点和CLI工具
│   └── lib/
│       ├── srt.ts         # SRT文件处理
│       ├── translate.ts   # AI翻译服务
│       └── prompts.ts     # 翻译提示模板
├── dist/                  # 编译后的JavaScript
├── .env.example           # 环境变量示例
├── .env                   # 环境变量（需创建）
├── package.json           # 项目配置
└── tsconfig.json          # TypeScript配置
```

### 脚本

- `yarn build`: 构建项目
- `yarn start`: 运行编译后的代码
- `yarn dev`: 使用ts-node运行（开发环境）

## 工作原理

1. 解析SRT文件，保留字幕索引、时间戳和文本
2. 使用AI分析字幕文本，自动提取术语表
3. 将字幕分批发送到OpenAI API进行翻译
4. 确保翻译过程中保持术语一致性
5. 将翻译后的字幕重新组装成合法的SRT格式
6. 输出到目标文件

## 许可证

MIT
