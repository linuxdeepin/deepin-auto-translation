# deepin-auto-translation

在翻译者参与贡献之前，使用 LLM 预先填充 Qt Linguist TS 文件中未翻译的字符串。

预先填充的字符串可被标记为 `type="unfinished"`[^1]，以此让翻译者可以得知这些字符串需要被主动校对。

[^1]: Transifex 平台会忽略被标记为 `type="unfinished"` 的字符串，所以对于此平台上传需求，我们不能保留这个属性。

## 用法

此仓库提供了一组脚本和实用函数，用于为基于 Qt 的项目预先填充翻译。由于 LLM 返回的结果并不总是正确和可靠，所以仍然建议在监督的情况下使用此工具。

### 运行项目

方便起见，建议使用 [bun](https://bun.sh/) 作为运行环境。根据官方指引安装完毕后，使用 `bun install` 安装相关依赖，完毕后运行 `bun index.ts` 即可。

请注意，`index.ts` 并未提供完整的行为逻辑，而是仅提供了一个简单的示例，用于展示如何使用此工具所提供的一些列辅助脚本/函数。你需要自行修改 `index.ts` 以实现你的需求。

### 调试建议

执行如下命令：

```shell
$ bun --inspect index.ts
```

并在随后输出的地址中打开浏览器，即可进行调试。即便无计划断点调试也建议使用此方式查看日志，这可以使你可以更方便的查看部分标记为可折叠的日志。你也可以使用其他 v8 inspector 兼容的调试工具。

## 资源和链接

- [Qt Linguist TS 文件格式 XSD](https://doc.qt.io/qt-6/linguist-ts-file-format.html)
- [OpenAI Completions API](https://platform.openai.com/docs/api-reference/chat)
  - [VolcEngine: ChatCompletions API](https://www.volcengine.com/docs/82379/1298454)
  - [vLLM: Structured Outputs](https://docs.vllm.ai/en/latest/usage/structured_outputs.html)
  - [OpenAI Chat Completions: Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs?api-mode=chat&example=chain-of-thought)
- [Ollama API#Structured outputs](https://github.com/ollama/ollama/blob/main/docs/api.md#request-structured-outputs)
- [Transifex OpenAPI](https://transifex.github.io/openapi/)
