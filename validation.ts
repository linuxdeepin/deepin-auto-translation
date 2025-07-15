// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

import settings from './settings';
import Secrets from './secrets';
import { MessageData } from './types';
import fs from 'fs';
import path from 'path';
import process from 'process';
import * as OpenAI from './openai';

/**
 * 验证配置接口
 */
export interface ValidationConfig {
    enableBackTranslation: boolean;        // 启用回译验证
    enableLanguageDetection: boolean;      // 启用语种检测
    requireBothPassed: boolean;            // 是否要求双重验证都通过
    enableRetry: boolean;                  // 失败时是否重试
    configName: string;                    // 配置名称
}

/**
 * 验证结果接口
 */
export interface ValidationResult {
    isValid: boolean;
    languageMatch: boolean;
    meaningPreserved: boolean;
    similarity: number;
    details: string;
    backTranslation?: string;  // 添加回译内容字段
}

/**
 * 批次验证结果接口
 */
export interface BatchValidationResult {
    totalCount: number;                    // 总翻译数
    backTranslationPassedCount: number;    // 回译验证通过数
    languageDetectionPassedCount: number;  // 语种检测通过数
    finalPassedCount: number;             // 最终验证通过数
    failedCount: number;                  // 验证失败数
    passRate: number;                     // 验证通过率
}

/**
 * 支持的语种列表 - 需要进行验证的语种
 */
const REQUIRED_LANGUAGES = [
    "ady",
    "af",
    "am_ET",
    "ar",
    "ast",
    "az",
    "bg",
    "bn",
    "bo",
    "bqi",
    "br",
    "ca",
    "cs",
    "da",
    "de",
    "el",
    "en_AU",
    "eo",
    "es",
    "et",
    "eu",
    "fa",
    "fi",
    "fil",
    "fr",
    "gl_ES",
    "he",
    "hi_IN",
    "hr",
    "hu",
    "hy",
    "id",
    "it",
    "ja",
    "ka",
    "km_KH",
    "kn_IN",
    "ko",
    "ku",
    "ku_IQ",
    "ky",
    "lt",
    "ml",
    "mn",
    "mr",
    "ms",
    "my",
    "nb",
    "ne",
    "nl",
    "pam",
    "pl",
    "pt",
    "pt_BR",
    "ro",
    "ru",
    "sc",
    "si",
    "sk",
    "sl",
    "sq",
    "sr",
    "sv",
    "sw",
    "ta",
    "th",
    "tr",
    "tzm",
    "ug",
    "uk",
    "ur",
    "vi",
    "zh_CN",
    "zh_HK",
    "zh_TW"
];

/**
 * 基于拉丁字母的语种列表
 */
const LATIN_BASED_LANGUAGES = [
    'af', 'ast', 'az', 'br', 'ca', 'cs', 'da', 'de', 'en_AU', 'eo', 'es', 'et',
    'eu', 'fi', 'fil', 'fr', 'gl_ES', 'hr', 'hu', 'id', 'it', 'lt', 'ms', 'nb',
    'nl', 'pam', 'pl', 'pt', 'pt_BR', 'ro', 'sc', 'sk', 'sl', 'sq', 'sr', 'sv',
    'sw', 'tr', 'tzm', 'vi'
];

/**
 * 检查语种是否为拉丁字母语种
 */
function isLatinBasedLanguage(langCode: string): boolean {
    return LATIN_BASED_LANGUAGES.includes(langCode);
}

/**
 * 预设验证配置
 */
export const VALIDATION_CONFIGS: Record<string, ValidationConfig> = {
    // 默认配置：使用混合语种检测（规则+AI）
    default: {
        enableBackTranslation: true,
        enableLanguageDetection: true,
        requireBothPassed: true,
        enableRetry: false,
        configName: '默认配置 (规则+AI语种检测)'
    },
    disabled: {
        enableBackTranslation: false,
        enableLanguageDetection: false,
        requireBothPassed: false,
        enableRetry: false,
        configName: '禁用验证'
    }
};

/**
 * 获取当前验证配置
 * 注意：语种检测现在已集成到翻译流程中默认启用，此配置主要用于批次后的额外验证
 */
export function getValidationConfig(): ValidationConfig {
    // 允许环境变量覆盖默认配置
    const configType = process.env.VALIDATION_CONFIG;
    
    // 如果设置了有效的环境变量配置，使用环境变量配置
    if (configType && configType in VALIDATION_CONFIGS) {
        return VALIDATION_CONFIGS[configType];
    }
    
    // 否则使用默认配置
    return VALIDATION_CONFIGS.default;
}

/**
 * 计算 Levenshtein 距离
 */
function levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    
    // 创建距离矩阵
    const matrix: number[][] = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
    
    // 初始化第一行和第一列
    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;
    
    // 填充矩阵
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,     // 删除
                    matrix[i][j - 1] + 1,     // 插入
                    matrix[i - 1][j - 1] + 1  // 替换
                );
            }
        }
    }
    
    return matrix[len1][len2];
}

/**
 * 语义相似度计算，更注重含义而非字面匹配
 */
function calculateSemanticSimilarity(str1: string, str2: string): number {
    // 标准化字符串：转换为小写，去除多余空格和标点符号
    const normalize = (text: string) => {
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')  // 替换所有标点符号为空格
            .replace(/\s+/g, ' ')      // 合并多个空格
            .trim();
    };
    
    const normalized1 = normalize(str1);
    const normalized2 = normalize(str2);
    
    if (normalized1 === normalized2) return 100;
    if (normalized1.length === 0 && normalized2.length === 0) return 100;
    if (normalized1.length === 0 || normalized2.length === 0) return 0;
    
    // 按词分割进行比较
    const words1 = normalized1.split(' ').filter(w => w.length > 0);
    const words2 = normalized2.split(' ').filter(w => w.length > 0);
    
    // 计算词语重合度
    const intersection = words1.filter(word => words2.includes(word));
    const union = [...new Set([...words1, ...words2])];
    const wordSimilarity = union.length > 0 ? (intersection.length / union.length) * 100 : 0;
    
    // 计算字符相似度
    const distance = levenshteinDistance(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);
    const charSimilarity = ((maxLength - distance) / maxLength) * 100;
    
    // 语义相似度：词语重合度权重更高
    const similarity = wordSimilarity * 0.7 + charSimilarity * 0.3;
    
    return Math.max(0, Math.min(100, similarity));
}

/**
 * 保持向后兼容的相似度计算函数
 */
function calculateSimilarity(str1: string, str2: string): number {
    return calculateSemanticSimilarity(str1, str2);
}

/**
 * 语言代码映射到语言名称
 */
const LANGUAGE_NAMES: Record<string, string> = {
    'zh_CN': '简体中文',
    'zh_TW': '繁体中文',
    'zh_HK': '繁体中文（香港）',
    'en_AU': '英语（澳大利亚）',
    'es': '西班牙语',
    'fr': '法语',
    'de': '德语',
    'it': '意大利语',
    'ja': '日语',
    'ko': '韩语',
    'ar': '阿拉伯语',
    'ru': '俄语',
    'pt': '葡萄牙语',
    'pt_BR': '葡萄牙语（巴西）',
    'nl': '荷兰语',
    'pl': '波兰语',
    'tr': '土耳其语',
    'th': '泰语',
    'vi': '越南语',
    'hi_IN': '印地语',
    'bn': '孟加拉语',
    'ur': '乌尔都语',
    'fa': '波斯语',
    'he': '希伯来语',
    'sv': '瑞典语',
    'da': '丹麦语',
    'nb': '挪威语',
    'fi': '芬兰语',
    'hu': '匈牙利语',
    'cs': '捷克语',
    'sk': '斯洛伐克语',
    'sl': '斯洛文尼亚语',
    'hr': '克罗地亚语',
    'sr': '塞尔维亚语',
    'bg': '保加利亚语',
    'ro': '罗马尼亚语',
    'et': '爱沙尼亚语',
    'lt': '立陶宛语',
    'uk': '乌克兰语',
    'eu': '巴斯克语',
    'ca': '加泰罗尼亚语',
    'gl_ES': '加利西亚语',
    'sq': '阿尔巴尼亚语',
    'hy': '亚美尼亚语',
    'ka': '格鲁吉亚语',
    'az': '阿塞拜疆语',
    'ky': '吉尔吉斯语',
    'mn': '蒙古语',
    'my': '缅甸语',
    'km_KH': '高棉语',
    'si': '僧伽罗语',
    'ta': '泰米尔语',
    'kn_IN': '卡纳达语',
    'ml': '马拉雅拉姆语',
    'mr': '马拉地语',
    'ne': '尼泊尔语',
    'ms': '马来语',
    'id': '印度尼西亚语',
    'fil': '菲律宾语',
    'sw': '斯瓦希里语',
    'af': '南非荷兰语',
    'am_ET': '阿姆哈拉语',
    'ady': '阿迪格语',
    'ast': '阿斯图里亚斯语',
    'bo': '藏语',
    'bqi': '巴赫蒂亚里语',
    'br': '布列塔尼语',
    'eo': '世界语',
    'ku': '库尔德语',
    'ku_IQ': '库尔德语（伊拉克）',
    'pam': '邦板牙语',
    'sc': '撒丁语',
    'tzm': '中阿特拉斯塔马塞特语',
    'ug': '维吾尔语',
    'el': '希腊语'
};

/**
 * 获取语言名称 - 返回英文缩写而不是中文名称
 */
function getLanguageName(langCode: string): string {
    // 直接返回语种代码，不进行中文映射
    return langCode;
}

/**
 * 调用翻译API
 */
async function callTranslationAPI(text: string, targetLanguage: string): Promise<string> {
    const response = await fetch(settings.openai.chatCompletionsEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Secrets.openai.accessKey}`
        },
        body: JSON.stringify({
            model: settings.openai.model,
            messages: [
                {
                    role: 'user',
                    content: `请将以下文本翻译为${getLanguageName(targetLanguage)}，只返回翻译结果，不要任何解释：\n\n${text}`
                }
            ],
            temperature: 0.1,
            max_tokens: 1000
        })
    });

    if (!response.ok) {
        throw new Error(`翻译API请求失败: ${response.status}`);
    }

    const data = await response.json();
    const translation = data.choices?.[0]?.message?.content?.trim();
    
    if (!translation) {
        throw new Error('翻译API返回空内容');
    }

    return translation;
}

/**
 * 处理XML内容的辅助函数
 */
function processXmlContent(text: string): string {
    // 简单处理：保留XML标签但去除多余空白
    return text.trim();
}

/**
 * 基于规则集的语种检测系统
 * 使用文本特征匹配闭源流程中定义的语种列表
 */
function performRuleBasedLanguageDetection(
    translation: string,
    expectedLanguage: string
): { detectedLanguage: string; isCorrect: boolean } {
    // 去除前后空白并转小写
    const text = translation.trim().toLowerCase();
    
    // 处理空文本
    if (!text) {
        return {
            detectedLanguage: 'unknown',
            isCorrect: false
        };
    }

    // 检查是否匹配期望语种
    if (isLanguageVariantMatch(expectedLanguage, expectedLanguage)) {
        return {
            detectedLanguage: expectedLanguage,
            isCorrect: true
        };
    }

    // 中文检测 (包括简体和繁体)
    const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf]/;
    if (chineseRegex.test(text)) {
        // 简体中文检测
        if (['zh_CN', 'zh'].includes(expectedLanguage)) {
            return {
                detectedLanguage: 'zh_CN',
                isCorrect: true
            };
        }
        // 繁体中文检测
        if (['zh_TW', 'zh_HK'].includes(expectedLanguage)) {
            return {
                detectedLanguage: expectedLanguage,
                isCorrect: true
            };
        }
        // 检测到中文但不匹配期望语种
        return {
            detectedLanguage: 'zh',
            isCorrect: false
        };
    }

    // 西里尔字母检测 (俄语、保加利亚语、乌克兰语等)
    const cyrillicRegex = /[\u0400-\u04ff]/;
    if (cyrillicRegex.test(text)) {
        // 俄语检测
        if (expectedLanguage === 'ru') {
            return {
                detectedLanguage: 'ru',
                isCorrect: true
            };
        }
        // 保加利亚语检测
        if (expectedLanguage === 'bg') {
            const bulgarianWords = ['това', 'който', 'някой', 'нещо', 'където', 'когато'];
            const hasBulgarianWords = bulgarianWords.some(word => text.includes(word));
            if (hasBulgarianWords) {
                return {
                    detectedLanguage: 'bg',
                    isCorrect: true
                };
            }
        }
        // 乌克兰语检测
        if (expectedLanguage === 'uk') {
            return {
                detectedLanguage: 'uk',
                isCorrect: true
            };
        }
        // 检测到西里尔字母但不确定具体语种
        return {
            detectedLanguage: 'cyrillic',
            isCorrect: false
        };
    }

    // 阿拉伯语检测
    const arabicRegex = /[\u0600-\u06ff\u0750-\u077f]/;
    if (arabicRegex.test(text)) {
        if (expectedLanguage === 'ar') {
            return {
                detectedLanguage: 'ar',
                isCorrect: true
            };
        }
        return {
            detectedLanguage: 'ar',
            isCorrect: false
        };
    }

    // 日语检测 (平假名、片假名、汉字)
    const hiraganaRegex = /[\u3040-\u309f]/;
    const katakanaRegex = /[\u30a0-\u30ff]/;
    if (hiraganaRegex.test(text) || katakanaRegex.test(text)) {
        if (expectedLanguage === 'ja') {
            return {
                detectedLanguage: 'ja',
                isCorrect: true
            };
        }
        return {
            detectedLanguage: 'ja',
            isCorrect: false
        };
    }

    // 韩语检测
    const koreanRegex = /[\uac00-\ud7af]/;
    if (koreanRegex.test(text)) {
        if (expectedLanguage === 'ko') {
            return {
                detectedLanguage: 'ko',
                isCorrect: true
            };
        }
        return {
            detectedLanguage: 'ko',
            isCorrect: false
        };
    }

    // 泰语检测
    const thaiRegex = /[\u0e00-\u0e7f]/;
    if (thaiRegex.test(text)) {
        if (expectedLanguage === 'th') {
            return {
                detectedLanguage: 'th',
                isCorrect: true
            };
        }
        return {
            detectedLanguage: 'th',
            isCorrect: false
        };
    }

    // 拉丁字母语种检测
    const latinRegex = /[a-zA-Z]/;
    if (latinRegex.test(text)) {
        // 针对具体语种的关键词检测
        const languagePatterns = {
            'de': ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'eine', 'auf', 'für'],
            'es': ['el', 'la', 'de', 'que', 'y', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da', 'su', 'por', 'son', 'con', 'para', 'una', 'del', 'al'],
            'fr': ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir', 'que', 'pour', 'dans', 'ce', 'son', 'une', 'sur', 'avec', 'ne', 'se', 'pas', 'tout', 'plus', 'par', 'grand', 'en', 'une', 'être', 'et', 'en', 'avoir', 'que', 'pour'],
            'it': ['il', 'di', 'che', 'e', 'la', 'un', 'a', 'per', 'non', 'una', 'in', 'sono', 'mi', 'ho', 'lo', 'ma', 'se', 'con', 'tutto', 'anche', 'ci', 'da', 'ancora', 'questo', 'già', 'come', 'mai', 'dopo', 'molto', 'bene', 'senza', 'può', 'dove', 'subito', 'qui'],
            'pt': ['o', 'de', 'e', 'do', 'da', 'em', 'um', 'para', 'é', 'com', 'não', 'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'foi', 'ao', 'ele', 'das', 'tem', 'à', 'seu', 'sua', 'ou', 'ser', 'quando', 'muito', 'há', 'nos', 'já', 'está', 'eu', 'também', 'só', 'pelo', 'pela', 'até', 'isso', 'ela', 'entre', 'era', 'depois', 'sem', 'mesmo', 'aos', 'ter', 'seus', 'suas', 'numa', 'pelos', 'pelas', 'esse', 'eles', 'estão', 'você', 'tinha', 'foram', 'essa', 'num', 'nem', 'suas', 'meu', 'às', 'minha', 'têm', 'numa', 'pelos', 'pelas', 'numa', 'dela', 'deles', 'estas', 'estes', 'essas', 'esses', 'aquela', 'aquele', 'aqueles', 'aquelas'],
            'pl': ['i', 'w', 'na', 'z', 'to', 'się', 'nie', 'do', 'że', 'o', 'a', 'jak', 'te', 'co', 'ale', 'od', 'za', 'po', 'już', 'tylko', 'jego', 'jej', 'tym', 'czy', 'też', 'dla', 'może', 'przy', 'przez', 'pod', 'bez', 'nad', 'przed', 'między', 'podczas', 'według', 'wśród', 'około', 'wokół', 'wobec', 'względem', 'dzięki', 'mimo', 'wbrew', 'przeciwko'],
            'nl': ['de', 'het', 'en', 'van', 'in', 'een', 'te', 'dat', 'op', 'is', 'voor', 'met', 'niet', 'aan', 'als', 'zijn', 'er', 'maar', 'om', 'door', 'over', 'ze', 'bij', 'uit', 'ook', 'tot', 'je', 'naar', 'kan', 'nog', 'worden', 'dit', 'onder', 'tegen', 'na', 'reeds', 'hier', 'zo', 'zonder', 'nu', 'al', 'zal', 'hen', 'dan', 'zou', 'haar', 'der', 'meer', 'veel', 'geen', 'hem', 'was'],
            'sv': ['och', 'i', 'att', 'det', 'som', 'på', 'de', 'av', 'för', 'inte', 'den', 'till', 'är', 'en', 'om', 'så', 'har', 'hans', 'hon', 'honom', 'hennes', 'de', 'dem', 'denna', 'denna', 'detta', 'dessa', 'där', 'här', 'när', 'sedan', 'innan', 'medan', 'eftersom', 'därför', 'dock', 'emellertid', 'alltså', 'inte', 'aldrig', 'alltid', 'ofta', 'ibland', 'sällan'],
            'da': ['og', 'i', 'at', 'det', 'som', 'på', 'de', 'af', 'for', 'ikke', 'den', 'til', 'er', 'en', 'om', 'så', 'har', 'hans', 'hun', 'ham', 'hendes', 'de', 'dem', 'denne', 'denne', 'dette', 'disse', 'hvor', 'her', 'når', 'siden', 'før', 'mens', 'fordi', 'derfor', 'dog', 'imidlertid', 'altså', 'ikke', 'aldrig', 'altid', 'ofte', 'nogle gange', 'sjældent'],
            'fi': ['ja', 'on', 'se', 'että', 'ei', 'ole', 'hän', 'minä', 'sinä', 'me', 'te', 'he', 'tämä', 'tuo', 'nämä', 'nuo', 'kuka', 'mikä', 'missä', 'milloin', 'miksi', 'miten', 'jos', 'kun', 'koska', 'vaikka', 'jotta', 'että', 'mutta', 'tai', 'sekä', 'myös', 'vain', 'vielä', 'jo', 'ei', 'en', 'et', 'emme', 'ette', 'eivät']
        };

        for (const [langCode, keywords] of Object.entries(languagePatterns)) {
            if (expectedLanguage === langCode || isLanguageVariantMatch(expectedLanguage, langCode)) {
                const matches = keywords.filter(keyword => text.includes(keyword)).length;
                if (matches >= 2) { // 至少匹配2个关键词
                    return {
                        detectedLanguage: langCode,
                        isCorrect: true
                    };
                }
            }
        }

        // 如果是英语期望语种，检查英语特征
        if (['en', 'en_US', 'en_GB'].includes(expectedLanguage)) {
            const englishWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall', 'this', 'that', 'these', 'those', 'a', 'an', 'some', 'any', 'all', 'no', 'not', 'only', 'just', 'very', 'too', 'so', 'more', 'most', 'less', 'least', 'much', 'many', 'few', 'little', 'big', 'small', 'long', 'short', 'high', 'low', 'good', 'bad', 'new', 'old', 'first', 'last', 'next', 'same', 'different', 'other', 'another', 'each', 'every', 'both', 'either', 'neither', 'one', 'two', 'three', 'here', 'there', 'where', 'when', 'why', 'how', 'what', 'who', 'which', 'whose'];
            const matches = englishWords.filter(word => text.includes(word)).length;
            if (matches >= 2) {
                return {
                    detectedLanguage: 'en',
                    isCorrect: true
                };
            }
        }

        // 对于拉丁字母语种，如果找不到特征，假设检测为英语
        return {
            detectedLanguage: 'en',
            isCorrect: isLanguageVariantMatch(expectedLanguage, 'en')
        };
    }

    // 无法识别的文本
    return {
        detectedLanguage: 'unknown',
        isCorrect: false
    };
}

/**
 * 检查语种是否为相近或方言变体
 */
function isLanguageVariantMatch(detected: string, expected: string): boolean {
    // 规范化语种代码
    const normalizeLanguage = (lang: string): string => {
        return lang.toLowerCase().replace(/[_-]/g, '');
    };
    
    const normalizedDetected = normalizeLanguage(detected);
    const normalizedExpected = normalizeLanguage(expected);
    
    // 直接匹配
    if (normalizedDetected === normalizedExpected) {
        return true;
    }
    
    // 语种变体映射
    const variants: { [key: string]: string[] } = {
        'zh': ['zh_cn', 'zh_tw', 'zh_hk', 'zhcn', 'zhtw', 'zhhk'],
        'en': ['en_us', 'en_gb', 'en_au', 'enus', 'engb', 'enau'],
        'pt': ['pt_br', 'ptbr'],
        'sr': ['sr_latn', 'srlatn'],
        'ku': ['ku_iq', 'kuiq'],
        'gl': ['gl_es', 'gles']
    };
    
    // 检查是否为已知变体
    for (const [base, variantList] of Object.entries(variants)) {
        if (variantList.includes(normalizedDetected) && variantList.includes(normalizedExpected)) {
            return true;
        }
        if (base === normalizedDetected && variantList.includes(normalizedExpected)) {
            return true;
        }
        if (base === normalizedExpected && variantList.includes(normalizedDetected)) {
            return true;
        }
    }
    
    return false;
}

/**
 * 使用AI进行综合翻译校验
 */
async function performAIValidation(originalText: string, translatedText: string, targetLanguage: string): Promise<ValidationResult> {
    try {
        const expectedLanguageName = getLanguageName(targetLanguage);
        
        // 处理可能包含XML的原文和译文
        const processedOriginal = processXmlContent(originalText);
        const processedTranslation = processXmlContent(translatedText);
        
        // 构建优化后的AI校验提示
        const prompt = `请帮我验证以下翻译的质量，重点关注两个方面：
1. 翻译的目标语言是否正确（应该是${expectedLanguageName}）
2. 翻译是否准确保持了原文的意思

原文：
${processedOriginal}

译文：
${processedTranslation}

请以JSON格式返回验证结果，包含以下字段：
{
    "languageCorrect": true/false,        // 语言是否匹配目标语言
    "detectedLanguage": "检测到的语言名称",
    "meaningPreserved": true/false,       // 翻译是否保持原文意思
    "similarity": 0-100,                  // 意思相似度百分比
    "details": "详细说明"                  // 验证结果的详细说明
}`;

        // 发送到AI进行验证
        const response = await fetch(settings.openai.chatCompletionsEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Secrets.openai.accessKey}`
            },
            body: JSON.stringify({
                model: settings.openai.model,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error(`API请求失败: ${response.status}`);
        }

        const content = await response.text();
        if (!content) {
            throw new Error('校验API返回空内容');
        }

        // 清理内容中的反引号和其他可能导致解析错误的字符
        const cleanContent = content.replace(/`/g, '').trim();
        
        // 解析JSON响应并添加错误处理
        let aiResult;
        try {
            aiResult = JSON.parse(cleanContent);
        } catch (parseError) {
            console.error('JSON解析错误，原始内容:', cleanContent);
            throw new Error(`JSON解析失败: ${parseError.message}`);
        }

        // 转换为新的ValidationResult格式
        return {
            isValid: aiResult.languageCorrect && aiResult.meaningPreserved,
            languageMatch: aiResult.languageCorrect,
            meaningPreserved: aiResult.meaningPreserved,
            similarity: aiResult.similarity / 100, // 转换为0-1范围
            details: aiResult.details,
            backTranslation: undefined
        };
    } catch (error) {
        console.error('验证过程发生错误:', error);
        return {
            isValid: false,
            languageMatch: false,
            meaningPreserved: false,
            similarity: 0,
            details: `Validation error occurred: ${error.message}`,
            backTranslation: undefined
        };
    }
}

/**
 * 回译验证：将翻译结果翻译回原语言（保留用于向后兼容）
 */
async function performBackTranslation(
    originalText: string, 
    translation: string, 
    targetLanguage: string
): Promise<{ passed: boolean; backTranslation: string }> {
    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            // 🔧 简化：移除冗长的调试输出
            const processedTranslation = processXmlContent(translation);
            
            // 🔧 优化：简化回译提示，避免AI返回完整提示词
            const backTranslationPrompt = `将以下${getLanguageName(targetLanguage)}文本翻译回英语。

原文参考："${processXmlContent(originalText)}"
${getLanguageName(targetLanguage)}文本："${processedTranslation}"

只返回英文翻译结果：`;

            const response = await fetch(settings.openai.chatCompletionsEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Secrets.openai.accessKey}`
                },
                body: JSON.stringify({
                    model: settings.openai.model,
                    messages: [
                        {
                            role: 'user',
                            content: backTranslationPrompt
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 1000
                })
            });

            if (!response.ok) {
                throw new Error(`回译API失败: ${response.status}`);
            }

            const data = await response.json();
            const backTranslation = data.choices?.[0]?.message?.content?.trim();
            
            if (!backTranslation) {
                throw new Error('回译失败：无结果');
            }

            // 🔧 简化：移除冗长的回译结果输出
            // 使用AI进行语义相似性判断
            const processedOriginal = processXmlContent(originalText);
            const aiComparison = await performAISemanticComparison(processedOriginal, backTranslation);
            
            // 🔧 简化：只输出简洁的验证结果
            return { passed: aiComparison.isSimilar, backTranslation };
        } catch (error) {
            lastError = error;
            console.error(`[回译错误][第${attempt}次尝试]`, error);
            if (attempt < 3) {
                await new Promise(res => setTimeout(res, 1000));
                continue;
            } else {
                throw error;
            }
        }
    }
    throw lastError;
}

/**
 * 语种检测：使用规则集检测翻译结果的语种
 */
function performLanguageDetection(
    translation: string, 
    expectedLanguage: string
): { detectedLanguage: string; isCorrect: boolean } {
    return performRuleBasedLanguageDetection(translation, expectedLanguage);
}

/**
 * 导出验证选项接口
 */
export interface ValidationOptions {
    enableValidation?: boolean;
}

/**
 * 修改主验证函数，添加选项参数
 */
export async function validateTranslation(
    originalText: string,
    translatedText: string,
    targetLanguage: string,
    options: ValidationOptions = { enableValidation: false }
): Promise<ValidationResult> {
    // 如果未启用验证，返回默认通过结果
    if (!options.enableValidation) {
        return {
            isValid: true,
            languageMatch: true,
            meaningPreserved: true,
            similarity: 100,
            details: "Validation skipped (not enabled)",
            backTranslation: undefined
        };
    }

    const config = getValidationConfig();
    let result: ValidationResult = {
        isValid: false,
        languageMatch: false,
        meaningPreserved: false,
        similarity: 0,
        details: "",
        backTranslation: undefined
    };

    // 第一步：语种检测（使用规则集检测） - 必须通过才能继续
    if (config.enableLanguageDetection) {
        const langDetection = performLanguageDetection(translatedText, targetLanguage);
        result.languageMatch = langDetection.isCorrect;
        
        if (!langDetection.isCorrect) {
            result.details = `语种检测失败: 检测到${getLanguageName(langDetection.detectedLanguage)}，期望${getLanguageName(targetLanguage)}`;
            result.isValid = false;
            return result;
        }
    } else {
        result.languageMatch = true;
    }

    // 第二步：回译验证（使用AI） - 语种检测通过后进行相似度验证
    if (config.enableBackTranslation) {
        try {
            const backTransResult = await performBackTranslation(originalText, translatedText, targetLanguage);
            // 🔧 修复：直接使用AI判断结果，100表示通过，0表示不通过
            result.meaningPreserved = backTransResult.passed;
            result.backTranslation = backTransResult.backTranslation; // 始终保存回译内容
            
            if (!result.meaningPreserved) {
                result.details = `AI语义验证不通过`;
                // 不要在这里提前返回，继续执行后面的逻辑
            }
        } catch (error) {
            result.details = `回译验证出错: ${error.message}`;
            result.isValid = false;
            return result; // 只有在出错时才提前返回
        }
    } else {
        result.meaningPreserved = true;
        result.similarity = 100;
    }

    // 最终判断：根据启用的验证项目决定结果
    if (config.enableLanguageDetection && config.enableBackTranslation) {
        // 如果两项都启用，则两项都必须通过
        result.isValid = result.languageMatch && result.meaningPreserved;
    } else if (config.enableLanguageDetection) {
        // 如果只启用语种检测，则只需语种检测通过
        result.isValid = result.languageMatch;
    } else if (config.enableBackTranslation) {
        // 如果只启用回译验证，则只需相似度检测通过
        result.isValid = result.meaningPreserved;
    } else {
        // 如果都没启用，默认通过
        result.isValid = true;
    }

    result.details = result.isValid ? "验证通过" : "验证失败";
    return result;
}

/**
 * 批量验证翻译
 */
export async function validateTranslationBatch(
    translations: Array<{
        originalText: string;
        translation: string;
        targetLanguage: string;
        messageData: MessageData;
    }>,
    config: ValidationConfig
): Promise<BatchValidationResult> {
    const logger = ValidationLogger.getInstance();
    
    // 简化的控制台输出
    console.log(`[Translation Validation] Starting validation for ${translations.length} items using AI语义验证`);
    
    logger.log(`[Translation Validation] Starting validation for ${translations.length} translation results...`);
    logger.log(`[Translation Validation] Configuration: ${config.configName}`);

    // 如果启用回译，首先进行批量回译
    let backTranslationResults: Array<{ passed: boolean; backTranslation: string; index: number }> = [];
    
    if (config.enableBackTranslation) {
        logger.log(`[Translation Validation] Performing batch AI semantic validation for ${translations.length} items...`);
        
        const backTranslationInputs = translations.map((t, index) => ({
            originalText: t.originalText,
            translation: t.translation,
            targetLanguage: t.targetLanguage,
            index: index
        }));
        
        backTranslationResults = await performBatchBackTranslation(backTranslationInputs);
        logger.log(`[Translation Validation] Batch AI semantic validation completed`);
    }

    let backTranslationPassedCount = 0;
    let languageDetectionPassedCount = 0;
    let finalPassedCount = 0;

    // 如果验证被禁用，全部通过
    if (!config.enableBackTranslation && !config.enableLanguageDetection) {
        logger.log(`[Translation Validation] Validation is disabled, all translations passed`);
        
        const batchResult: BatchValidationResult = {
            totalCount: translations.length,
            backTranslationPassedCount: translations.length,
            languageDetectionPassedCount: translations.length,
            finalPassedCount: translations.length,
            failedCount: 0,
            passRate: 100
        };
        
        return batchResult;
    }

    // 逐一验证每个翻译
    for (let i = 0; i < translations.length; i++) {
        const { originalText, translation, targetLanguage } = translations[i];
        
        logger.log(`[Validation ${i + 1}/${translations.length}] Validating...`);
        
        let backTranslationResult: { passed: boolean; backTranslation: string } | null = null;
        
        // 如果有回译结果，获取对应的结果
        if (config.enableBackTranslation) {
            const result = backTranslationResults.find(r => r.index === i);
            if (result) {
                backTranslationResult = {
                    passed: result.passed,
                    backTranslation: result.backTranslation
                };
            }
        }
        
        // 语种检测
        let languageDetectionResult: { detectedLanguage: string; isCorrect: boolean } | null = null;
        if (config.enableLanguageDetection) {
            languageDetectionResult = performLanguageDetection(translation, targetLanguage);
        }
        
        // 验证逻辑
        let isBackTranslationValid = true;
        let isLanguageDetectionValid = true;
        
        if (config.enableBackTranslation && backTranslationResult) {
            // 🔧 修复：直接使用AI判断结果，100表示通过，0表示不通过
            isBackTranslationValid = backTranslationResult.passed;
            if (isBackTranslationValid) {
                backTranslationPassedCount++;
            }
        } else if (config.enableBackTranslation) {
            isBackTranslationValid = false;
        } else {
            // 如果未启用回译验证，不影响最终结果
            isBackTranslationValid = true;
        }
        
        if (config.enableLanguageDetection && languageDetectionResult) {
            isLanguageDetectionValid = languageDetectionResult.isCorrect;
            if (isLanguageDetectionValid) {
                languageDetectionPassedCount++;
            }
        } else if (config.enableLanguageDetection) {
            isLanguageDetectionValid = false;
        } else {
            // 如果未启用语种检测，不影响最终结果
            isLanguageDetectionValid = true;
        }
        
        // 最终结果判断 - 修复逻辑问题
        let finalResult = false;
        let details = '';
        
        // 根据实际启用的验证项目决定通过条件
        if (config.enableBackTranslation && config.enableLanguageDetection) {
            // 两项都启用：必须都通过才算通过
            finalResult = isBackTranslationValid && isLanguageDetectionValid;
            if (!finalResult) {
                const failedChecks: string[] = [];
                if (!isBackTranslationValid) failedChecks.push('AI语义验证不通过');
                if (!isLanguageDetectionValid) failedChecks.push(`语种检测失败: 检测到 ${languageDetectionResult?.detectedLanguage}，期望 ${targetLanguage}`);
                details = failedChecks.join('; ');
            }
        } else if (config.enableBackTranslation) {
            // 只启用回译验证：只需回译通过
            finalResult = isBackTranslationValid;
            if (!finalResult) {
                details = 'AI语义验证不通过';
            }
        } else if (config.enableLanguageDetection) {
            // 只启用语种检测：只需语种检测通过
            finalResult = isLanguageDetectionValid;
            if (!finalResult) {
                details = `语种检测失败: 检测到 ${languageDetectionResult?.detectedLanguage}，期望 ${targetLanguage}`;
            }
        } else {
            // 都未启用：默认通过
            finalResult = true;
            details = '验证已禁用 - 默认通过';
        }
        
        if (finalResult) {
            finalPassedCount++;
        } else {
            // 🔧 验证失败：保留翻译内容，但标记为未完成状态
            const messageData = translations[i].messageData;
            if (messageData.translationElement) {
                // 简单标记为未完成即可
                messageData.translationElement.setAttribute('type', 'unfinished');
                
                logger.log(`[Validation ${i + 1}/${translations.length}] ❌ Failed - Marked as unfinished`);
                console.log(`[Validation Failed] Marked as unfinished: "${originalText.substring(0, 50)}${originalText.length > 50 ? '...' : ''}"`);
            }
        }
        
        // 创建验证结果对象
        const validationResult: ValidationResult = {
            isValid: finalResult,
            languageMatch: isLanguageDetectionValid,
            meaningPreserved: isBackTranslationValid,
            similarity: isBackTranslationValid ? 100 : 0,
            details: details,
            backTranslation: backTranslationResult?.backTranslation
        };
        
        // 详细日志记录到文件
        logger.logValidationResult({
            index: i + 1,
            total: translations.length,
            originalText,
            translation,
            targetLanguage,
            result: validationResult
        });
    }

    const batchResult: BatchValidationResult = {
        totalCount: translations.length,
        backTranslationPassedCount,
        languageDetectionPassedCount,
        finalPassedCount,
        failedCount: translations.length - finalPassedCount,
        passRate: Math.round((finalPassedCount / translations.length) * 100)
    };

    // 简化的完成输出
    console.log(`[Translation Validation] Completed: ${finalPassedCount}/${translations.length} passed (${batchResult.passRate}%)`);
    
    // 添加详细的统计信息
    if (config.enableLanguageDetection || config.enableBackTranslation) {
        const detailInfo: string[] = [];
        if (config.enableLanguageDetection) {
            detailInfo.push(`Language Detection: ${languageDetectionPassedCount}/${translations.length} (${Math.round((languageDetectionPassedCount / translations.length) * 100)}%)`);
        }
        if (config.enableBackTranslation) {
            detailInfo.push(`AI语义验证: ${backTranslationPassedCount}/${translations.length} (${Math.round((backTranslationPassedCount / translations.length) * 100)}%)`);
        }
        console.log(`[Translation Validation] Details: ${detailInfo.join(', ')}`);
    }
    
    logger.log(`[Translation Validation] Validation completed: Passed ${batchResult.finalPassedCount}/${batchResult.totalCount} translations (${batchResult.passRate}%)`);
    if (config.enableLanguageDetection) {
        logger.log(`[Translation Validation] Language detection: ${languageDetectionPassedCount}/${translations.length} passed (${Math.round((languageDetectionPassedCount / translations.length) * 100)}%)`);
    }
    if (config.enableBackTranslation) {
        logger.log(`[Translation Validation] AI语义验证: ${backTranslationPassedCount}/${translations.length} passed (${Math.round((backTranslationPassedCount / translations.length) * 100)}%)`);
    }
    logger.log(`[Translation Validation] Detailed log recorded to: ${logger.getLogFilePath()}`);

    return batchResult;
}

/**
 * 打印验证配置信息
 */
export function printValidationConfig(config: ValidationConfig): void {
    // 删除了控制台日志输出，只保留 ValidationLogger 记录
    
    // 使用ValidationLogger记录配置信息
    const logger = ValidationLogger.getInstance();
    
    if (config.enableBackTranslation && config.enableLanguageDetection) {
        if (config.configName.includes('混合语种检测')) {
            logger.log(`[Validation Configuration] ${config.configName}`);
            logger.log(`[Validation Configuration] Validation process: Hybrid language detection (rule→AI) → AI semantic validation (both must pass)`);
        } else {
            logger.log(`[Validation Configuration] ${config.configName}`);
            logger.log(`[Validation Configuration] Validation process: Language detection (must) → AI semantic validation (must)`);
        }
    } else if (config.enableBackTranslation) {
        logger.log(`[Validation Configuration] Back-translation validation only`);
    } else if (config.enableLanguageDetection) {
        if (config.configName.includes('混合语种检测')) {
            logger.log(`[Validation Configuration] Hybrid language detection only (rule→AI)`);
        } else {
            logger.log(`[Validation Configuration] Rule-based language detection only`);
        }
    } else {
        logger.log(`[Validation Configuration] Validation disabled`);
    }
}

// 简单的日志记录功能
const logValidationResults = (data: any) => {
    try {
        const logEntry = {
            timestamp: new Date().toISOString(),
            ...data
        };
        const logLine = JSON.stringify(logEntry) + '\n';
        const logFile = `validation-log-${new Date().toISOString().split('T')[0]}.jsonl`;
        fs.appendFileSync(logFile, logLine);
    } catch (error) {
        console.error('Error recording validation log:', error);
    }
};

export async function validateTranslations(
    translations: { originalText: string; translation: string; targetLanguage: string }[],
    options: ValidationOptions = { enableValidation: false }
): Promise<ValidationResult[]> {
    const logger = ValidationLogger.getInstance();
    
    if (!options.enableValidation) {
        // 如果未启用验证，返回全部通过的结果
        return translations.map(() => ({
            isValid: true,
            languageMatch: true,
            meaningPreserved: true,
            similarity: 100,
            details: "Validation skipped (not enabled)",
            backTranslation: undefined
        }));
    }

    const results: ValidationResult[] = [];
    console.log(`[Validation] Processing ${translations.length} items...`);
    
    for (let i = 0; i < translations.length; i++) {
        const { originalText, translation, targetLanguage } = translations[i];
        
        logger.log(`[Validation ${i + 1}/${translations.length}] Validating...`);
        
        try {
            const result = await validateTranslation(originalText, translation, targetLanguage, options);
            results.push(result);
            
            if (result.isValid) {
                logger.log(`[Validation ${i + 1}/${translations.length}] ✓ Passed`);
            } else {
                logger.log(`[Validation ${i + 1}/${translations.length}] ❌ Failed`);
                logger.log(`  - ${result.details}`);
            }
        } catch (error) {
            logger.log(`[Validation ${i + 1}/${translations.length}] ❌ Validation error: ${error.message}`);
            results.push({
                isValid: false,
                languageMatch: false,
                meaningPreserved: false,
                similarity: 0,
                details: `Validation error occurred: ${error.message}`,
                backTranslation: undefined
            });
        }
    }

    // 输出验证统计
    const totalCount = results.length;
    const passedCount = results.filter(r => r.isValid).length;
    const languageMatchCount = results.filter(r => r.languageMatch).length;
    const meaningPreservedCount = results.filter(r => r.meaningPreserved).length;
    
    // 简化的控制台统计
    console.log(`[Validation] Completed: ${passedCount}/${totalCount} passed (${((passedCount / totalCount) * 100).toFixed(1)}%)`);
    
    // 详细统计记录到日志文件
    logger.log('\n[Batch Validation] Validation completed statistics:');
    logger.log(`  - Total translations: ${totalCount} items`);
    logger.log(`  - Language match: ${languageMatchCount} items`);
    logger.log(`  - Meaning preserved: ${meaningPreservedCount} items`);
    logger.log(`  - Final passed: ${passedCount} items`);
    logger.log(`  - Validation failed: ${totalCount - passedCount} items`);
    logger.log(`  - Validation pass rate: ${((passedCount / totalCount) * 100).toFixed(1)}%`);

    return results;
}

/**
 * 使用AI判断语义相似性
 */
async function performAISemanticComparison(
    originalText: string,
    backTranslation: string
): Promise<{ isSimilar: boolean }> {
    // 检查是否为空或无效输入
    if (!originalText?.trim() || !backTranslation?.trim()) {
        return { isSimilar: false };
    }

    // 如果两个文本完全相同，直接返回相似
    if (originalText.trim() === backTranslation.trim()) {
        return { isSimilar: true };
    }

    // 构造AI比较提示
    const prompt = `请比较以下两段文本的语义是否相近：

原文: "${originalText}"
回译: "${backTranslation}"

请回答"是"或"不是"。如果两段文本表达的意思基本一致，请回答"是"；如果意思有明显差异，请回答"不是"。`;

    try {
        // 调用OpenAI API
        const response = await callTranslationAPI(prompt, 'zh_CN');
        
        if (!response) {
            return { isSimilar: false };
        }

        // 解析AI回复
        const normalizedResponse = response.toLowerCase().trim();
        const isSimilar = normalizedResponse.includes('是') && !normalizedResponse.includes('不是');
        
        return { isSimilar };
    } catch (error) {
        console.error('[AI语义比较] API调用失败:', error);
        // 发生错误时的处理逻辑：计算文本相似度作为回退方案
        const similarity = calculateSimilarity(originalText, backTranslation);
        const isSimilar = similarity >= 0.7; // 70%相似度阈值
        
        return { isSimilar };
    }
}

/**
 * 批量回译验证 - 按批次处理多个翻译
 */
async function performBatchBackTranslation(
    translations: Array<{
        originalText: string;
        translation: string;
        targetLanguage: string;
        index: number;
    }>
): Promise<Array<{ passed: boolean; backTranslation: string; index: number }>> {
    const BATCH_SIZE = 15;
    const allResults: Array<{ passed: boolean; backTranslation: string; index: number }> = [];
    
    console.log(`[批量回译] 开始处理 ${translations.length} 个翻译，分成 ${Math.ceil(translations.length / BATCH_SIZE)} 个批次...`);
    
    // 分批处理
    for (let i = 0; i < translations.length; i += BATCH_SIZE) {
        const batch = translations.slice(i, i + BATCH_SIZE);
        const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(translations.length / BATCH_SIZE);
        
        console.log(`\n[回译批次 ${batchIndex}/${totalBatches}] 处理 ${batch.length} 个翻译...`);
        
        try {
            const batchResults = await processSingleBackTranslationBatch(batch, batchIndex, totalBatches);
            allResults.push(...batchResults);
            
            // 显示本批次结果摘要
            const passedCount = batchResults.filter(r => r.passed).length;
            console.log(`[回译批次 ${batchIndex}/${totalBatches}] 完成，通过率: ${passedCount}/${batch.length} (${((passedCount / batch.length) * 100).toFixed(1)}%)`);
            
            // 批次间延迟
            if (i + BATCH_SIZE < translations.length) {
                console.log(`[回译批次 ${batchIndex}/${totalBatches}] 等待1秒后继续...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            console.error(`[回译批次 ${batchIndex}/${totalBatches}] 处理失败，回退到逐个处理:`, error.message);
            
            // 对本批次逐个处理
            for (const item of batch) {
                try {
                    const result = await performBackTranslation(item.originalText, item.translation, item.targetLanguage);
                    
                    allResults.push({
                        passed: result.passed,
                        backTranslation: result.backTranslation,
                        index: item.index
                    });
                } catch (err) {
                    console.error(`[回译校验] 处理失败: ${err.message}`);
                    allResults.push({
                        passed: false,
                        backTranslation: `错误: ${err.message}`,
                        index: item.index
                    });
                }
            }
        }
    }
    
    // 最终统计
    const totalPassed = allResults.filter(r => r.passed).length;
    console.log(`[批量回译] 总体完成，通过率: ${totalPassed}/${allResults.length} (${((totalPassed / allResults.length) * 100).toFixed(1)}%)`);
    
    return allResults;
}

/**
 * 处理单个回译批次
 */
async function processSingleBackTranslationBatch(
    batch: Array<{
        originalText: string;
        translation: string;
        targetLanguage: string;
        index: number;
    }>,
    batchIndex: number,
    totalBatches: number
): Promise<Array<{ passed: boolean; backTranslation: string; index: number }>> {
    // 构建批量回译提示
    const batchPrompt = `你是专业翻译员。请将以下不同语言的文本翻译回英语。

**重要要求：**
1. 每个译文都有对应的原始英文，请参考原文进行回译
2. 回译结果应该与原文的语义和意图基本一致
3. 对于简单的字符、缩写、标点符号，考虑其在原文中的含义和用途
4. 保持与原文相同的格式和风格
5. 如果译文是正确翻译，回译应该接近原文

**格式要求：严格按照要求的格式回答，每行一个回译结果，不要添加编号或额外解释**

回译内容：
${batch.map((item, idx) => 
    `${idx + 1}. 原文参考: "${processXmlContent(item.originalText)}"
   ${getLanguageName(item.targetLanguage)}译文: "${processXmlContent(item.translation)}"`
).join('\n')}

英文回译结果（每行一个，不要编号）：`;

    const response = await fetch(settings.openai.chatCompletionsEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Secrets.openai.accessKey}`
        },
        body: JSON.stringify({
            model: settings.openai.model,
            messages: [
                {
                    role: 'user',
                    content: batchPrompt
                }
            ],
            temperature: 0.1,
            max_tokens: 2000
        })
    });

    if (!response.ok) {
        throw new Error(`批量回译API失败: ${response.status}`);
    }

    const data = await response.json();
    const backTranslationText = data.choices?.[0]?.message?.content?.trim();
    
    if (!backTranslationText) {
        throw new Error('批量回译失败：无结果');
    }

    // 添加调试信息
    console.log(`[回译批次 ${batchIndex}/${totalBatches}] 回译API原始响应:`);
    console.log(`"${backTranslationText}"`);

    // 解析回译结果
    const backTranslations = backTranslationText
        .split('\n')
        .map(line => {
            // 移除各种可能的前缀和格式
            let cleaned = line.trim();
            // 移除数字编号 (1. 2. 3. 等)
            cleaned = cleaned.replace(/^\d+\.\s*/, '');
            // 移除破折号前缀 (- 等)
            cleaned = cleaned.replace(/^[-*]\s*/, '');
            // 移除引号包围
            cleaned = cleaned.replace(/^["']|["']$/g, '');
            return cleaned.trim();
        })
        .filter(line => line.length > 0);

    if (backTranslations.length !== batch.length) {
        throw new Error(`期望 ${batch.length} 个结果，得到 ${backTranslations.length} 个`);
    }

    // 显示批次详细信息
    console.log(`[回译批次 ${batchIndex}/${totalBatches}] 批量验证详情:`);
    batch.forEach((item, idx) => {
        console.log(`  ${idx + 1}. "${item.originalText}" => "${item.translation}" => "${backTranslations[idx]}"`);
    });

    // 批量AI语义比较
    const semanticPrompt = `请比较这些英文文本对，判断它们是否有相同的核心意思。

重要说明：
- 注重语义含义，不是精确用词
- 这些文本来自软件界面翻译
- 请严格按照格式回答

格式要求：每行只回答一个"是"或"否"，不要添加任何解释或编号

比较对象：
${batch.map((item, idx) => 
    `${idx + 1}. 原文: "${processXmlContent(item.originalText)}"
   回译: "${backTranslations[idx]}"`
).join('\n')}

答案（每行一个"是"或"否"）：`;

    const semanticResponse = await fetch(settings.openai.chatCompletionsEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Secrets.openai.accessKey}`
        },
        body: JSON.stringify({
            model: settings.openai.model,
            messages: [
                {
                    role: 'user',
                    content: semanticPrompt
                }
            ],
            temperature: 0.1,
            max_tokens: 500
        })
    });

    if (!semanticResponse.ok) {
        throw new Error(`批量语义比较API失败: ${semanticResponse.status}`);
    }

    const semanticData = await semanticResponse.json();
    const semanticResultsText = semanticData.choices?.[0]?.message?.content?.trim();
    
    if (!semanticResultsText) {
        throw new Error('批量语义比较失败：无结果');
    }

    // 更健壮的结果解析逻辑
    const semanticResults = semanticResultsText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0) // 过滤空行
        .map(line => {
            // 移除各种可能的前缀和格式
            let cleanLine = line.trim();
            // 移除行号前缀（如 "1. 是" 或 "1. Yes"）
            cleanLine = cleanLine.replace(/^\d+\.\s*/, '');
            // 移除破折号前缀
            cleanLine = cleanLine.replace(/^[-*]\s*/, '');
            // 移除引号包围
            cleanLine = cleanLine.replace(/^["']|["']$/g, '');
            // 转换为小写进行判断
            cleanLine = cleanLine.toLowerCase().trim();
            
            // 判断是否为肯定答案
            return cleanLine.includes('是') || 
                   cleanLine.includes('yes') || 
                   cleanLine.includes('true') ||
                   cleanLine === '是' ||
                   cleanLine === 'yes';
        });

    // 确保我们有正确数量的结果
    if (semanticResults.length < batch.length) {
        // 如果结果不够，用传统相似度计算补充
        while (semanticResults.length < batch.length) {
            const idx = semanticResults.length;
            const traditionalSimilarity = calculateSemanticSimilarity(
                batch[idx].originalText, 
                backTranslations[idx]
            );
            semanticResults.push(traditionalSimilarity >= 60);
        }
    }

    // 只取前batch.length个结果
    const finalResults = semanticResults.slice(0, batch.length);

    // 返回结果
    return batch.map((item, idx) => ({
        passed: finalResults[idx],
        backTranslation: backTranslations[idx],
        index: item.index
    }));
}

// 创建验证日志系统
class ValidationLogger {
    private static instance: ValidationLogger;
    private logFilePath: string;
    private logStream: fs.WriteStream | null = null;

    private constructor() {
        this.logFilePath = path.join(process.cwd(), 'translations_log.txt');
        this.initLogFile();
    }

    static getInstance(): ValidationLogger {
        if (!ValidationLogger.instance) {
            ValidationLogger.instance = new ValidationLogger();
        }
        return ValidationLogger.instance;
    }

    private initLogFile(): void {
        try {
            this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
            const header = `\n=== 翻译验证会话开始 (${new Date().toLocaleString('zh-CN')}) ===\n`;
            this.logStream.write(header);
        } catch (error) {
            console.error('初始化验证日志文件失败:', error);
        }
    }

    log(message: string): void {
        try {
            if (this.logStream) {
                this.logStream.write(`${message}\n`);
            }
        } catch (error) {
            console.error('写入验证日志失败:', error);
        }
    }

    logValidationResult(data: {
        index: number;
        total: number;
        originalText: string;
        translation: string;
        targetLanguage: string;
        result: ValidationResult;
    }): void {
        const { index, total, originalText, translation, targetLanguage, result } = data;
        const status = result.isValid ? '✓ Passed' : '❌ Failed';
        
        // 添加语种检测详细信息
        const langDetectionResult = performLanguageDetection(translation, targetLanguage);
        const langStatus = langDetectionResult.isCorrect ? '✓' : '❌';
        
        this.log(`[Validation ${index}/${total}] ${status}${result.isValid ? '' : ': ' + result.details}`);
        this.log(`  Target language: ${targetLanguage} (${getLanguageName(targetLanguage)})`);
        this.log(`  Language detection: ${langStatus} Detected: ${getLanguageName(langDetectionResult.detectedLanguage)}`);
        this.log(`  Original: "${originalText}"`);
        this.log(`  Translation: "${translation}"`);
        
        if (result.backTranslation) {
            this.log(`  Back-translation: "${result.backTranslation}"`);
        }
        
        if (!result.isValid) {
            this.log(`  AI semantic judgment: ${result.similarity === 100 ? '通过' : '不通过'}`);
            this.log(`  Language match: ${result.languageMatch ? '✓' : '❌'}`);
            this.log(`  Meaning preserved: ${result.meaningPreserved ? '✓' : '❌'}`);
        }
        this.log(`  ---`);
    }

    close(): void {
        if (this.logStream) {
            const footer = `=== 翻译验证会话结束 (${new Date().toLocaleString('zh-CN')}) ===\n`;
            this.logStream.write(footer);
            this.logStream.end();
        }
    }

    getLogFilePath(): string {
        return this.logFilePath;
    }
}

export async function validateTranslationAfterTranslation(
    originalText: string,
    translation: string,
    targetLanguage: string,
    config: ValidationConfig
): Promise<{ 
    shouldInclude: boolean; 
    languageValid: boolean; 
    backTranslationValid?: boolean; 
    reason: string;
    backTranslation?: string;
}> {
    try {
        // 第一步：语种检测（规则+AI混合）
        const languageValid = await performEnhancedLanguageCheck(translation, targetLanguage);
        
        if (!languageValid) {
            return {
                shouldInclude: false,
                languageValid: false,
                reason: '语种检测不通过'
            };
        }

        // 第二步：如果启用回译，进行回译检测
        if (config.enableBackTranslation) {
            try {
                const backResult = await performBackTranslation(originalText, translation, targetLanguage);
                const backTranslationValid = backResult.passed; // 只用AI判断
                
                return {
                    shouldInclude: backTranslationValid,
                    languageValid: true,
                    backTranslationValid,
                    backTranslation: backResult.backTranslation,
                    reason: backTranslationValid ? '语种和回译都通过' : `回译未通过AI语义判断`
                };
            } catch (error) {
                console.error('回译检测异常:', error);
                // 回译失败时，如果语种检测通过，仍然接受翻译
                return {
                    shouldInclude: true,
                    languageValid: true,
                    backTranslationValid: false,
                    reason: '语种通过，回译检测异常'
                };
            }
        }

        // 只进行语种检测
        return {
            shouldInclude: true,
            languageValid: true,
            reason: '语种检测通过'
        };

    } catch (error) {
        console.error('翻译验证异常:', error);
        return {
            shouldInclude: false,
            languageValid: false,
            reason: `验证异常: ${error.message}`
        };
    }
}

// 在validateTranslationAfterTranslation之前添加：
async function performEnhancedLanguageCheck(translation: string, targetLanguage: string): Promise<boolean> {
    // 获取当前验证配置
    const config = getValidationConfig();
    
    // 如果使用混合语种检测配置
    if (config.configName.includes('混合语种检测')) {
        const result = await performHybridLanguageDetection(translation, targetLanguage);
        return result.isCorrect;
    } else {
        // 使用传统的纯规则检测
        const result = performLanguageDetection(translation, targetLanguage);
        return result.isCorrect;
    }
}

/**
 * AI语种检测：使用大模型检测翻译结果的语种
 */
async function performAILanguageDetection(
    translation: string, 
    expectedLanguage: string
): Promise<{ detectedLanguage: string; isCorrect: boolean; reason: string }> {
    const prompt = `请检测以下文本是否为${getLanguageName(expectedLanguage)}语种。

文本: "${translation}"
期望语种: ${getLanguageName(expectedLanguage)}

请直接回答"是"或"不是"，不要添加任何解释。`;

    try {
        const response = await callTranslationAPI(prompt, 'zh_CN');
        const answer = response.trim().toLowerCase();
        const isCorrect = answer.includes('是') && !answer.includes('不是');
        
        return {
            detectedLanguage: isCorrect ? expectedLanguage : 'unknown',
            isCorrect: isCorrect,
            reason: `AI检测结果: ${response.trim()}`
        };
    } catch (error) {
        console.error(`[AI语种检测] API调用失败:`, error);
        return {
            detectedLanguage: 'unknown',
            isCorrect: false,
            reason: 'API调用失败'
        };
    }
}

/**
 * 混合语种检测：先规则检测，失败后使用AI检测
 */
async function performHybridLanguageDetection(
    translation: string,
    expectedLanguage: string
): Promise<{ detectedLanguage: string; isCorrect: boolean; method: string; details: string }> {
    // 第一步：规则检测
    const ruleResult = performRuleBasedLanguageDetection(translation, expectedLanguage);
    
    // 如果规则检测通过，直接返回
    if (ruleResult.isCorrect) {
        return {
            detectedLanguage: ruleResult.detectedLanguage,
            isCorrect: true,
            method: '基于规则',
            details: `基于规则检测通过`
        };
    }
    
    // 第二步：规则检测失败，使用AI检测
    const aiResult = await performAILanguageDetection(translation, expectedLanguage);
    
    // 如果AI检测通过，返回AI结果
    if (aiResult.isCorrect) {
        return {
            detectedLanguage: aiResult.detectedLanguage,
            isCorrect: true,
            method: '基于AI',
            details: `基于AI检测通过: ${aiResult.reason}`
        };
    }
    
    // 两种检测都失败
    return {
        detectedLanguage: ruleResult.detectedLanguage || aiResult.detectedLanguage,
        isCorrect: false,
        method: '混合检测失败',
        details: `规则检测: ${ruleResult.detectedLanguage}, AI检测: ${aiResult.detectedLanguage} - 都失败`
    };
}