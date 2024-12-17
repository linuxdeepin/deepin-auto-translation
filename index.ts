// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'fs';
import xmldom from 'xmldom';
import axios from 'axios';
import * as YAML from 'js-yaml';
import * as Secrets from './secrets';
import * as QtLinguist from './qtlinguist';
import * as Doubao from './doubao';
import * as Transifex from './transifex';
import * as GitRepo from './gitrepo';
import { MessageData, TransifexResource } from './types';
import { resourceUsage } from 'process';

async function translateLinguistTsFile(inputFilePath: string, keepUnfinishedTypeAttr : boolean = true) : Promise<number>
{
    const inputFileContents = fs.readFileSync(inputFilePath, 'utf8');
    const doc = new xmldom.DOMParser().parseFromString(inputFileContents, 'application/xml');
    // <TS language="ar" version="2.1">
    const tsElement = doc.getElementsByTagName('TS')[0];
    let targetLanguage = tsElement.getAttribute('language')!;
    if (targetLanguage === 'en') {
        console.log(`${inputFilePath} is already in English, skipped...`);
        return 0;
    }
    console.log(`Translating ${inputFilePath} to ${targetLanguage}`);

    let translationQueue = QtLinguist.extractStringsFromDocument(doc);
    // split translationQueue into batches, each batch contains 25 messages
    const batchSize = 25;
    for (let i = 0; i < translationQueue.length; i += batchSize) {
        const batch = translationQueue.slice(i, i + batchSize);
        await Doubao.fetchTranslations(batch, targetLanguage, keepUnfinishedTypeAttr);
    }

    fs.writeFileSync(inputFilePath, new xmldom.XMLSerializer().serializeToString(doc));

    return translationQueue.length;
}

// You need to do the main auto-translate logic here.

// The following one is just for demo purpose:
Doubao.fetchTranslations([
    {
        translationElement: null,
        context: "AppItemMenu",
        source: "Move to Top",
        comment: null
    },
    {
        translationElement: null,
        context: "BottomBar",
        source: "Full-screen Mode",
        comment: null
    },
    {
        translationElement: null,
        context: "DummyAppItemMenu",
        source: "Install",
        comment: null
    },
    {
        translationElement: null,
        context: "DummyAppItemMenu",
        source: "Remove",
        comment: null
    },
    {
        translationElement: null,
        context: "UninstallDialog",
        source: "Are you sure you want to uninstall %1?",
        comment: null
    }
], 'ar', true);
