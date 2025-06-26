// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * 并行翻译配置
 */
export interface ParallelConfig {
    MAX_CONCURRENT_FILES: number;       // 同时处理的文件数量
    MAX_CONCURRENT_BATCHES: number;     // 每个文件内同时处理的批次数量
    BATCH_SIZE: number;                 // 每批次的翻译条数
    BATCH_DELAY: number;                // 批次间延迟（毫秒）
    ENABLE_PARALLEL: boolean;           // 是否启用并行处理
}

/**
 * 预设配置
 */
export const PARALLEL_CONFIGS = {
    // 默认配置（推荐）
    default: {
        MAX_CONCURRENT_FILES: 3,
        MAX_CONCURRENT_BATCHES: 2,
        BATCH_SIZE: 30,
        BATCH_DELAY: 1000,
        ENABLE_PARALLEL: true
    } as ParallelConfig,

    // 高性能配置（适合高配置机器）
    high: {
        MAX_CONCURRENT_FILES: 5,
        MAX_CONCURRENT_BATCHES: 3,
        BATCH_SIZE: 50,
        BATCH_DELAY: 500,
        ENABLE_PARALLEL: true
    } as ParallelConfig,

    // 保守配置（适合API限制严格的情况）
    conservative: {
        MAX_CONCURRENT_FILES: 2,
        MAX_CONCURRENT_BATCHES: 1,
        BATCH_SIZE: 20,
        BATCH_DELAY: 2000,
        ENABLE_PARALLEL: true
    } as ParallelConfig,

    // 串行配置（禁用并行处理）
    serial: {
        MAX_CONCURRENT_FILES: 1,
        MAX_CONCURRENT_BATCHES: 1,
        BATCH_SIZE: 30,
        BATCH_DELAY: 2000,
        ENABLE_PARALLEL: false
    } as ParallelConfig
};

/**
 * 获取当前的并行配置
 */
export function getParallelConfig(): ParallelConfig {
    const configType = process.env.TRANSLATION_PARALLEL_CONFIG || 'default';
    
    if (configType in PARALLEL_CONFIGS) {
        return PARALLEL_CONFIGS[configType as keyof typeof PARALLEL_CONFIGS];
    }
    
    console.warn(`未知的并行配置类型: ${configType}，使用默认配置`);
    return PARALLEL_CONFIGS.default;
}

/**
 * 打印并行配置信息
 */
export function printParallelConfig(config: ParallelConfig): void {
    console.log('========== 并行处理配置 ==========');
    console.log(`并行处理: ${config.ENABLE_PARALLEL ? '启用' : '禁用'}`);
    console.log(`文件并发数: ${config.MAX_CONCURRENT_FILES}`);
    console.log(`批次并发数: ${config.MAX_CONCURRENT_BATCHES}`);
    console.log(`批次大小: ${config.BATCH_SIZE}`);
    console.log(`批次延迟: ${config.BATCH_DELAY}ms`);
    console.log('=====================================');
} 