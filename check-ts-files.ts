// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'fs';
import * as YAML from 'js-yaml';
import { execSync } from 'child_process';
import * as Transifex from './transifex';
import { createTsFileFromTemplate } from './qtlinguist';

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
 * 检查所有仓库最新提交中是否包含 TypeScript 文件
 * 
 * 功能说明：
 * 1. 从 transifex-projects.yml 文件中读取所有项目信息
 * 2. 遍历每个项目，检查其本地仓库是否存在
 * 3. 对每个存在的仓库，检查其最新提交中是否包含 .ts 文件
 * 4. 对每个找到的 ts 文件进行分析：
 *    - 如果是繁体中文(zh_HK, zh_TW)，标记为 A 类
 *    - 如果是小语种(es, it, de等)，显示语种信息并跳过
 *    - 其他语种则返回给调用者处理
 * 
 * 注意事项：
 * 1. 需要确保 transifex-projects.yml 文件存在且格式正确
 * 2. 需要确保所有仓库都已克隆到 repo/ 目录下
 * 3. 需要确保有权限访问这些仓库
 * 4. 需要确保系统已安装 git 命令
 * 5. 目前的逻辑只对"最新一次 commit 中的 ts 文件"生效。
 */
export async function checkTsFilesInGitLog() {
    const filesToTranslate: { file: string; langCode: string; resource: any; repoPath: string; isTraditionalChinese?: boolean }[] = [];
    let totalFilesFound = 0;
    const processedFiles = new Set<string>(); // 用于跟踪已处理的文件
    
    try {
        // 从 YAML 文件中读取所有项目信息
        const allResources = await loadAllResources();

        // 遍历每个项目
        for (const resource of allResources) {
            const { repository } = resource;
            const repoPath = `repo/${repository}`;

            // 检查仓库是否存在
            if (!fs.existsSync(repoPath)) {
                console.log(`仓库 ${repository} 不存在，跳过检查`);
                continue;
            }

            // 使用 git log 命令检查最新提交中的 ts 文件
            const command = `cd ${repoPath} && git log -1 --name-only --pretty=format: | grep -E "\\.ts$"`;
            try {
                const output = execSync(command, { encoding: 'utf8' });
                
                if (output.trim()) {
                    const tsFiles = output.trim().split('\n');
                    
                    // 如果找到ts文件，先从Transifex同步翻译
                    syncTranslationsFromTransifex(repository, repoPath);
                    
                    for (const tsFile of tsFiles) {
                        if (processTsFile(tsFile, resource, repoPath, processedFiles, filesToTranslate)) {
                            totalFilesFound++;
                        }
                    }
                }
            } catch (error) {
                if ((error as any).status === 1) {
                    // git grep 没有找到匹配项，这是正常情况
                    continue;
                } else {
                    console.error(`检查仓库 ${repository} 时出错:`, error);
                }
            }
        }

        if (totalFilesFound > 0) {
            console.log(`\n共找到 ${totalFilesFound} 个 ts 文件，其中 ${filesToTranslate.length} 个需要翻译`);
        } else {
            console.log('\n没有找到任何 ts 文件');
        }
    } catch (error) {
        console.error('检查过程中出错:', error);
    }

    return filesToTranslate;
} 

/**
 * 检查所有仓库最新提交中是否包含 _en.ts 文件，且提交标题包含"transfix"
 * 
 * 功能说明：
 * 1. 从 transifex-projects.yml 文件中读取所有项目信息
 * 2. 遍历每个项目，检查其本地仓库是否存在
 * 3. 对每个存在的仓库，检查其最新提交中是否包含 _en.ts 文件，且提交标题包含"transfix"
 * 4.  同时，从Transifex平台拉取最新的翻译更新，以确保GitHub和Transifex保持同步
 * 5. 如果找到符合条件的提交，根据脚本根目录的language.yml中的语种列表，在translations目录下查找对应的ts文件
 * 6. 对每个找到的ts文件判断：若语种不在language.yml中，则输出日志跳过；若在language.yml中，则进行后续处理：
 *    - 如果是繁体中文(zh_HK, zh_TW)，标记为需要规则库匹配处理
 *    - 如果是小语种(es, it, de等)，显示语种信息并跳过
 *    - 其他语种则返回给调用者处理，用于AI大模型翻译
 * 7. 如果language.yml中有新增的语言代码但还没有对应的ts文件，则自动基于英文文件创建新的ts文件
 */
export async function checkEnTsFilesWithTransfix() {
    const filesToTranslate: { file: string; langCode: string; resource: any; repoPath: string; isTraditionalChinese?: boolean }[] = [];
    let totalFilesFound = 0;
    const processedFiles = new Set<string>(); // 用于跟踪已处理的文件
    let foundTransfixCommit = false; // 标记是否找到包含"transfix"的提交
    
    try {
        // 读取脚本根目录下的language.yml文件获取语种列表
        const languageYmlPath = './language.yml';
        if (!fs.existsSync(languageYmlPath)) {
            console.log(`脚本根目录不存在language.yml文件，退出检查`);
            return { filesToTranslate, foundTransfixCommit, totalFilesFound };
        }
        
        const languageCodes = fs.readFileSync(languageYmlPath, 'utf8')
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => line.trim()); // 修复：移除每行可能存在的空格
            
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

            // 首先检查最新提交是否包含"transfix"
            try {
                let commitTitle;
                try {
                    commitTitle = execSync(`cd ${repoPath} && git log -1 --pretty=format:"%s"`, { encoding: 'utf8' });
                } catch (error) {
                    console.error(`获取仓库 ${repository} 提交信息时出错:`, error);
                    continue;
                }
                
                if (!commitTitle.toLowerCase().includes('transfix')) {
                    console.log(`仓库 ${repository} 的最新提交不包含"transfix"，跳过检查`);
                    continue;
                }
                
                foundTransfixCommit = true; // 找到包含"transfix"的提交
                console.log(`仓库 ${repository} 的最新提交包含"transfix"，标题: ${commitTitle}`);
                
                // 检查最新提交中是否包含 _en.ts 或 _en_US.ts 文件
                let enTsFiles;
                try {
                    enTsFiles = execSync(
                        `cd ${repoPath} && git log -1 --name-only --pretty=format: | grep -E "_(en|en_US)\\.ts$"`, 
                        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
                    ).toString().trim();
                } catch (error) {
                    if ((error as any).status === 1) {
                        // grep 没有找到匹配项，这是正常情况
                        console.log(`仓库 ${repository} 的最新提交不包含_en.ts或_en_US.ts文件，跳过检查`);
                        continue;
                    } else {
                        console.error(`检查仓库 ${repository} 的英文翻译文件时出错:`, error);
                        continue;
                    }
                }
                
                if (!enTsFiles) {
                    console.log(`仓库 ${repository} 的最新提交不包含_en.ts或_en_US.ts文件，跳过检查`);
                    continue;
                }
                
                foundTransfixCommit = true; // 找到包含"transfix"的提交且包含_en.ts文件
                const enFiles = enTsFiles.split('\n');
                console.log(`找到 ${enFiles.length} 个_en.ts文件`);
                
                // 在确认有符合条件的提交后，从Transifex平台同步更新翻译文件
                syncTranslationsFromTransifex(repository, repoPath);
                
                // 打印所有language.yml中的语言代码，方便调试
                console.log(`语言代码列表: [${languageCodes.join(', ')}]`);
                
                // 对每个找到的_en.ts文件，查找translations目录下的对应翻译文件
                for (const enFile of enFiles) {
                    // 提取基本文件名和目录
                    const isEnUS = enFile.includes('_en_US.ts');
                    const baseName = isEnUS ? enFile.replace('_en_US.ts', '') : enFile.replace('_en.ts', '');
                    const baseDir = enFile.includes('/') ? enFile.substring(0, enFile.lastIndexOf('/') + 1) : '';
                    
                    // 记录当前处理的英文文件类型
                    const enFileType = isEnUS ? '_en_US.ts' : '_en.ts';
                    console.log(`处理${enFileType}文件: ${enFile}`);
                    
                    // 检查英文文件所在的目录结构，判断translations在哪里
                    let translationsDir;
                    
                    // 如果英文文件路径中已包含translations，使用相同的目录结构
                    if (enFile.includes('/translations/')) {
                        // 如果英文文件在translations目录中，直接使用该目录
                        translationsDir = `${repoPath}/${baseDir}`;
                    } else {
                        // 否则检查translations子目录
                        translationsDir = `${repoPath}/${baseDir}translations`;
                        
                        // 如果translations子目录不存在，尝试查找英文文件所在目录
                        if (!fs.existsSync(translationsDir)) {
                            translationsDir = `${repoPath}/${baseDir}`;
                        }
                    }
                    
                    console.log(`查找翻译文件的目录: ${translationsDir}`);
                    
                    // 根据language.yml中的语种列表查找对应的翻译文件
                    for (const langCode of languageCodes) {
                        if (langCode === 'en' || langCode === 'en_US') continue; // 跳过英文
                        
                        // 根据英文文件的路径模式构建翻译文件路径
                        const langFileName = isEnUS ? 
                            enFile.replace('_en_US.ts', `_${langCode}.ts`) : 
                            enFile.replace('_en.ts', `_${langCode}.ts`);
                        const fullPath = `${repoPath}/${langFileName}`;
                        
                        // 尝试直接查找文件，如果文件不存在也尝试移除语言代码中可能的空格
                        let fileExists = fs.existsSync(fullPath);
                        let actualLangCode = langCode;
                        let actualFullPath = fullPath;
                        
                        // 如果文件不存在，尝试检查是否是因为语言代码中有空格导致的
                        if (!fileExists && langCode.includes(' ')) {
                            const cleanLangCode = langCode.replace(/\s+/g, '');
                            const cleanPath = enFile.replace('_en.ts', `_${cleanLangCode}.ts`);
                            const cleanFullPath = `${repoPath}/${cleanPath}`;
                            
                            if (fs.existsSync(cleanFullPath)) {
                                console.log(`  - 语言代码 "${langCode}" 包含空格，找到清理后的文件: ${cleanFullPath}`);
                                fileExists = true;
                                actualLangCode = cleanLangCode;
                                actualFullPath = cleanFullPath;
                            }
                        }
                        
                        // 如果文件不存在，需要基于英文文件创建新的ts文件
                        if (!fileExists) {
                            console.log(`  - 未找到语种 ${langCode} 的翻译文件，正在基于英文文件创建...`);
                            
                            // 英文模板文件的完整路径
                            const enFullPath = `${repoPath}/${enFile}`;
                            console.log(`  - 使用模板文件: ${enFile} (${isEnUS ? 'en_US' : 'en'})`);
                            
                            // 创建新的ts文件
                            const newFilePath = createTsFileFromTemplate(actualLangCode, enFullPath);
                            
                            if (newFilePath) {
                                console.log(`  - 成功创建新的翻译文件: ${newFilePath}`);
                                fileExists = true;
                                actualFullPath = newFilePath;
                                
                                // 添加到待翻译列表，新创建的文件必然需要翻译
                                totalFilesFound++;
                                
                                // 检查是否为繁体中文
                                if (['zh_HK', 'zh_TW'].includes(actualLangCode)) {
                                    console.log(`  - ${langFileName} (当前文件为简繁体转换文件，采用规则库匹配方式处理)`);
                                    filesToTranslate.push({
                                        file: langFileName,
                                        langCode: actualLangCode,
                                        resource,
                                        repoPath,
                                        isTraditionalChinese: true
                                    });
                                    continue;
                                }

                                // 检查是否为小语种
                                if (actualLangCode in MINOR_LANGUAGES) {
                                    console.log(`  - ${langFileName} (${MINOR_LANGUAGES[actualLangCode]}小语种，跳过不由脚本处理)`);
                                    continue;
                                }

                                // 其他语种添加到待翻译列表
                                console.log(`  - ${langFileName} (新创建文件，需要基于AI大模型进行翻译)`);
                                filesToTranslate.push({
                                    file: langFileName,
                                    langCode: actualLangCode,
                                    resource,
                                    repoPath
                                });
                                continue;
                            } else {
                                console.error(`  - 创建语种 ${langCode} 的翻译文件失败`);
                            }
                        }
                        
                        // 检查文件是否存在
                        if (fileExists) {
                            // 检查是否包含未翻译内容
                            const fileContent = fs.readFileSync(actualFullPath, 'utf8');
                            const unfinishedTranslations = hasUnfinishedTranslations(fileContent);
                            
                            if (!unfinishedTranslations) {
                                console.log(`  - ${langFileName} (没有未翻译内容，跳过)`);
                                continue;
                            }
                            
                            totalFilesFound++;
                            
                            // 如果文件已经处理过，跳过
                            if (processedFiles.has(langFileName)) {
                                continue;
                            }
                            processedFiles.add(langFileName);
                            
                            // 检查是否为繁体中文
                            if (['zh_HK', 'zh_TW'].includes(actualLangCode.trim())) {
                                console.log(`  - ${langFileName} (当前文件为简繁体转换文件，采用规则库匹配方式处理)`);
                                filesToTranslate.push({
                                    file: langFileName,
                                    langCode: actualLangCode.trim(),
                                    resource,
                                    repoPath,
                                    isTraditionalChinese: true
                                });
                                continue;
                            }

                            // 检查是否为小语种
                            if (actualLangCode.trim() in MINOR_LANGUAGES) {
                                console.log(`  - ${langFileName} (${MINOR_LANGUAGES[actualLangCode.trim()]}小语种，跳过不由脚本处理)`);
                                continue;
                            }

                            // 其他语种添加到待翻译列表
                            console.log(`  - ${langFileName} (需要基于AI大模型进行翻译)`);
                            filesToTranslate.push({
                                file: langFileName,
                                langCode: actualLangCode.trim(),
                                resource,
                                repoPath
                            });
                        } else {
                            console.log(`  - 未找到语种 ${actualLangCode} 的翻译文件: ${actualFullPath}`);
                        }
                    }
                }
            } catch (error) {
                if ((error as any).status === 1) {
                    // git grep 没有找到匹配项，这是正常情况
                    console.log(`仓库 ${repository} 没有找到符合条件的文件`);
                    continue;
                } else {
                    console.error(`检查仓库 ${repository} 时出错:`, error);
                }
            }
        }

        if (totalFilesFound > 0) {
            // 统计需要繁体翻译的文件数量
            const traditionalFilesCount = filesToTranslate.filter(item => 
                ['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese).length;
            
            // 计算小语种文件数量(不需要处理的文件)
            const skipFilesCount = totalFilesFound - filesToTranslate.length - traditionalFilesCount;
            
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

    // 返回包含两个元素的数组：需要翻译的文件列表和是否找到了包含"transfix"的提交
    return { filesToTranslate, foundTransfixCommit, totalFilesFound };
} 