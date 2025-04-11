// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { MessageData } from './types';

function createTsFileFromTemplate(targetLanguageCode: string, templateFilePath: string)
{
    // /usr/lib/qt6/bin/lconvert -i ./dde-launchpad_ru.ts -o dde-launchpad_ar.ts -target-language ar -drop-translations
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