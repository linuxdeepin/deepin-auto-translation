// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import axios from 'axios';
import * as YAML from 'js-yaml';
import * as Secrets from './secrets';
import * as QtLinguist from './qtlinguist';
import * as Ollama from './ollama';
import * as Transifex from './transifex';
import * as GitRepo from './gitrepo';
import { MessageData, TransifexResource } from './types';
import { exit } from 'node:process';

async function translateLinguistTsFile(inputFilePath: string, keepUnfinishedTypeAttr : boolean = true) : Promise<number>
{
    const inputFileContents = fs.readFileSync(inputFilePath, 'utf8');
    const doc = new DOMParser().parseFromString(inputFileContents, 'application/xml');
    // <TS language="ar" version="2.1">
    const tsElement = doc.getElementsByTagName('TS')[0];
    let targetLanguage = tsElement.getAttribute('language')!;
    if (targetLanguage === 'en') {
        console.log(`${inputFilePath} is already in English, skipped...`);
        return 0;
    }
    console.log(`Translating ${inputFilePath} to ${targetLanguage}`);

    let translationQueue = QtLinguist.extractStringsFromDocument(doc);
    console.log(`Extracted ${translationQueue.length} untranslated strings from file: ${inputFilePath}`)
    // split translationQueue into batches, each batch contains 25 messages
    const batchSize = 25;
    for (let i = 0; i < translationQueue.length; i += batchSize) {
        const batch = translationQueue.slice(i, i + batchSize);
        await Ollama.fetchTranslations(batch, targetLanguage, keepUnfinishedTypeAttr);
        fs.writeFileSync(inputFilePath, new XMLSerializer().serializeToString(doc));
    }

    return translationQueue.length;
}

// You need to do the main auto-translate logic here.

// The following one is just for demo purpose:
Ollama.fetchTranslations([
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

// translateLinguistTsFile('./repo/linuxdeepin/dde-shell/panels/notification/osd/default/translations/org.deepin.ds.osd.default_ar.ts', false);


// use Transifex API to get a list of resources under o:linuxdeepin:p:deepin-desktop-environment
// const resources = await Transifex.getAllLinkedResources('o:linuxdeepin:p:deepin-desktop-environment');
// console.log(`Found ${resources.length} resources`, resources);


// Transifex.uploadTranslatedFileToTransifex('ar', './dde-launchpad_ar.ts.ts', 'o:linuxdeepin:p:deepin-desktop-environment:r:bb726c8fc86b842e75820abb670f0f48');

/*
const transifexProjects = await Transifex.getAllProjects('o:linuxdeepin');
fs.writeFileSync('./transifex-projects.yml', YAML.dump(transifexProjects));

// read transifex-projects.yml and get all resources form these projects
// const transifexProjects = YAML.load(fs.readFileSync('./transifex-projects.yml', 'utf8')) as string[];
const allResources = await Transifex.getAllLinkedResourcesFromProjects(transifexProjects);
// save allResources to yaml file
fs.writeFileSync('./transifex-resources.yml', YAML.dump(allResources));
*/

/*
const transifexResources = YAML.load(fs.readFileSync('./transifex-resources.yml', 'utf8')) as TransifexResource[];
GitRepo.ensureLocalReposExist(transifexResources);
for (const resource of transifexResources) {
    if (resource.additionalMarker === undefined) {
        const resPath = GitRepo.getResourcePath(resource, 'ar');
        if (resPath === '') {
            console.log(`Skipping ${resource}...`);
            resource.additionalMarker = 'skipped';
            fs.writeFileSync('./transifex-resources.yml', YAML.dump(transifexResources));
            continue;
        }
        console.log(resPath, "aaa");
        const strCount = await translateLinguistTsFile(resPath, false);
        if (strCount > 0) {
            console.log(`Uploading ${resPath} to Transifex (${resource.transifexResourceId})...`);
            Transifex.uploadTranslatedFileToTransifex('ar', resPath, resource.transifexResourceId);
            resource.additionalMarker = 'translated';
        } else {
            console.log(`Skipping ${resPath}...`);
            resource.additionalMarker = 'skipped';
        }
        fs.writeFileSync('./transifex-resources.yml', YAML.dump(transifexResources));
    }
}
*/
