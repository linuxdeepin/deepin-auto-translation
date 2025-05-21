// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import * as YAML from 'js-yaml';
import { execSync } from 'node:child_process';
import { TransifexResource, TransifexYaml } from './types';
import * as Settings from './settings';

export function ensureLocalReposExist(resources: TransifexResource[], useMirror: boolean = true)
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
            if (repoUrl.startsWith("https://github.com/linuxdeepin") && useMirror) {
                // replace to `https://gitee.com/deepin-community` mirror for faster clone
                repoUrl = repoUrl.replace("github.com/linuxdeepin", "gitee.com/deepin-community");
            }
            try {
                // 设置超时和强制退出，避免无限等待
                const cloneCommand = `git clone ${repoUrl} ${repoPath} --branch ${branch} --depth=1 --single-branch`;
                console.log(`执行命令: ${cloneCommand}`);
                
                // 使用timeout命令设置超时，如果超过300秒（5分钟）则终止进程
                const timeoutCommand = `timeout 300 ${cloneCommand}`;
                execSync(timeoutCommand, {
                    stdio: 'inherit',
                    timeout: 300000 // 设置300秒(5分钟)超时
                });
                console.log(`repo ${repoPath} cloned successfully`);
            } catch (error) {
                // 如果克隆失败但是目录被部分创建了，尝试删除它
                if (fs.existsSync(repoPath)) {
                    try {
                        console.error(`Clone failed for ${repoPath}, cleaning up partially created directory...`);
                        execSync(`rm -rf ${repoPath}`);
                    } catch (cleanupError) {
                        console.error(`Failed to clean up ${repoPath}: ${cleanupError}`);
                    }
                }
                
                console.error(`Failed to clone ${repoPath}: ${error}`);
                console.log(`Continuing with next repository...`);
                continue; // 继续处理下一个仓库
            }
        } else {
            // 检查已存在的仓库状态
            try {
                // 使用git status命令检查仓库状态，确认它是一个有效的git仓库
                execSync(`cd ${repoPath} && git status`, { stdio: 'ignore', timeout: 5000 });
                console.log(`repo ${repoPath} exists and is valid, skipped...`);
            } catch (error) {
                // 如果不是有效的git仓库，则报错并继续
                console.error(`repo ${repoPath} exists but is not a valid git repository: ${error}`);
                console.log(`Continuing with next repository...`);
            }
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
