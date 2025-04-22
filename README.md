# deepin-auto-translation

Pre-fill untranslated strings in Qt Linguist TS files using LLM, before translators gets involved.

Pre-filled strings can be marked with an `type="unfinished"` attribute, so translators will know these strings needs to be reviewed.[^1]

[^1]: Transifex platform will ignore strings marked with `type="unfinished"`, so for uploading purpose we won't keep this attribute.

## Usage

This repo offers a set of scripts and utility functions that can help you pre-fill translations for Qt-based projects. It still needs to be guided to use since the results returned by LLM are not always correct and not reliable in some cases.

### Running the Project

In convenience, we recommend using [bun](https://bun.sh/) as your runtime environment. After installing it according to the official guide, use `bun install` to install the necessary dependencies, and then run `bun index.ts` to start the project.

Please note that `index.ts` does not provide a complete set of behaviors, but rather provides a simple example to demonstrate how to use the helper scripts/functions provided by this tool. You will need to modify `index.ts` yourself to achieve your needs.

### Debugging Suggestions

Running the following command:

```shell
$ bun --inspect index.ts
```

and then visit the address printed in the console to open the debugger. This will allow you to debug your code in the browser. Even if you don't plan to use a debugger, it's still recommended to use this method to view logs, as it allows you to easily collapse certain logs. You can also use other v8 inspector compatible debugging tools.

## Resources and Links

- [Qt Linguist TS file format XSD](https://doc.qt.io/qt-6/linguist-ts-file-format.html)
- [OpenAI Completions API](https://platform.openai.com/docs/api-reference/chat)
  - [VolcEngine: ChatCompletions API](https://www.volcengine.com/docs/82379/1298454)
  - [vLLM: Structured Outputs](https://docs.vllm.ai/en/latest/usage/structured_outputs.html)
  - [OpenAI Chat Completions: Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs?api-mode=chat&example=chain-of-thought)
- [Ollama API#Structured outputs](https://github.com/ollama/ollama/blob/main/docs/api.md#request-structured-outputs)
- [Transifex OpenAPI](https://transifex.github.io/openapi/)
