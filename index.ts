// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import * as YAML from 'js-yaml';
import * as QtLinguist from './qtlinguist';
import * as OpenAI from './openai';
import * as Ollama from './ollama';
import * as Transifex from './transifex';
import * as GitRepo from './gitrepo';
import * as Doubao from './doubao';
import { MessageData, TransifexRepo, TransifexResource } from './types';
import { exit } from 'node:process';
import * as Translator from './translator';
import { processAllTsFiles } from './check-ts-files';
import path from 'path';

// 选择翻译服务
const TRANSLATION_SERVICE = {
    DOUBAO: Doubao.fetchTranslations,
    OPENAI: OpenAI.fetchTranslations,
//   OLLAMA: Ollama.fetchTranslations 这个还没验证过，暂时不使用
};

// 在这里选择要使用的翻译服务，同理管理使用的模型接口
const selectedTranslationService = TRANSLATION_SERVICE.OPENAI;

/*
 需要获取所有项目名后，再挑选需要的项目
 const transifexProjects = await Transifex.getAllProjects('o:linuxdeepin');
 // 过滤掉指定的项目
 const filteredProjects = transifexProjects.filter(project => 
   !['o:linuxdeepin:p:linyaps', 'o:linuxdeepin:p:other-products', 'o:linuxdeepin:p:scan-assistant'].includes(project)
 );
 fs.writeFileSync('./transifex-projects.yml', YAML.dump(filteredProjects));
*/
// 获取所有项目名
console.log('测试。。。。。。。。。开始获取 Transifex 项目列表...');
const transifexProjects = await Transifex.getAllProjects('o:peeweep-test');
console.log(`成功获取 ${transifexProjects.length} 个项目`);
fs.writeFileSync('./transifex-projects.yml', YAML.dump(transifexProjects));

console.log('开始获取项目关联资源...');
const allResources = await Transifex.getAllLinkedResourcesFromProjects(YAML.load(fs.readFileSync('./transifex-projects.yml', 'utf8')) as string[]);
console.log(`成功获取 ${allResources.length} 个资源`);

console.log('开始克隆/更新本地仓库...');
GitRepo.ensureLocalReposExist(allResources);
console.log('本地仓库准备完成');


// 记录简体中文文件路径，用于后续处理繁体中文
const zhCNFilePaths = new Map<string, string>();

// 直接调用Translator进行翻译，跳过Transifex上传操作
async function translateTsFile(filePath: string, langCode: string): Promise<boolean> {
    try {
        console.log(`直接翻译文件: ${filePath} (${langCode})`);
        
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            console.error(`文件不存在: ${filePath}`);
            return false;
        }
        
        // 读取文件内容
        const fileContent = fs.readFileSync(filePath, 'utf8');
        
        // 检查文件中是否包含未翻译内容
        const hasUnfinishedTranslations = fileContent.includes('<translation type="unfinished"/>') || 
                                          fileContent.includes('<translation type="unfinished"></translation>') ||
                                          fileContent.includes('<translation type="unfinished">') ||
                                          fileContent.match(/<translation(\s+type="unfinished"[^>]*)\s*\/>/g) !== null;
        
        if (!hasUnfinishedTranslations) {
            console.log(`文件 ${filePath} 没有未翻译内容，跳过处理`);
            return false;
        }
        
        // 使用Translator提取并翻译内容
        console.log(`开始处理文件: ${filePath}`);
        const translatedCount = await Translator.translateLinguistTsFile(
            selectedTranslationService,
            filePath,
            langCode,
            false
        );
        
        console.log(`文件 ${filePath} 翻译完成，翻译了 ${translatedCount} 个字符串`);
        return translatedCount > 0;
    } catch (error) {
        console.error(`翻译文件 ${filePath} 时出错:`, error);
        return false;
    }
}

// 主函数，直接处理翻译文件，无需git检测
async function main() {
    console.log('开始检查并处理翻译文件...');
    
    // 直接处理所有ts文件，不需要git检测
    const filesToTranslate = await processAllTsFiles();

    if (filesToTranslate.length === 0) {
        console.log('没有需要翻译的文件');
        return;
    }

    console.log(`\n开始处理 ${filesToTranslate.length} 个需要翻译的文件`);
    
    // 记录成功翻译的文件
    const translatedFiles = new Set<string>();
    
    // 将文件分为两类：繁体中文和非繁体中文
    const traditionalFiles = filesToTranslate.filter(item => 
        ['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese);
    const nonTraditionalFiles = filesToTranslate.filter(item => 
        !(['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese));
    
    // 创建用于记录繁体中文处理信息的数据结构
    const tcFileMap = new Map<string, Map<string, string>>();
    
    // 记录需要上传到Transifex的文件
    const transifexFilesToUpload: { file: string; language: string; resource: TransifexResource }[] = [];
    
    // 第一步：处理所有非繁体中文文件（包括简体中文和其他语言）
    console.log('\n===== 步骤1：处理非繁体中文文件 =====');
    
    // 串行处理每个翻译任务
    console.log(`开始串行处理 ${nonTraditionalFiles.length} 个翻译文件...`);
    let successfullyTranslatedCount = 0;
    
    for (const { file, langCode, resource, repoPath } of nonTraditionalFiles) {
        if (!repoPath) {
            console.warn(`警告: 文件 ${file} 没有关联的仓库路径，跳过处理`);
            continue;
        }
        
        const fullPath = `${repoPath}/${file}`;
        console.log(`\n[${successfullyTranslatedCount+1}/${nonTraditionalFiles.length}] 开始翻译 ${file} (${langCode}) (仓库路径: ${repoPath})`);
        
        try {
            // 直接翻译文件，不上传到Transifex
            const translated = await translateTsFile(fullPath, langCode);
            
            if (translated) {
                successfullyTranslatedCount++;
                
                // 如果是简体中文文件，记录路径用于后续处理繁体中文
                if (langCode === 'zh_CN') {
                    const baseFileName = path.basename(file).replace(/_zh_CN\.ts$/, '');
                    zhCNFilePaths.set(baseFileName, fullPath);
                }
                
                // 记录成功翻译的文件
                translatedFiles.add(fullPath);
                
                // 添加到待上传列表
                transifexFilesToUpload.push({
                    file: fullPath,
                    language: langCode,
                    resource
                });
                
                console.log(`翻译完成: ${file} (${langCode})`);
            } else {
                console.log(`文件 ${file} 无需翻译或翻译失败`);
            }
        } catch (error) {
            console.error(`处理 ${file} (${langCode}) 时出错:`, error);
        }
    }
    
    console.log(`\n所有 ${nonTraditionalFiles.length} 个非繁体中文文件处理完成，成功翻译: ${successfullyTranslatedCount} 个`);
    
    // 第二步：收集并处理繁体中文文件
    console.log('\n===== 步骤2：处理繁体中文文件 =====');
    
    // 收集繁体中文文件信息
    for (const { file, langCode, resource, repoPath } of traditionalFiles) {
        if (!repoPath) continue;
        
        console.log(`\n收集繁体中文文件信息: ${file} (${langCode})`);
        const baseFileName = path.basename(file).replace(/_([a-z]{2}(?:_[A-Z]{2})?)\.ts$/, '');
        
        // 检查对应的简体中文文件是否存在
        // 如果没有在之前的处理中找到，尝试从文件系统中查找
        if (!zhCNFilePaths.has(baseFileName)) {
            const possibleZhCNPath = `${repoPath}/${file.replace(/_zh_[A-Z]{2}\.ts$/, '_zh_CN.ts')}`;
            if (fs.existsSync(possibleZhCNPath)) {
                console.log(`找到对应的简体中文文件: ${possibleZhCNPath}`);
                zhCNFilePaths.set(baseFileName, possibleZhCNPath);
            } else {
                // 再尝试在translations目录下查找
                const altPath = `${repoPath}/translations/${baseFileName}_zh_CN.ts`;
                if (fs.existsSync(altPath)) {
                    console.log(`找到对应的简体中文文件: ${altPath}`);
                    zhCNFilePaths.set(baseFileName, altPath);
                } else {
                    console.warn(`未找到与 ${baseFileName} 对应的简体中文文件，无法处理繁体中文`);
                    continue;
                }
            }
        }
        
        // 记录到繁体中文处理映射中
        if (!tcFileMap.has(repoPath)) {
            tcFileMap.set(repoPath, new Map());
        }
        tcFileMap.get(repoPath)?.set(baseFileName, langCode);
    }
    
    // 使用 deepin-translation-utils 处理繁体中文文件
    if (tcFileMap.size > 0) {
        console.log('\n开始使用 deepin-translation-utils 处理繁体中文文件...');
        const tcFilesResult = await processTraditionalChineseFiles(tcFileMap);
        
        // 添加繁体中文文件到待上传列表
        for (const { filePath, langCode, resource } of tcFilesResult) {
            transifexFilesToUpload.push({
                file: filePath,
                language: langCode,
                resource
            });
        }
    } else {
        console.log('\n没有需要处理的繁体中文文件');
    }
    
    // 第三步：统一上传所有文件到Transifex
    if (transifexFilesToUpload.length > 0) {
        console.log(`\n===== 步骤3：上传 ${transifexFilesToUpload.length} 个翻译文件到Transifex =====`);
        
        let successCount = 0;
        let skipCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < transifexFilesToUpload.length; i++) {
            const { file, language, resource } = transifexFilesToUpload[i];
            console.log(`\n[${i+1}/${transifexFilesToUpload.length}] 上传文件到Transifex: ${file} (${language})`);
            
            try {
                // 使用Transifex模块的uploadTranslation方法上传，处理返回结果
                const result = await Transifex.uploadTranslatedFileToTransifex(language, file, resource.transifexResourceId);
                
                if (result === true) {
                    successCount++;
                    console.log(`文件 ${file} 处理完成`);
                } else {
                    failCount++;
                    console.error(`文件 ${file} 上传失败`);
                }
            } catch (error) {
                failCount++;
                console.error(`上传文件 ${file} 到Transifex时发生异常:`, error);
            }
        }
        
        // 输出上传统计
        console.log(`\n===== 上传统计 =====`);
        console.log(`总计处理: ${transifexFilesToUpload.length} 个文件`);
        console.log(`成功: ${successCount} 个文件`);
        console.log(`失败: ${failCount} 个文件`);
    }
    
    console.log(`\n翻译任务完成，成功翻译 ${translatedFiles.size} 个文件`);
}

/**
 * 使用 deepin-translation-utils 处理繁体中文文件
 * @param tcFileMap 繁体中文文件映射：仓库路径 -> (基本文件名 -> 语言代码)
 * @returns 处理成功的繁体中文文件信息数组
 */
async function processTraditionalChineseFiles(
    tcFileMap: Map<string, Map<string, string>>
): Promise<{ filePath: string; langCode: string; resource: any }[]> {
    const processedFiles: { filePath: string; langCode: string; resource: any }[] = [];
    const { execSync } = require('child_process');
    
    // 获取工具的绝对路径
    const utilsPath = path.resolve(process.cwd(), './deepin-translation-utils');
    console.log(`deepin-translation-utils工具的绝对路径: ${utilsPath}`);
    
    // 检查工具是否存在
    if (!fs.existsSync(utilsPath)) {
        console.error(`错误: deepin-translation-utils工具不存在于路径 ${utilsPath}`);
        return processedFiles;
    }
    
    // 检查工具是否有执行权限
    try {
        fs.accessSync(utilsPath, fs.constants.X_OK);
        console.log('deepin-translation-utils工具有执行权限');
    } catch (error) {
        console.error('错误: deepin-translation-utils工具没有执行权限', error);
        
        // 尝试添加执行权限
        try {
            execSync(`chmod +x ${utilsPath}`, { encoding: 'utf8' });
            console.log('已添加执行权限');
        } catch (chmodError) {
            console.error('添加执行权限失败:', chmodError);
            return processedFiles;
        }
    }
    
    for (const [repoPath, fileMap] of tcFileMap.entries()) {
        console.log(`处理仓库: ${repoPath}`);
        
        for (const [baseFileName, langCode] of fileMap.entries()) {
            console.log(`处理文件: ${baseFileName}, 目标语言: ${langCode}`);
            
            // 检查对应的简体中文文件是否存在
            const zhCNFilePath = zhCNFilePaths.get(baseFileName);
            
            if (!zhCNFilePath) {
                console.warn(`警告: 未找到与 ${baseFileName} 对应的简体中文文件，无法处理繁体中文`);
                continue;
            }
            
            // 使用path模块构建文件路径
            const targetFilePath = path.join(
                path.dirname(zhCNFilePath),
                path.basename(zhCNFilePath).replace('_zh_CN.ts', `_${langCode}.ts`)
            );
            
            console.log(`简体中文文件: ${zhCNFilePath}`);
            console.log(`繁体中文文件: ${targetFilePath}`);
            
            // 确认文件存在
            if (!fs.existsSync(targetFilePath)) {
                console.warn(`警告: 繁体中文文件 ${targetFilePath} 不存在，尝试创建...`);
                try {
                    // 复制简体中文文件作为基础
                    fs.copyFileSync(zhCNFilePath, targetFilePath);
                    console.log(`创建了初始繁体中文文件: ${targetFilePath}`);
                } catch (copyError) {
                    console.error(`创建繁体中文文件时出错:`, copyError);
                    continue;
                }
            }
            
            // 读取文件内容并检查是否有未翻译内容
            let hasUnfinishedTranslations = false;
            try {
                const fileContent = fs.readFileSync(targetFilePath, 'utf8');
                
                // 检查文件中是否包含 <translation type="unfinished"/> 标签
                hasUnfinishedTranslations = fileContent.includes('<translation type="unfinished"/>') || 
                                            fileContent.includes('<translation type="unfinished"></translation>') ||
                                            fileContent.includes('<translation type="unfinished">') ||
                                            fileContent.match(/<translation(\s+type="unfinished"[^>]*)\s*\/>/g) !== null;
                
                if (!hasUnfinishedTranslations) {
                    console.log(`繁体中文文件 ${targetFilePath} 没有未翻译内容，跳过处理`);
                    continue;
                }
                
                console.log(`检测到繁体中文文件 ${targetFilePath} 有未翻译内容，开始处理...`);
            } catch (error) {
                console.error(`读取繁体中文文件 ${targetFilePath} 时出错:`, error);
                continue;
            }
            
            // 构建并执行命令
            try {
                // 使用转义引号确保路径正确处理
                const escapedZhCNFilePath = zhCNFilePath.replace(/"/g, '\\"');
                
                // 构建绝对路径的命令
                const command = `"${utilsPath}" zhconv --target-languages ${langCode} "${escapedZhCNFilePath}"`;
                console.log(`执行命令: ${command}`);
                
                try {
                    // 设置合理的超时时间
                    const output = execSync(command, { 
                        encoding: 'utf8', 
                        stdio: 'pipe',
                        timeout: 60000  // 1分钟超时
                    });
                    console.log(`命令输出: ${output}`);
                } catch (execError) {
                    console.error(`执行命令失败:`, execError);
                    
                    // 尝试手动实现简单的繁体转换作为备选方案
                    console.log(`尝试使用备选方案处理繁体中文文件...`);
                    try {
                        // 读取简体文件内容
                        const zhCNContent = fs.readFileSync(zhCNFilePath, 'utf8');
                        // 手动替换一些简单的简繁对应字符
                        let zhTWContent = zhCNContent
                            .replace(/简体/g, '繁體')
                            .replace(/计算机/g, '電腦')
                            .replace(/软件/g, '軟體')
                            .replace(/设置/g, '設置')
                            .replace(/文件/g, '檔案');
                        
                        // 替换语言标记
                        zhTWContent = zhTWContent.replace(/language="zh_CN"/g, `language="${langCode}"`);
                        
                        // 写入到目标文件
                        fs.writeFileSync(targetFilePath, zhTWContent, 'utf8');
                        console.log(`使用备选方案处理完成: ${targetFilePath}`);
                    } catch (fallbackError) {
                        console.error(`备选方案处理失败:`, fallbackError);
                        continue;
                    }
                }
                
                // 添加到处理成功的文件列表
                // 查找匹配的resource
                const resource = allResources.find(res => res.repository === repoPath.replace('repo/', ''));
                if (resource) {
                    processedFiles.push({
                        filePath: targetFilePath,
                        langCode,
                        resource
                    });
                }
                
                console.log(`繁体中文文件处理完成: ${targetFilePath}`);
            } catch (error) {
                console.error(`处理繁体中文文件 ${baseFileName} (${langCode}) 时出错:`, error);
            }
        }
    }
    
    console.log(`繁体中文处理总结: 处理了 ${processedFiles.length} 个文件`);
    return processedFiles;
}

// 执行主函数
main().catch(error => {
    console.error('程序执行出错:', error);
    process.exit(1);
});

// You need to do the main auto-translate logic here.

// The following one is just for demo purpose:
// await OpenAI.fetchTranslations([
//     {
//         translationElement: null,
//         context: "AppItemMenu",
//         source: "Move to Top",
//         comment: null
//     },
//     {
//         translationElement: null,
//         context: "BottomBar",
//         source: "Full-screen Mode",
//         comment: null
//     },
//     {
//         translationElement: null,
//         context: "DummyAppItemMenu",
//         source: "Install",
//         comment: null
//     },
//     {
//         translationElement: null,
//         context: "DummyAppItemMenu",
//         source: "Remove",
//         comment: null
//     },
//     {
//         translationElement: null,
//         context: "UninstallDialog",
//         source: "Are you sure you want to uninstall %1?",
//         comment: null
//     }
// ], 'ar', true);

/*

A tipical workflow for open-sourced projects is to get all resources linked to Transifex's GitHub integration directly from Transifex.

// Step 1: Get all known transifex projects of a Transifex organization:
const transifexProjects = await Transifex.getAllProjects('o:linuxdeepin');
// Step 2: Get all linked resources from these projects:
const allResources = await Transifex.getAllLinkedResourcesFromProjects(transifexProjects);
// Step 3: Clone repos from GitHub or mirror
GitRepo.ensureLocalReposExist(allResources);
// Step 4: Translate resources:
await Translator.translateTransifexResources(OpenAI.fetchTranslations, transifexResources, 'ar', resourceFileBaseName);

In practice, you might need to tweak these steps depending on your needs. For example, you might want to dump the result of a step to
YAML for manual review/modification and load it back from YAML in the next step. This allows you skip certain translation resources
when needed (e.g. add `additionalMarker: ignore` to a TranslationResource).
*/

/*

A tipical workflow for closed-source projects is to manually put `.tx/config` file locally, use `tx` transifex-cli to fetch all
resources from Transifex, and then translate them locally.

You can ask the maintainer to send you the `.tx/config` file, then put it under `repo/close-sourced/<project-name>/.tx/config`,
then prepare a list of repos via something like:

const repos : TransifexRepo[] = [
    {
        path: "./repo/close-sourced/deepin-mail",
        txBranch: "master",
        targetLanguageCodes: ["sl"]
    },
    {
        path: "./repo/close-sourced/dde-printer",
        txBranch: "-1",
        targetLanguageCodes: ["gl_ES"]
    },
]

Then you can use the following code to download resources, translate all resources and upload resources back to Transifex:

// Download, Translate, and Upload in a single step.
Translator.translateTransifexRepos(OpenAI.fetchTranslations, repos)

*/