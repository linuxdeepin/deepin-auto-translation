# deepin-auto-translation

在翻译者参与贡献之前，使用 LLM 预先填充 Qt Linguist TS 文件中未翻译的字符串。

预先填充的字符串可被标记为 `type="unfinished"`[^1]，以此让翻译者可以得知这些字符串需要被主动校对。

[^1]: Transifex 平台会忽略被标记为 `type="unfinished"` 的字符串，所以对于此平台上传需求，我们不能保留这个属性。

## 用法

TODO

## 资源和链接

- [Qt Linguist TS 文件格式 XSD](https://doc.qt.io/qt-6/linguist-ts-file-format.html)
- [OpenAI Completions API](https://platform.openai.com/docs/api-reference/chat)
  - [VolcEngine: ChatCompletions API](https://www.volcengine.com/docs/82379/1298454)
  - [vLLM: Structured Outputs](https://docs.vllm.ai/en/latest/usage/structured_outputs.html)
  - [OpenAI Chat Completions: Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs?api-mode=chat&example=chain-of-thought)
- [Ollama API#Structured outputs](https://github.com/ollama/ollama/blob/main/docs/api.md#request-structured-outputs)
- [Transifex OpenAPI](https://transifex.github.io/openapi/)
