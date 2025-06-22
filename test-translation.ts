// 测试翻译质量检查功能
import * as OpenAI from './openai';

function isEnglishVariant(lang: string) {
    return ['en', 'en_AU', 'en_GB', 'en_CA', 'en_US'].includes(lang);
}

// 模拟翻译质量检查函数
function isValidTranslation(source: string, translation: string, targetLanguage: string): { valid: boolean; reason?: string } {
    // 检查基本有效性
    if (!translation || typeof translation !== 'string') {
        return { valid: false, reason: '翻译内容为空或格式错误' };
    }

    // 去除首尾空白字符进行检查
    const trimmedTranslation = translation.trim();
    if (trimmedTranslation.length === 0) {
        return { valid: false, reason: '翻译内容为空' };
    }

    // 检查是否只包含问号或无意义字符（明显的乱码标志）
    if (/^[\s\?!@#$%^&*()_+=\-\[\]{}|\\:";'<>,.\/~`]*$/.test(trimmedTranslation)) {
        return { valid: false, reason: '翻译内容只包含符号或问号，可能是乱码' };
    }

    // 检查翻译是否异常长（比原文长10倍以上才认为异常）
    if (translation.length > source.length * 10) {
        return { valid: false, reason: '翻译内容异常长，可能存在问题' };
    }

    // 检查是否包含大量重复的同一字符（同一字符连续重复20次以上）
    const repeatedChar = /(.)\1{19,}/;  // 同一字符重复20次以上
    if (repeatedChar.test(translation)) {
        return { valid: false, reason: '包含过多重复字符，可能是乱码' };
    }

    // 只检查明显的控制字符和替换字符（保留换行符\n和制表符\t）
    const invalidChars = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD\uFFFE\uFFFF]/;
    if (invalidChars.test(translation)) {
        return { valid: false, reason: '包含无效控制字符，可能是乱码' };
    }

    // 检查是否整个翻译都是相同的单个字符（长度大于10且全是同一字符）
    const uniqueChars = new Set(translation.replace(/\s/g, ''));
    if (uniqueChars.size === 1 && translation.length > 10) {
        return { valid: false, reason: '翻译内容全是相同字符，可能是乱码' };
    }

    // 检查是否翻译结果异常短（原文超过50字符但翻译只有1-2个字符）
    if (source.length > 50 && trimmedTranslation.length <= 2) {
        return { valid: false, reason: '翻译内容过短，可能不完整' };
    }

    // 只有非英语变体才做以下检测
    if (!isEnglishVariant(targetLanguage)) {
        // 检查翻译是否与原文完全相同（忽略大小写和空格）
        const normalizedSource = source.toLowerCase().replace(/\s+/g, ' ').trim();
        const normalizedTranslation = trimmedTranslation.toLowerCase().replace(/\s+/g, ' ').trim();
        if (normalizedSource === normalizedTranslation) {
            return { valid: false, reason: '翻译内容与原文完全相同，可能未正确翻译' };
        }

        // 检查翻译是否包含明显的英文单词（可能是原文未翻译）
        const englishWords = /\b(?:the|and|or|but|in|on|at|to|for|of|with|by|from|up|down|out|off|over|under|between|among|through|during|before|after|since|until|while|when|where|why|how|what|which|who|whom|whose|this|that|these|those|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|may|might|must|can|shall|let|make|get|go|come|take|give|put|set|keep|hold|bring|carry|send|tell|say|speak|talk|write|read|see|look|watch|listen|hear|feel|think|know|understand|learn|teach|help|work|play|eat|drink|sleep|wake|run|walk|sit|stand|lie|open|close|start|stop|begin|end|finish|complete|create|build|make|break|fix|repair|clean|wash|buy|sell|pay|cost|spend|save|find|lose|win|lose|play|game|time|day|night|morning|afternoon|evening|week|month|year|today|yesterday|tomorrow|now|then|here|there|where|when|why|how|what|which|who|yes|no|ok|okay|good|bad|big|small|large|little|new|old|young|hot|cold|warm|cool|fast|slow|quick|easy|hard|difficult|simple|complex|right|wrong|correct|incorrect|true|false|real|fake|true|false|yes|no|ok|okay|good|bad|big|small|large|little|new|old|young|hot|cold|warm|cool|fast|slow|quick|easy|hard|difficult|simple|complex|right|wrong|correct|incorrect|true|false|real|fake|click|here|continue|hello|world)\b/i;
        if (englishWords.test(trimmedTranslation) && !englishWords.test(source)) {
            return { valid: false, reason: '翻译内容包含英文单词，可能是原文未翻译' };
        }
    }

    // 检查翻译是否包含明显的阿拉伯数字（可能是原文未翻译）
    const arabicNumbers = /\b\d+\b/;
    if (arabicNumbers.test(trimmedTranslation) && !arabicNumbers.test(source)) {
        return { valid: false, reason: '翻译内容包含阿拉伯数字，可能是原文未翻译' };
    }

    // 检查翻译是否包含明显的标点符号（可能是原文未翻译）
    const punctuation = /[.,;:!?()[\]{}"'`~@#$%^&*+=|\\/<>]/;
    if (punctuation.test(trimmedTranslation) && !punctuation.test(source)) {
        return { valid: false, reason: '翻译内容包含标点符号，可能是原文未翻译' };
    }

    // 其他情况都认为是有效的翻译
    return { valid: true };
}

// 测试用例
const testCases = [
    {
        source: "Move to Top",
        translation: "Move to Top",
        targetLanguage: "ar",
        expected: false,
        description: "翻译与原文完全相同"
    },
    {
        source: "Full-screen Mode",
        translation: "Full-screen Mode",
        targetLanguage: "ar",
        expected: false,
        description: "翻译与原文完全相同（忽略大小写）"
    },
    {
        source: "Hello World",
        translation: "Hello World!",
        targetLanguage: "ar",
        expected: false,
        description: "翻译包含英文单词"
    },
    {
        source: "Click here",
        translation: "Click here to continue",
        targetLanguage: "ar",
        expected: false,
        description: "翻译包含英文单词"
    },
    {
        source: "Settings",
        translation: "الإعدادات",
        targetLanguage: "ar",
        expected: true,
        description: "正确的阿拉伯语翻译"
    },
    {
        source: "Cancel",
        translation: "إلغاء",
        targetLanguage: "ar",
        expected: true,
        description: "正确的阿拉伯语翻译"
    },
    {
        source: "Save",
        translation: "حفظ",
        targetLanguage: "ar",
        expected: true,
        description: "正确的阿拉伯语翻译"
    },
    {
        source: "Delete",
        translation: "حذف",
        targetLanguage: "ar",
        expected: true,
        description: "正确的阿拉伯语翻译"
    },
    {
        source: "Required",
        translation: "الضروري",
        targetLanguage: "ar",
        expected: true,
        description: "正确的阿拉伯语翻译"
    },
    // 英语变体测试
    {
        source: "Color",
        translation: "Colour",
        targetLanguage: "en_GB",
        expected: true,
        description: "美式转英式，允许"
    },
    {
        source: "Move to Top",
        translation: "Move to Top",
        targetLanguage: "en_GB",
        expected: true,
        description: "英语变体允许原文"
    },
    {
        source: "Full-screen Mode",
        translation: "Full-screen Mode",
        targetLanguage: "en_AU",
        expected: true,
        description: "英语变体允许原文"
    },
];

console.log("=== 翻译质量检查测试 ===\n");

testCases.forEach((testCase, index) => {
    const result = isValidTranslation(testCase.source, testCase.translation, testCase.targetLanguage);
    const passed = (result.valid === testCase.expected);
    
    console.log(`测试 ${index + 1}: ${testCase.description}`);
    console.log(`  原文: "${testCase.source}"`);
    console.log(`  译文: "${testCase.translation}"`);
    console.log(`  目标语言: ${testCase.targetLanguage}`);
    console.log(`  预期: ${testCase.expected ? '有效' : '无效'}`);
    console.log(`  实际: ${result.valid ? '有效' : '无效'}`);
    if (!result.valid && result.reason) {
        console.log(`  原因: ${result.reason}`);
    }
    console.log(`  结果: ${passed ? '✅ 通过' : '❌ 失败'}`);
    console.log('');
});

console.log("=== 测试完成 ==="); 