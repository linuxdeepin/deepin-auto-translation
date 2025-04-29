// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import * as YAML from 'js-yaml';
import axios from 'axios';
import * as Secrets from './secrets';
import { MessageData } from './types';
import * as Prompt from './prompt';

export async function fetchTranslations(messages: MessageData[], targetLanguage: string, keepUnfinishedTypeAttr : boolean) : Promise<void>
{
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
                content: Prompt.systemPrompt
            },
            {
                role: "user",
                "content": userPrompt
            }
        ],
        // undocumented but seems supported
        extra_body: {
            guided_json: Prompt.structedOutputJsonSchema
        },
    }, {
        headers: {
            Authorization: `Bearer ${Secrets.doubao.accessKey}`
        }
    }).then(response => {
        // response as json array
        console.log(response.data.choices[0].message.content);
        // 豆包 API 返回的响应内容中包含了 Markdown 代码块标记（```json），这导致 JSON.parse() 无法正确解析
        // 在解析 JSON 之前，先移除响应内容中可能存在的 Markdown 代码块标记（```json 和 ```）。
        const content = response.data.choices[0].message.content.replace(/```json\n?|\n?```/g, '').trim();
        const responsedTranslations = JSON.parse(content);
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