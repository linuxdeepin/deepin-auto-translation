# deepin-auto-translation

Pre-fill untranslated strings in Qt Linguist TS files using LLM, before translators gets involved.

Pre-filled strings can be marked with an `type="unfinished"` attribute, so translators will know these strings needs to be reviewed.[^1]

[^1]: Transifex platform will ignore strings marked with `type="unfinished"`, so for uploading purpose we won't keep this attribute.

## Usage

TODO

## Resources and Links

- [Qt Linguist TS file format XSD](https://doc.qt.io/qt-6/linguist-ts-file-format.html)
- [VolcEngine ChatCompletions API](https://www.volcengine.com/docs/82379/1298454)
- [Transifex OpenAPI](https://transifex.github.io/openapi/)
