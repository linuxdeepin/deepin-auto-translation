// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import * as YAML from 'js-yaml';
import * as QtLinguist from './qtlinguist';
import * as OpenAI from './openai';
import * as Ollama from './ollama';
import * as Transifex from './transifex';
import * as GitRepo from './gitrepo';
import { MessageData, TransifexRepo, TransifexResource } from './types';
import { exit } from 'node:process';
import * as Translator from './translator';
import * as Doubao from './doubao';

// You need to do the main auto-translate logic here.

// The following one is just for demo purpose:
await OpenAI.fetchTranslations([
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
