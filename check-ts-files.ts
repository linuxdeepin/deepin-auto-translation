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
 */
function processTsFile(
    tsFile: string, 
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
    
    // 从文件名中提取语种代码，支持带路径的文件名
    const match = tsFile.match(/[^/]+_([a-z]{2}(?:_[A-Z]{2})?).ts$/);
    if (!match) {
        console.log(`  - ${tsFile} (不符合命名规范，跳过)`);
        return false;
    }
    
    const langCode = match[1];

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
            
        console.log(`从脚本根目录的language.yml中读取到${languageCodes.length}种语言`);
        
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

            console.log(`检查仓库 ${repository}`);
            
            // 从Transifex同步翻译文件
            syncTranslationsFromTransifex(repository, repoPath);
            
            // 查找所有ts文件
            let tsFiles: string[] = [];
            try {
                // 使用命令行工具查找所有ts文件
                const findCommand = `find ${repoPath} -name "*.ts" -type f | grep -v "node_modules" | grep -v ".git"`;
                const output = execSync(findCommand, { encoding: 'utf8' });
                
                if (output.trim()) {
                    tsFiles = output.trim().split('\n').map(file => {
                        // 转换为相对于仓库的路径
                        const relativePath = file.replace(`${repoPath}/`, '');
                        return relativePath;
                    });
                }
            } catch (error) {
                console.error(`在仓库 ${repository} 中查找ts文件时出错:`, error);
                continue;
            }
            
            if (tsFiles.length === 0) {
                console.log(`仓库 ${repository} 中没有找到ts文件`);
                continue;
            }
            
            console.log(`在仓库 ${repository} 中找到 ${tsFiles.length} 个ts文件`);
            
            // 筛选符合条件的ts文件
            const matchingTsFiles = tsFiles.filter(file => {
                const match = file.match(/_([a-z]{2}(?:_[A-Z]{2})?).ts$/);
                if (!match) return false;
                
                const langCode = match[1];
                return languageCodes.includes(langCode);
            });
            
            console.log(`其中 ${matchingTsFiles.length} 个文件匹配language.yml中的语言`);
            
            // 处理每个匹配的ts文件
            for (const tsFile of matchingTsFiles) {
                const fullPath = path.join(repoPath, tsFile);
                
                // 检查文件是否存在未翻译内容
                try {
                    const fileContent = fs.readFileSync(fullPath, 'utf8');
                    const needsTranslation = hasUnfinishedTranslations(fileContent);
                    
                    if (!needsTranslation) {
                        console.log(`  - ${tsFile} (没有未翻译内容，跳过)`);
                        continue;
                    }
                } catch (error) {
                    console.error(`读取文件 ${fullPath} 时出错:`, error);
                    continue;
                }
                
                // 处理ts文件
                if (processTsFile(tsFile, resource, repoPath, processedFiles, filesToTranslate)) {
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
            
            console.log(`\n共找到 ${totalFilesFound} 个需要处理的翻译文件，其中：`);
            console.log(`  - ${filesToTranslate.length - traditionalFilesCount} 个需要AI翻译`);
            console.log(`  - ${traditionalFilesCount} 个需要繁体中文转换处理`);
            console.log(`  - ${skipFilesCount} 个是小语种文件，跳过不处理`);
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