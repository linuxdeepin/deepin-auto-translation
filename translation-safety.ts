/**
 * 翻译安全性配置和验证模块
 * 确保大批量翻译时每条上下文都是独立的，互不干扰
 */

export interface TranslationSafetyConfig {
    enableStrictIndexing: boolean;          // 启用严格索引验证
    enableContextValidation: boolean;       // 启用上下文验证
    enableSourceTextMatching: boolean;      // 启用源文本匹配验证
    enableOrderValidation: boolean;         // 启用顺序验证
    maxAllowedMismatch: number;            // 最大允许的不匹配数量
    enableDetailedLogging: boolean;        // 启用详细日志
}

export interface TranslationMapping {
    sourceIndex: number;
    translationIndex: number;
    sourceText: string;
    translationText: string;
    contextId: string;
    isValid: boolean;
    reason?: string;
    timestamp: number;
}

export interface SafetyValidationResult {
    totalMappings: number;
    validMappings: number;
    invalidMappings: number;
    mismatchCount: number;
    orderIssues: number;
    contextIssues: number;
    passed: boolean;
    details: string[];
}

// 默认安全配置
const DEFAULT_SAFETY_CONFIG: TranslationSafetyConfig = {
    enableStrictIndexing: true,
    enableContextValidation: true,
    enableSourceTextMatching: true,
    enableOrderValidation: true,
    maxAllowedMismatch: 0, // 默认不允许任何不匹配
    enableDetailedLogging: true
};

/**
 * 获取翻译安全配置
 */
export function getTranslationSafetyConfig(): TranslationSafetyConfig {
    // 可以从环境变量或配置文件读取
    const envConfig = {
        enableStrictIndexing: process.env.TRANSLATION_STRICT_INDEXING !== 'false',
        enableContextValidation: process.env.TRANSLATION_CONTEXT_VALIDATION !== 'false',
        enableSourceTextMatching: process.env.TRANSLATION_SOURCE_MATCHING !== 'false',
        enableOrderValidation: process.env.TRANSLATION_ORDER_VALIDATION !== 'false',
        maxAllowedMismatch: parseInt(process.env.TRANSLATION_MAX_MISMATCH || '0'),
        enableDetailedLogging: process.env.TRANSLATION_DETAILED_LOGGING !== 'false'
    };
    
    return { ...DEFAULT_SAFETY_CONFIG, ...envConfig };
}

/**
 * 为消息数组添加安全标识符
 */
export function addSafetyIdentifiers<T extends { context: string; source: string }>(
    messages: T[]
): (T & { _originalIndex: number; _contextId: string; _timestamp: number })[] {
    const timestamp = Date.now();
    return messages.map((message, index) => ({
        ...message,
        _originalIndex: index,
        _contextId: `${message.context}_${message.source}_${index}_${timestamp}`,
        _timestamp: timestamp
    }));
}

/**
 * 验证翻译映射的安全性
 */
export function validateTranslationMappings(
    mappings: TranslationMapping[],
    config: TranslationSafetyConfig
): SafetyValidationResult {
    const result: SafetyValidationResult = {
        totalMappings: mappings.length,
        validMappings: 0,
        invalidMappings: 0,
        mismatchCount: 0,
        orderIssues: 0,
        contextIssues: 0,
        passed: false,
        details: []
    };
    
    if (mappings.length === 0) {
        result.passed = true;
        return result;
    }
    
    // 统计有效和无效映射
    mappings.forEach((mapping, index) => {
        if (mapping.isValid) {
            result.validMappings++;
        } else {
            result.invalidMappings++;
            result.details.push(`映射 ${index}: ${mapping.reason || '未知错误'}`);
        }
        
        // 检查索引顺序
        if (config.enableOrderValidation && mapping.sourceIndex !== index) {
            result.orderIssues++;
            result.details.push(`顺序错误 ${index}: 预期索引 ${index}, 实际索引 ${mapping.sourceIndex}`);
        }
        
        // 检查上下文ID
        if (config.enableContextValidation && !mapping.contextId) {
            result.contextIssues++;
            result.details.push(`上下文缺失 ${index}: 缺少上下文ID`);
        }
    });
    
    // 计算不匹配数量
    result.mismatchCount = result.invalidMappings + result.orderIssues + result.contextIssues;
    
    // 判断是否通过验证
    result.passed = result.mismatchCount <= config.maxAllowedMismatch;
    
    if (config.enableDetailedLogging) {
        console.log(`[翻译安全验证] 总映射: ${result.totalMappings}, 有效: ${result.validMappings}, 无效: ${result.invalidMappings}`);
        console.log(`[翻译安全验证] 不匹配总数: ${result.mismatchCount}, 允许上限: ${config.maxAllowedMismatch}`);
        console.log(`[翻译安全验证] 验证结果: ${result.passed ? '通过' : '失败'}`);
        
        if (result.details.length > 0 && result.details.length <= 10) {
            console.log(`[翻译安全验证] 详细问题:`);
            result.details.forEach(detail => console.log(`  - ${detail}`));
        } else if (result.details.length > 10) {
            console.log(`[翻译安全验证] 问题过多 (${result.details.length} 个)，仅显示前10个:`);
            result.details.slice(0, 10).forEach(detail => console.log(`  - ${detail}`));
        }
    }
    
    return result;
}

/**
 * 检查批次处理是否安全
 */
export function isBatchProcessingSafe(
    inputCount: number,
    outputCount: number,
    config: TranslationSafetyConfig
): { isSafe: boolean; reason?: string; suggestions?: string[] } {
    if (!config.enableStrictIndexing) {
        return { isSafe: true }; // 如果不启用严格索引，则总是安全
    }
    
    // 计算响应率
    const responseRate = outputCount / inputCount;
    
    // 完全匹配的情况
    if (inputCount === outputCount) {
        return { isSafe: true };
    }
    
    // 没有任何响应
    if (outputCount === 0) {
        return {
            isSafe: false,
            reason: 'API完全无响应',
            suggestions: [
                '检查API密钥是否有效',
                '检查网络连接',
                '检查API服务状态',
                '尝试减小批次大小'
            ]
        };
    }
    
    // 部分响应的情况
    if (outputCount < inputCount) {
        const missedCount = inputCount - outputCount;
        
        // 响应率过低（小于50%）
        if (responseRate < 0.5) {
            return {
                isSafe: false,
                reason: `响应率过低 (${(responseRate * 100).toFixed(1)}%)，缺失${missedCount}条翻译`,
                suggestions: [
                    '大幅减小批次大小 (BATCH_SIZE)',
                    '增加批次间延迟 (BATCH_DELAY)',
                    '检查源文本是否包含敏感内容',
                    '检查单条文本长度是否过长',
                    '降低并发数 (MAX_CONCURRENT_BATCHES)'
                ]
            };
        }
        
        // 响应率中等（50%-80%）
        if (responseRate < 0.8) {
            if (config.enableDetailedLogging) {
                console.warn(`[批次安全] 响应率中等 (${(responseRate * 100).toFixed(1)}%)，缺失${missedCount}条翻译`);
                console.warn(`[批次安全] 建议优化配置提高响应率`);
            }
            
            return {
                isSafe: true, // 仍然安全，但给出建议
                reason: `响应率中等 (${(responseRate * 100).toFixed(1)}%)`,
                suggestions: [
                    '适度减小批次大小',
                    '增加批次间延迟',
                    '检查是否有特殊字符或敏感词'
                ]
            };
        }
        
        // 响应率较好（80%-95%）
        if (responseRate < 0.95) {
            if (config.enableDetailedLogging) {
                console.log(`[批次安全] 响应率良好 (${(responseRate * 100).toFixed(1)}%)，缺失${missedCount}条翻译`);
            }
            
            return {
                isSafe: true,
                reason: `响应率良好 (${(responseRate * 100).toFixed(1)}%)`,
                suggestions: [
                    '当前配置基本合理',
                    '可考虑微调批次大小以达到100%响应率'
                ]
            };
        }
        
        // 响应率很好（95%-100%）
        if (config.enableDetailedLogging) {
            console.log(`[批次安全] 响应率优秀 (${(responseRate * 100).toFixed(1)}%)，仅缺失${missedCount}条翻译`);
        }
        
        return {
            isSafe: true,
            reason: `响应率优秀 (${(responseRate * 100).toFixed(1)}%)`,
            suggestions: ['当前配置excellent，偶尔缺失是正常现象']
        };
    }
    
    // 输出比输入多的异常情况
    if (outputCount > inputCount) {
        return {
            isSafe: false,
            reason: `异常情况：输出条数(${outputCount})超过输入条数(${inputCount})`,
            suggestions: [
                '检查API响应解析逻辑',
                '检查是否有重复处理',
                '联系技术支持'
            ]
        };
    }
    
    return { isSafe: true };
}

/**
 * 生成翻译安全报告
 */
export function generateSafetyReport(
    validationResults: SafetyValidationResult[],
    config: TranslationSafetyConfig
): string {
    const totalBatches = validationResults.length;
    const passedBatches = validationResults.filter(r => r.passed).length;
    const failedBatches = totalBatches - passedBatches;
    
    const totalMappings = validationResults.reduce((sum, r) => sum + r.totalMappings, 0);
    const totalValid = validationResults.reduce((sum, r) => sum + r.validMappings, 0);
    const totalInvalid = validationResults.reduce((sum, r) => sum + r.invalidMappings, 0);
    
    const report = [
        '=== 翻译安全性报告 ===',
        `批次统计: ${totalBatches} 个批次, ${passedBatches} 个通过, ${failedBatches} 个失败`,
        `映射统计: ${totalMappings} 个映射, ${totalValid} 个有效, ${totalInvalid} 个无效`,
        `通过率: ${((passedBatches / totalBatches) * 100).toFixed(1)}%`,
        `有效率: ${((totalValid / totalMappings) * 100).toFixed(1)}%`,
        '',
        '配置信息:',
        `- 严格索引: ${config.enableStrictIndexing ? '启用' : '禁用'}`,
        `- 上下文验证: ${config.enableContextValidation ? '启用' : '禁用'}`,
        `- 源文本匹配: ${config.enableSourceTextMatching ? '启用' : '禁用'}`,
        `- 顺序验证: ${config.enableOrderValidation ? '启用' : '禁用'}`,
        `- 最大允许不匹配: ${config.maxAllowedMismatch}`,
        ''
    ];
    
    if (failedBatches > 0) {
        report.push('失败批次详情:');
        validationResults.forEach((result, index) => {
            if (!result.passed) {
                report.push(`批次 ${index + 1}: ${result.mismatchCount} 个问题`);
                if (result.details.length > 0) {
                    result.details.slice(0, 3).forEach(detail => {
                        report.push(`  - ${detail}`);
                    });
                    if (result.details.length > 3) {
                        report.push(`  - ... 还有 ${result.details.length - 3} 个问题`);
                    }
                }
            }
        });
    }
    
    return report.join('\n');
}

/**
 * 打印翻译安全配置
 */
export function printTranslationSafetyConfig(config: TranslationSafetyConfig): void {
    console.log('\n=== 翻译安全配置 ===');
    console.log(`严格索引验证: ${config.enableStrictIndexing ? '✅ 启用' : '❌ 禁用'}`);
    console.log(`上下文验证: ${config.enableContextValidation ? '✅ 启用' : '❌ 禁用'}`);
    console.log(`源文本匹配验证: ${config.enableSourceTextMatching ? '✅ 启用' : '❌ 禁用'}`);
    console.log(`顺序验证: ${config.enableOrderValidation ? '✅ 启用' : '❌ 禁用'}`);
    console.log(`最大允许不匹配数: ${config.maxAllowedMismatch}`);
    console.log(`详细日志: ${config.enableDetailedLogging ? '✅ 启用' : '❌ 禁用'}`);
    console.log('======================\n');
} 