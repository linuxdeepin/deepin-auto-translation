// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import * as QtLinguist from './qtlinguist';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { TransifexResource, TransifexRepo, TranslationOperation, MessageData } from './types';
import * as YAML from 'js-yaml';
import * as GitRepo from './gitrepo';
import * as Transifex from './transifex';
import { ParallelConfig, getParallelConfig } from './parallel-config';
import { getValidationConfig, printValidationConfig, validateTranslationBatch } from './validation';
import { 
    getTranslationSafetyConfig, 
    printTranslationSafetyConfig, 
    isBatchProcessingSafe,
    validateTranslationMappings,
    TranslationMapping,
    SafetyValidationResult
} from './translation-safety';
import path from 'path';

/**
 * 增量更新文件中的翻译内容
 * 只更新已翻译的条目，保持文件的其他部分不变
 */
function updateTranslationsInFile(inputFilePath: string, doc: any, tsElement: any): void {
    try {
        // 确保输入文件路径是绝对路径
        const absoluteInputPath = path.resolve(inputFilePath);
        
        // 读取原始文件内容
        const originalContent = fs.readFileSync(absoluteInputPath, 'utf8');
        
        // 提取XML声明
        const xmlDeclarationMatch = originalContent.match(/^<\?xml[^>]*\?>\s*(?:\n|\r\n)?/);
        const xmlDeclaration = xmlDeclarationMatch ? xmlDeclarationMatch[0] : '<?xml version="1.0" encoding="utf-8"?>\n';
        
        // 提取DOCTYPE声明
        const doctypeMatch = originalContent.match(/<!DOCTYPE[^>]*>\s*(?:\n|\r\n)?/);
        const doctypeDeclaration = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE TS>\n';
        
        // 检测原始文件的缩进模式
        const indentMatch = originalContent.match(/\n(\s+)<(?:context|name|message|location|source|translation)/);
        const indentString = indentMatch ? indentMatch[1] : '    '; // 默认4个空格
        
        // 使用更智能的方式重构XML，保留原始格式
        let result = xmlDeclaration + doctypeDeclaration;
        
        // 获取TS元素的属性
        const tsAttributes: string[] = [];
        if (tsElement.getAttribute('version')) {
            tsAttributes.push(`version="${tsElement.getAttribute('version')}"`);
        }
        if (tsElement.getAttribute('language')) {
            tsAttributes.push(`language="${tsElement.getAttribute('language')}"`);
        }
        if (tsElement.getAttribute('sourcelanguage')) {
            tsAttributes.push(`sourcelanguage="${tsElement.getAttribute('sourcelanguage')}"`);
        }
        
        result += `<TS ${tsAttributes.join(' ')}>\n`;
        
        // 遍历所有context
        const contexts = doc.getElementsByTagName('context');
        for (let i = 0; i < contexts.length; i++) {
            const context = contexts[i];
            result += `<context>\n`;
            
            // context name
            const nameElement = context.getElementsByTagName('name')[0];
            if (nameElement) {
                result += `${indentString}<name>${nameElement.textContent}</name>\n`;
            }
            
            // messages
            const messages = context.getElementsByTagName('message');
            for (let j = 0; j < messages.length; j++) {
                const message = messages[j];
                result += `${indentString}<message>\n`;
                
                // location
                const locationElement = message.getElementsByTagName('location')[0];
                if (locationElement) {
                    const filename = locationElement.getAttribute('filename');
                    const line = locationElement.getAttribute('line');
                    result += `${indentString}${indentString}<location filename="${filename}" line="${line}"/>\n`;
                }
                
                // source
                const sourceElement = message.getElementsByTagName('source')[0];
                if (sourceElement) {
                    result += `${indentString}${indentString}<source>${escapeXml(sourceElement.textContent || '')}</source>\n`;
                }
                
                // comment (if exists)
                const commentElement = message.getElementsByTagName('comment')[0];
                if (commentElement && commentElement.textContent) {
                    result += `${indentString}${indentString}<comment>${escapeXml(commentElement.textContent)}</comment>\n`;
                }
                
                // translation
                const translationElement = message.getElementsByTagName('translation')[0];
                if (translationElement) {
                    const type = translationElement.getAttribute('type');
                    const translationText = translationElement.textContent || '';
                    
                    if (type && type !== 'finished') {
                        if (translationText.trim() === '') {
                            result += `${indentString}${indentString}<translation type="${type}"></translation>\n`;
                        } else {
                            result += `${indentString}${indentString}<translation type="${type}">${escapeXml(translationText)}</translation>\n`;
                        }
                    } else {
                        if (translationText.trim() === '') {
                            result += `${indentString}${indentString}<translation></translation>\n`;
                        } else {
                            result += `${indentString}${indentString}<translation>${escapeXml(translationText)}</translation>\n`;
                        }
                    }
                }
                
                result += `${indentString}</message>\n`;
            }
            
            result += `</context>\n`;
        }
        
        result += `</TS>\n`;
        
        // 在写入文件前检查目录是否存在
        const targetDir = path.dirname(absoluteInputPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        
        // 写回文件
        fs.writeFileSync(absoluteInputPath, result, { encoding: 'utf8' });
        
        console.log(`[文件更新] 已将翻译结果写入文件: ${absoluteInputPath}`);
    } catch (error) {
        console.error(`[文件更新错误] 更新文件 ${inputFilePath} 时出错:`, error);
        throw error;
    }
}

/**
 * 并行翻译批次处理函数
 * 🔒 新架构：消除文件内批次并发，防止写入竞争
 */
async function translateBatchesInParallel(
    translator: TranslationOperation,
    translationQueue: any[],
    targetLanguage: string,
    keepUnfinishedTypeAttr: boolean,
    parallelConfig: ParallelConfig,
    inputFilePath: string,
    doc: any,
    tsElement: any
): Promise<{ actualTranslatedCount: number; hasTranslationErrors: boolean }> {
    const batchSize = parallelConfig.BATCH_SIZE;
    const batchDelay = parallelConfig.BATCH_DELAY;
    
    // 🔒 强制检查：确保批次处理为串行模式
    const forceSequentialBatches = parallelConfig.FORCE_SEQUENTIAL_BATCHES;
    const actualMaxConcurrentBatches = forceSequentialBatches ? 1 : parallelConfig.MAX_CONCURRENT_BATCHES;
    
    if (parallelConfig.MAX_CONCURRENT_BATCHES > 1 && forceSequentialBatches) {
        console.log(`[翻译安全] 强制串行批次处理，忽略 MAX_CONCURRENT_BATCHES=${parallelConfig.MAX_CONCURRENT_BATCHES} 设置`);
    }
    
    // 将翻译队列分割成批次
    const batches: any[][] = [];
    for (let i = 0; i < translationQueue.length; i += batchSize) {
        batches.push(translationQueue.slice(i, i + batchSize));
    }
    
    const totalBatches = batches.length;
    let actualTranslatedCount = 0;
    let hasTranslationErrors = false;
    
    console.log(`[翻译架构] 文件内串行处理模式: ${totalBatches} 个批次 × ${batchSize} 条/批次`);
    console.log(`[翻译安全] 文件: ${path.basename(inputFilePath)} - 避免并发写入风险`);
    
    // 创建批次处理函数
    const processBatch = async (batch: any[], batchIndex: number): Promise<number> => {
        try {
            console.log(`[串行翻译] 开始处理批次 ${batchIndex + 1}/${totalBatches}，共 ${batch.length} 条`);
            
            // 🔒 启用翻译安全性系统
            const safetyConfig = getTranslationSafetyConfig();
            if (safetyConfig.enableDetailedLogging) {
                printTranslationSafetyConfig(safetyConfig);
            }

            // 🔒 批次处理安全检查
            const safetyResult = isBatchProcessingSafe(batch.length, batch.length, safetyConfig);
            if (!safetyResult.isSafe) {
                console.error(`[翻译安全] 批次处理不安全: ${safetyResult.reason}`);
                if (safetyResult.suggestions) {
                    console.error('[翻译安全] 建议措施:');
                    safetyResult.suggestions.forEach(suggestion => {
                        console.error(`  • ${suggestion}`);
                    });
                }
                throw new Error(`批次处理安全检查失败: ${safetyResult.reason}`);
            } else if (safetyResult.reason && safetyConfig.enableDetailedLogging) {
                console.log(`[翻译安全] ${safetyResult.reason}`);
                if (safetyResult.suggestions) {
                    console.log('[翻译安全] 优化建议:');
                    safetyResult.suggestions.forEach(suggestion => {
                        console.log(`  • ${suggestion}`);
                    });
                }
            }

            console.log(`🔄 串行处理批次 (${batchIndex + 1}/${totalBatches}): ${batch.length} 条消息`);
            console.log(`📊 安全配置: 文件内串行 ✅, 无并发写入风险`);

            const validationConfig = getValidationConfig();
            console.log(`🔍 验证配置: ${validationConfig.configName}`);

            try {
                // 🔒 记录批次开始时间戳，用于后续验证
                const batchStartTime = Date.now();
                console.log(`[翻译安全] 批次开始: ${new Date(batchStartTime).toISOString()}`);

                // 执行翻译
                await translator(batch, targetLanguage, keepUnfinishedTypeAttr);

                // 🔒 批次完成后的安全验证
                const batchEndTime = Date.now();
                console.log(`[翻译安全] 批次完成: ${new Date(batchEndTime).toISOString()}, 耗时: ${batchEndTime - batchStartTime}ms`);
                
                // 🔒 验证翻译结果的上下文独立性
                if (safetyConfig.enableContextValidation) {
                    const mappings: TranslationMapping[] = batch.map((msg, index) => ({
                        sourceIndex: index,
                        translationIndex: index,
                        sourceText: msg.source,
                        translationText: msg.translationElement?.textContent || '',
                        contextId: `${msg.context}_${msg.source}_${index}_${batchStartTime}`,
                        isValid: !!msg.translationElement?.textContent,
                        reason: msg.translationElement?.textContent ? undefined : '翻译内容为空',
                        timestamp: batchStartTime
                    }));
                    
                    const validationResult = validateTranslationMappings(mappings, safetyConfig);
                    if (!validationResult.passed) {
                        console.warn(`[翻译安全] 批次验证失败: ${validationResult.mismatchCount} 个问题`);
                        // 可以选择是否抛出错误，或者仅记录警告
                        if (safetyConfig.maxAllowedMismatch === 0) {
                            console.error('[翻译安全] 严格模式下不允许任何不匹配，停止处理');
                            // throw new Error(`翻译安全验证失败: ${validationResult.mismatchCount} 个问题`);
                        }
                    }
                }

                // 统计本批次翻译的数量（只统计非unfinished状态的翻译）
                const batchTranslatedCount = batch.filter(msg => 
                    msg.translationElement && 
                    msg.translationElement.textContent && 
                    msg.translationElement.textContent.trim() !== '' &&
                    msg.translationElement.getAttribute('type') !== 'unfinished'
                ).length;
                
                // 🔧 新增：每个批次完成后立即更新文件
                // 🔒 安全保障：串行模式下无写入竞争风险
                if (batchTranslatedCount > 0) {
                    try {
                        updateTranslationsInFile(inputFilePath, doc, tsElement);
                        console.log(`[串行翻译] 批次 ${batchIndex + 1}/${totalBatches} 完成，翻译了 ${batchTranslatedCount} 条，已安全更新文件`);
                    } catch (updateError) {
                        console.error(`[串行翻译] 批次 ${batchIndex + 1}/${totalBatches} 文件更新失败:`, updateError);
                        // 文件更新失败不影响翻译统计
                    }
                } else {
                    console.log(`[串行翻译] 批次 ${batchIndex + 1}/${totalBatches} 完成，翻译了 ${batchTranslatedCount} 条`);
                }
                
                if (batchTranslatedCount === 0 && batch.length > 0) {
                    hasTranslationErrors = true;
                }
                
                // 原有验证逻辑
                if (validationConfig.configName !== 'disabled') {
                    await validateTranslationBatch(batch.map(msg => ({
                        originalText: msg.source,
                        translation: msg.translationElement?.textContent || '',
                        targetLanguage: targetLanguage,
                        messageData: msg
                    })), validationConfig);
                }
                
                return batchTranslatedCount;
            } catch (error) {
                console.error(`❌ 批次失败 (${batchIndex + 1}/${totalBatches}):`, error);
                throw error;
            }
        } catch (error) {
            console.error(`[串行翻译错误] 处理批次 ${batchIndex + 1}/${totalBatches} 时出错:`, error.message);
            hasTranslationErrors = true;
            return 0;
        }
    };
    
    // 🔒 新架构：强制串行处理批次，消除文件内并发风险
    if (forceSequentialBatches || actualMaxConcurrentBatches === 1) {
        console.log(`[翻译架构] 文件内串行模式：逐个处理 ${totalBatches} 个批次`);
        
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`[串行翻译] 处理批次 ${i + 1}/${totalBatches}`);
            
            const batchTranslatedCount = await processBatch(batch, i);
            actualTranslatedCount += batchTranslatedCount;
            
            // 如果不是最后一个批次，添加延迟
            if (i < batches.length - 1) {
                console.log(`[串行翻译] 等待 ${batchDelay}ms 后继续下一批次...`);
                await new Promise(resolve => setTimeout(resolve, batchDelay));
            }
        }
    } else {
        // 🚨 保留旧的并发逻辑作为备选（但不推荐使用）
        console.warn(`[翻译架构] ⚠️  使用文件内并发模式，存在写入竞争风险！建议启用 FORCE_SEQUENTIAL_BATCHES`);
        
        // 使用并发限制处理批次
        for (let i = 0; i < batches.length; i += actualMaxConcurrentBatches) {
            const currentBatches = batches.slice(i, i + actualMaxConcurrentBatches);
            const batchPromises = currentBatches.map((batch, index) => 
                processBatch(batch, i + index)
            );
            
            console.log(`[并行翻译] ⚠️  并行处理第 ${i + 1}-${Math.min(i + actualMaxConcurrentBatches, batches.length)} 批次`);
            
            const results = await Promise.all(batchPromises);
            actualTranslatedCount += results.reduce((sum, count) => sum + count, 0);
            
            // 如果不是最后一轮，添加延迟
            if (i + actualMaxConcurrentBatches < batches.length) {
                console.log(`[并行翻译] 等待 ${batchDelay}ms 后继续...`);
                await new Promise(resolve => setTimeout(resolve, batchDelay));
            }
        }
    }
    
    const processingMode = forceSequentialBatches ? '串行' : '并发';
    console.log(`[${processingMode}翻译] 文件 ${inputFilePath} 处理完成，共翻译了 ${actualTranslatedCount} 条`);
    
    return { actualTranslatedCount, hasTranslationErrors };
}

/**
 * XML转义函数，将特殊字符转换为XML实体
 */
function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case "'": return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

/**
 * 统一的批次处理流程：翻译 → (可选验证) → 写入文件 → 下一批次
 */
async function translateBatchesWithValidation(
    translator: TranslationOperation,
    translationQueue: any[],
    targetLanguage: string,
    keepUnfinishedTypeAttr: boolean,
    parallelConfig: ParallelConfig,
    inputFilePath: string,
    doc: any,
    tsElement: any,
    validationConfig: any
): Promise<{ actualTranslatedCount: number; hasTranslationErrors: boolean }> {
    const batchSize = parallelConfig.BATCH_SIZE;
    const totalBatches = Math.ceil(translationQueue.length / batchSize);
    let actualTranslatedCount = 0;
    let hasTranslationErrors = false;

    console.log(`📝 开始串行处理 ${translationQueue.length} 条翻译，分成 ${totalBatches} 个批次...`);

    // 逐批处理：翻译 → (可选验证) → 写入文件
    for (let i = 0; i < translationQueue.length; i += batchSize) {
        const batch = translationQueue.slice(i, i + batchSize);
        const batchIndex = Math.floor(i / batchSize) + 1;
        
        try {
            console.log(`[翻译批次 ${batchIndex}/${totalBatches}] 开始翻译 ${batch.length} 条...`);
            
            // 第一步：执行翻译
            await translator(batch, targetLanguage, keepUnfinishedTypeAttr);
            
            // 统计本批次翻译的数量（只统计非unfinished状态的翻译）
            const batchTranslatedCount = batch.filter(msg => 
                msg.translationElement && 
                msg.translationElement.textContent && 
                msg.translationElement.textContent.trim() !== '' &&
                msg.translationElement.getAttribute('type') !== 'unfinished'
            ).length;

            console.log(`[翻译批次 ${batchIndex}/${totalBatches}] 翻译完成，翻译了 ${batchTranslatedCount} 条`);

            // 第二步：按新流程进行验证：翻译后 -> 语种检测 -> 可选回译
            if ((validationConfig.enableLanguageDetection || validationConfig.enableBackTranslation) && 
                batchTranslatedCount > 0) {
                
                console.log(`[翻译批次 ${batchIndex}/${totalBatches}] 开始验证 ${batchTranslatedCount} 条翻译的质量...`);
                
                // 对每个已翻译的条目进行验证
                let validationPassedCount = 0;
                let validationFailedCount = 0;
                let currentValidationIndex = 0;
                
                for (const msg of batch) {
                    if (msg.translationElement && 
                        msg.translationElement.textContent && 
                        msg.translationElement.textContent.trim() !== '') {
                        
                        currentValidationIndex++;
                        const originalText = msg.source;
                        const translation = msg.translationElement.textContent.trim();
                        
                        try {
                            console.log(`[翻译批次 ${batchIndex}/${totalBatches}] 验证第 ${currentValidationIndex}/${batchTranslatedCount} 条翻译...`);
                            
                            // 使用新的验证流程：语种检测 + 可选回译
                            const { validateTranslationAfterTranslation } = await import('./validation');
                            const validationResult = await validateTranslationAfterTranslation(
                                originalText,
                                translation,
                                targetLanguage,
                                validationConfig
                            );
                            
                            if (validationResult.shouldInclude) {
                                // 验证通过，保留翻译
                                validationPassedCount++;
                                console.log(`[翻译批次 ${batchIndex}/${totalBatches}] 第 ${currentValidationIndex}/${batchTranslatedCount} 条 ✅ 通过 - ${validationResult.reason}`);
                            } else {
                                // 验证失败，清空翻译以避免错行
                                msg.translationElement.textContent = '';
                                msg.translationElement.setAttribute('type', 'unfinished');
                                validationFailedCount++;
                                console.log(`[翻译批次 ${batchIndex}/${totalBatches}] 第 ${currentValidationIndex}/${batchTranslatedCount} 条 ❌ 跳过 - ${validationResult.reason}`);
                            }
                        } catch (validationError) {
                            console.error(`[翻译批次 ${batchIndex}/${totalBatches}] 第 ${currentValidationIndex}/${batchTranslatedCount} 条 ❌ 跳过 - 处理异常: ${validationError.message}`);
                            // 异常时清空翻译，避免错行
                            msg.translationElement.textContent = '';
                            msg.translationElement.setAttribute('type', 'unfinished');
                            validationFailedCount++;
                        }
                    }
                }
                
                console.log(`[翻译批次 ${batchIndex}/${totalBatches}] 验证完成，最终保留: ${validationPassedCount} 条翻译`);
                console.log(`[翻译完成] 处理结果统计:`);
                console.log(`- 📊 输入总数: ${batchTranslatedCount} 条`);
                console.log(`- ✅ 成功翻译: ${validationPassedCount} 条`);
                console.log(`- ❌ 跳过翻译: ${validationFailedCount} 条`);
                if (validationFailedCount > 0) {
                    console.log(`  └─ ⚠  验证失败: ${validationFailedCount} 条 (质量/语种问题)`);
                }
                console.log(`- 📈 翻译成功率: ${((validationPassedCount / batchTranslatedCount) * 100).toFixed(1)}% (${validationPassedCount}/${batchTranslatedCount})`);
                console.log(`- 🌐 API响应率: 100.0% (${batchTranslatedCount}/${batchTranslatedCount})`);
                
                actualTranslatedCount += validationPassedCount;
            } else {
                // 如果没有启用验证，直接计入成功翻译数量
                actualTranslatedCount += batchTranslatedCount;
            }

            // 第三步：每个批次验证完成后立即写入文件
            if (batchTranslatedCount > 0 || i === 0) { // 第一批次总是写入，确保文件更新
                try {
                    updateTranslationsInFile(inputFilePath, doc, tsElement);
                    console.log(`[文件更新] 已将翻译结果写入文件: ${inputFilePath}`);
                    console.log(`[翻译批次 ${batchIndex}/${totalBatches}] 文件已更新`);
                } catch (updateError) {
                    console.error(`[翻译批次 ${batchIndex}/${totalBatches}] 文件更新失败:`, updateError);
                    hasTranslationErrors = true;
                }
            }

            // 如果本批次没有成功翻译任何内容，标记为有错误
            const finalBatchCount = batch.filter(msg => 
                msg.translationElement && 
                msg.translationElement.textContent && 
                msg.translationElement.textContent.trim() !== '' &&
                msg.translationElement.getAttribute('type') !== 'unfinished'
            ).length;
            
            if (finalBatchCount === 0 && batch.length > 0) {
                hasTranslationErrors = true;
            }

            // 批次间延迟
            if (i + batchSize < translationQueue.length) {
                await new Promise(resolve => setTimeout(resolve, parallelConfig.BATCH_DELAY));
            }
            
        } catch (error) {
            console.error(`[翻译批次 ${batchIndex}/${totalBatches}] 处理失败:`, error.message);
            hasTranslationErrors = true;
        }
    }

    return { actualTranslatedCount, hasTranslationErrors };
}

/*
 * translateLinguistTsFile translates a linguist ts file to a target language.
 * @param translator - the translation operation to perform (e.g. OpenAI.fetchTranslations or Ollama.fetchTranslations)
 * @param inputFilePath - the path to the linguist ts file to translate, the file will be modified by this method
 * @param languageHint - the language code to translate to, if the language code cannot be extracted from the input file (e.g. ill-formed ts file)
 * @returns the number of strings in the translation queue.
 */
export async function translateLinguistTsFile(translator: TranslationOperation, inputFilePath: string, languageHint: string = '', keepUnfinishedTypeAttr : boolean = true) : Promise<number>
{
    // 使用二进制方式读取文件，避免编码问题
    const fileBuffer = fs.readFileSync(inputFilePath);
    const fileContent = fileBuffer.toString('utf8');

    // 解析XML文档
    const doc = new DOMParser().parseFromString(fileContent, 'application/xml');
    const tsElement = doc.getElementsByTagName('TS')[0];
    
    if (!tsElement) {
        console.error(`Invalid TS file: ${inputFilePath}`);
        return 0;
    }

    const targetLanguage = languageHint || tsElement.getAttribute('language') || 'en';
    
    // 提取需要翻译的字符串
    const translationQueue = QtLinguist.extractStringsFromDocument(doc);

    console.log(`Extracted ${translationQueue.length} untranslated strings from file: ${inputFilePath}`)
    
    if (translationQueue.length === 0) {
        return 0;
    }
    
    // 获取并行配置
    const parallelConfig = getParallelConfig();
    
    // 获取验证配置
    const validationConfig = getValidationConfig();
    
    // 打印验证配置信息
    if (validationConfig.enableBackTranslation || validationConfig.enableLanguageDetection) {
        printValidationConfig(validationConfig);
    }
    
    // 记录实际成功翻译的数量
    let actualTranslatedCount = 0;
    let hasTranslationErrors = false;

    // 🔧 统一的批次处理流程：翻译 → (可选验证) → 写入文件 → 下一批次
    const result = await translateBatchesWithValidation(
        translator,
        translationQueue,
        targetLanguage,
        keepUnfinishedTypeAttr,
        parallelConfig,
        inputFilePath,
        doc,
        tsElement,
        validationConfig
    );
    
    actualTranslatedCount = result.actualTranslatedCount;
    hasTranslationErrors = result.hasTranslationErrors;

    // 🔧 移除重复的最终文件写入（现在由具体的处理函数负责）
    console.log(`[翻译完成] 所有批次处理完成`);

    // 根据实际翻译情况显示不同的消息
    if (hasTranslationErrors) {
        console.log(`文件 ${inputFilePath} 翻译完成，实际翻译了 ${actualTranslatedCount} 个字符串 (有错误)`);
        if (actualTranslatedCount > 0) {
            console.log(`  - 翻译成功: 翻译了 ${actualTranslatedCount} 个字符串`);
        }
    } else {
        console.log(`文件 ${inputFilePath} 翻译完成，翻译了 ${actualTranslatedCount} 个字符串`);
        if (actualTranslatedCount > 0) {
            console.log(`  - 翻译成功: 翻译了 ${actualTranslatedCount} 个字符串`);
        }
    }
    
    return actualTranslatedCount;
}

/*
 * translateTransifexResources translates all resources in a list of TransifexResources to a target language.
 * 
 * This method is mainly used for translate open-sourced projects that was linked to Transifex's GitHub integration.
 * Currently, repos should be ensured on disk (under `repo/` subfolder) by using `GitRepo.ensureLocalReposExist()` before using this method.
 * This method rely on .tx/transifex.yaml to get the resource paths.
 * 
 * @param translator - the translation operation to perform (e.g. OpenAI.fetchTranslations or Ollama.fetchTranslations)
 * @param transifexResources - the list of TransifexResources to translate
 * @param targetLanguageCode - the language code to translate to
 */
export async function translateTransifexResources(translator: TranslationOperation, transifexResources: TransifexResource[], targetLanguageCode: string, statusLogBaseName: string)
{
    for (const resource of transifexResources) {
        if (resource.additionalMarker === undefined) {
            const resPath = GitRepo.getResourcePath(resource, targetLanguageCode);
            if (resPath === '') {
                console.log(`Skipping ${resource}...`);
                resource.additionalMarker = 'skipped (no resource)';
                fs.writeFileSync(`./${statusLogBaseName}_${targetLanguageCode}.yml`, YAML.dump(transifexResources));
                continue;
            }
            console.log("Translating resource: ", resPath);
            const strCount = await translateLinguistTsFile(translator, resPath, targetLanguageCode, false);
            if (strCount > 0) {
                console.log(`Uploading ${resPath} to Transifex (${resource.transifexResourceId})...`);
                await Transifex.uploadTranslatedFileToTransifex(targetLanguageCode, resPath, resource.transifexResourceId);
                resource.additionalMarker = 'translated';
            } else {
                console.log(`Skipping ${resPath}...`);
                resource.additionalMarker = 'skipped';
            }
            fs.writeFileSync(`./${statusLogBaseName}_${targetLanguageCode}.yml`, YAML.dump(transifexResources));
        }
    }
}

/*
 * translateTransifexRepos translates all repo resources in a list of TransifexRepos to a target language.
 * 
 * This method is mainly used for translate private projects that are not able to linked to Transifex's GitHub integration,
 * but open-sourced projects can also use it as well as long as a correct `.tx/config` file is provided.
 * This method rely on .tx/config to work correctly, `tx` transifex-cli needs to be installed beforehand.
 * Currently, repo's .tx/config file should be ensured on disk (suggested to be under `repo/` subfolder, but you can point
 * it to anywhere as long as TransifexRepo pointed to the correct location) before using this method.
 * 
 * Example TransifexRepo array:
 * 
 * const repos : TransifexRepo[] = [
 *     {
 *         path: "./repo/close-sourced/deepin-mail",
 *         txBranch: "master",
 *         targetLanguageCodes: ["sl"]
 *     },
 *     {
 *         path: "./repo/close-sourced/deepin-installer-reborn",
 *         txBranch: "-1",
 *         targetLanguageCodes: ["th"]
 *     },
 *     {
 *         path: "./repo/linuxdeepin/deepin-home",
 *         txBranch: "-1",
 *         targetLanguageCodes: ["sl"]
 *     },
 * ]
 * 
 * Be aware, the given `txBranch` is for the target branch on Transifex, not the local repo's git branch. We don't
 * even need it to be a git repo to use this method.
 */
export async function translateTransifexRepos(translator: TranslationOperation, repos: TransifexRepo[])
{
    for (const repo of repos) {
        if (Transifex.isEmptyTxRepo(repo)) {
            Transifex.downloadTranslationFilesViaCli(repo.path, repo.txBranch);
        }
        const langCodes = repo.targetLanguageCodes;
        for (const langCode of langCodes) {
            const resourceFiles = Transifex.getResourcePathsFromTxRepo(repo, langCode);
            for (const resourceFile of resourceFiles) {
                const resPath = `${repo.path}/${resourceFile}`
                console.log("Translating resource: ", resourceFile);
                const strCount = await translateLinguistTsFile(translator, resPath, langCode, false);
                if (strCount > 0) {
                    console.log(`${resPath} translated`);
                } else {
                    console.log(`Skipping ${resPath}...`);
                }
            }
            Transifex.uploadTranslatedFilesViaCli(langCode, repo.path, repo.txBranch);
        }
    }
}
