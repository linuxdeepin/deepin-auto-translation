// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import * as YAML from 'js-yaml';
import axios from 'axios';
import * as Secrets from './secrets';
import { MessageData } from './types';

export async function fetchTranslations(messages: MessageData[], targetLanguage: string, keepUnfinishedTypeAttr : boolean) : Promise<void>
{
    const systemPrompt = `你是一个各国语言的翻译工具，擅长进行计算机操作系统与软件的用户界面文案翻译。用户将以YAML格式提供一系列待翻译文本，结构为：

\`\`\`yaml
targetLanguageCode: ar
messages:
- context: "AppItemMenu"
  source: "Move to Top"
  comment: "Move the selected item to the top of the list"
- context: "BottomBar"
  source: "Full-screen Mode"
\`\`\`

需要注意，comment 是对原文进行翻译时的补充说明，但 comment 字段不一定存在。source 字段为待翻译的原文，格式遵循 Qt 的 \`QObject::tr()\` 中存在的文案格式。

你需要将所有提供的字符串翻译到 targetLanguageCode 语言代码所给定的语言。
你需要最终返回一个 Json，内容为一个数组，其内容为按原有 YAML 所提供的顺序依次每一项的原文以及对应的翻译文案。
最终 Json 数组包含的译文数量与原始提供的待翻译原文数量等长。除此 Json 外无需附加任何额外描述。

对于上述示例，返回的 Json 应为：

\`\`\`json
[
    { "source": "Move to Top", "translation": "نقل إلى الأعلى" },
    { "source": "Full-screen Mode", "translation": "وضع الشاشة الكاملة" }
]
\`\`\`
`;

    let userPrompt = YAML.dump({
        targetLanguageCode: targetLanguage,
        messages: messages.map(message => {
            return {
                context: message.context,
                source: message.source,
                comment: message.comment
            }
        })
    });

    // axios request
    return axios.post('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
        model: Secrets.doubao.model,
        messages: [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                "content": userPrompt
            }
        ],
        // undocumented but seems supported
        extra_body: {
            guided_json: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        source: {
                            type: "string"
                        },
                        translation: {
                            type: "string"
                        }
                    },
                    required: [
                        "source",
                        "translation"
                    ]
                }
            }
        },
    }, {
        headers: {
            Authorization: `Bearer ${Secrets.doubao.accessKey}`
        }
    }).then(response => {
        // response as json array
        console.log(response.data.choices[0].message.content);
        const responsedTranslations = JSON.parse(response.data.choices[0].message.content);
        if (Array.isArray(responsedTranslations) && responsedTranslations.length === messages.length) {
            console.log(`Translated ${messages.length} strings`);
            for (let i = 0; i < messages.length; i++) {
                const translation = responsedTranslations[i];
                let translationElement = messages[i].translationElement;
                if (translationElement) {
                    translationElement.textContent = translation.translation;
                    // also check if we need to remove the type=unfinished attribute
                    if (!keepUnfinishedTypeAttr && translationElement.getAttribute('type') === 'unfinished') {
                        translationElement.removeAttribute('type');
                    }
                }
            }
        } else {
            console.log(Array.isArray(responsedTranslations), responsedTranslations.length, messages.length);
            console.error(`Unexpected response from Doubao: ${responsedTranslations}`);
        }
        // also log token usage
        console.log(response.data.usage)
    }).catch(error => {
        console.error(error);
    });
}