// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import * as YAML from 'js-yaml';
import { execSync } from 'node:child_process';
import * as Transifex from './transifex';

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
        const allResources = await Transifex.getAllLinkedResourcesFromProjects(
            YAML.load(fs.readFileSync('./transifex-projects.yml', 'utf8')) as string[]
        );

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
                    
                    for (const tsFile of tsFiles) {
                        // 如果文件已经处理过，跳过
                        if (processedFiles.has(tsFile)) {
                            continue;
                        }
                        processedFiles.add(tsFile);
                        totalFilesFound++;
                        
                        // 从文件名中提取语种代码，支持带路径的文件名
                        const match = tsFile.match(/[^/]+_([a-z]{2}(?:_[A-Z]{2})?).ts$/);
                        if (!match) {
                            console.log(`  - ${tsFile} (不符合命名规范，跳过)`);
                            continue;
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
                            continue;
                        }

                        // 检查是否为小语种
                        if (langCode in MINOR_LANGUAGES) {
                            console.log(`  - ${tsFile} (${MINOR_LANGUAGES[langCode]}小语种，跳过不由脚本处理)`);
                            continue;
                        }

                        // 其他语种添加到待翻译列表
                        console.log(`  - ${tsFile} (需要基于AI大模型进行翻译)`);
                        filesToTranslate.push({
                            file: tsFile,
                            langCode,
                            resource,
                            repoPath
                        });
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