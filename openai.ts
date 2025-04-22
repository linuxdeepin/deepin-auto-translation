// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import * as YAML from 'js-yaml';
import axios from 'axios';
import * as Settings from './settings'
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
    return axios.post(Settings.openai.chatCompletionsEndpoint, {
        model: Settings.openai.model,
        temperature: 0.5,
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
        response_format: Prompt.structedOutputSchema,
    }, {
        headers: {
            Authorization: `Bearer ${Secrets.openai.accessKey}`
        }
    }).then(response => {
        // response as json array
        console.groupCollapsed("Translation status");
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
            console.error(`Unexpected response from OpenAI endpoint: ${responsedTranslations}`);
        }
        // also log token usage
        console.log(response.data.usage);
        console.groupEnd();
    }).catch(error => {
        console.error(error);
    });
}