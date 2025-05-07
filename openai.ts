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
        // 对返回内容进行预处理，移除可能的Markdown代码块标记和清理内容
        const content = response.data.choices[0].message.content.replace(/```json\n?|\n?```/g, '').trim();
        try {
            // 尝试修复JSON格式问题，处理可能的未终止字符串
            let fixedContent = content;
            // 检查是否是有效的JSON
            if (!isValidJson(fixedContent)) {
                console.log("尝试修复不完整的JSON...");
                // 1. 查找缺少闭合引号的字符串
                fixedContent = fixJsonString(fixedContent);
                // 2. 如果仍然无效，尝试更简单的方式：截断内容到最后一个完整的JSON对象
                if (!isValidJson(fixedContent)) {
                    console.log("尝试截断到最后一个完整对象...");
                    fixedContent = truncateToValidJson(fixedContent);
                }
                console.log("修复后的JSON:", fixedContent);
            }
            const responsedTranslations = JSON.parse(fixedContent);
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
        } catch (error) {
            console.error("JSON解析错误:", error);
            console.error("原始内容:", response.data.choices[0].message.content);
            console.error("处理后内容:", content);
            console.groupEnd();
        }
    }).catch(error => {
        console.error(error);
    });
}

// 检查字符串是否为有效的JSON
function isValidJson(str) {
    try {
        JSON.parse(str);
        return true;
    } catch (e) {
        return false;
    }
}

// 尝试修复未终止的JSON字符串
function fixJsonString(str) {
    // 如果是数组开头但没有数组结尾，添加结尾
    if (str.trim().startsWith('[') && !str.trim().endsWith(']')) {
        str = str.trim() + ']';
    }
    
    // 查找可能未闭合的对象
    const matches = str.match(/{[^}]*$/g);
    if (matches) {
        str = str.replace(/{[^}]*$/g, '}');
    }
    
    // 查找可能未闭合的引号
    let inString = false;
    let lastQuotePos = -1;
    let needsClosingQuote = false;
    
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '"' && (i === 0 || str[i-1] !== '\\')) {
            if (inString) {
                inString = false;
            } else {
                inString = true;
                lastQuotePos = i;
            }
        }
    }
    
    // 如果字符串以未闭合的引号结束，添加闭合引号
    if (inString) {
        const beforeQuote = str.substring(0, lastQuotePos);
        const afterQuote = str.substring(lastQuotePos);
        // 限制翻译内容长度，避免过长的无效内容
        const maxLength = 100; // 合理的翻译长度限制
        const quotedContent = afterQuote.substring(1, Math.min(maxLength, afterQuote.length));
        str = beforeQuote + '"' + quotedContent + '"' + (afterQuote.length > maxLength ? '}]' : '');
    }
    
    return str;
}

// 截断内容到最后一个完整的JSON对象
function truncateToValidJson(str) {
    // 如果是数组格式，尝试保留开头和必要的部分
    if (str.trim().startsWith('[')) {
        // 尝试保留开头的[和第一个完整对象
        const match = str.match(/\[\s*{[^{]*?}\s*(?:,|$)/);
        if (match) {
            return match[0].endsWith(',') ? match[0].slice(0, -1) + ']' : match[0] + ']';
        }
        
        // 如果无法找到完整对象，但有开始标记，构建一个最小有效的JSON数组
        return '[{"source":"Error parsing response","translation":"翻译解析错误"}]';
    }
    
    // 无法修复，返回一个最小有效的JSON
    return '[{"source":"Error parsing response","translation":"翻译解析错误"}]';
}