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

// 读取配置文件
function readConfig() {
    try {
        const configContent = fs.readFileSync('./config.yml', 'utf8');
        const config = YAML.load(configContent) as { transifex: { organization: string } };
        return config;
    } catch (error) {
        console.error('读取配置文件失败:', error);
        process.exit(1);
    }
}

// 读取或生成项目列表
async function readOrGenerateProjectList(organization: string) {
    try {
        // 首先检查是否存在 transifex-projects.yml
        if (fs.existsSync('./transifex-projects.yml')) {
            console.log('项目配置文件 transifex-projects.yml 存在');
            const projectListContent = fs.readFileSync('./transifex-projects.yml', 'utf8');
            const projectList = YAML.load(projectListContent) as string[];
            
            if (projectList && projectList.length > 0) {
                console.log(`从配置文件中读取到 ${projectList.length} 个指定项目`);
                return projectList;
            } else {
                console.log('项目配置文件为空，将拉取所有项目');
            }
        }
        
        // 如果不存在配置文件或配置文件为空，则从 Transifex API 获取所有项目
        console.log('从 Transifex API 获取组织下的所有项目...');
        const allProjects = await Transifex.getAllProjects(organization);
        console.log(`从 Transifex API 获取到 ${allProjects.length} 个项目`);
        
        // 生成 transifex-projects.yml 文件
        fs.writeFileSync('./transifex-projects.yml', YAML.dump(allProjects));
        console.log('已生成 transifex-projects.yml 文件，包含所有项目');
        console.log('如需限制处理特定项目，请编辑此文件并保留需要的项目ID');
        
        return allProjects;
    } catch (error) {
        console.error('读取或生成项目列表失败:', error);
        process.exit(1);
    }
}

// 获取所有项目名
console.log('开始获取 Transifex 项目列表...');
const config = readConfig();
const filteredProjects = await readOrGenerateProjectList(config.transifex.organization);

console.log(`最终处理项目数量: ${filteredProjects.length}`);

console.log('开始获取项目关联资源...');
const allResources = await Transifex.getAllLinkedResourcesFromProjects(filteredProjects);
console.log(`成功获取 ${allResources.length} 个资源`);

console.log('开始克隆/更新本地仓库...');
GitRepo.ensureLocalReposExist(allResources);
console.log('本地仓库准备完成');


// 记录简体中文文件路径，用于后续处理繁体中文
const zhCNFilePaths = new Map<string, string>();

// 在开始翻译前添加编码转换检查
async function ensureFileEncoding(filePath: string) {
    // 此函数不再使用，保留空实现以避免破坏现有代码引用
    console.log(`[不再使用] 跳过文件编码检查: ${filePath}`);
}

// 直接调用Translator进行翻译，跳过Transifex上传操作
export async function translateTsFile(filePath: string, langCode: string): Promise<boolean> {
    try {
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            console.error(`文件不存在: ${filePath}`);
            return false;
        }
        
        // 使用二进制方式读取文件，避免编码问题
        const fileBuffer = fs.readFileSync(filePath);
        const fileContent = fileBuffer.toString('utf8');
        
        // 检查文件中是否包含未翻译内容
        const hasUnfinishedTranslations = fileContent.includes('<translation type="unfinished"/>') || 
                                          fileContent.includes('<translation type="unfinished"></translation>') ||
                                          fileContent.includes('<translation type="unfinished">') ||
                                          fileContent.match(/<translation(\s+type="unfinished"[^>]*)\s*\/>/g) !== null;
        
        if (!hasUnfinishedTranslations) {
            return false;
        }
        
        // 使用Translator提取并翻译内容
        const translatedCount = await Translator.translateLinguistTsFile(
            selectedTranslationService,
            filePath,
            langCode,
            false
        );
        
        return translatedCount > 0;
    } catch (error) {
        console.error(`翻译文件 ${filePath} 时出错:`, error);
        return false;
    }
}

/**
 * 使用 deepin-translation-utils 处理繁体中文文件
 * @param repoGroups 繁体中文文件分组：仓库路径 -> [{baseFileName, langCode, resource}]
 * @returns 处理成功的繁体中文文件信息数组
 */
async function processTraditionalChineseFiles(
    repoGroups: Map<string, { baseFileName: string; langCode: string; resource: any }[]>
): Promise<{ filePath: string; langCode: string; resource: any }[]> {
    const processedFiles: { filePath: string; langCode: string; resource: any }[] = [];
    const { execSync } = require('child_process');
    
    // 检查工具是否存在
    const utilsPath = process.env.TRANSLATION_UTILS_PATH || path.resolve(process.cwd(), './deepin-translation-utils');
    if (!fs.existsSync(utilsPath)) {
        console.error(`[繁体处理错误] deepin-translation-utils工具不存在于路径 ${utilsPath}`);
        console.error('[繁体处理错误] 请确保工具文件存在，或通过 TRANSLATION_UTILS_PATH 环境变量指定正确的路径');
        return processedFiles;
    }
    console.log(`[繁体处理] deepin-translation-utils工具的绝对路径: ${utilsPath}`);
    // 添加诊断信息
    try {
        console.log('[繁体处理诊断] 检查文件信息:');
        const fileStats = fs.statSync(utilsPath);
        console.log(`[繁体处理诊断] 文件权限: ${fileStats.mode.toString(8)}`);
        console.log(`[繁体处理诊断] 文件大小: ${fileStats.size} 字节`);
        console.log(`[繁体处理诊断] 最后修改时间: ${fileStats.mtime}`);
        // 不再使用file命令和ldd命令，因为CI环境中可能不存在
    } catch (error) {
        console.error('[繁体处理诊断] 获取文件信息时出错:', error);
    }
    
    // 检查工具是否有执行权限并添加权限
    try {
        // 先主动添加执行权限，确保CI环境下工具可执行
        execSync(`chmod +x "${utilsPath}"`, { encoding: 'utf8' });
        console.log('[繁体处理] 已添加执行权限');
        
        // 再次检查是否有执行权限
        fs.accessSync(utilsPath, fs.constants.X_OK);
        console.log('[繁体处理] deepin-translation-utils工具有执行权限');
    } catch (error) {
        console.error('[繁体处理错误] deepin-translation-utils工具权限检查或修改失败', error);
        console.error('[繁体处理错误] 无法继续处理繁体中文文件，请确保工具可执行');
        return processedFiles;
    }
    
    // 统计信息
    let totalFiles = 0;
    let processedCount = 0;
    let errorCount = 0;
    let skipCount = 0;
    
    // 计算需要处理的总文件数
    for (const files of repoGroups.values()) {
        totalFiles += files.length;
    }
    
    console.log(`[繁体处理] 开始处理共 ${totalFiles} 个繁体中文文件，使用串行处理方式`);
    
    // 使用 for...of 循环顺序处理所有仓库
    const repoEntries = Array.from(repoGroups.entries());
    for (let repoIndex = 0; repoIndex < repoEntries.length; repoIndex++) {
        const [repoPath, files] = repoEntries[repoIndex];
        console.log(`[繁体处理] [${repoIndex+1}/${repoEntries.length}] 处理仓库: ${repoPath}`);
        
        // 使用 for...of 循环顺序处理仓库中的所有文件
        for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
            const { baseFileName, langCode, resource } = files[fileIndex];
            const fileProgress = `[${processedCount+1}/${totalFiles}]`;
            console.log(`[繁体处理] ${fileProgress} 开始处理文件: ${baseFileName}, 目标语言: ${langCode}`);
            
            try {
                // 检查对应的简体中文文件是否存在
                const zhCNFilePath = zhCNFilePaths.get(baseFileName);
                
                if (!zhCNFilePath) {
                    console.warn(`[繁体处理警告] ${fileProgress} 未找到与 ${baseFileName} 对应的简体中文文件，无法处理繁体中文`);
                    skipCount++;
                    continue;
                }
                
                // 使用path模块构建文件路径
                const targetFilePath = path.join(
                    path.dirname(zhCNFilePath),
                    path.basename(zhCNFilePath).replace('_zh_CN.ts', `_${langCode}.ts`)
                );
                
                console.log(`[繁体处理] ${fileProgress} 简体中文文件: ${zhCNFilePath}`);
                console.log(`[繁体处理] ${fileProgress} 繁体中文文件: ${targetFilePath}`);
                
                // 确认文件存在
                if (!fs.existsSync(targetFilePath)) {
                    console.warn(`[繁体处理警告] ${fileProgress} 繁体中文文件 ${targetFilePath} 不存在，尝试创建...`);
                    try {
                        // 复制简体中文文件作为基础
                        fs.copyFileSync(zhCNFilePath, targetFilePath);
                        console.log(`[繁体处理] ${fileProgress} 创建了初始繁体中文文件: ${targetFilePath}`);
                    } catch (copyError) {
                        console.error(`[繁体处理错误] ${fileProgress} 创建繁体中文文件时出错:`, copyError);
                        errorCount++;
                        continue;
                    }
                }
                
                // 读取文件内容并检查是否有未翻译内容
                let hasUnfinishedTranslations = false;
                try {
                    const fileContent = fs.readFileSync(targetFilePath, 'utf8');
                    
                    // 检查文件中是否包含未翻译标记
                    hasUnfinishedTranslations = fileContent.includes('<translation type="unfinished"/>') || 
                                               fileContent.includes('<translation type="unfinished"></translation>') ||
                                               fileContent.includes('<translation type="unfinished">') ||
                                               fileContent.match(/<translation(\s+type="unfinished"[^>]*)\s*\/>/g) !== null;
                    
                    if (!hasUnfinishedTranslations) {
                        skipCount++;
                        continue;
                    }
                    
                    console.log(`[繁体处理] ${fileProgress} 检测到繁体中文文件 ${targetFilePath} 有未翻译内容，开始处理...`);
                } catch (error) {
                    console.error(`[繁体处理错误] ${fileProgress} 读取繁体中文文件 ${targetFilePath} 时出错:`, error);
                    errorCount++;
                    continue;
                }
                
                // 构建并执行命令
                try {
                    // 使用转义引号确保路径正确处理
                    const escapedZhCNFilePath = zhCNFilePath.replace(/"/g, '\\"');
                    
                    // 使用绝对路径执行命令，不再使用相对路径
                    const command = `"${utilsPath}" zhconv -t ${langCode} "${escapedZhCNFilePath}"`;
                    console.log(`[繁体处理] ${fileProgress} 开始生成${langCode}文件`);
                    console.log(`[繁体处理] ${fileProgress} 执行命令: ${command}`);
                    
                    try {
                        // 设置更长的超时时间，确保在CI环境有足够时间处理
                        const output = execSync(command, { 
                            encoding: 'utf8', 
                            stdio: 'pipe',
                            timeout: 120000,  // 2分钟超时，CI环境可能较慢
                            shell: '/bin/bash'  // 显式指定shell，避免环境差异
                        });
                        console.log(`[繁体处理] ${fileProgress} 命令执行成功${output.trim() ? '，输出: ' + output.trim() : '，无输出'}`);
                        
                        // 验证转换后的文件是否存在
                        if (fs.existsSync(targetFilePath)) {
                            console.log(`[繁体处理] ${fileProgress} 验证文件存在: ${targetFilePath}`);
                            
                            // 验证文件大小是否合理
                            const targetStats = fs.statSync(targetFilePath);
                            const sourceStats = fs.statSync(zhCNFilePath);
                            if (targetStats.size < sourceStats.size * 0.5) {
                                console.warn(`[繁体处理警告] ${fileProgress} 生成的文件大小异常，源文件: ${sourceStats.size} 字节，目标文件: ${targetStats.size} 字节`);
                            } else {
                                console.log(`[繁体处理] ${fileProgress} 文件大小合理，源文件: ${sourceStats.size} 字节，目标文件: ${targetStats.size} 字节`);
                            }
                        } else {
                            throw new Error(`转换后的文件不存在: ${targetFilePath}`);
                        }
                    } catch (execError) {
                        console.error(`[繁体处理错误] ${fileProgress} 执行命令失败:`, execError);
                        
                        // 不使用备选方案，直接记录错误并跳过
                        console.error(`[繁体处理错误] ${fileProgress} 无法使用deepin-translation-utils工具处理文件，跳过处理`);
                        errorCount++;
                        continue;
                    }
                    
                    processedCount++;
                    console.log(`[繁体处理] ${fileProgress} 繁体中文文件处理完成: ${targetFilePath}`);
                    
                    // 添加成功处理的文件到返回列表
                    processedFiles.push({
                        filePath: targetFilePath,
                        langCode: langCode,
                        resource: resource
                    });
                    
                    // 添加延迟，避免CI环境中资源竞争
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.error(`[繁体处理错误] ${fileProgress} 处理繁体中文文件 ${baseFileName} (${langCode}) 时出错:`, error);
                    errorCount++;
                }
            } catch (outerError) {
                console.error(`[繁体处理严重错误] ${fileProgress} 处理文件 ${baseFileName} 时发生未捕获异常:`, outerError);
                errorCount++;
            }
        }
    }
    
    console.log(`\n[繁体处理] ========== 处理总结 ==========`);
    console.log(`[繁体处理] 总文件数: ${totalFiles}`);
    console.log(`[繁体处理] 成功处理: ${processedCount} 文件`);
    console.log(`[繁体处理] 跳过处理: ${skipCount} 文件`);
    console.log(`[繁体处理] 处理失败: ${errorCount} 文件`);
    console.log(`[繁体处理] 添加到上传列表: ${processedFiles.length} 文件`);
    
    // 列出成功处理的文件路径和语言
    if (processedFiles.length > 0) {
        console.log(`\n[繁体处理] 成功处理的文件列表:`);
        processedFiles.forEach((item, index) => {
            console.log(`[繁体处理] ${index+1}. ${item.filePath} (${item.langCode})`);
        });
    }

    // 如果有处理失败的文件，建议用户检查
    if (errorCount > 0) {
        console.log(`\n[繁体处理] ⚠️ 警告：有 ${errorCount} 个文件处理失败，请检查上方日志了解详细信息`);
    }

    // 如果有跳过的文件，提供说明
    if (skipCount > 0) {
        console.log(`\n[繁体处理] ℹ️ 提示：${skipCount} 个文件被跳过，可能是因为文件已完成翻译或找不到对应的简体中文文件`);
    }

    // 添加处理效率统计
    const successRate = totalFiles > 0 ? ((processedCount / totalFiles) * 100).toFixed(1) : '0';
    console.log(`\n[繁体处理] 处理成功率: ${successRate}% (${processedCount}/${totalFiles})`);
    
    return processedFiles;
}

// 主函数，直接处理翻译文件，无需git检测
async function main() {
    console.log('\n========== 开始翻译任务 ==========');
    console.log('当前时间:', new Date().toLocaleString());
    console.log('工作目录:', process.cwd());
    
    // 直接处理所有ts文件，不需要git检测
    const filesToTranslate = await processAllTsFiles();

    if (filesToTranslate.length === 0) {
        console.log('\n⚠️ 没有需要翻译的文件');
        return;
    }

    console.log(`\n✨ 开始处理 ${filesToTranslate.length} 个需要翻译的文件`);
    
    // 记录成功翻译的文件
    const translatedFiles = new Set<string>();
    
    // 将文件分为两类：繁体中文和非繁体中文
    const traditionalFiles = filesToTranslate.filter(item => 
        ['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese);
    const nonTraditionalFiles = filesToTranslate.filter(item => 
        !(['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese));
    
    // 记录需要上传到Transifex的文件
    const transifexFilesToUpload: { file: string; language: string; resource: TransifexResource }[] = [];
    
    // 第一步：处理所有非繁体中文文件（包括简体中文和其他语言）
    console.log('\n===== 步骤1：处理非繁体中文文件 =====');
    
    // 串行处理每个翻译任务
    console.log(`📝 开始串行处理 ${nonTraditionalFiles.length} 个翻译文件...`);
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
    
    // 收集繁体中文文件信息 - 改为使用数组而非Map存储，避免相同baseFileName的不同语言版本互相覆盖
    const traditionalChineseFiles: { baseFileName: string; langCode: string; repoPath: string; resource: any }[] = [];
    
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
        
        // 添加到繁体中文文件数组
        traditionalChineseFiles.push({
            baseFileName,
            langCode,
            repoPath,
            resource
        });
    }
    
    // 使用 deepin-translation-utils 处理繁体中文文件
    if (traditionalChineseFiles.length > 0) {
        console.log(`\n开始使用 deepin-translation-utils 处理繁体中文文件...共有 ${traditionalChineseFiles.length} 个文件需要处理`);
        
        // 按仓库分组，方便后续处理
        const repoGroups = new Map<string, { baseFileName: string; langCode: string; resource: any }[]>();
        
        for (const file of traditionalChineseFiles) {
            if (!repoGroups.has(file.repoPath)) {
                repoGroups.set(file.repoPath, []);
            }
            repoGroups.get(file.repoPath)?.push({
                baseFileName: file.baseFileName,
                langCode: file.langCode,
                resource: file.resource
            });
        }
        
        const tcFilesResult = await processTraditionalChineseFiles(repoGroups);
        
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
        console.log(`\n===== 步骤3：使用tx push上传翻译文件到Transifex =====`);
        console.log(`📤 准备上传 ${transifexFilesToUpload.length} 个翻译文件到Transifex平台`);

        // 按仓库路径分组文件
        const repoGroups = new Map<string, { file: string; language: string; resource: TransifexResource }[]>();
        
        for (const item of transifexFilesToUpload) {
            // 获取项目根目录路径（repo/linuxdeepin/xxx）
            const fullPath = path.resolve(item.file);
            // 修改正则表达式，确保只匹配到仓库根目录，不包含translations等子目录
            const match = fullPath.match(/repo\/linuxdeepin\/[^\/]+(?=\/|$)/);
            if (!match) {
                console.error(`❌ 错误: 无法从路径 ${item.file} 中提取项目根目录`);
                continue;
            }
            const repoPath = match[0];
            
            if (!repoGroups.has(repoPath)) {
                repoGroups.set(repoPath, []);
            }
            repoGroups.get(repoPath)?.push(item);
        }

        console.log(`\n📦 按仓库分组后，共有 ${repoGroups.size} 个仓库需要处理`);

        let successCount = 0;
        let failCount = 0;

        // 遍历每个仓库执行tx push
        for (const [repoPath, files] of repoGroups.entries()) {
            console.log(`\n🔄 处理仓库: ${repoPath}`);
            console.log(`📝 该仓库有 ${files.length} 个文件需要上传`);

            try {
                // 检查.tx/config文件是否存在
                const txConfigPath = path.join(repoPath, '.tx', 'config');
                if (!fs.existsSync(txConfigPath)) {
                    console.error(`❌ 错误: 仓库 ${repoPath} 中未找到 .tx/config 文件，跳过处理`);
                    failCount += files.length;
                    continue;
                }

                // 切换到仓库目录
                const originalCwd = process.cwd();
                process.chdir(repoPath);

                // 执行tx push命令
                console.log(`🚀 开始执行tx push命令...`);
                const { execSync } = require('child_process');
                try {
                    const output = execSync('tx push -s -t', { 
                        encoding: 'utf8',
                        stdio: 'pipe',
                        timeout: 300000 // 5分钟超时
                    });
                    console.log(`✅ tx push执行成功`);
                    console.log(`📋 命令输出:\n${output}`);
                    successCount += files.length;
                } catch (error) {
                    console.error(`❌ tx push执行失败:`, error);
                    failCount += files.length;
                }

                // 切回原目录
                process.chdir(originalCwd);

            } catch (error) {
                console.error(`❌ 处理仓库 ${repoPath} 时发生错误:`, error);
                failCount += files.length;
            }
        }

        // 输出上传统计
        console.log(`\n===== 上传统计 =====`);
        console.log(`📊 总计上传: ${transifexFilesToUpload.length} 个文件`);
        console.log(`✅ 上传成功: ${successCount} 个文件`);
        console.log(`❌ 上传失败: ${failCount} 个文件`);
        
        // 计算上传成功率
        const uploadSuccessRate = ((successCount / transifexFilesToUpload.length) * 100).toFixed(1);
        console.log(`📈 上传成功率: ${uploadSuccessRate}%`);

        if (failCount > 0) {
            console.log(`\n⚠️ 警告：有 ${failCount} 个文件上传失败，请检查上方日志了解详细信息`);
        }
    }
    
    // 任务完成统计
    console.log(`\n========== 翻译任务完成 ==========`);
    console.log(`✨ AI翻译完成: ${translatedFiles.size} 个文件`);
    console.log(`🔄 繁体转换完成: ${transifexFilesToUpload.length - translatedFiles.size} 个文件`);
    console.log(`📝 总计处理完成: ${translatedFiles.size + (transifexFilesToUpload.length - translatedFiles.size)} 个文件`);
    
    // 添加任务耗时统计
    const endTime = new Date();
    console.log(`\n⏱️ 任务结束时间: ${endTime.toLocaleString()}`);
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