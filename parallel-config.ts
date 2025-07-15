// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * 并行处理配置类型定义
 */
export type ParallelConfig = {
    MAX_CONCURRENT_FILES: number;
    BATCH_SIZE: number;
    API_RATE_LIMIT: {
        MAX_REQUESTS: number;
        TIME_WINDOW: number;
        WINDOW_MS?: number;
        MAX_CALLS_PER_WINDOW?: number;
    };
    MIN_FILES_FOR_PARALLEL: number;
    ENABLE_PARALLEL: boolean;
    FORCE_SEQUENTIAL_BATCHES?: boolean;
    BATCH_DELAY?: number;
};

export type ParallelConfigName = 'standard' | 'performance' | 'conservative';

export const PARALLEL_CONFIGS: Record<ParallelConfigName, ParallelConfig> = {
    // 标准配置：平衡速度和稳定性
    standard: {
        MAX_CONCURRENT_FILES: 3,
        BATCH_SIZE: 15,
        API_RATE_LIMIT: {
            MAX_REQUESTS: 3,
            TIME_WINDOW: 1000,
        },
        MIN_FILES_FOR_PARALLEL: 2,
        ENABLE_PARALLEL: true,
        FORCE_SEQUENTIAL_BATCHES: false,
        BATCH_DELAY: 1000
    },
    // 性能配置：最大化翻译速度
    performance: {
        MAX_CONCURRENT_FILES: 5,
        BATCH_SIZE: 15,
        API_RATE_LIMIT: {
            MAX_REQUESTS: 5,
            TIME_WINDOW: 1000,
        },
        MIN_FILES_FOR_PARALLEL: 2,
        ENABLE_PARALLEL: true,
        FORCE_SEQUENTIAL_BATCHES: false,
        BATCH_DELAY: 500
    },
    // 保守配置：串行处理但优化速度
    conservative: {
        MAX_CONCURRENT_FILES: 1,
        BATCH_SIZE: 15,
        API_RATE_LIMIT: {
            MAX_REQUESTS: 1,
            TIME_WINDOW: 2000,
        },
        MIN_FILES_FOR_PARALLEL: 999999,
        ENABLE_PARALLEL: false,
        FORCE_SEQUENTIAL_BATCHES: true,
        BATCH_DELAY: 2000
    }
};

/**
 * 获取并行配置
 * @param profile 配置文件名称，可选值：'standard'|'validation'|'performance'|'conservative'|'robust'
 * @returns 并行配置对象
 */
export function getParallelConfig(profile?: string): ParallelConfig {
    // 从参数或环境变量获取配置名称
    const selectedProfile = profile || process.env.TRANSLATION_PARALLEL_CONFIG || 'conservative';

    // 获取基础配置
    const baseConfig = PARALLEL_CONFIGS[selectedProfile as ParallelConfigName] || PARALLEL_CONFIGS.conservative;

    return baseConfig;
}

/**
 * 打印并行配置信息
 */
export function printParallelConfig(config: ParallelConfig) {
    console.log('📊 并行处理配置:');
    console.log(`  - 最大并发文件数: ${config.MAX_CONCURRENT_FILES}`);
    console.log(`  - 批次大小: ${config.BATCH_SIZE}`);
    console.log(`  - API速率限制: ${config.API_RATE_LIMIT.MAX_REQUESTS}次/${config.API_RATE_LIMIT.TIME_WINDOW}ms`);
    console.log(`  - 并发处理: ${config.ENABLE_PARALLEL ? '启用' : '禁用'}`);
    console.log(`  - 最小并发文件数: ${config.MIN_FILES_FOR_PARALLEL}`);
    console.log(`  - 批次处理模式: ${config.FORCE_SEQUENTIAL_BATCHES ? '强制串行' : '允许并发'}`);
    console.log(`  - 批次间延迟: ${config.BATCH_DELAY}ms`);
}
