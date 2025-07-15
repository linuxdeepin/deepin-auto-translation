// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import * as YAML from 'js-yaml';
import axios from 'axios';
import * as Settings from './settings'
import * as Secrets from './secrets';
import { MessageData } from './types';
import * as Prompt from './prompt';

// 🔧 全局文本标准化函数，用于比较源文本时忽略格式差异
function normalizeTextForComparison(text: string): string {
    return text
        .trim()
        // 首先处理转义字符，将转义的引号转换为普通引号
        .replace(/\\"/g, '"')           // 转义的双引号 -> 普通双引号
        .replace(/\\'/g, "'")           // 转义的单引号 -> 普通单引号
        .replace(/\\\\/g, '\\')         // 转义的反斜杠 -> 普通反斜杠
        // 处理多余的引号包围（常见于API返回的JSON解析结果）
        .replace(/^["']+|["']+$/g, '')  // 移除首尾的引号（单引号或双引号）
        .replace(/\s+/g, ' ')           // 将多个空白字符（包括换行符、制表符等）替换为单个空格
        .replace(/\n/g, ' ')            // 确保换行符被替换为空格
        .replace(/\r/g, ' ')            // 确保回车符被替换为空格
        .replace(/\t/g, ' ')            // 确保制表符被替换为空格
        .replace(/[　]/g, ' ')          // 全角空格替换为半角空格
        .replace(/["""'']/g, '"')       // 统一引号格式（全角引号、智能引号等）
        .replace(/[''′]/g, "'")         // 统一撇号格式
        .replace(/[…]/g, '...')         // 统一省略号格式
        .replace(/[—–]/g, '-')          // 统一破折号格式
        .replace(/\s+/g, ' ')           // 再次合并多个空格
        .trim();
}

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
        // 显示完整的原始响应内容，不再截断
        const fullResponse = response.data.choices[0].message.content;
        console.log(fullResponse);
        
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
                console.error(`[处理结果] API响应格式异常，跳过本批次翻译 (共 ${messages.length} 条待翻译内容)`);
                console.error('可能原因：API返回了非JSON格式内容或格式不符合预期');
                return;
            }

            // 检查数组长度是否匹配
            if (parsedContent.length !== messages.length) {
                console.log('[翻译警告] 翻译数量不匹配');
                console.log(`- 预期数量: ${messages.length}`);
                console.log(`- 实际数量: ${parsedContent.length}`);
                console.log('- 继续处理可用的翻译，未返回的条目将保持unfinished状态');
            }

            // 🔒 初始化统计变量
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

                // 只有非英语变体才做以下检测，并且需要更智能的判断
                if (!isEnglishVariant(targetLanguage)) {
                    // 检查翻译是否与原文完全相同（忽略大小写和空格）
                    const normalizedSource = source.toLowerCase().replace(/\s+/g, ' ').trim();
                    const normalizedTranslation = trimmedTranslation.toLowerCase().replace(/\s+/g, ' ').trim();
                    if (normalizedSource === normalizedTranslation) {
                        // 对于短的专有名词、技术术语等，翻译相同是正常的
                        // 只有当内容较长（超过20个字符）且全部相同时才认为是问题
                        if (source.length > 20) {
                            return { valid: false, reason: '较长文本翻译内容与原文完全相同，模型未正确翻译，跳过不处理' };
                        }
                        // 短文本如专有名词、品牌名等，相同是正常的，允许通过
                    }
                }

                // 检查翻译是否包含明显异常的标点符号组合（如连续的问号或乱码标点）
                // 移除过于严格的标点符号检查，因为正常翻译中可能包含标点符号
                const abnormalPunctuation = /[\?\?]{3,}|[!!!]{3,}|[@#$%^&*+=|\\]{3,}/;
                if (abnormalPunctuation.test(trimmedTranslation)) {
                    return { valid: false, reason: '翻译内容包含异常的标点符号组合，可能是乱码' };
                }

                // 其他情况都认为是有效的翻译
                return { valid: true };
            }

            // 先尝试解析整个数组以验证格式
            const parsedArray = parsedContent;
            if (!Array.isArray(parsedArray)) {
                console.error('[翻译错误] 响应格式错误: 响应解析结果不是数组');
                console.error(`[处理结果] API响应解析失败，跳过本批次翻译 (共 ${messages.length} 条待翻译内容)`);
                console.error('可能原因：JSON解析异常或数据结构不符合预期');
                return;
            }

            // 检查数组长度是否匹配
            if (parsedArray.length !== messages.length) {
                console.log('[翻译警告] 翻译数量不匹配');
                console.log(`- 预期数量: ${messages.length}`);
                console.log(`- 实际数量: ${parsedArray.length}`);
                console.log('- 继续处理可用的翻译，未返回的条目将保持unfinished状态');
            }

            console.log('[翻译详情] 开始处理翻译条目:');
            
            // 🔒 严格索引验证：确保翻译结果与源文本的对应关系绝对正确
            const validMappings: Array<{
                sourceIndex: number;
                translationIndex: number;
                sourceText: string;
                translationText: string;
                isValid: boolean;
                reason?: string;
                hasResponse: boolean; // 新增：标记是否有API响应
            }> = [];
            
            // 🔒 第一步：为所有输入创建映射，包括没有响应的条目
            console.log(`[上下文验证] 处理输入条目: ${messagesWithId.length} 条，API响应: ${parsedArray.length} 条`);
            
            // 🔒 智能错位修复：首先尝试建立正确的源文本映射
            const sourceTextToIndex = new Map<string, number>();
            for (let i = 0; i < messagesWithId.length; i++) {
                sourceTextToIndex.set(messagesWithId[i].source, i);
            }
            
            // 🔒 检测是否存在错位问题
            let hasSourceMismatch = false;
            
            for (let i = 0; i < Math.min(parsedArray.length, messagesWithId.length); i++) {
                const translation = parsedArray[i];
                const sourceMessage = messagesWithId[i];
                
                // 🔧 修复：使用全局文本标准化函数进行比较
                const originalSourceNormalized = normalizeTextForComparison(sourceMessage.source);
                const apiSourceNormalized = translation.source ? normalizeTextForComparison(translation.source) : '';
                const sourceTextMatch = originalSourceNormalized === apiSourceNormalized;
                
                if (translation.source && !sourceTextMatch) {
                    hasSourceMismatch = true;
                    console.log(`[源文检测] ❌ 检测到错位！条目 ${i + 1} 源文本不匹配`);
                    console.log(`[源文检测] 原文: "${originalSourceNormalized}"`);
                    console.log(`[源文检测] API:  "${apiSourceNormalized}"`);
                    break;
                }
            }
            
            // console.log(`[错位检测] 错位检测结果: hasSourceMismatch = ${hasSourceMismatch}`);
            
            // 🔧 环境变量控制智能修复功能（默认禁用，避免错位风险）
            const enableSourceValidation = process.env.ENABLE_SOURCE_VALIDATION === 'true';
            
            if (hasSourceMismatch && enableSourceValidation) {
                console.log(`[🔧 源文校验] 检测到源文本错位，启动智能匹配修复...`);
                
                // 尝试通过源文本内容重新建立映射
                const usedTranslations = new Set<number>();
                const sourceValidationMappings: Array<{
                    sourceIndex: number;
                    translationIndex: number;
                    sourceText: string;
                    translationText: string;
                    isValid: boolean;
                    reason?: string;
                    hasResponse: boolean;
                    matchType: 'exact' | 'fallback' | 'none';
                }> = [];
                
                // 第一遍：精确匹配
                for (let i = 0; i < messagesWithId.length; i++) {
                    const sourceMessage = messagesWithId[i];
                    const sourceText = sourceMessage.source;
                    
                    // 在所有API响应中查找匹配的源文本
                    let foundMatch = false;
                    for (let j = 0; j < parsedArray.length; j++) {
                        if (usedTranslations.has(j)) continue;
                        
                        const translation = parsedArray[j];
                        // 🔧 修复：使用全局文本标准化函数进行比较
                        if (translation.source && normalizeTextForComparison(translation.source) === normalizeTextForComparison(sourceText)) {
                            // 找到精确匹配
                            console.log(`[🔧 源文校验] 精确匹配: 源文本 ${i} → 翻译 ${j} ("${sourceText.substring(0, 30)}...")`);
                            
                            usedTranslations.add(j);
                            sourceValidationMappings.push({
                                sourceIndex: i,
                                translationIndex: j,
                                sourceText: sourceText,
                                translationText: translation.translation || '',
                                isValid: true,
                                hasResponse: true,
                                matchType: 'exact'
                            });
                            foundMatch = true;
                            break;
                        }
                    }

                    if (!foundMatch) {
                        // 🚫 新逻辑：不进行回退匹配，直接标记为跳过
                        // console.log(`[🔧 智能修复] ❌ 跳过条目 ${i + 1}: 源文本不匹配，为避免翻译错行，保持未完成状态 ("${sourceText.substring(0, 30)}...")`);
                        sourceValidationMappings.push({
                            sourceIndex: i,
                            translationIndex: -1,
                            sourceText: sourceText,
                            translationText: '',
                            isValid: false,
                            hasResponse: false,
                            matchType: 'none',
                            reason: '源文本不匹配，为避免翻译错行而跳过'
                        });
                    }
                }
                
                // 🚫 移除第二遍回退匹配逻辑，直接输出统计结果
                const exactMatches = sourceValidationMappings.filter(m => m.matchType === 'exact').length;
                const skippedMatches = sourceValidationMappings.filter(m => m.matchType === 'none').length;
                console.log(`[🔧 源文校验] 修复完成 - 精确匹配: ${exactMatches}, 跳过条目: ${skippedMatches}, 总计: ${messagesWithId.length}`);
                console.log(`[🔧 源文校验] 为避免翻译错行，${skippedMatches} 个源文本不匹配的条目将保持 "unfinished" 状态`);
                
                // 使用源文校验后的映射替换原来的映射处理逻辑
                for (const mapping of sourceValidationMappings) {
                    try {
                        const sourceMessage = messagesWithId[mapping.sourceIndex];
                        
                        if (mapping.isValid && mapping.translationText) {
                            // 进行质量检查
                            const qualityCheck = isValidTranslation(mapping.sourceText, mapping.translationText, targetLanguage);
                            if (!qualityCheck.valid) {
                                validMappings.push({
                                    sourceIndex: mapping.sourceIndex,
                                    translationIndex: mapping.translationIndex,
                                    sourceText: mapping.sourceText,
                                    translationText: mapping.translationText,
                                    isValid: false,
                                    hasResponse: true,
                                    reason: `质量检查失败: ${qualityCheck.reason}`
                                });
                                continue;
                            }

                            // 实时语种检测
                            // const languageValidation = preWriteTranslationValidation(
                            //     mapping.sourceText, 
                            //     mapping.translationText, 
                            //     targetLanguage, 
                            //     true
                            // );
                            
                            // if (!languageValidation.isValid) {
                            //     validMappings.push({
                            //         sourceIndex: mapping.sourceIndex,
                            //         translationIndex: mapping.translationIndex,
                            //         sourceText: mapping.sourceText,
                            //         translationText: mapping.translationText,
                            //         isValid: false,
                            //         hasResponse: true,
                            //         reason: `语种检测失败: ${languageValidation.reason}`
                            //     });
                            //     continue;
                            // }
                            
                            // 通过所有检查
                            validMappings.push({
                                sourceIndex: mapping.sourceIndex,
                                translationIndex: mapping.translationIndex,
                                sourceText: mapping.sourceText,
                                translationText: mapping.translationText,
                                isValid: true,
                                hasResponse: true
                            });
                        } else {
                            validMappings.push({
                                sourceIndex: mapping.sourceIndex,
                                translationIndex: mapping.translationIndex,
                                sourceText: mapping.sourceText,
                                translationText: mapping.translationText,
                                isValid: false,
                                hasResponse: mapping.hasResponse,
                                reason: mapping.reason || '未知错误'
                            });
                        }
                    } catch (error) {
                        validMappings.push({
                            sourceIndex: mapping.sourceIndex,
                            translationIndex: mapping.translationIndex,
                            sourceText: mapping.sourceText,
                            translationText: '',
                            isValid: false,
                            hasResponse: mapping.hasResponse,
                            reason: `处理异常: ${error.message}`
                        });
                    }
                }
            } else if (hasSourceMismatch && !enableSourceValidation) {
                // 🚫 源文校验被禁用但检测到错位问题，跳过所有可能有问题的翻译
                console.log(`[🚫 源文校验] 源文校验已禁用 (ENABLE_SOURCE_VALIDATION=false)，检测到源文本错位，为避免翻译错行，将跳过所有可能错位的条目`);
                
                for (let i = 0; i < messagesWithId.length; i++) {
                    const sourceMessage = messagesWithId[i];
                    const sourceText = sourceMessage.source;
                    
                    // 检查是否有对应的API响应
                    if (i >= parsedArray.length) {
                        validMappings.push({
                            sourceIndex: i,
                            translationIndex: i,
                            sourceText: sourceText,
                            translationText: '',
                            isValid: false,
                            hasResponse: false,
                            reason: 'API未返回此条目的翻译'
                        });
                        continue;
                    }
                    
                    const translation = parsedArray[i];
                    
                    // 🚫 严格检查源文本匹配，不匹配就跳过
                    // 🔧 修复：使用全局文本标准化函数进行比较
                    if (translation.source && normalizeTextForComparison(translation.source) !== normalizeTextForComparison(sourceText)) {
                        console.log(`[🚫 源文校验] ❌ 跳过条目 ${i + 1}: 源文本不匹配，源文校验已禁用`);
                        console.log(`[🚫 源文校验]   预期源文本: "${sourceText}"`);
                        console.log(`[🚫 源文校验]   API返回源文本: "${translation.source}"`);
                        validMappings.push({
                            sourceIndex: i,
                            translationIndex: i,
                            sourceText: sourceText,
                            translationText: '',
                            isValid: false,
                            hasResponse: true,
                            reason: '源文本不匹配'
                        });
                        continue;
                    }
                    
                    // 源文本匹配或没有源文本字段，进行正常处理
                    if (!translation || !translation.translation || typeof translation.translation !== 'string') {
                        validMappings.push({
                            sourceIndex: i,
                            translationIndex: i,
                            sourceText: sourceText,
                            translationText: '',
                            isValid: false,
                            hasResponse: true,
                            reason: '无效的翻译内容格式'
                        });
                        continue;
                    }
                    
                    // 质量检查
                    const qualityCheck = isValidTranslation(sourceText, translation.translation, targetLanguage);
                    if (!qualityCheck.valid) {
                        validMappings.push({
                            sourceIndex: i,
                            translationIndex: i,
                            sourceText: sourceText,
                            translationText: translation.translation,
                            isValid: false,
                            hasResponse: true,
                            reason: `质量检查失败: ${qualityCheck.reason}`
                        });
                        continue;
                    }
                    
                    // 语种检测
                    // const languageValidation = preWriteTranslationValidation(
                    //     sourceText, 
                    //     translation.translation, 
                    //     targetLanguage, 
                    //     true
                    // );
                    
                    // if (!languageValidation.isValid) {
                    //     validMappings.push({
                    //         sourceIndex: i,
                    //         translationIndex: i,
                    //         sourceText: sourceText,
                    //         translationText: translation.translation,
                    //         isValid: false,
                    //         hasResponse: true,
                    //         reason: `语种检测失败: ${languageValidation.reason}`
                    //     });
                    //     continue;
                    // }
                    
                    // 通过所有检查
                    validMappings.push({
                        sourceIndex: i,
                        translationIndex: i,
                        sourceText: sourceText,
                        translationText: translation.translation,
                        isValid: true,
                        hasResponse: true
                    });
                }
            } else {
                // 🔒 没有错位问题，使用原来的逐一映射逻辑
                for (let i = 0; i < messagesWithId.length; i++) {
                    try {
                    const sourceMessage = messagesWithId[i];
                    const sourceText = sourceMessage.source;
                    
                    // 检查是否有对应的API响应
                    if (i >= parsedArray.length) {
                        // 没有API响应的条目，标记为未处理（保持unfinished状态）
                        validMappings.push({
                            sourceIndex: i,
                            translationIndex: i,
                            sourceText: sourceText,
                            translationText: '',
                            isValid: false,
                            hasResponse: false,
                            reason: 'API未返回此条目的翻译（可能由于内容过长、敏感词过滤或API限制）'
                        });
                        continue;
                    }
                    
                    const translation = parsedArray[i];
                    
                    // 🔒 验证翻译对象的完整性
                    if (!translation || !translation.translation || typeof translation.translation !== 'string') {
                        validMappings.push({
                            sourceIndex: i,
                            translationIndex: i,
                            sourceText: sourceText,
                            translationText: '',
                            isValid: false,
                            hasResponse: true,
                            reason: '无效的翻译内容格式'
                        });
                        continue;
                    }
                    
                    // 🔒 可选：验证翻译响应中是否包含索引信息（如果API支持）
                    if (translation.index !== undefined && translation.index !== i) {
                        console.warn(`[索引警告] 翻译 ${i}: API返回索引 ${translation.index} 与预期索引 ${i} 不匹配`);
                    }
                    
                    // 🔒 验证源文本匹配（如果API返回了源文本）
                    // 🔧 修复：使用全局文本标准化函数进行比较，忽略多余空格、换行符等差异
                    if (translation.source && normalizeTextForComparison(translation.source) !== normalizeTextForComparison(sourceText)) {
                        console.warn(`[源文本警告] 翻译 ${i + 1}: API返回源文本不匹配`);
                        console.warn(`[源文本警告]   预期源文本: "${sourceText}"`);
                        console.warn(`[源文本警告]   API返回源文本: "${translation.source}"`);
                        console.warn(`[源文本警告]   标准化预期: "${normalizeTextForComparison(sourceText)}"`);
                        console.warn(`[源文本警告]   标准化实际: "${normalizeTextForComparison(translation.source)}"`);
                        validMappings.push({
                            sourceIndex: i,
                            translationIndex: i,
                            sourceText: sourceText,
                            translationText: translation.translation,
                            isValid: false,
                            hasResponse: true,
                            reason: '源文本不匹配，可能存在索引错位'
                        });
                        continue;
                    }
                    
                    // 检查翻译质量（基本格式和内容检查）
                    const qualityCheck = isValidTranslation(sourceText, translation.translation, targetLanguage);
                    if (!qualityCheck.valid) {
                        validMappings.push({
                            sourceIndex: i,
                            translationIndex: i,
                            sourceText: sourceText,
                            translationText: translation.translation,
                            isValid: false,
                            hasResponse: true,
                            reason: `质量检查失败: ${qualityCheck.reason}`
                        });
                        continue;
                    }

                    // 实时语种检测（新增）
                    // const languageValidation = preWriteTranslationValidation(
                    //     sourceText, 
                    //     translation.translation, 
                    //     targetLanguage, 
                    //     true // 启用验证
                    // );
                    
                    // if (!languageValidation.isValid) {
                    //     validMappings.push({
                    //         sourceIndex: i,
                    //         translationIndex: i,
                    //         sourceText: sourceText,
                    //         translationText: translation.translation,
                    //         isValid: false,
                    //         hasResponse: true,
                    //         reason: `语种检测失败: ${languageValidation.reason}`
                    //     });
                    //     continue;
                    // }
                    
                    // 🔒 所有检查通过，标记为有效映射
                    validMappings.push({
                        sourceIndex: i,
                        translationIndex: i,
                        sourceText: sourceText,
                        translationText: translation.translation,
                        isValid: true,
                        hasResponse: true
                    });
                    
                } catch (error) {
                    validMappings.push({
                        sourceIndex: i,
                        translationIndex: i,
                        sourceText: messagesWithId[i].source,
                        translationText: '',
                        isValid: false,
                        hasResponse: i < parsedArray.length,
                        reason: `处理异常: ${error.message}`
                    });
                    }
                }
            }
            
            // 🔒 第二步：安全应用有效的翻译，确保一对一映射
            successCount = 0; // 重置计数器
            skipCount = 0; // 重置计数器
            
            console.log(`[上下文验证] 映射验证完成，有效映射: ${validMappings.filter(m => m.isValid).length}/${validMappings.length}`);
            
            for (const mapping of validMappings) {
                try {
                    const sourceMessage = messagesWithId[mapping.sourceIndex];
                    
                    if (mapping.isValid) {
                        // 🔒 最终安全检查：确保索引对应的消息是正确的
                        if (sourceMessage.source !== mapping.sourceText) {
                            console.error(`[严重错误] 索引 ${mapping.sourceIndex} 的源文本不匹配！`);
                            console.error(`  预期: "${mapping.sourceText}"`);
                            console.error(`  实际: "${sourceMessage.source}"`);
                            skipCount++;
                            continue;
                        }
                        
                        // 应用翻译
                        let translationElement = sourceMessage.translationElement;
                        if (translationElement) {
                            translationElement.textContent = mapping.translationText;
                            if (!keepUnfinishedTypeAttr && translationElement.getAttribute('type') === 'unfinished') {
                                translationElement.removeAttribute('type');
                            }
                            console.log(`[条目 ${mapping.sourceIndex + 1}/${messagesWithId.length}] ✓ "${mapping.sourceText.substring(0, 30)}${mapping.sourceText.length > 30 ? '...' : ''}" → "${mapping.translationText.substring(0, 50)}${mapping.translationText.length > 50 ? '...' : ''}"`);
                            successCount++;
                        }
                    } else {
                        console.log(`[条目 ${mapping.sourceIndex + 1}/${messagesWithId.length}] ❌ 跳过 - ${mapping.reason}`);
                        skipCount++;
                    }
                } catch (error) {
                    console.log(`[条目 ${mapping.sourceIndex + 1}/${messagesWithId.length}] ❌ 应用错误 - ${error.message}`);
                    skipCount++;
                }
            }
            
            // 🔒 第三步：验证完整性和生成详细统计
            const totalProcessed = successCount + skipCount;
            const noResponseCount = validMappings.filter(m => !m.hasResponse).length;
            const failedWithResponseCount = validMappings.filter(m => m.hasResponse && !m.isValid).length;
            
            if (totalProcessed !== messagesWithId.length) {
                console.warn(`[完整性警告] 处理数量不匹配！输入: ${messagesWithId.length}, 处理: ${totalProcessed}`);
            }
            
            // 输出详细的处理结果统计
            console.log('[翻译完成] 处理结果统计:');
            console.log(`- 📊 输入总数: ${messagesWithId.length} 条`);
            console.log(`- ✅ 成功翻译: ${successCount} 条`);
            console.log(`- ❌ 跳过翻译: ${skipCount} 条`);
            
            if (noResponseCount > 0) {
                console.log(`  └─ 🚫 API未返回: ${noResponseCount} 条 (保持unfinished状态)`);
            }
            
            if (failedWithResponseCount > 0) {
                console.log(`  └─ ⚠️  验证失败: ${failedWithResponseCount} 条 (质量/语种问题)`);
            }
            
            if (qualityIssueCount > 0) {
                console.log(`- ⚠️  质量问题: ${qualityIssueCount} 条`);
            }
            
            const successRate = ((successCount / messagesWithId.length) * 100).toFixed(1);
            const apiResponseRate = ((parsedArray.length / messagesWithId.length) * 100).toFixed(1);
            
            console.log(`- 📈 翻译成功率: ${successRate}% (${successCount}/${messagesWithId.length})`);
            console.log(`- 🌐 API响应率: ${apiResponseRate}% (${parsedArray.length}/${messagesWithId.length})`);
            
            // 如果API响应率低于90%，给出建议
            if (parsedArray.length < messagesWithId.length * 0.6) {
                console.log('');
                console.log('📋 响应率较低的可能原因和建议:');
                console.log('   • 批次过大 → 尝试减小 BATCH_SIZE');
                console.log('   • 文本过长 → 检查源文本长度');
                console.log('   • 敏感内容 → 检查是否包含敏感词');
                console.log('   • API限制 → 降低并发数或增加延迟');
            }
            
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
            console.error(`[处理结果] API响应JSON解析失败，跳过本批次翻译 (共 ${messages.length} 条待翻译内容)`);
            console.error('可能原因：API返回了非标准JSON格式或包含特殊字符');
            return;
        }
    }).catch(error => {
        console.error('[翻译错误] API请求失败:', error.message);
        console.error(`[处理结果] API网络请求失败，跳过本批次翻译 (共 ${messages.length} 条待翻译内容)`);
        console.error('可能原因：网络连接问题、API密钥错误、请求超时或API服务异常');
    });
}