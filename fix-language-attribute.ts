// SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'fs';
import path from 'path';

/**
 * 从文件名中提取语言代码
 */
function extractLanguageCode(filename: string): string | null {
    // 匹配 _xx.ts 或 _xx_YY.ts 格式
    const match = filename.match(/_([a-z]{2}(?:_[A-Z]{2})?)\.ts$/);
    return match ? match[1] : null;
}

/**
 * 修复单个TS文件中的language属性
 */
function fixLanguageAttribute(filePath: string): boolean {
    try {
        const filename = path.basename(filePath);
        const languageCode = extractLanguageCode(filename);
        
        if (!languageCode) {
            console.log(`⚠️  跳过非语种文件: ${filePath}`);
            return false;
        }

        // 读取文件内容
        let content = fs.readFileSync(filePath, 'utf8');
        
        // 检查当前的language属性
        const currentLanguageMatch = content.match(/<TS[^>]*language="([^"]*)"[^>]*>/);
        if (!currentLanguageMatch) {
            console.log(`⚠️  文件中未找到language属性: ${filePath}`);
            return false;
        }
        
        const currentLanguage = currentLanguageMatch[1];
        if (currentLanguage === languageCode) {
            console.log(`✅ 文件language属性已正确: ${filePath} (${languageCode})`);
            return false;
        }
        
        console.log(`🔧 修复language属性: ${filePath}`);
        console.log(`   从 "${currentLanguage}" 改为 "${languageCode}"`);
        
        // 修复language属性
        content = content.replace(
            /(<TS(?:\s+version="[^"]*")?\s+language=")[^"]*(")/, 
            `$1${languageCode}$2`
        );
        
        // 如果上面的匹配失败，尝试匹配language在version之前的情况
        if (content.includes(`language="${currentLanguage}"`)) {
            content = content.replace(
                /(<TS(?:\s+[^>]*)?language=")[^"]*(")/, 
                `$1${languageCode}$2`
            );
        }
        
        // 写回文件
        fs.writeFileSync(filePath, content, { encoding: 'utf8' });
        
        console.log(`✅ 已修复: ${filePath}`);
        return true;
        
    } catch (error) {
        console.error(`❌ 修复文件失败 ${filePath}:`, error);
        return false;
    }
}

/**
 * 递归查找并修复目录中的所有TS文件
 */
function fixLanguageAttributesInDirectory(dirPath: string): { fixed: number, total: number } {
    let fixedCount = 0;
    let totalCount = 0;
    
    if (!fs.existsSync(dirPath)) {
        console.log(`⚠️  目录不存在: ${dirPath}`);
        return { fixed: fixedCount, total: totalCount };
    }
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
            // 递归处理子目录
            const subResult = fixLanguageAttributesInDirectory(fullPath);
            fixedCount += subResult.fixed;
            totalCount += subResult.total;
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            // 处理TS文件
            totalCount++;
            if (fixLanguageAttribute(fullPath)) {
                fixedCount++;
            }
        }
    }
    
    return { fixed: fixedCount, total: totalCount };
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.error('请提供要修复的目录路径');
        console.error('');
        console.error('使用方法:');
        console.error('  bun fix-language-attribute.ts /path/to/translations');
        console.error('  bun fix-language-attribute.ts /path/to/project');
        console.error('');
        console.error('这个脚本会递归查找所有.ts文件并修复其中的language属性');
        process.exit(1);
    }
    
    const targetPath = args[0];
    
    console.log(`🔧 开始修复language属性...`);
    console.log(`目标路径: ${targetPath}`);
    console.log('');
    
    const result = fixLanguageAttributesInDirectory(targetPath);
    
    console.log('');
    console.log(`📊 修复完成统计:`);
    console.log(`   总文件数: ${result.total}`);
    console.log(`   已修复数: ${result.fixed}`);
    console.log(`   无需修复: ${result.total - result.fixed}`);
    
    if (result.fixed > 0) {
        console.log(`✅ 成功修复了 ${result.fixed} 个文件的language属性`);
    } else {
        console.log(`ℹ️  没有发现需要修复的文件`);
    }
}

// 如果直接运行此文件
if (require.main === module) {
    main().catch(console.error);
}

export { fixLanguageAttribute, fixLanguageAttributesInDirectory }; 