// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import * as YAML from 'js-yaml';
import axios from 'axios';
import * as Secrets from './secrets';
import { MessageData } from './types';

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

    // Seems QwenMT only support language name in English
    function getLanguageName(languageCode: string): string {
        const replacedLanguageCode = languageCode.replace('_', '-');
        const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
        const languageName = displayNames.of(replacedLanguageCode);
        return languageName || replacedLanguageCode; // If not supported, return the original code
    }

    // axios request
    return axios.post('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        model: 'qwen-mt-turbo',
        messages: [
            {
                role: "user",
                "content": userPrompt
            }
        ],
        translation_options: {
            "source_lang": "English",
            "target_lang": getLanguageName(targetLanguage),
            "domains": "The sentence is from Qt Linguist file for Qt application UI translation."
        },
    }, {
        headers: {
            Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`
        }
    }).then(response => {
        // response as yaml format
        console.log(response.data.choices[0].message.content);
        const responseData = YAML.load(response.data.choices[0].message.content) as any;
        const responsedTranslations = responseData.messages;
        if (Array.isArray(responsedTranslations) && responsedTranslations.length === messages.length) {
            console.log(`Translated ${messages.length} strings`);
            for (let i = 0; i < messages.length; i++) {
                const translation = responsedTranslations[i];
                let translationElement = messages[i].translationElement;
                if (translationElement) {
                    translationElement.textContent = translation.source;
                    // also check if we need to remove the type=unfinished attribute
                    if (!keepUnfinishedTypeAttr && translationElement.getAttribute('type') === 'unfinished') {
                        translationElement.removeAttribute('type');
                    }
                }
            }
        } else {
            console.log(Array.isArray(responsedTranslations), responsedTranslations.length, messages.length);
            console.error(`Unexpected response from QwenMT: ${responsedTranslations}`);
        }
        // also log token usage
        console.log(response.data.usage)
    }).catch(error => {
        console.error(error);
    });
}