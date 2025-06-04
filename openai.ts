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
        
        // 检查和修复基本的JSON格式问题
        function validateAndCleanJson(str: string): string {
            try {
                // 基础清理
                str = str.replace(/\t/g, ' '); // 替换制表符为空格
                str = str.replace(/\s+/g, ' '); // 合并多个空格
                str = str.replace(/\[\]{/g, '['); // 修复开头的[]{
                str = str.replace(/}:{/g, '},{'); // 修复}:{这样的格式
                
                // 移除注释
                str = str.replace(/\/\/.*/g, '');
                
                // 清理属性名中的空格
                str = str.replace(/"(\w+)\s*":/g, '"$1":');
                
                // 移除末尾逗号
                str = str.replace(/,(\s*[\]}])/g, '$1');
                
                // 确保是数组格式
                str = str.trim();
                if (!str.startsWith('[')) str = '[' + str;
                if (!str.endsWith(']')) str = str + ']';
                
                // 修复不完整的对象
                str = str.replace(/({[^}]*)}?\s*$/, '$1}]');
                
                // 尝试解析，如果失败则进行更深层的修复
                try {
                    const parsed = JSON.parse(str);
                    return JSON.stringify(parsed); // 返回标准化的JSON字符串
                } catch (e) {
                    // 提取所有完整的对象
                    const objects = str.match(/{[^}]+}/g) || [];
                    if (objects.length > 0) {
                        return '[' + objects.join(',') + ']';
                    }
                }
                
                return str;
            } catch (error) {
                console.error('[JSON清理] 清理JSON时发生错误:', error.message);
                return str;
            }
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
            function isValidTranslation(source: string, translation: string): { valid: boolean; reason?: string } {
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
                    const qualityCheck = isValidTranslation(sourceText, translation.translation);
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