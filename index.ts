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
import { checkTsFilesInGitLog } from './check-ts-files';
import { execSync } from 'child_process';

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

const allResources = await Transifex.getAllLinkedResourcesFromProjects(YAML.load(fs.readFileSync('./transifex-projects.yml', 'utf8')) as string[]);

// 记录简体中文文件路径，用于后续处理繁体中文
const zhCNFilePaths = new Map<string, string>();

// 检查最新的 git log 中的 ts 文件并进行翻译
async function main() {
    console.log('开始检查并处理翻译文件...');
    const filesToTranslate = await checkTsFilesInGitLog();

    if (filesToTranslate.length === 0) {
        console.log('没有需要翻译的文件');
        return;
    }

    console.log(`\n开始处理 ${filesToTranslate.length} 个需要翻译的文件`);
    
    // 记录成功翻译的文件和它们的仓库路径
    const translatedFiles = new Map<string, Set<string>>();
    
    // 将文件分为两类：繁体中文和非繁体中文
    const traditionalFiles = filesToTranslate.filter(item => 
        ['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese);
    const nonTraditionalFiles = filesToTranslate.filter(item => 
        !(['zh_HK', 'zh_TW'].includes(item.langCode) || item.isTraditionalChinese));
    
    // 创建用于记录繁体中文处理信息的数据结构
    const tcFileMap = new Map<string, Map<string, string>>();
    
    // 第一步：处理所有非繁体中文文件（包括简体中文和其他语言）
    console.log('\n===== 步骤1：处理非繁体中文文件 =====');
    
    for (const { file, langCode, resource, repoPath } of nonTraditionalFiles) {
        console.log(`\n正在翻译 ${file} (${langCode}) (仓库路径: ${repoPath || '未定义'})`);
        try {
            const baseFileName = file.split('/').pop()?.replace(/_([a-z]{2}(?:_[A-Z]{2})?)\.ts$/, '') || file;
            await Translator.translateTransifexResources(
                selectedTranslationService,
                [resource],
                langCode,
                baseFileName
            );
            
            // 如果是简体中文文件，记录路径用于后续处理繁体中文
            if (langCode === 'zh_CN' && repoPath) {
                const fullPath = `${repoPath}/${file}`;
                zhCNFilePaths.set(baseFileName, fullPath);
            }
            
            if (!repoPath) {
                console.warn(`警告: 文件 ${file} 没有关联的仓库路径，无法进行 Git 操作`);
                continue;
            }
            
            // 记录成功翻译的文件
            if (!translatedFiles.has(repoPath)) {
                translatedFiles.set(repoPath, new Set());
            }
            translatedFiles.get(repoPath)?.add(file);
            
        } catch (error) {
            console.error(`翻译 ${file} 时出错:`, error);
        }
    }
    
    // 第二步：收集并处理繁体中文文件
    console.log('\n===== 步骤2：处理繁体中文文件 =====');
    
    // 收集繁体中文文件信息
    for (const { file, langCode, resource, repoPath } of traditionalFiles) {
        if (!repoPath) continue;
        
        console.log(`\n收集繁体中文文件信息: ${file} (${langCode})`);
        const baseFileName = file.split('/').pop()?.replace(/_([a-z]{2}(?:_[A-Z]{2})?)\.ts$/, '') || file;
        
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
        await processTraditionalChineseFiles(tcFileMap, translatedFiles);
    } else {
        console.log('\n没有需要处理的繁体中文文件');
    }
    
    // 将所有翻译好的文件提交到 Git 仓库
    if (translatedFiles.size > 0) {
        console.log('\n将翻译好的文件提交到 Git 仓库...');
        commitTranslatedFiles(translatedFiles);
    }
}

/**
 * 使用 deepin-translation-utils 处理繁体中文文件
 * @param tcFileMap 繁体中文文件映射：仓库路径 -> (基本文件名 -> 语言代码)
 * @param translatedFiles 记录翻译文件的Map
 */
async function processTraditionalChineseFiles(
    tcFileMap: Map<string, Map<string, string>>,
    translatedFiles: Map<string, Set<string>>
): Promise<void> {
    for (const [repoPath, fileMap] of tcFileMap.entries()) {
        for (const [baseFileName, langCode] of fileMap.entries()) {
            // 检查对应的简体中文文件是否存在
            const zhCNFilePath = zhCNFilePaths.get(baseFileName);
            
            if (!zhCNFilePath) {
                console.warn(`警告: 未找到与 ${baseFileName} 对应的简体中文文件，无法处理繁体中文`);
                continue;
            }
            
            // 检查繁体中文文件是否存在未翻译内容
            const targetFilePath = zhCNFilePath.replace('_zh_CN.ts', `_${langCode}.ts`);
            
            // 确认文件存在
            if (!fs.existsSync(targetFilePath)) {
                console.warn(`警告: 繁体中文文件 ${targetFilePath} 不存在，无法检查翻译状态`);
                continue;
            }
            
            // 读取文件内容并检查是否有未翻译内容
            try {
                const fileContent = fs.readFileSync(targetFilePath, 'utf8');
                
                // 检查文件中是否包含 <translation type="unfinished"/> 标签
                const hasUnfinishedTranslations = fileContent.includes('<translation type="unfinished"/>') || 
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
            
            console.log(`处理繁体中文文件 (${langCode}): ${baseFileName}`);
            try {
                // 执行 deepin-translation-utils 命令，只处理特定的目标语言
                const command = `./deepin-translation-utils zhconv --target-languages ${langCode} ${zhCNFilePath}`;
                console.log(`执行命令: ${command}`);
                execSync(command, { encoding: 'utf8', stdio: 'inherit' });
                
                // 将生成的繁体中文文件上传到 Transifex
                console.log(`上传繁体中文文件 (${langCode}) 到 Transifex...`);
                
                // 记录生成的文件，以便后续进行 Git 提交
                if (!translatedFiles.has(repoPath)) {
                    translatedFiles.set(repoPath, new Set());
                }
                
                // 提取相对路径而不仅仅是文件名
                const repoPrefix = `${repoPath}/`;
                const targetRelativePath = targetFilePath.startsWith(repoPrefix) 
                    ? targetFilePath.substring(repoPrefix.length) 
                    : targetFilePath;
                
                translatedFiles.get(repoPath)?.add(targetRelativePath);
                
            } catch (error) {
                console.error(`处理繁体中文文件 ${baseFileName} (${langCode}) 时出错:`, error);
            }
        }
    }
}

/**
 * 将翻译后的文件通过 git 添加到当前提交
 * @param translatedFiles 翻译文件映射：仓库路径 -> 文件集合
 */
function commitTranslatedFiles(translatedFiles: Map<string, Set<string>>): void {
    for (const [repoPath, files] of translatedFiles.entries()) {
        try {
            console.log(`\n处理仓库 ${repoPath} 中的翻译文件...`);
            const fileList = Array.from(files).join('" "');
            
            // 执行 git add 和 git commit --amend
            execSync(`cd ${repoPath} && git add "${fileList}" && git commit --amend --no-edit`, { encoding: 'utf8' });
            console.log(`成功将 ${files.size} 个文件添加到 ${repoPath} 的当前提交`);
        } catch (error) {
            console.error(`Git 操作失败 (${repoPath}): ${error}`);
        }
    }
}

// 执行主函数
main().catch(error => {
    console.error('程序执行出错:', error);
    process.exit(1);
});