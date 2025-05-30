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
    if (targetLanguage === 'en') {
        console.log(`${inputFilePath} is already in English, skipped...`);
        return 0;
    }
    console.log(`Translating ${inputFilePath} to ${targetLanguage}`);

    let translationQueue = QtLinguist.extractStringsFromDocument(doc);
    console.log(`Extracted ${translationQueue.length} untranslated strings from file: ${inputFilePath}`)
    
    if (translationQueue.length === 0) {
        console.log(`No untranslated strings found in ${inputFilePath}, skipped...`);
        return 0;
    }
    
    // split translationQueue into batches, each batch contains 30 messages
    const batchSize = 30;
    for (let i = 0; i < translationQueue.length; i += batchSize) {
        const batch = translationQueue.slice(i, i + batchSize);
        await translator(batch, targetLanguage, keepUnfinishedTypeAttr);
        // 添加2秒延迟，让翻译更稳定
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // 安全地序列化和写回XML文件，避免格式破坏
    try {
        // 首先备份原始文件的第一行（XML声明）和格式
        const originalContent = fs.readFileSync(inputFilePath, 'utf8');
        const xmlDeclarationMatch = originalContent.match(/^<\?xml[^>]*\?>\s*/);
        const xmlDeclaration = xmlDeclarationMatch ? xmlDeclarationMatch[0] : '<?xml version="1.0" encoding="utf-8"?>\n';
        
        // 序列化文档
        const serializedXml = new XMLSerializer().serializeToString(doc);
        
        // 清理序列化后的内容，移除可能的多余空行和格式问题
        let cleanedXml = serializedXml
            .replace(/^\s*<\?xml[^>]*\?>\s*/, '') // 移除XMLSerializer可能添加的XML声明
            .replace(/\n\s*\n\s*\n/g, '\n\n') // 将连续的多个空行合并为最多两个换行
            .replace(/>\s*\n\s*</g, '>\n<') // 标准化标签间的换行
            .trim();
        
        // 重新组装最终内容
        const finalContent = xmlDeclaration + cleanedXml + '\n';
        
        // 写回文件
        fs.writeFileSync(inputFilePath, finalContent, { encoding: 'utf8' });
        
        console.log(`Finished translating ${translationQueue.length} strings in ${inputFilePath}`);
    } catch (writeError) {
        console.error(`写回文件 ${inputFilePath} 时出错:`, writeError);
        console.error('尝试保留原始文件格式...');
        
        // 如果出错，尝试更保守的方式：只更新翻译内容，保持原始文件结构
        try {
            const originalContent = fs.readFileSync(inputFilePath, 'utf8');
            // 这里应该已经通过DOM操作更新了翻译内容，所以直接保存修改后的内容
            const serializedXml = new XMLSerializer().serializeToString(doc);
            fs.writeFileSync(inputFilePath, serializedXml, { encoding: 'utf8' });
            console.log(`使用备用方式完成文件写入: ${inputFilePath}`);
        } catch (backupError) {
            console.error(`备用写入方式也失败:`, backupError);
            throw backupError;
        }
    }
    
    return translationQueue.length;
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
