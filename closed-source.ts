// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'fs';
import path from 'path';
import process from 'process';
import * as Translator from './translator';
import * as OpenAI from './openai';
import { execSync } from 'child_process';

// 选择翻译服务 - 直接使用OpenAI，避免导入index.ts
const selectedTranslationService = OpenAI.fetchTranslations;

// 定义小语种列表
const MINOR_LANGUAGES = {
    'es': '西班牙语',
    'it': '意大利语',
    'de': '德语',
    'de_DE': '德语',
    'ja': '日语',
    'uk': '乌克兰语',
    'pt_BR': '巴西葡萄牙语',
    'sq': '阿尔巴尼亚语',
    'zh_CN': '简体中文',
    'pl': '波兰语'
};
// 记录简体中文文件路径，用于后续处理繁体中文
const zhCNFilePaths = new Map<string, string>();

/**
 * 直接翻译ts文件（独立实现，避免触发index.ts的初始化代码）
 * @returns {status: 'success'|'no_need'|'failed', translatedCount?: number, message?: string}
 */
async function translateTsFile(filePath: string, langCode: string): Promise<{status: 'success'|'no_need'|'failed', translatedCount?: number, message?: string}> {
    try {
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            const errorMsg = `文件不存在: ${filePath}`;
            console.error(errorMsg);
            return {status: 'failed', message: errorMsg};
        }
        
        // 使用二进制方式读取文件，避免编码问题
        const fileBuffer = fs.readFileSync(filePath);
        const fileContent = fileBuffer.toString('utf8');
        
        // 检查文件中是否包含未翻译内容
        const hasUnfinished = hasUnfinishedTranslations(fileContent);
        
        if (!hasUnfinished) {
            return {status: 'no_need', message: '没有未翻译内容'};
        }
        
        // 使用Translator提取并翻译内容
        const translatedCount = await Translator.translateLinguistTsFile(
            selectedTranslationService,
            filePath,
            langCode,
            false
        );
        
        if (translatedCount > 0) {
            return {status: 'success', translatedCount, message: `翻译了 ${translatedCount} 个字符串`};
        } else {
            return {status: 'no_need', message: '没有需要翻译的内容'};
        }
    } catch (error) {
        const errorMsg = `翻译文件 ${filePath} 时出错: ${error}`;
        console.error(errorMsg);
        return {status: 'failed', message: errorMsg};
    }
}

/**
 * 处理单个繁体中文文件
 * @returns {status: 'success'|'no_need'|'failed', message?: string}
 */
async function processTraditionalChineseFile(
    targetFilePath: string, 
    langCode: string, 
    sourceFilePath: string
): Promise<{status: 'success'|'no_need'|'failed', message?: string}> {
    const { execSync } = require('child_process');
    
    try {
        // 检查工具是否存在
        const utilsPath = process.env.TRANSLATION_UTILS_PATH || path.resolve(process.cwd(), './deepin-translation-utils');
        if (!fs.existsSync(utilsPath)) {
            const errorMsg = `deepin-translation-utils工具不存在于路径 ${utilsPath}`;
            console.error(`[繁体处理错误] ${errorMsg}`);
            console.error('[繁体处理错误] 请确保工具文件存在，或通过 TRANSLATION_UTILS_PATH 环境变量指定正确的路径');
            return {status: 'failed', message: errorMsg};
        }
        
        // 检查工具是否有执行权限并添加权限
        try {
            execSync(`chmod +x "${utilsPath}"`, { encoding: 'utf8' });
            fs.accessSync(utilsPath, fs.constants.X_OK);
        } catch (error) {
            const errorMsg = 'deepin-translation-utils工具权限检查或修改失败';
            console.error('[繁体处理错误]', errorMsg, error);
            return {status: 'failed', message: errorMsg};
        }
        
        // 确认文件存在，如果不存在则从简体中文文件复制
        if (!fs.existsSync(targetFilePath)) {
            console.log(`[繁体处理] 繁体中文文件不存在，从简体中文文件复制: ${targetFilePath}`);
            try {
                fs.copyFileSync(sourceFilePath, targetFilePath);
            } catch (copyError) {
                const errorMsg = `创建繁体中文文件时出错: ${copyError}`;
                console.error(`[繁体处理错误] ${errorMsg}`);
                return {status: 'failed', message: errorMsg};
            }
        }
        
        // 读取文件内容并检查是否有未翻译内容
        const fileContent = fs.readFileSync(targetFilePath, 'utf8');
        const hasUnfinished = hasUnfinishedTranslations(fileContent);
        
        if (!hasUnfinished) {
            return {status: 'no_need', message: '没有未翻译内容'};
        }
        
        // 使用工具转换
        const escapedSourcePath = sourceFilePath.replace(/"/g, '\\"');
        const command = `"${utilsPath}" zhconv -t ${langCode} "${escapedSourcePath}"`;
        
        console.log(`[繁体处理] 开始生成${langCode}文件: ${targetFilePath}`);
        console.log(`[繁体处理] 执行命令: ${command}`);
        
        const output = execSync(command, { 
            encoding: 'utf8', 
            stdio: 'pipe',
            timeout: 120000,
            shell: '/bin/bash'
        });
        
        console.log(`[繁体处理] 命令执行成功${output.trim() ? '，输出: ' + output.trim() : '，无输出'}`);
        
        // 验证转换后的文件
        if (fs.existsSync(targetFilePath)) {
            const targetStats = fs.statSync(targetFilePath);
            const sourceStats = fs.statSync(sourceFilePath);
            if (targetStats.size < sourceStats.size * 0.5) {
                console.warn(`[繁体处理警告] 生成的文件大小异常，源文件: ${sourceStats.size} 字节，目标文件: ${targetStats.size} 字节`);
            } else {
                console.log(`[繁体处理] 繁体中文文件处理完成: ${targetFilePath}`);
            }
            return {status: 'success', message: '繁体中文转换成功'};
        } else {
            throw new Error(`转换后的文件不存在: ${targetFilePath}`);
        }
    } catch (error) {
        const errorMsg = `处理繁体中文文件失败: ${error}`;
        console.error(`[繁体处理错误] ${errorMsg}`);
        return {status: 'failed', message: errorMsg};
    }
}

/**
 * 检查文件内容是否包含真正需要翻译的未翻译内容
 * 这个函数使用与qtlinguist.ts中extractStringsFromDocument相同的严格检查逻辑
 */
function hasUnfinishedTranslations(fileContent: string): boolean {
    // 使用DOM解析器进行精确检查，而不是简单的字符串匹配
    try {
        const { DOMParser } = require('@xmldom/xmldom');
        const doc = new DOMParser().parseFromString(fileContent, 'application/xml');
        
        // 检查解析是否成功
        if (!doc || !doc.getElementsByTagName) {
            console.warn('文件解析失败，回退到字符串匹配检查');
            return simpleStringCheck(fileContent);
        }
        
        // 遍历所有context元素
        const contextElements = doc.getElementsByTagName('context');
        for (let i = 0; i < contextElements.length; i++) {
            const contextElement = contextElements[i];
            const messageElements = contextElement.getElementsByTagName('message');
            
            for (let j = 0; j < messageElements.length; j++) {
                const messageElement = messageElements[j];
                const translationElement = messageElement.getElementsByTagName('translation')[0];
                
                if (!translationElement) continue;
                
                // 严格检查条件: 只处理标记为"unfinished"且内容为空的翻译
                const isUnfinished = translationElement.getAttribute('type') === 'unfinished';
                const isEmpty = !translationElement.textContent || translationElement.textContent.trim() === '';
                
                // 如果找到真正需要翻译的内容（unfinished且为空），返回true
                if (isUnfinished && isEmpty) {
                    return true;
                }
            }
        }
        
        // 没有找到需要翻译的内容
        return false;
    } catch (error) {
        console.warn('DOM解析检查失败，回退到字符串匹配检查:', error);
        return simpleStringCheck(fileContent);
    }
}

/**
 * 简单的字符串匹配检查（作为DOM解析的回退方案）
 */
function simpleStringCheck(fileContent: string): boolean {
    return fileContent.includes('<translation type="unfinished"/>') || 
           fileContent.includes('<translation type="unfinished"></translation>') ||
           fileContent.includes('<translation type="unfinished">') ||
           fileContent.match(/<translation(\s+type="unfinished"[^>]*)\s*\/>/g) !== null;
}

/**
 * 查找目录中的所有ts文件
 */
function findTsFiles(dir: string): string[] {
    const results: string[] = [];
    console.log(`开始在目录 ${dir} 中查找ts文件...`);
    
    function findRecursively(currentDir: string) {
        try {
            // console.log(`扫描目录: ${currentDir}`);
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                
                // 跳过node_modules和.git目录
                if (entry.isDirectory()) {
                    if (entry.name !== 'node_modules' && entry.name !== '.git') {
                        findRecursively(fullPath);
                    } else {
                        // console.log(`跳过目录: ${fullPath}`);
                    }
                } else if (entry.isFile() && entry.name.endsWith('.ts')) {
                    // console.log(`找到ts文件: ${fullPath}`);
                    results.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`读取目录 ${currentDir} 内容时出错:`, error);
        }
    }
    
    try {
        findRecursively(dir);
    } catch (error) {
        console.error(`查找目录 ${dir} 中的ts文件时出错:`, error);
    }
    
    console.log(`在目录 ${dir} 中共找到 ${results.length} 个ts文件`);
    return results;
}

/**
 * 从文件名中提取语言代码
 * 支持多种命名格式，如：
 * - project_zh_CN.ts
 * - translation_zh_CN.ts
 * - 任何前缀_zh_CN.ts
 * - 任何前缀_ast.ts（三字母语言代码）
 * - 任何前缀_af_ZA.ts（带地区的语言代码）
 * 
 * @param filename 文件名
 * @returns 语言代码或null（如果不匹配）
 */
function extractLanguageCode(filename: string): string | null {
    // 首先检查文件名是否包含下划线，避免处理类似 dde-introduction.ts 的文件
    if (!filename.includes('_')) {
        return null;
    }
    
    // 使用更宽松的正则表达式，支持：
    // 1. 2-3个字母的语言代码
    // 2. 带地区的语言代码（如af_ZA）
    // 3. 支持任意前缀
    const match = filename.match(/.*_([a-z]{2,3}(?:_[A-Z]{2,3})?)\.ts$/);
    if (!match) return null;
    return match[1];
}

/**
 * 从文件名中提取基础名称（不包含语言代码）
 */
function extractBaseName(filename: string): string | null {
    const match = filename.match(/(.+)_[a-z]{2,3}(?:_[A-Z]{2,3})?\.ts$/);
    if (!match) return null;
    return match[1];
}

/**
 * 检查文件是否被排除
 */
function isFileExcluded(filePath: string, excludeFiles: string[]): boolean {
    if (!excludeFiles || excludeFiles.length === 0) return false;
    
    const fileName = path.basename(filePath);
    const relativePath = filePath;
    
    return excludeFiles.some(exclude => {
        // 支持文件名匹配或路径匹配
        return fileName.includes(exclude) || relativePath.includes(exclude);
    });
}

/**
 * 处理ts文件，根据语种类型添加到对应列表
 * 
 * @param tsFile 翻译文件路径
 * @param langCode 已提取的语言代码
 * @param processedFiles 已处理文件集合
 * @param filesToTranslate 待翻译文件列表
 * @param excludeFiles 要排除的文件列表
 * @param encounteredMinorLanguages 已遇到的小语种集合
 * @returns 是否成功处理
 */
function processTsFile(
    tsFile: string, 
    langCode: string,
    processedFiles: Set<string>,
    filesToTranslate: { file: string; langCode: string; isTraditionalChinese?: boolean }[],
    excludeFiles: string[] = [],
    encounteredMinorLanguages: Set<string>
): boolean {
    // 如果文件已经处理过，跳过
    if (processedFiles.has(tsFile)) {
        return false;
    }
    processedFiles.add(tsFile);
    
    // 检查文件是否被排除
    if (isFileExcluded(tsFile, excludeFiles)) {
        console.log(`  - ${tsFile} (文件被排除，跳过处理)`);
        return false;
    }
    
    // 检查是否为繁体中文
    if (['zh_HK', 'zh_TW'].includes(langCode)) {
        filesToTranslate.push({
            file: tsFile,
            langCode,
            isTraditionalChinese: true
        });
        return true;
    }

    // 检查是否为小语种
    if (langCode in MINOR_LANGUAGES) {
        encounteredMinorLanguages.add(langCode);
        return true;
    }

    // 其他语种添加到待翻译列表
    filesToTranslate.push({
        file: tsFile,
        langCode
    });
    return true;
}

/**
 * 处理闭源项目中的所有 ts 文件
 * 
 * @param projectPath 本地项目路径
 * @param excludeFiles 要排除的文件列表（可选）
 * @returns 待翻译文件列表
 */
export async function processClosedSourceProject(projectPath: string, excludeFiles: string[] = []) {
    const filesToTranslate: { file: string; langCode: string; isTraditionalChinese?: boolean }[] = [];
    let totalFilesFound = 0;
    const processedFiles = new Set<string>();
    const encounteredMinorLanguages = new Set<string>();
    
    // 清空简体中文文件路径记录
    zhCNFilePaths.clear();
    
    try {
        // 检查项目路径是否存在
        if (!fs.existsSync(projectPath)) {
            console.error(`项目路径不存在: ${projectPath}`);
            return filesToTranslate;
        }

        // 检查是否为目录
        const stat = fs.statSync(projectPath);
        if (!stat.isDirectory()) {
            console.error(`指定路径不是目录: ${projectPath}`);
            return filesToTranslate;
        }

        console.log(`\n========== 开始处理闭源项目 ==========`);
        console.log(`项目路径: ${projectPath}`);
        console.log(`当前工作目录: ${process.cwd()}`);
        
        if (excludeFiles.length > 0) {
            console.log(`排除文件: ${excludeFiles.join(', ')}`);
        }
        
        // 检查目录内容
        const entries = fs.readdirSync(projectPath);
        console.log(`项目目录内容: ${entries.length} 个项目`);
        
        // 查找所有ts文件
        console.log(`开始查找ts文件...`);
        
        // 首先检查translations目录
        const translationsDir = path.join(projectPath, 'translations');
        let tsFilePaths: string[] = [];
        
        if (fs.existsSync(translationsDir)) {
            console.log(`检测到translations目录，优先从该目录查找ts文件`);
            tsFilePaths = findTsFiles(translationsDir);
            console.log(`在translations目录中找到${tsFilePaths.length}个ts文件`);
        }
        
        // 如果translations目录没有找到或没有ts文件，则继续在整个项目中查找
        if (tsFilePaths.length === 0) {
            console.log(`在translations目录中未找到ts文件，继续在整个项目中查找`);
            tsFilePaths = findTsFiles(projectPath);
            console.log(`在整个项目中找到${tsFilePaths.length}个ts文件`);
        }
        
        if (tsFilePaths.length === 0) {
            console.log(`项目中没有找到任何ts文件`);
            return filesToTranslate;
        }
        
        // 转换为相对路径
        let tsFiles = tsFilePaths.map(file => path.relative(projectPath, file));
        
        console.log(`在项目中找到 ${tsFiles.length} 个有效ts文件`);
        
        // 收集所有可能的前缀，用于调试
        const prefixes = new Set<string>();
        
        // 分析所有文件名模式并记录简体中文文件
        tsFiles.forEach(file => {
            const basename = path.basename(file);
            const langCode = extractLanguageCode(basename);
            const baseName = extractBaseName(basename);
            
            if (langCode && baseName) {
                prefixes.add(baseName);
                
                // 如果是简体中文文件，记录其路径
                if (langCode === 'zh_CN') {
                    const fullPath = path.join(projectPath, file);
                    zhCNFilePaths.set(baseName, fullPath);
                    console.log(`记录简体中文文件: ${baseName} -> ${fullPath}`);
                }
            }
        });
        
        console.log(`检测到的可能前缀: ${Array.from(prefixes).join(', ') || '无'}`);
        
        // 筛选符合条件的ts文件
        const matchingTsFiles: { file: string; langCode: string }[] = [];
        
        for (const file of tsFiles) {
            const basename = path.basename(file);
            const langCode = extractLanguageCode(basename);
            
            if (!langCode) {
                console.log(`  跳过源文件 ${file} - 这是源文件，不是翻译文件`);
                continue;
            }
            
            matchingTsFiles.push({ file, langCode });
        }
        
        console.log(`找到 ${matchingTsFiles.length} 个需要处理的翻译文件`);
        
        // 处理每个匹配的ts文件
        for (const { file: tsFile, langCode } of matchingTsFiles) {
            const fullPath = path.join(projectPath, tsFile);
            
            // 检查文件是否存在未翻译内容
            try {
                if (!fs.existsSync(fullPath)) {
                    continue;
                }
                
                const fileContent = fs.readFileSync(fullPath, 'utf8');
                // 检查文件内容是否包含未翻译标记
                const hasUnfinished = hasUnfinishedTranslations(fileContent);
                
                if (!hasUnfinished) {
                    continue;
                }
            } catch (error) {
                console.error(`读取文件时出错: ${tsFile}`, error);
                continue;
            }
            
            // 处理ts文件
            if (processTsFile(fullPath, langCode, processedFiles, filesToTranslate, excludeFiles, encounteredMinorLanguages)) {
                totalFilesFound++;
            }
        }

        if (totalFilesFound > 0) {
            // 统计需要繁体翻译的文件数量
            const traditionalFilesCount = filesToTranslate.filter(item => 
                ['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese).length;
            
            // 计算小语种文件数量(不需要处理的文件)
            const skipFilesCount = totalFilesFound - filesToTranslate.length;
            
            // 收集各类型的语种
            const aiTranslateLanguages = filesToTranslate
                .filter(item => !(['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese))
                .map(item => item.langCode);
            const traditionalLanguages = filesToTranslate
                .filter(item => ['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese)
                .map(item => item.langCode);
            
            console.log(`\n========== 统计信息 ==========`);
            console.log(`共找到 ${totalFilesFound} 个需要处理的翻译文件，其中：`);
            console.log(`  - ${filesToTranslate.length - traditionalFilesCount} 个需要AI翻译 (${aiTranslateLanguages.join(', ')})`);
            if (traditionalFilesCount > 0) {
                console.log(`  - ${traditionalFilesCount} 个需要繁体中文转换处理 (${traditionalLanguages.join(', ')})`);
            } else {
                console.log(`  - ${traditionalFilesCount} 个需要繁体中文转换处理`);
            }
            if (skipFilesCount > 0) {
                console.log(`  - ${skipFilesCount} 个是小语种文件，跳过不处理 (${Array.from(encounteredMinorLanguages).join(', ')})`);
            } else {
                console.log(`  - ${skipFilesCount} 个是小语种文件，跳过不处理`);
            }
            
            // 输出所有待翻译的文件
            console.log(`\n========== 待翻译文件列表 ==========`);
            filesToTranslate.forEach((item, index) => {
                const type = item.isTraditionalChinese ? "繁体中文" : "AI翻译";
                console.log(`${index+1}. ${item.file} (${item.langCode}) - ${type}`);
            });
        } else {
            console.log('\n没有找到任何需要处理的翻译文件');
        }
    } catch (error) {
        console.error('处理闭源项目时出错:', error);
    }

    return filesToTranslate;
}

/**
 * 翻译闭源项目中的指定ts文件
 * 
 * @param projectPath 本地项目路径
 * @param specificFiles 指定要翻译的文件列表（可选，如果不指定则处理所有文件）
 * @param excludeFiles 要排除的文件列表（可选）
 */
export async function translateClosedSourceProject(
    projectPath: string, 
    specificFiles?: string[], 
    excludeFiles: string[] = []
) {
    console.log(`\n========== 开始翻译闭源项目 ==========`);
    console.log(`项目路径: ${projectPath}`);
    
    // 首先扫描项目获取待翻译文件
    const filesToTranslate = await processClosedSourceProject(projectPath, excludeFiles);
    
    if (filesToTranslate.length === 0) {
        console.log('没有找到需要翻译的文件');
        return;
    }
    
    // 如果指定了特定文件，则只翻译这些文件
    let targetFiles = filesToTranslate;
    if (specificFiles && specificFiles.length > 0) {
        targetFiles = filesToTranslate.filter(item => 
            specificFiles.some(specFile => item.file.includes(specFile))
        );
        console.log(`筛选后需要翻译的文件: ${targetFiles.length} 个`);
    }
    
    console.log(`\n✨ 开始处理 ${targetFiles.length} 个需要翻译的文件`);
    
    // 将文件分为两类：繁体中文和非繁体中文
    const traditionalFiles = targetFiles.filter(item => 
        ['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese);
    const nonTraditionalFiles = targetFiles.filter(item => 
        !(['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese));
    
    // 统计变量
    let successCount = 0;
    let noNeedCount = 0;
    let failCount = 0;
    const failedLanguages = new Set<string>();
    const successLanguages = new Set<string>();
    const noNeedLanguages = new Set<string>();
    
    // 第一步：处理所有非繁体中文文件（包括简体中文和其他语言）
    console.log('\n===== 步骤1：处理非繁体中文文件 =====');
    console.log(`📝 开始串行处理 ${nonTraditionalFiles.length} 个翻译文件...`);
    
    for (let i = 0; i < nonTraditionalFiles.length; i++) {
        const fileInfo = nonTraditionalFiles[i];
        console.log(`\n[${i+1}/${nonTraditionalFiles.length}] 正在翻译: ${fileInfo.file} (${fileInfo.langCode})`);
        
        try {
            const result = await translateTsFile(fileInfo.file, fileInfo.langCode);
            
            if (result.status === 'success') {
                console.log(`  - 翻译成功: ${result.message}`);
                successCount++;
                successLanguages.add(fileInfo.langCode);
                
                // 如果是简体中文文件，记录路径用于后续处理繁体中文
                if (fileInfo.langCode === 'zh_CN') {
                    const baseFileName = path.basename(fileInfo.file).replace(/_zh_CN\.ts$/, '');
                    zhCNFilePaths.set(baseFileName, fileInfo.file);
                }
            } else if (result.status === 'no_need') {
                console.log(`  - 无需翻译: ${result.message}`);
                noNeedCount++;
                noNeedLanguages.add(fileInfo.langCode);
                
                // 即使无需翻译，如果是简体中文文件也要记录路径
                if (fileInfo.langCode === 'zh_CN') {
                    const baseFileName = path.basename(fileInfo.file).replace(/_zh_CN\.ts$/, '');
                    zhCNFilePaths.set(baseFileName, fileInfo.file);
                }
            } else {
                console.log(`  - 翻译失败: ${result.message}`);
                failCount++;
                failedLanguages.add(fileInfo.langCode);
            }
        } catch (error) {
            console.error(`  - 处理文件时出错:`, error);
            failCount++;
            failedLanguages.add(fileInfo.langCode);
        }
    }

    console.log(`\n所有 ${nonTraditionalFiles.length} 个非繁体中文文件处理完成`);
    console.log(`  - 翻译成功: ${successCount} 个`);
    console.log(`  - 无需翻译: ${noNeedCount} 个`);
    console.log(`  - 翻译失败: ${failCount} 个`);
    
    // 第二步：处理繁体中文文件
    console.log('\n===== 步骤2：处理繁体中文文件 =====');
    
    if (traditionalFiles.length === 0) {
        console.log('没有需要处理的繁体中文文件');
    } else {
        console.log(`📝 开始串行处理 ${traditionalFiles.length} 个繁体中文文件...`);
        
        for (let i = 0; i < traditionalFiles.length; i++) {
            const fileInfo = traditionalFiles[i];
            console.log(`\n[${i+1}/${traditionalFiles.length}] 正在处理繁体中文: ${fileInfo.file} (${fileInfo.langCode})`);
            
            try {
                // 查找对应的简体中文文件
                const baseName = extractBaseName(path.basename(fileInfo.file));
                const sourceFilePath = baseName ? zhCNFilePaths.get(baseName) : null;
                
                if (!sourceFilePath) {
                    console.error(`  - 未找到对应的简体中文文件，无法处理: ${fileInfo.file}`);
                    failCount++;
                    failedLanguages.add(fileInfo.langCode);
                    continue;
                }
                
                const result = await processTraditionalChineseFile(
                    fileInfo.file, 
                    fileInfo.langCode, 
                    sourceFilePath
                );
                
                if (result.status === 'success') {
                    console.log(`  - 繁体中文转换成功: ${result.message}`);
                    successCount++;
                    successLanguages.add(fileInfo.langCode);
                } else if (result.status === 'no_need') {
                    console.log(`  - 无需转换: ${result.message}`);
                    noNeedCount++;
                    noNeedLanguages.add(fileInfo.langCode);
                } else {
                    console.log(`  - 繁体中文转换失败: ${result.message}`);
                    failCount++;
                    failedLanguages.add(fileInfo.langCode);
                }
            } catch (error) {
                console.error(`  - 处理繁体中文文件时出错:`, error);
                failCount++;
                failedLanguages.add(fileInfo.langCode);
            }
        }
    }
    
    // 最终统计
    console.log(`\n========== 翻译完成 ==========`);
    console.log(`总计: ${targetFiles.length} 个文件`);
    console.log(`成功: ${successCount} 个`);
    console.log(`无需翻译: ${noNeedCount} 个`);
    console.log(`失败: ${failCount} 个`);
    
    // 详细语种统计
    if (successLanguages.size > 0) {
        console.log(`\n✅ 翻译成功的语种: ${Array.from(successLanguages).sort().join(', ')}`);
    }
    
    if (noNeedLanguages.size > 0) {
        console.log(`\n⏭️  无需翻译的语种: ${Array.from(noNeedLanguages).sort().join(', ')}`);
    }
    
    if (failedLanguages.size > 0) {
        console.log(`\n❌ 翻译失败的语种: ${Array.from(failedLanguages).sort().join(', ')}`);
    }
    
    // console.log(`\n注意: 闭源项目翻译完成后不会自动提交到版本控制或Transifex平台`);
}

// 如果直接运行此文件，则作为命令行工具使用
if ((import.meta as any)?.main || require.main === module) {
    async function main() {
        // 从命令行参数获取项目路径
        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            console.error('请提供项目路径作为命令行参数');
            console.error('');
            console.error('使用方法:');
            console.error('  bun closed-source.ts /path/to/your/project');
            console.error('  bun closed-source.ts /path/to/your/project file1.ts file2.ts');
            console.error('  bun closed-source.ts /path/to/your/project --exclude file1.ts --exclude file2.ts');
            console.error('  bun closed-source.ts /path/to/your/project file1.ts --exclude skip1.ts');
            console.error('');
            console.error('参数说明:');
            console.error('  第一个参数: 项目路径（必需）');
            console.error('  其他参数: 指定要翻译的文件名（可选）');
            console.error('  --exclude: 指定要排除的文件名（可选，可多次使用）');
            process.exit(1);
        }
        
        const projectPath = args[0];
        const excludeFiles: string[] = [];
        const specificFiles: string[] = [];
        
        // 解析命令行参数
        let i = 1;
        while (i < args.length) {
            if (args[i] === '--exclude') {
                if (i + 1 < args.length) {
                    excludeFiles.push(args[i + 1]);
                    i += 2;
                } else {
                    console.error('--exclude 参数需要提供文件名');
                    process.exit(1);
                }
            } else {
                specificFiles.push(args[i]);
                i++;
            }
        }
        
        console.log(`开始处理闭源项目: ${projectPath}`);
        
        if (specificFiles.length > 0) {
            console.log(`指定翻译文件: ${specificFiles.join(', ')}`);
        }
        
        if (excludeFiles.length > 0) {
            console.log(`排除文件: ${excludeFiles.join(', ')}`);
        }
        
        try {
            // 执行翻译
            await translateClosedSourceProject(
                projectPath, 
                specificFiles.length > 0 ? specificFiles : undefined,
                excludeFiles
            );
            console.log('\n✅ 翻译完成');
        } catch (error) {
            console.error('\n❌ 翻译过程中出错:', error);
            process.exit(1);
        }
    }
    
    // 执行主函数
    main().catch(console.error);
} 