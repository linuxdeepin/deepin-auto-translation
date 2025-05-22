// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import axios from 'axios';
import * as YAML from 'js-yaml';
import { parse } from 'ini';
import * as Secrets from './secrets';
import { TransifexIniResource, TransifexRepo, TransifexResource, TransifexYaml } from './types';
import { execSync } from 'node:child_process';

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
export async function uploadTranslatedFileToTransifex(language: string, filepath: string, resourceId: string): Promise<boolean> {
    console.log(`准备上传文件 ${filepath} 到Transifex资源 ${resourceId}, 语言: ${language}`);
    
    try {
        // 首先读取文件内容
        const fileContent = await fs.promises.readFile(filepath, 'utf8');
        const fileSize = Buffer.byteLength(fileContent);
        console.log(`文件大小: ${fileSize} 字节`);
        
        // 创建FormData
        const formData = new FormData();
        formData.append('content', await fs.openAsBlob(filepath));
        formData.append('file_type', 'default');
        formData.append('language', `l:${language}`);
        formData.append('resource', resourceId);
        
        console.log(`开始上传文件到Transifex...`);
        
        const response = await fetch('https://rest.api.transifex.com/resource_translations_async_uploads', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${Secrets.transifex.accessKey}`
            },
            body: formData
        });
        
        // 解析响应
        const responseText = await response.text();
        
        // 检查HTTP状态码
        if (!response.ok) {
            // 处理409冲突错误
            if (response.status === 409) {
                console.log(`⚠️ 文件 ${filepath} 上传时发生冲突(HTTP 409)。这通常意味着相同内容已存在于Transifex上。`);
                console.log(`这不是错误，表示文件已经存在且内容相同，无需重复上传。`);
                return true; // 视为成功，因为文件内容已存在
            } else {
                let errorDetail = "未知错误";
                try {
                    const errorJson = JSON.parse(responseText);
                    if (errorJson.errors && errorJson.errors.length > 0) {
                        errorDetail = `${errorJson.errors[0].code}: ${errorJson.errors[0].detail}`;
                    }
                } catch (e) {
                    errorDetail = responseText || `HTTP错误! 状态码: ${response.status}`;
                }
                
                console.error(`❌ 上传文件 ${filepath} 失败: ${errorDetail}`);
                return false;
            }
        }
        
        // 成功响应
        try {
            const data = JSON.parse(responseText);
            console.log(`✅ 文件 ${filepath} 上传成功! 响应: `, data);
            return true;
        } catch (parseError) {
            console.log(`✅ 文件 ${filepath} 上传成功，但无法解析响应: ${responseText}`);
            return true;
        }
    } catch (error) {
        console.error(`❌ 上传文件 ${filepath} 时发生异常:`, error);
        return false;
    }
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
