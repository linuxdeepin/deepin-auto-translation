# deepin-auto-translation

Pre-fill untranslated strings in Qt Linguist TS files using LLM, before translators gets involved.

Pre-filled strings can be marked with an `type="unfinished"` attribute, so translators will know these strings needs to be reviewed.[^1]

[^1]: Transifex platform will ignore strings marked with `type="unfinished"`, so for uploading purpose we won't keep this attribute.

## Usage

This repo offers a set of scripts and utility functions that can help you pre-fill translations for Qt-based projects. It still needs to be guided to use since the results returned by LLM are not always correct and not reliable in some cases.

## Resources and Links

- [Qt Linguist TS file format XSD](https://doc.qt.io/qt-6/linguist-ts-file-format.html)
- [OpenAI Completions API](https://platform.openai.com/docs/api-reference/chat)
  - [VolcEngine: ChatCompletions API](https://www.volcengine.com/docs/82379/1298454)
  - [vLLM: Structured Outputs](https://docs.vllm.ai/en/latest/usage/structured_outputs.html)
  - [OpenAI Chat Completions: Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs?api-mode=chat&example=chain-of-thought)
- [Ollama API#Structured outputs](https://github.com/ollama/ollama/blob/main/docs/api.md#request-structured-outputs)
- [Transifex OpenAPI](https://transifex.github.io/openapi/)
