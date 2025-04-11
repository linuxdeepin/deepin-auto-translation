// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'fs';
import * as YAML from 'js-yaml';
import { parse } from 'ini';
import { execSync } from 'child_process';
import { TransifexIniResource, TransifexResource, TransifexYaml } from './types';
import * as Settings from './settings';

export function ensureLocalReposExist(resources: TransifexResource[])
{
    for (const resource of resources) {
        const { repository, branch, additionalMarker } = resource;
        // console.log(`repo ${repository}/${branch}`);
        const repoPath = `repo/${repository}`;
        if (additionalMarker === 'ignore') {
            console.log(`repo ${repoPath} marked as 'ignore', skipped...`);
            continue;
        }
        if (!fs.existsSync(repoPath)) {
            console.log(`repo ${repoPath} does not exist, cloning...`);
            let repoUrl = `https://github.com/${repository}.git`;
            if (repoUrl.startsWith("https://github.com/linuxdeepin")) {
                // replace to `https://gitee.com/deepin-community` mirror for faster clone
                repoUrl = repoUrl.replace("github.com/linuxdeepin", "gitee.com/deepin-community");
            }
            execSync(`git clone ${repoUrl} ${repoPath} --branch ${branch} --depth=1`, {
                stdio: 'inherit'
            });
        } else {
            // TODO: updating?
            console.log(`repo ${repoPath} exists, skipped...`);
        }
    }
}

export function getResourcePath(res: TransifexResource, languageCode: string)
{
    const { repository, resource } = res;
    const repoPath = `repo/${repository}`;
    const englishResourcePath = `${repoPath}/${resource}`;
    let result = '';
    const transifexYaml = YAML.load(fs.readFileSync(`${repoPath}/.tx/transifex.yaml`, 'utf8')) as TransifexYaml;
    for (const filter of transifexYaml.filters) {
        if (filter.source_file === resource) {
            if (filter.file_format !== 'QT') return '';
            const targetLanguagePath = filter.translation_files_expression
            result = targetLanguagePath.replace(/<lang>/g, languageCode);
            break;
        }
    }
    if (result === '') return result;
    result = `${repoPath}/${result}`;
    // also ensure resource file exists. if not, create it with lconvert
    if (!fs.existsSync(result)) {
        console.log(`${result} does not exist, creating...`);
        // /usr/lib/qt6/bin/lconvert -i ./dde-launchpad_ru.ts -o dde-launchpad_ar.ts -target-language ar -drop-translations
        const command = `${Settings.bin.lconvert} -i ${englishResourcePath} -o ${result} -target-language ${languageCode} -drop-translations`;
        const output = execSync(command);
        console.log(output.toString());
    }
    return result;
}

export function getResourcePathsFromTxConfig(repoPath: string, languageCode: string) : string[]
{
    const transifexCfg = parse(fs.readFileSync(`${repoPath}/.tx/config`, 'utf8'));
    let sections : TransifexIniResource[] = [];
    for (const key in transifexCfg) {
        if (key === "main") continue;
        sections.push(transifexCfg[key] as TransifexIniResource);
    }
    let resourcePaths : string[] = [];
    for (const res of sections) {
        if (res.type !== 'QT') continue;
        const targetLanguagePath = res.file_filter
        const targetResourcePath = targetLanguagePath.replace(/<lang>/g, languageCode)
        const targetResourceFullPath = `${repoPath}/${targetResourcePath}`
        if (!fs.existsSync(targetResourceFullPath)) {
            console.log(`${targetResourceFullPath} does not exist, skipping...`);
            continue
        }
        resourcePaths.push(targetResourcePath)
    }
    return resourcePaths
}

export function getResourcePathsFromTxYaml(repoPath: string, languageCode: string) : string[]
{
    const transifexYaml = YAML.load(fs.readFileSync(`${repoPath}/.tx/transifex.yaml`, 'utf8')) as TransifexYaml;
    let resourcePaths : string[] = [];
    for (const filter of transifexYaml.filters) {
        if (filter.file_format !== 'QT') continue;
        const targetLanguagePath = filter.translation_files_expression
        const targetResourcePath = targetLanguagePath.replace(/<lang>/g, languageCode)
        const targetResourceFullPath = `${repoPath}/${targetResourcePath}`
        if (!fs.existsSync(targetResourceFullPath)) {
            console.log(`${targetResourceFullPath} does not exist, skipping...`);
            continue
        }
        resourcePaths.push(targetResourcePath)
    }
    return resourcePaths
}

