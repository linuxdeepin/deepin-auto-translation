// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { MessageData } from './types';
import { Document } from '@xmldom/xmldom';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

export function createTsFileFromTemplate(targetLanguageCode: string, templateFilePath: string): string | null
{
    try {
        // 构建目标文件路径
        const templateDir = path.dirname(templateFilePath);
        const templateFileName = path.basename(templateFilePath);
        const targetFileName = templateFileName.replace(/_[a-z]{2}(?:_[A-Z]{2})?\.ts$/, `_${targetLanguageCode}.ts`);
        const targetFilePath = path.join(templateDir, targetFileName);
        
        // 使用lconvert工具从模板创建目标语言文件
        const command = `lconvert -i "${templateFilePath}" -o "${targetFilePath}" -target-language ${targetLanguageCode} -drop-translations`;
        
        console.log(`执行命令: ${command}`);
        try {
            execSync(command, { encoding: 'utf8' });
        } catch (error) {
            console.error(`执行lconvert命令失败:`, error);
            return null;
        }
        
        // 检查文件是否成功创建
        if (fs.existsSync(targetFilePath)) {
            return targetFilePath;
        }
        return null;
    } catch (error) {
        console.error('创建翻译文件模板失败:', error);
        return null;
    }
}

export function extractStringsFromDocument(doc: Document) : MessageData[]
{
    let translationQueue : MessageData[] = [];

    // <context>s
    const contextElements = doc.getElementsByTagName('context');
    for (let i = 0; i < contextElements.length; i++) {
        const contextElement = contextElements[i];
        // <name/>
        const nameElement = contextElement.getElementsByTagName('name')[0];
        // <message>s
        const messageElements = contextElement.getElementsByTagName('message');
        for (let j = 0; j < messageElements.length; j++) {
            const messageElement = messageElements[j];
            // <source/>
            const sourceElement = messageElement.getElementsByTagName('source')[0];
            // check if we have a <comment> element
            const commentElements = messageElement.getElementsByTagName('comment');
            let comment : string | null = commentElements.length > 0 ? commentElements[0].textContent : null;
            // <translation>
            let translationElement = messageElement.getElementsByTagName('translation')[0];
            // skip if translation is not unfinished
            if (translationElement.getAttribute('type') !== 'unfinished') {
                continue;
            }
            // skip if translation is already filled
            const messageTranslation = translationElement.textContent!.trim();
            if (messageTranslation.length !== 0) {
                continue;
            }
            const messageData : MessageData = {
                'translationElement': translationElement,
                'context': nameElement.textContent!,
                'source': sourceElement.textContent!,
                'comment': comment
            }
            translationQueue.push(messageData);
            // console.log(`  ${messageData.context}: ${messageData.source} ${comment ? `(${comment})` : ''}`)
            // </translation>
        }
        // </message>
    }
    // </context>

    return translationQueue;
}