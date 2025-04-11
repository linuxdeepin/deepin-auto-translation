// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { Element } from '@xmldom/xmldom'

export type TransifexYaml = {
    filters: {
        filter_type: string,
        source_file: string,
        file_format: string,
        source_language: string,
        translation_files_expression: string
    }[],
    settings: {
        pr_branch_name: string
    }
}

export type TransifexIniResource = {
    file_filter: string,
    source_file: string,
    source_lang: string,
    type: string
}

export type TransifexRepo = {
    path: string,
    txBranch: string,
    targetLanguageCodes: string[]
}

export type TransifexResource = {
    repository: string, // "linuxdeepin/dde-launchpad"
    branch: string, // "master"
    resource: string, // "path/to/file.ts"
    transifexResourceId: string, // "o:linuxdeepin:p:deepin-desktop-environment:r:m23--dde-launchpad"
    additionalMarker: any, // could be used to mark if a resource is translated or not, can be `undefined`
}

export type MessageData = {
    translationElement: Element | null,
    context: string,
    source: string,
    comment: string | null
}
