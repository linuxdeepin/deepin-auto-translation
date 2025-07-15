// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import * as YAML from 'js-yaml';
import axios from 'axios';
import { MessageData } from './types';
import * as Prompt from './prompt';

export async function fetchTranslations(messages: MessageData[], targetLanguage: string, keepUnfinishedTypeAttr : boolean) : Promise<void>
{
    // 🔒 安全检查：为每条消息创建唯一标识，确保上下文独立
    const messagesWithId = messages.map((message, index) => ({
        ...message,
        _originalIndex: index,
        _contextId: `${message.context}_${message.source}_${index}` // 唯一标识符
    }));
    
    let userPrompt = YAML.dump({
        targetLanguageCode: targetLanguage,
        messages: messagesWithId.map((message, index) => {
            return {
                index: index, // 🔒 添加索引字段，确保顺序可追踪
                context: message.context,
                source: message.source,
                comment: message.comment
            }
        })
    });

    // axios request
    return axios.post('http://127.0.0.1:11434/api/chat', {
        model: 'qwen2.5:7b',
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
        stream: false,
        format: Prompt.structedOutputJsonSchema,
        options: {
            temperature: 0.5
        }
    }).then(response => {
        // response as json array
        console.log(`[翻译状态] 开始处理翻译响应 (目标语言: ${targetLanguage})`);
        // 过滤掉大量空行，只保留有实际内容的行
        const responseLines = response.data.message.content.split('\n');
        const filteredLines = responseLines.filter(line => line.trim() !== '').slice(0, 20); // 只显示前20行有内容的行
        const cleanedResponse = filteredLines.join('\n');
        console.log('[原始响应]', cleanedResponse + (responseLines.length > filteredLines.length ? '\n...' : ''));
        
        // 检查和修复基本的JSON格式问题 - 改进版本，支持截断JSON修复
        function validateAndCleanJson(str: string): string {
            try {
                // 1. 移除末尾的省略号标记（处理截断的JSON）
                str = str.replace(/\.\.\.\s*$/, '');
                
                // 2. 基础清理
                str = str.replace(/\t/g, ' '); // 替换制表符为空格
                str = str.replace(/\s+/g, ' '); // 合并多个空格
                str = str.replace(/\[\]{/g, '['); // 修复开头的[]{
                str = str.replace(/}:{/g, '},{'); // 修复}:{这样的格式
                
                // 移除注释
                str = str.replace(/\/\/.*/g, '');
                
                // 清理属性名中的空格
                str = str.replace(/"(\w+)\s*":/g, '"$1":');
                
                // 修复常见的属性名错误
                str = str.replace(/"source\*\*":/g, '"source":');
                str = str.replace(/"source\*":/g, '"source":');
                str = str.replace(/"translation\*\*":/g, '"translation":');
                str = str.replace(/"translation\*":/g, '"translation":');
                
                // 移除末尾逗号
                str = str.replace(/,(\s*[\]}])/g, '$1');
                
                // 确保是数组格式
                str = str.trim();
                if (!str.startsWith('[')) str = '[' + str;
                if (!str.endsWith(']')) str = str + ']';
                
                // 3. 首先尝试直接解析
                try {
                    const parsed = JSON.parse(str);
                    return JSON.stringify(parsed);
                } catch (e) {
                    // 如果直接解析失败，使用智能对象提取
                    console.log('[JSON清理] 直接解析失败，使用智能提取...');
                    const objects = extractCompleteObjects(str);
                    if (objects.length > 0) {
                        return JSON.stringify(objects);
                    }
                }
                
                return '[]';
            } catch (error) {
                console.error('[JSON清理] 清理JSON时发生错误:', error.message);
                return '[]';
            }
        }
        
        // 智能提取完整的翻译对象 - 改进版本，支持多种格式
        function extractCompleteObjects(str: string): any[] {
            const objects: any[] = [];
            
            // 尝试多种匹配模式，从严格到宽松
            const patterns = [
                // 标准顺序：source在前，translation在后
                /{\s*"source":\s*"([^"]*)",\s*"translation":\s*"([^"]*)"\s*}/g,
                // 颠倒顺序：translation在前，source在后
                /{\s*"translation":\s*"([^"]*)",\s*"source":\s*"([^"]*)"\s*}/g,
                // 允许中间有其他字段（非贪婪模式）
                /{\s*[^}]*?"source":\s*"([^"]*)"[^}]*?"translation":\s*"([^"]*)"[^}]*?}/g,
                /{\s*[^}]*?"translation":\s*"([^"]*)"[^}]*?"source":\s*"([^"]*)"[^}]*?}/g
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
            
            console.log('[JSON清理] 提取到', objects.length, '个完整对象');
            return objects;
        }
        
        // 清理和验证JSON
        const originalContent = response.data.message.content;
        const cleanedContent = validateAndCleanJson(originalContent);
        
        try {
            const responsedTranslations = JSON.parse(cleanedContent);
            
            if (!Array.isArray(responsedTranslations)) {
                console.error('[错误] 响应格式错误: 不是数组格式');
                console.error(`[处理结果] API响应格式异常，跳过本批次翻译 (共 ${messages.length} 条待翻译内容)`);
                console.error('可能原因：API返回了非JSON格式内容或格式不符合预期');
                return;
            }

            if (responsedTranslations.length !== messages.length) {
                console.error(`[警告] 翻译数量不匹配 (预期: ${messages.length}, 实际: ${responsedTranslations.length})`);
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

            // 检查数组长度是否匹配
            if (responsedTranslations.length !== messages.length) {
                console.log('[翻译警告] 翻译数量不匹配');
                console.log(`- 预期数量: ${messages.length}`);
                console.log(`- 实际数量: ${responsedTranslations.length}`);
                console.log('- 继续处理可用的翻译，未返回的条目将保持unfinished状态');
            }

            console.log('[翻译详情] 开始处理翻译条目:');

            // 🔒 为所有输入创建映射，包括没有响应的条目
            console.log(`[上下文验证] 处理输入条目: ${messagesWithId.length} 条，API响应: ${responsedTranslations.length} 条`);
            
            for (let i = 0; i < messagesWithId.length; i++) {
                try {
                    const sourceMessage = messagesWithId[i];
                    const sourceText = sourceMessage.source;
                    
                    // 检查是否有对应的API响应
                    if (i >= responsedTranslations.length) {
                        // 没有API响应的条目，标记为未处理（保持unfinished状态）
                        console.log(`[条目 ${i + 1}/${messagesWithId.length}] ❌ 跳过 - API未返回此条目的翻译`);
                        skipCount++;
                        continue;
                    }
                    
                    const translation = responsedTranslations[i];
                    
                    // 检查翻译是否有效
                    if (!translation || !translation.translation || typeof translation.translation !== 'string') {
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
                        console.log(`[条目 ${i+1}/${messages.length}] ⚠️ 质量问题`);
                        console.log(`- 原文: "${sourceText}"`);
                        console.log(`- 译文: "${translation.translation}"`);
                        console.log(`- 原因: ${qualityCheck.reason}`);
                        qualityIssueCount++;
                        skipCount++;
                        continue;
                    }
                    
                    if (sourceMessage.translationElement) {
                        sourceMessage.translationElement.textContent = translation.translation;
                        if (!keepUnfinishedTypeAttr && sourceMessage.translationElement.getAttribute('type') === 'unfinished') {
                            sourceMessage.translationElement.removeAttribute('type');
                        }
                        console.log(`[条目 ${i+1}/${messages.length}] ✓ "${sourceText.substring(0, 30)}${sourceText.length > 30 ? '...' : ''}" → "${translation.translation.substring(0, 50)}${translation.translation.length > 50 ? '...' : ''}"`);
                        successCount++;
                    }
                } catch (error) {
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
            console.error('[错误] JSON解析失败');
            console.error('原因:', error.message);
        }
    }).catch(error => {
        console.error('[翻译错误] API请求失败:', error.message);
    });
}