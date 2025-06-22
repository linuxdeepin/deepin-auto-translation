// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import * as QtLinguist from './qtlinguist';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { TransifexResource, TransifexRepo, TranslationOperation } from './types';
import * as YAML from 'js-yaml';
import * as GitRepo from './gitrepo';
import * as Transifex from './transifex';

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
    const inputFileBuffer = fs.readFileSync(inputFilePath);
    const inputFileContents = inputFileBuffer.toString('utf8');
    
    const doc = new DOMParser().parseFromString(inputFileContents, 'application/xml');
    // <TS language="ar" version="2.1">
    const tsElement = doc.getElementsByTagName('TS')[0];
    let targetLanguage = tsElement.getAttribute('language')!;
    if (targetLanguage === null) {
        console.warn(`${inputFilePath} does not have a language attribute, using languageHint instead`);
        targetLanguage = languageHint;
        if (languageHint === '') {
            console.warn(`${inputFilePath} does not have a language attribute and languageHint is empty, skipped...`);
            return 0;
        }
    }
    // 只跳过完全相同的英语代码，允许英语变体之间的本地化（如 en 源文 -> en_AU 目标文）
    if (targetLanguage === 'en') {
        console.log(`${inputFilePath} is already in English (en), skipped...`);
        return 0;
    }
    // console.log(`Translating ${inputFilePath} to ${targetLanguage}`);

    let translationQueue = QtLinguist.extractStringsFromDocument(doc);
    console.log(`Extracted ${translationQueue.length} untranslated strings from file: ${inputFilePath}`)
    
    if (translationQueue.length === 0) {
        return 0;
    }
    
    // 记录实际成功翻译的数量
    let actualTranslatedCount = 0;
    let hasTranslationErrors = false;
    
    // split translationQueue into batches, each batch contains 30 messages
    const batchSize = 15;
    for (let i = 0; i < translationQueue.length; i += batchSize) {
        const batch = translationQueue.slice(i, i + batchSize);
        try {
            await translator(batch, targetLanguage, keepUnfinishedTypeAttr);
            // 检查这一批次是否有翻译错误
            const batchTranslatedCount = batch.filter(msg => 
                msg.translationElement && 
                msg.translationElement.textContent && 
                msg.translationElement.textContent.trim() !== '' &&
                msg.translationElement.getAttribute('type') !== 'unfinished'
            ).length;
            actualTranslatedCount += batchTranslatedCount;
            
            // 如果这一批次没有成功翻译任何内容，标记为有错误
            if (batchTranslatedCount === 0 && batch.length > 0) {
                hasTranslationErrors = true;
            }
            
            // 添加1秒延迟，让翻译更稳定
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`[翻译错误] 处理批次 ${Math.floor(i/batchSize) + 1} 时出错:`, error.message);
            hasTranslationErrors = true;
        }
    }
    
    // 保留原始格式的智能写回XML文件
    try {
        // 读取原始文件内容
        const originalContent = fs.readFileSync(inputFilePath, 'utf8');
        
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
        
        // 写回文件
        fs.writeFileSync(inputFilePath, result, { encoding: 'utf8' });
        
        // 根据实际翻译情况显示不同的消息
        if (hasTranslationErrors) {
            console.log(`文件 ${inputFilePath} 翻译完成，实际翻译了 ${actualTranslatedCount} 个字符串 (有错误)`);
            if (actualTranslatedCount > 0) {
                console.log(`  - 翻译成功: 翻译了 ${actualTranslatedCount} 个字符串`);
            } else {
                console.log(`  - 翻译失败: 由于JSON解析错误或其他问题，未能成功翻译任何内容`);
            }
        } else {
            console.log(`文件 ${inputFilePath} 翻译完成，翻译了 ${actualTranslatedCount} 个字符串`);
        }
    } catch (writeError) {
        console.error(`写回文件 ${inputFilePath} 时出错:`, writeError);
        console.error('尝试使用XMLSerializer作为备用方案...');
        
        // 如果出错，回退到XMLSerializer方案
        try {
            const originalContent = fs.readFileSync(inputFilePath, 'utf8');
            
            // 提取原始的XML和DOCTYPE声明
            const xmlDeclarationMatch = originalContent.match(/^<\?xml[^>]*\?>\s*(?:\n|\r\n)?/);
            const xmlDeclaration = xmlDeclarationMatch ? xmlDeclarationMatch[0] : '<?xml version="1.0" encoding="utf-8"?>\n';
            
            const doctypeMatch = originalContent.match(/<!DOCTYPE[^>]*>\s*(?:\n|\r\n)?/);
            const doctypeDeclaration = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE TS>\n';
            
            // 序列化XML，移除自动添加的声明
            const serializedXml = new XMLSerializer().serializeToString(doc);
            const cleanedXml = serializedXml
                .replace(/^\s*<\?xml[^>]*\?>\s*/, '')
                .replace(/^\s*<!DOCTYPE[^>]*>\s*/, '')
                .trim();
            
            // 重新组装并写入
            const finalContent = xmlDeclaration + doctypeDeclaration + cleanedXml + '\n';
            fs.writeFileSync(inputFilePath, finalContent, { encoding: 'utf8' });
            
            console.log(`使用XMLSerializer备用方式完成文件写入: ${inputFilePath}`);
        } catch (backupError) {
            console.error(`备用写入方式也失败:`, backupError);
            throw backupError;
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
