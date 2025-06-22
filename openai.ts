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
        console.log(`[翻译状态] 开始处理翻译响应 (当前处理中语言: ${targetLanguage})`);
        
        // 格式化JSON输出的辅助函数
        function formatJSON(obj: any): string {
            try {
                return JSON.stringify(obj, null, 2);
            } catch (error) {
                return String(obj);
            }
        }
        
        // 显示原始响应，使用格式化的JSON
        console.log("[原始响应]");
        // 过滤掉大量空行，只保留有实际内容的行
        const responseLines = response.data.choices[0].message.content.split('\n');
        const filteredLines = responseLines.filter(line => line.trim() !== '').slice(0, 20); // 只显示前20行有内容的行
        const cleanedResponse = filteredLines.join('\n');
        console.log(cleanedResponse + (responseLines.length > filteredLines.length ? '\n...' : ''));
        
        // 对返回内容进行预处理，移除可能的Markdown代码块标记和清理内容
        let content = response.data.choices[0].message.content.replace(/```json\n?|\n?```/g, '').trim();
        
        // 检查和修复基本的JSON格式问题 - 简化版本
        function validateAndCleanJson(str: string): string {
            try {
                // 首先尝试直接解析原始内容
                try {
                    const parsed = JSON.parse(str);
                    return JSON.stringify(parsed);
                } catch (e) {
                    // 如果直接解析失败，进行最小化清理
                    let cleanedStr = str;
                    
                    // 移除末尾的省略号标记
                    cleanedStr = cleanedStr.replace(/\.\.\.\s*$/, '');
                    
                    // 移除注释
                    cleanedStr = cleanedStr.replace(/\/\/.*/g, '');
                    
                    // 清理属性名中的空格
                    cleanedStr = cleanedStr.replace(/"(\w+)\s*":/g, '"$1":');
                    
                    // 修复常见的属性名错误
                    cleanedStr = cleanedStr.replace(/"source\*\*":/g, '"source":');
                    cleanedStr = cleanedStr.replace(/"source\*":/g, '"source":');
                    cleanedStr = cleanedStr.replace(/"translation\*\*":/g, '"translation":');
                    cleanedStr = cleanedStr.replace(/"translation\*":/g, '"translation":');
                    
                    // 移除末尾逗号
                    cleanedStr = cleanedStr.replace(/,(\s*[\]}])/g, '$1');
                    
                    // 确保是数组格式
                    cleanedStr = cleanedStr.trim();
                    if (!cleanedStr.startsWith('[')) cleanedStr = '[' + cleanedStr;
                    if (!cleanedStr.endsWith(']')) cleanedStr = cleanedStr + ']';
                    
                    // 再次尝试解析
                    try {
                        const parsed = JSON.parse(cleanedStr);
                        return JSON.stringify(parsed);
                    } catch (e2) {
                        // 如果清理后仍然失败，使用智能对象提取
                        const objects = extractCompleteObjects(cleanedStr);
                        if (objects.length > 0) {
                            return JSON.stringify(objects);
                        }
                    }
                }
                
                return '[]';
            } catch (error) {
                return '[]';
            }
        }
        
        // 智能提取完整的翻译对象 - 改进版本，支持多种格式
        function extractCompleteObjects(str: string): any[] {
            const objects: any[] = [];
            
            // 尝试多种匹配模式，从严格到宽松
            const patterns = [
                // 标准顺序：source在前，translation在后 - 改进版本，支持转义字符
                /{\s*"source":\s*"((?:[^"\\]|\\.)*)",\s*"translation":\s*"((?:[^"\\]|\\.)*)"\s*}/g,
                // 颠倒顺序：translation在前，source在后 - 改进版本，支持转义字符
                /{\s*"translation":\s*"((?:[^"\\]|\\.)*)",\s*"source":\s*"((?:[^"\\]|\\.)*)"\s*}/g,
                // 允许中间有其他字段（非贪婪模式）- 改进版本，支持转义字符
                /{\s*[^}]*?"source":\s*"((?:[^"\\]|\\.)*)"[^}]*?"translation":\s*"((?:[^"\\]|\\.)*)"[^}]*?}/g,
                /{\s*[^}]*?"translation":\s*"((?:[^"\\]|\\.)*)"[^}]*?"source":\s*"((?:[^"\\]|\\.)*)"[^}]*?}/g
            ];
            
            for (let i = 0; i < patterns.length; i++) {
                const pattern = patterns[i];
                let match;
                while ((match = pattern.exec(str)) !== null) {
                    let source, translation;
                    
                    if (i === 1 || i === 3) {
                        // 颠倒顺序的模式：translation在match[1]，source在match[2]
                        translation = match[1];
                        source = match[2];
                    } else {
                        // 标准顺序：source在match[1]，translation在match[2]
                        source = match[1];
                        translation = match[2];
                    }
                    
                    if (source && translation) {
                        // 解码转义字符
                        source = source.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                        translation = translation.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                        
                        // 避免重复添加相同的对象
                        const exists = objects.some(obj => obj.source === source && obj.translation === translation);
                        if (!exists) {
                            objects.push({ source, translation });
                        }
                    }
                }
                
                // 如果已经找到对象，就不需要尝试更宽松的模式了
                if (objects.length > 0) {
                    break;
                }
            }
            
            return objects;
        }
        
        // 清理和验证JSON
        const originalContent = content;
        content = validateAndCleanJson(content);
        
        try {
            // 解析响应内容
            const parsedContent = JSON.parse(content);
            
            // 检查数组格式
            if (!Array.isArray(parsedContent)) {
                console.error('[错误] 响应格式错误: 不是数组格式');
                console.error(`[处理结果] 由于响应格式错误，跳过本批次翻译 (共 ${messages.length} 条待翻译内容)`);
                return;
            }

            // 检查数组长度
            if (parsedContent.length !== messages.length) {
                console.error(`[警告] 翻译数量不匹配 (预期: ${messages.length}, 实际: ${parsedContent.length})`);
            }

            let successCount = 0;
            let skipCount = 0;
            let qualityIssueCount = 0;
            
            console.log('[翻译] 开始处理...');
            
            // 验证翻译质量的辅助函数
            function isEnglishVariant(lang: string) {
                return ['en', 'en_AU', 'en_GB', 'en_CA', 'en_US'].includes(lang);
            }
            // 验证翻译质量的辅助函数
            function isValidTranslation(source: string, translation: string, targetLanguage: string): { valid: boolean; reason?: string } {
                // 检查基本有效性
                if (!translation || typeof translation !== 'string') {
                    return { valid: false, reason: '翻译内容为空或格式错误' };
                }

                // 去除首尾空白字符进行检查
                const trimmedTranslation = translation.trim();
                if (trimmedTranslation.length === 0) {
                    return { valid: false, reason: '翻译内容为空' };
                }

                // 检查是否只包含问号或无意义字符（明显的乱码标志）
                if (/^[\s\?!@#$%^&*()_+=\-\[\]{}|\\:";'<>,.\/~`]*$/.test(trimmedTranslation)) {
                    return { valid: false, reason: '翻译内容只包含符号或问号，可能是乱码' };
                }

                // 检查翻译是否异常长（比原文长10倍以上才认为异常）
                if (translation.length > source.length * 10) {
                    return { valid: false, reason: '翻译内容异常长，可能存在问题' };
                }

                // 检查是否包含大量重复的同一字符（同一字符连续重复20次以上）
                const repeatedChar = /(.)\1{19,}/;  // 同一字符重复20次以上
                if (repeatedChar.test(translation)) {
                    return { valid: false, reason: '包含过多重复字符，可能是乱码' };
                }

                // 只检查明显的控制字符和替换字符（保留换行符\n和制表符\t）
                const invalidChars = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD\uFFFE\uFFFF]/;
                if (invalidChars.test(translation)) {
                    return { valid: false, reason: '包含无效控制字符，可能是乱码' };
                }

                // 检查是否整个翻译都是相同的单个字符（长度大于10且全是同一字符）
                const uniqueChars = new Set(translation.replace(/\s/g, ''));
                if (uniqueChars.size === 1 && translation.length > 10) {
                    return { valid: false, reason: '翻译内容全是相同字符，可能是乱码' };
                }

                // 检查是否翻译结果异常短（原文超过50字符但翻译只有1-2个字符）
                if (source.length > 50 && trimmedTranslation.length <= 2) {
                    return { valid: false, reason: '翻译内容过短，可能不完整' };
                }

                // 检查是否混入其他语言字符（特别是中文和英文）
                const chineseChars = /[\u4e00-\u9fff]/;  // 中文字符
                const englishChars = /[a-zA-Z]/;  // 英文字符
                
                // 对于非中文语言，检查是否混入中文字符
                if (!['zh_CN', 'zh_TW', 'zh_HK'].includes(targetLanguage) && chineseChars.test(translation)) {
                    return { valid: false, reason: '翻译结果混入了中文字符，不符合目标语言要求' };
                }
                
                // 对于非英文语言，检查是否混入过多英文字符（允许少量专有名词）
                // if (!isEnglishVariant(targetLanguage) && englishChars.test(translation)) {
                //     // 计算英文字符的比例
                //     const englishCharCount = (translation.match(/[a-zA-Z]/g) || []).length;
                //     const totalCharCount = translation.replace(/\s/g, '').length;
                //     if (totalCharCount > 0 && englishCharCount / totalCharCount > 0.3) {
                //         return { valid: false, reason: '翻译结果混入了过多英文字符，可能不符合目标语言要求' };
                //     }
                // }

                // 只有非英语变体才做以下检测
                if (!isEnglishVariant(targetLanguage)) {
                    // 检查翻译是否与原文完全相同（忽略大小写和空格）
                    const normalizedSource = source.toLowerCase().replace(/\s+/g, ' ').trim();
                    const normalizedTranslation = trimmedTranslation.toLowerCase().replace(/\s+/g, ' ').trim();
                    if (normalizedSource === normalizedTranslation) {
                        return { valid: false, reason: '翻译内容与原文相同，可能是专有名词或无需翻译的内容' };
                    }
                }

                // 检查翻译是否包含明显的标点符号（可能是原文未翻译）
                const punctuation = /[.,;:!?()[\]{}"'`~@#$%^&*+=|\\/<>]/;
                if (punctuation.test(trimmedTranslation) && !punctuation.test(source)) {
                    return { valid: false, reason: '翻译内容包含标点符号，可能是原文未翻译' };
                }

                // 其他情况都认为是有效的翻译
                return { valid: true };
            }

            // 先尝试解析整个数组以验证格式
            const parsedArray = parsedContent;
            if (!Array.isArray(parsedArray)) {
                console.error('[翻译错误] 响应格式错误: 响应解析结果不是数组');
                console.error(`[处理结果] 由于响应格式错误，跳过本批次翻译 (共 ${messages.length} 条待翻译内容)`);
                return;
            }

            // 检查数组长度是否匹配
            if (parsedArray.length !== messages.length) {
                console.log('[翻译警告] 翻译数量不匹配');
                console.log(`- 预期数量: ${messages.length}`);
                console.log(`- 实际数量: ${parsedArray.length}`);
                console.log('- 继续处理可用的翻译');
            }

            console.log('[翻译详情] 开始处理翻译条目:');
            for (let i = 0; i < Math.min(messages.length, parsedArray.length); i++) {
                try {
                    const translation = parsedArray[i];
                    let translationElement = messages[i].translationElement;
                    const sourceText = messages[i].source;
                    
                    // 检查翻译是否有效
                    if (!translation || !translation.translation || typeof translation.translation !== 'string') {
                        // 保留错误信息的详细输出
                        console.log(`[条目 ${i+1}/${messages.length}] ❌ 跳过`);
                        console.log(`- 原文: "${sourceText}"`);
                        console.log(`- 原因: 无效的翻译内容`);
                        if (translation) {
                            console.log(`- 返回: ${JSON.stringify(translation)}`);
                        }
                        skipCount++;
                        continue;
                    }

                    // 检查翻译质量
                    const qualityCheck = isValidTranslation(sourceText, translation.translation, targetLanguage);
                    if (!qualityCheck.valid) {
                        // 保留质量问题的详细输出
                        console.log(`[条目 ${i+1}/${messages.length}] ⚠️ 质量问题`);
                        console.log(`- 原文: "${sourceText}"`);
                        console.log(`- 译文: "${translation.translation}"`);
                        console.log(`- 原因: ${qualityCheck.reason}`);
                        qualityIssueCount++;
                        skipCount++;
                        continue;
                    }
                    
                    if (translationElement) {
                        translationElement.textContent = translation.translation;
                        if (!keepUnfinishedTypeAttr && translationElement.getAttribute('type') === 'unfinished') {
                            translationElement.removeAttribute('type');
                        }
                        // 成功翻译只显示条目编号，不显示详情
                        console.log(`[条目 ${i+1}/${messages.length}] ✓`);
                        successCount++;
                    }
                } catch (error) {
                    // 保留错误信息的详细输出
                    console.log(`[条目 ${i+1}/${messages.length}] ❌ 跳过`);
                    console.log(`- 原文: "${messages[i].source}"`);
                    console.log(`- 原因: 处理出错 (${error.message})`);
                    skipCount++;
                }
            }
            
            // 输出处理结果统计
            console.log('[翻译完成] 处理结果统计:');
            console.log(`- 成功翻译: ${successCount} 条`);
            console.log(`- 跳过翻译: ${skipCount} 条`);
            if (qualityIssueCount > 0) {
                console.log(`- 质量问题: ${qualityIssueCount} 条`);
            }
            console.log(`- 完成比例: ${((successCount / messages.length) * 100).toFixed(1)}%`);
            
            // 使用单行输出token使用情况
            if (response.data.usage) {
                console.log('[Token统计]', JSON.stringify(response.data.usage));
            }
        } catch (error) {
            // 简化错误输出，避免产生大量空行
            console.error('[错误] JSON解析失败');
            console.error('原因:', error.message);
            // 过滤掉大量空行，只保留有实际内容的行
            const responseLines = response.data.choices[0].message.content.split('\n');
            const filteredLines = responseLines.filter(line => line.trim() !== '').slice(0, 10); // 错误时只显示前10行有内容的行
            const cleanedResponse = filteredLines.join('\n');
            console.error('原始响应:', cleanedResponse + (responseLines.length > filteredLines.length ? '\n...' : ''));
            console.error(`[处理结果] 由于JSON解析失败，跳过本批次翻译 (共 ${messages.length} 条待翻译内容)`);
            return;
        }
    }).catch(error => {
        console.error('[翻译错误] API请求失败:', error.message);
        console.error(`[处理结果] 由于API请求失败，跳过本批次翻译 (共 ${messages.length} 条待翻译内容)`);
    });
}