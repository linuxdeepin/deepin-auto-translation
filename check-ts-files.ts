// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'fs';
import * as YAML from 'js-yaml';
import { execSync } from 'child_process';
import * as Transifex from './transifex';
import { createTsFileFromTemplate } from './qtlinguist';
import path from 'path';

// 定义小语种列表
const MINOR_LANGUAGES = {
    'es': '西班牙语',
    'it': '意大利语',
    'de': '德语',
    'de_DE': '德语',
    'ja': '日语',
    'uk': '乌克兰语',
    'pt_BR': '巴西葡萄牙语',
    'sq': '阿尔巴尼亚语'
};

/**
 * 从 YAML 文件加载所有项目资源
 */
async function loadAllResources() {
    return await Transifex.getAllLinkedResourcesFromProjects(
        YAML.load(fs.readFileSync('./transifex-projects.yml', 'utf8')) as string[]
    );
}

/**
 * 从 Transifex 同步翻译文件
 * 
 * 功能说明：
 * 1. 检查仓库中是否有.tx/config文件
 * 2. 如果存在.tx/config文件，则使用transifex-cli拉取所有翻译
 * 3. 如果仓库没有.tx/config文件，则输出日志提示
 */
function syncTranslationsFromTransifex(repository: string, repoPath: string) {
    console.log(`正在从Transifex平台同步${repository}仓库的翻译文件...`);
    try {
        // 检查仓库中是否有.tx/config文件
        const txConfigPath = `${repoPath}/.tx/config`;
        
        // tx pull命令只支持使用.tx/config配置文件
        if (fs.existsSync(txConfigPath)) {
            // 使用transifex-cli拉取所有翻译
            console.log(`使用tx命令从Transifex拉取${repository}的翻译文件...`);
            Transifex.downloadTranslationFilesViaCli(repoPath);
            console.log(`成功从Transifex同步${repository}的翻译文件`);
        } else {
            console.log(`仓库${repository}没有.tx/config配置文件，无法从Transifex同步翻译`);
        }
    } catch (error) {
        console.error(`从Transifex同步${repository}翻译文件时出错:`, error);
        console.log(`请在实际启用此脚本前人工检查${repository}仓库的.tx/config配置是否正确`);
    }
}

/**
 * 处理ts文件，根据语种类型添加到对应列表
 * 
 * @param tsFile 翻译文件路径
 * @param langCode 已提取的语言代码
 * @param resource Transifex资源
 * @param repoPath 仓库路径
 * @param processedFiles 已处理文件集合
 * @param filesToTranslate 待翻译文件列表
 * @returns 是否成功处理
 */
function processTsFile(
    tsFile: string, 
    langCode: string,
    resource: any, 
    repoPath: string, 
    processedFiles: Set<string>,
    filesToTranslate: { file: string; langCode: string; resource: any; repoPath: string; isTraditionalChinese?: boolean }[]
): boolean {
    // 如果文件已经处理过，跳过
    if (processedFiles.has(tsFile)) {
        return false;
    }
    processedFiles.add(tsFile);
    
    // 检查是否为繁体中文
    if (['zh_HK', 'zh_TW'].includes(langCode)) {
        console.log(`  - ${tsFile} (当前文件为简繁体转换文件，采用规则库匹配方式处理)`);
        filesToTranslate.push({
            file: tsFile,
            langCode,
            resource,
            repoPath,
            isTraditionalChinese: true
        });
        return true;
    }

    // 检查是否为小语种
    if (langCode in MINOR_LANGUAGES) {
        console.log(`  - ${tsFile} (${MINOR_LANGUAGES[langCode]}小语种，跳过不由脚本处理)`);
        return true;
    }

    // 其他语种添加到待翻译列表
    console.log(`  - ${tsFile} (需要基于AI大模型进行翻译)`);
    filesToTranslate.push({
        file: tsFile,
        langCode,
        resource,
        repoPath
    });
    return true;
}

/**
 * 检查文件内容是否包含未翻译内容
 */
function hasUnfinishedTranslations(fileContent: string): boolean {
    return fileContent.includes('<translation type="unfinished"/>') || 
           fileContent.includes('<translation type="unfinished"></translation>') ||
           fileContent.includes('<translation type="unfinished">') ||
           fileContent.match(/<translation(\s+type="unfinished"[^>]*)\s*\/>/g) !== null;
}

/**
 * 安全执行shell命令，处理可能的错误
 * @param command 要执行的命令
 * @param defaultValue 命令失败时返回的默认值
 * @returns 命令的输出或默认值
 */
function safeExecSync(command: string, defaultValue: string = ""): string {
    try {
        return execSync(command, { encoding: 'utf8' });
    } catch (error) {
        // 检查是否仅仅是find命令没有找到匹配项
        console.log(`执行命令 "${command}" 时出现错误，返回默认值`);
        return defaultValue;
    }
}

/**
 * 从文件名中提取语言代码
 * 支持多种命名格式，如：
 * - project_zh_CN.ts
 * - translation_zh_CN.ts
 * - 任何前缀_zh_CN.ts
 * 
 * @param filename 文件名
 * @returns 语言代码或null（如果不匹配）
 */
function extractLanguageCode(filename: string): string | null {
    // 使用更通用的正则表达式匹配任何前缀后跟下划线和语言代码的模式
    const match = filename.match(/.*_([a-z]{2}(?:_[A-Z]{2})?)\.ts$/);
    if (!match) return null;
    return match[1];
}

/**
 * 处理所有仓库中的 ts 文件，不依赖git检测
 * 
 * 功能说明：
 * 1. 从 transifex-projects.yml 文件中读取所有项目信息
 * 2. 遍历每个项目，检查其本地仓库是否存在
 * 3. 对每个存在的仓库，从Transifex同步最新翻译
 * 4. 根据脚本根目录的language.yml中的语种列表，查找对应的ts文件
 * 5. 对每个找到的ts文件判断并分类：
 *    - 如果是繁体中文(zh_HK, zh_TW)，标记为需要规则库匹配处理
 *    - 如果是小语种(es, it, de等)，显示语种信息并跳过
 *    - 其他语种则返回给调用者处理，用于AI大模型翻译
 */
export async function processAllTsFiles() {
    const filesToTranslate: { file: string; langCode: string; resource: any; repoPath: string; isTraditionalChinese?: boolean }[] = [];
    let totalFilesFound = 0;
    const processedFiles = new Set<string>(); // 用于跟踪已处理的文件
    
    try {
        // 读取脚本根目录下的language.yml文件获取语种列表
        const languageYmlPath = './language.yml';
        if (!fs.existsSync(languageYmlPath)) {
            console.log(`脚本根目录不存在language.yml文件，退出检查`);
            return filesToTranslate;
        }
        
        const languageCodes = fs.readFileSync(languageYmlPath, 'utf8')
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => line.trim());
            
        console.log(`从脚本根目录的language.yml中读取到${languageCodes.length}种语言: ${languageCodes.join(', ')}`);
        
        // 从 YAML 文件中读取所有项目信息
        const allResources = await loadAllResources();

        console.log(`从transifex-projects.yml中读取到${allResources.length}个项目`);

        // 遍历每个项目
        for (const resource of allResources) {
            const { repository } = resource;
            const repoPath = `repo/${repository}`;

            // 检查仓库是否存在
            if (!fs.existsSync(repoPath)) {
                console.log(`仓库 ${repository} 不存在，跳过检查`);
                continue;
            }

            console.log(`\n========== 开始检查仓库 ${repository} ==========`);
            console.log(`仓库路径: ${repoPath}`);
            console.log(`检查目录是否存在: ${fs.existsSync(repoPath)}`);
            
            // 检查目录内容
            const lsOutput = safeExecSync(`ls -la ${repoPath}`, "目录为空或无法访问");
            console.log(`目录内容列表:\n${lsOutput}`);
            
            // 从Transifex同步翻译文件
            syncTranslationsFromTransifex(repository, repoPath);
            
            // 查找所有ts文件 - 分步骤执行以便更好地调试
            console.log(`开始查找ts文件...`);
            
            // 步骤1: 只用find找ts文件，不用grep过滤
            const findCmd = `find ${repoPath} -name "*.ts" -type f`;
            console.log(`执行命令: ${findCmd}`);
            const allTsFiles = safeExecSync(findCmd, "");
            
            if (!allTsFiles.trim()) {
                console.log(`仓库 ${repository} 中没有找到任何ts文件`);
                continue;
            }
            
            // 步骤2: 在JavaScript中过滤掉node_modules和.git目录中的文件
            let tsFiles = allTsFiles.trim().split('\n')
                .filter(file => !file.includes('node_modules') && !file.includes('.git'))
                .map(file => file.replace(`${repoPath}/`, ''));
            
            console.log(`在仓库 ${repository} 中找到 ${tsFiles.length} 个有效ts文件（排除node_modules和.git目录）`);
            
            // 收集所有可能的前缀，用于调试
            const prefixes = new Set<string>();
            
            // 分析所有文件名模式
            tsFiles.forEach(file => {
                const basename = path.basename(file);
                const match = basename.match(/(.+)_[a-z]{2}(?:_[A-Z]{2})?\.ts$/);
                if (match) {
                    prefixes.add(match[1]);
                }
            });
            
            console.log(`检测到的可能前缀: ${Array.from(prefixes).join(', ') || '无'}`);
            
            // 筛选符合条件的ts文件 - 使用更通用的匹配模式，适应不同的前缀命名
            const matchingTsFiles: { file: string; langCode: string }[] = [];
            
            for (const file of tsFiles) {
                const basename = path.basename(file);
                const langCode = extractLanguageCode(basename);
                
                if (!langCode) {
                    console.log(`  跳过文件 ${file} - 不符合命名格式要求`);
                    continue;
                }
                
                if (!languageCodes.includes(langCode)) {
                    console.log(`  跳过文件 ${file} - 语言代码 ${langCode} 不在language.yml中`);
                    continue;
                }
                
                matchingTsFiles.push({ file, langCode });
            }
            
            console.log(`找到 ${matchingTsFiles.length} 个匹配language.yml中语言的文件`);
            
            // 处理每个匹配的ts文件
            for (const { file: tsFile, langCode } of matchingTsFiles) {
                const fullPath = path.join(repoPath, tsFile);
                console.log(`\n处理文件: ${tsFile} (语言: ${langCode})`);
                
                // 检查文件是否存在未翻译内容
                try {
                    if (!fs.existsSync(fullPath)) {
                        console.log(`  - 文件不存在，跳过`);
                        continue;
                    }
                    
                    const fileContent = fs.readFileSync(fullPath, 'utf8');
                    // 检查文件内容是否包含未翻译标记
                    const hasUnfinished = hasUnfinishedTranslations(fileContent);
                    
                    if (!hasUnfinished) {
                        console.log(`  - 没有未翻译内容，跳过`);
                        continue;
                    }
                    
                    console.log(`  - 检测到未翻译内容，开始处理`);
                } catch (error) {
                    console.error(`  - 读取文件时出错:`, error);
                    continue;
                }
                
                // 处理ts文件
                if (processTsFile(tsFile, langCode, resource, repoPath, processedFiles, filesToTranslate)) {
                    totalFilesFound++;
                }
            }
        }

        if (totalFilesFound > 0) {
            // 统计需要繁体翻译的文件数量
            const traditionalFilesCount = filesToTranslate.filter(item => 
                ['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese).length;
            
            // 计算小语种文件数量(不需要处理的文件)
            const skipFilesCount = totalFilesFound - filesToTranslate.length;
            
            console.log(`\n========== 统计信息 ==========`);
            console.log(`共找到 ${totalFilesFound} 个需要处理的翻译文件，其中：`);
            console.log(`  - ${filesToTranslate.length - traditionalFilesCount} 个需要AI翻译`);
            console.log(`  - ${traditionalFilesCount} 个需要繁体中文转换处理`);
            console.log(`  - ${skipFilesCount} 个是小语种文件，跳过不处理`);
            
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
        console.error('检查过程中出错:', error);
    }

    return filesToTranslate;
} 

// 保留以下函数用于兼容性，但不会在新的流程中使用
export async function checkTsFilesInGitLog() {
    console.log('checkTsFilesInGitLog函数已弃用，请使用processAllTsFiles');
    return await processAllTsFiles();
}

export async function checkEnTsFilesWithTransfix() {
    console.log('checkEnTsFilesWithTransfix函数已弃用，请使用processAllTsFiles');
    return { 
        filesToTranslate: await processAllTsFiles(), 
        foundTransfixCommit: true, 
        totalFilesFound: 0 
    };
} 