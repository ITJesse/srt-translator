# SRT Translator

一个使用AI（OpenAI）翻译SRT字幕文件的命令行工具。

## 功能特点

- 将SRT字幕文件翻译成任何语言
- 保留原始格式和时间轴
- 支持各种OpenAI模型
- 批处理以处理大型字幕文件
- 命令行界面，便于集成

## 安装

### 前提条件

- Node.js (v14或更高版本)
- Yarn或npm
- OpenAI API密钥

### 设置

1. 克隆此仓库:

   ```
   git clone https://github.com/yourusername/srt-translator.git
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

4. 创建包含OpenAI API密钥的`.env`文件:
   ```
   cp .env.example .env
   ```
   然后编辑`.env`文件并添加您的OpenAI API密钥。

### 全局安装

您可以全局安装该工具，以便在任何地方使用:

1. 全局链接包:

   ```
   yarn link
   ```

   或者如果你喜欢npm:

   ```
   npm link
   ```

2. 现在，您可以从任何地方使用`srt-translator`命令:

   ```
   srt-translator path/to/subtitles.srt -t chinese
   ```

3. 或者，您可以直接从GitHub安装:
   ```
   npm install -g github:yourusername/srt-translator
   ```

## 使用方法

### 基本用法

```bash
srt-translator path/to/subtitles.srt
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
  -V, --version              输出版本号
  -h, --help                 显示帮助信息
```

### 示例

翻译为日语:

```bash
srt-translator subtitles.srt -t japanese
```

指定源语言和目标语言:

```bash
srt-translator subtitles.srt -s english -t french
```

使用不同的OpenAI模型:

```bash
srt-translator subtitles.srt -t german -m gpt-3.5-turbo
```

指定输出文件:

```bash
srt-translator subtitles.srt -t japanese -o translated_japanese.srt
```

调整批处理大小和并发数:

```bash
srt-translator subtitles.srt -l 1500 -c 5
```

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

## 许可证

MIT
