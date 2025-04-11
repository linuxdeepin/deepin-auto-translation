// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'fs';
import axios from 'axios';
import * as YAML from 'js-yaml';
import { parse } from 'ini';
import * as Secrets from './secrets';
import { TransifexIniResource, TransifexRepo, TransifexResource, TransifexYaml } from './types';
import { execSync } from 'child_process';

async function getTransifexAllPages(url: string) {
    try {
        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${Secrets.transifex.accessKey}`
            }
        });
        const content = response.data.data;
        if (response.data.links.next) {
            return content.concat(await getTransifexAllPages(response.data.links.next));
        } else {
            return content;
        }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.response && error.response.status >= 400) {
                const errorCode = error.response.data.errors[0].code;
                const errorDetail = error.response.data.errors[0].detail;
                console.error(`Error Code: ${errorCode}, Error Detail: ${errorDetail}`);
            } else {
                console.error('An error occurred:', error.message);
            }
        } else {
            console.error('An unexpected error occurred:', error);
        }
    }
}

// organizationId: string, like "o:linuxdeepin", return a list of projectIds, formateed can be passed directly to `getAllLinkedResources`
export async function getAllProjects(organizationId: string): Promise<string[]>
{
    const txapiurl = `https://rest.api.transifex.com/projects?filter[organization]=${organizationId}`;
    const projects = await getTransifexAllPages(txapiurl);
    return projects.map(project => project.id);
}

// projectId: string, like "o:linuxdeepin:p:deepin-desktop-environment"
export async function getAllLinkedResources(projectId: string): Promise<TransifexResource[]>
{
    const txapiurl = `https://rest.api.transifex.com/resources?filter[project]=${projectId}`;
    const resources = await getTransifexAllPages(txapiurl);
    const filteredResources = resources.filter(resource => {
        const categories = resource.attributes.categories;
        if (categories === null || categories.length === 0) return false;
        // linked resource's category format should be "github#repository:linuxdeepin/dde-launchpad#branch:master#path:path/to/file.ts"
        // "legacy" ones uses the branch name as resource name, like "m20", "m23"
        return categories[0].startsWith("github#");
    });
    return filteredResources.map(resource => {
        const category : string = resource.attributes.categories[0];
        const parts = category.split('#');
        const parsedData = parts.reduce((acc, part) => {
            const [key, value] = part.split(':');
            if (key && value) {
                acc[key] = value;
            }
            return acc;
        }, {} as { [key: string]: string });

        return {
            repository: parsedData.repository,
            branch: parsedData.branch,
            resource: parsedData.path,
            transifexResourceId: resource.id
        };
    });
}

export async function getAllLinkedResourcesFromProjects(projectIds: string[])
{
    const allResources: TransifexResource[] = [];
    for (const projectId of projectIds) {
        const resources = await getAllLinkedResources(projectId);
        allResources.push(...resources);
    }
    return allResources;
}

// resourceId: string, like "o:linuxdeepin:p:deepin-desktop-environment:r:m23--dde-launchpad"
export async function uploadTranslatedFileToTransifex(language: string, filepath: string, resourceId: string)
{
    const formData = new FormData();
    formData.append('content', await fs.openAsBlob(filepath));
    formData.append('file_type', 'default')
    formData.append('language', `l:${language}`);
    formData.append('resource', resourceId);
    axios.postForm('https://rest.api.transifex.com/resource_translations_async_uploads', formData, {
        headers: {
            Authorization: `Bearer ${Secrets.transifex.accessKey}`
        }
    }).then(response => {
        console.log(response.data, response.statusText);
    }).catch(error => {
        console.error(error.response.status, error.response.data);
    })
}

export function isEmptyTxRepo(repo: TransifexRepo): boolean {
    let isEmptyRepo = false;
    fs.readdir(repo.path, (err, files) => {
        isEmptyRepo = files.length === 1; 
    });
    return isEmptyRepo;
}

export function downloadTranslationFilesViaCli(repoPath: string, txBranch: string = "-1")
{
    const output = execSync(`tx pull --all --branch ${txBranch}`, {
        cwd: repoPath,
        stdio: 'inherit'
    });
}

export function uploadTranslatedFilesViaCli(language: string, repoPath: string, txBranch: string = "-1")
{
    if (fs.existsSync(`${repoPath}/.tx/config`)) {
        const output = execSync(`tx push -t --languages ${language} --branch ${txBranch}`, {
            cwd: repoPath,
            stdio: 'inherit'
        });
    } else {
        console.error(`${repoPath}/.tx/config does not exist, skipping...`);
    }
}

export function getResourcePathsFromTxRepo(txRepo: TransifexRepo, languageCode: string) : string[]
{
    const txConfigPath = `${txRepo.path}/.tx/config`;
    const txYamlPath = `${txRepo.path}/.tx/transifex.yaml`;
    if (fs.existsSync(txYamlPath)) {
        return getResourcePathsFromTxYaml(txRepo.path, languageCode);
    } else if (fs.existsSync(txConfigPath)) {
        return getResourcePathsFromTxConfig(txRepo.path, languageCode);
    } else {
        console.error(`${txConfigPath} or ${txYamlPath} does not exist, skipping...`);
        return [];
    }
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
