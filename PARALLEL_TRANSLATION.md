# 并行翻译功能说明

本项目已经支持并行翻译处理，可以显著提高翻译速度。通过同时处理多个文件和批次，可以将翻译时间减少50%-80%。

## 🚀 性能提升

### 优化前（串行处理）
- 每次只处理1个文件
- 每个文件内部每次只处理1个批次（30条翻译）
- 批次间有2秒延迟

### 优化后（并行处理）
- 同时处理多个文件（默认3个）
- 每个文件内部同时处理多个批次（默认2个）
- 批次延迟减少到1秒
- 支持自定义配置参数

## 📋 配置选项

### 环境变量配置

设置 `TRANSLATION_PARALLEL_CONFIG` 环境变量来选择预设配置：

```bash
# 默认配置（推荐）
export TRANSLATION_PARALLEL_CONFIG=default

# 高性能配置（适合高配置机器）
export TRANSLATION_PARALLEL_CONFIG=high

# 保守配置（适合API限制严格的情况）
export TRANSLATION_PARALLEL_CONFIG=conservative

# 禁用并行处理（回退到原始串行模式）
export TRANSLATION_PARALLEL_CONFIG=serial
```

### 预设配置详情

| 配置类型 | 文件并发数 | 批次并发数 | 批次大小 | 批次延迟 | 适用场景 |
|---------|-----------|-----------|---------|---------|----------|
| 默认配置 | 3 | 2 | 30 | 1000ms | 大多数情况 |
| 高性能配置 | 5 | 3 | 50 | 500ms | 高配置机器 + 宽松API限制 |
| 保守配置 | 2 | 1 | 20 | 2000ms | API限制严格 |
| 串行配置 | 1 | 1 | 30 | 2000ms | 禁用并行处理 |

## 🛠️ 使用方法

### 1. 使用默认配置
```bash
bun closed-source.ts /path/to/your/project
```

### 2. 使用高性能配置
```bash
export TRANSLATION_PARALLEL_CONFIG=high
bun closed-source.ts /path/to/your/project
```

### 3. 使用保守配置（API限制严格时）
```bash
export TRANSLATION_PARALLEL_CONFIG=conservative
bun closed-source.ts /path/to/your/project
```

### 4. 禁用并行处理
```bash
export TRANSLATION_PARALLEL_CONFIG=serial
bun closed-source.ts /path/to/your/project
```

## ⚡ 性能对比示例

假设有60个翻译文件，每个文件有90条待翻译文本：

### 串行处理时间
- 文件处理：60个文件 × 3批次 × (翻译时间 + 2秒延迟) = 约30-45分钟

### 并行处理时间（默认配置）
- 文件处理：60个文件 ÷ 3并发 = 20轮
- 批次处理：3批次 ÷ 2并发 = 2轮
- 总时间：约10-15分钟（提升60-70%）

### 并行处理时间（高性能配置）
- 文件处理：60个文件 ÷ 5并发 = 12轮
- 批次处理：更大批次 + 更高并发
- 总时间：约6-10分钟（提升75-85%）

## 🔧 自定义配置

如果需要更精细的控制，可以修改 `parallel-config.ts` 文件中的配置：

```typescript
export const CUSTOM_CONFIG: ParallelConfig = {
    MAX_CONCURRENT_FILES: 4,        // 同时处理4个文件
    MAX_CONCURRENT_BATCHES: 2,      // 每个文件内同时处理2个批次
    BATCH_SIZE: 40,                 // 每批次40条翻译
    BATCH_DELAY: 800,               // 批次间延迟800ms
    ENABLE_PARALLEL: true           // 启用并行处理
};
```

## ⚠️ 注意事项

### API限制
- 不同的翻译服务（OpenAI、豆包等）有不同的API限制
- 如果遇到频繁的限流错误，请使用保守配置或增加延迟时间
- 可以通过 `BATCH_DELAY` 参数调整批次间延迟

### 硬件要求
- 并发处理会增加CPU和内存使用
- 建议在至少4核CPU的机器上使用高性能配置
- 网络带宽也会影响并行处理效果

### 错误处理
- 如果并行处理出现问题，系统会自动回退到串行处理
- 可以设置 `ENABLE_PARALLEL: false` 来完全禁用并行处理
- 每个文件和批次的错误都会被独立处理，不会影响其他任务

## 🐛 故障排除

### 1. API限流错误
```
错误：Too many requests
解决：使用保守配置或增加 BATCH_DELAY
```

### 2. 内存不足
```
错误：Out of memory
解决：减少 MAX_CONCURRENT_FILES 或 MAX_CONCURRENT_BATCHES
```

### 3. 网络超时
```
错误：Request timeout
解决：减少并发数或增加延迟时间
```

### 4. 翻译质量问题
```
问题：并行处理时翻译质量下降
解决：减少 BATCH_SIZE 或使用串行配置
```

## 📊 监控和日志

程序运行时会显示详细的并行处理信息：

```
========== 并行处理配置 ==========
并行处理: 启用
文件并发数: 3
批次并发数: 2
批次大小: 30
批次延迟: 1000ms
=====================================

[并行处理] 开始处理 15 个翻译文件，最大并发数: 3
[并行翻译] 分成 3 个批次进行并行处理，每批次 30 条，最大并发 2
[并行处理] 翻译文件 5/15 完成
```

这些日志可以帮助你监控翻译进度和性能。

## 🔄 版本兼容性

- 新的并行处理功能完全向后兼容
- 如果不设置任何配置，会使用默认的并行配置
- 原有的串行处理逻辑仍然保留，可以通过配置切换
- 所有现有的命令行参数和功能都保持不变 