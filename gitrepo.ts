// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import * as YAML from 'js-yaml';
import { execSync } from 'node:child_process';
import { TransifexResource, TransifexYaml } from './types';
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
