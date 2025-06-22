# -*- coding: utf-8 -*-
import csv
import time
import os
from openai import OpenAI
from config import API_KEY
from language_codes import LANGUAGE_CODES, REVERSE_LANGUAGE_CODES

# 设置环境变量
os.environ['OPENAI_API_KEY'] = API_KEY
# 如果需要代理，取消下面的注释并设置正确的代理地址
# os.environ['HTTPS_PROXY'] = 'http://127.0.0.1:7890'
# os.environ['HTTP_PROXY'] = 'http://127.0.0.1:7890'

def show_common_languages():
    """
    显示常用语言示例
    """
    common_langs = [
        ('zh', '中文'), ('en', '英文'), ('ja', '日语'),
        ('ko', '韩语'), ('fr', '法语'), ('de', '德语'),
        ('es', '西班牙语'), ('ru', '俄语'), ('ar', '阿拉伯语')
    ]
    print("\n常用语言示例：")
    for code, name in common_langs:
        print(f"{name}({code})", end='  ')
    print("\n")

def get_target_language():
    """
    交互式获取目标语言，返回(语言代码, 中文名称)元组
    """
    print("\n请选择目标语言（支持中文名称或英文缩写）")
    print("提示：您可以查看 language_codes.py 文件获取完整的语言代码列表")
    show_common_languages()
    
    while True:
        target_language = input("请输入目标语言: ").strip()
        # 检查输入是否是语言代码或中文名称
        if target_language in LANGUAGE_CODES:
            return (target_language, LANGUAGE_CODES[target_language])
        elif target_language in REVERSE_LANGUAGE_CODES:
            return (REVERSE_LANGUAGE_CODES[target_language], target_language)
        else:
            print("不支持的语言，请重新输入或查看 language_codes.py 获取支持的语言列表")

def get_source_language():
    """
    交互式获取源语言，返回(语言代码, 中文名称)元组
    """
    print("\n请选择源语言（支持中文名称或英文缩写）")
    print("提示：您可以查看 language_codes.py 文件获取完整的语言代码列表")
    show_common_languages()
    
    while True:
        source_language = input("请输入源语言: ").strip()
        # 检查输入是否是语言代码或中文名称
        if source_language in LANGUAGE_CODES:
            return (source_language, LANGUAGE_CODES[source_language])
        elif source_language in REVERSE_LANGUAGE_CODES:
            return (REVERSE_LANGUAGE_CODES[source_language], source_language)
        else:
            print("不支持的语言，请重新输入或查看 language_codes.py 获取支持的语言列表")

def translate_to_language(client, text, source_language_code, target_language, max_retries=3):
    """
    使用 OpenAI API 将文本从指定源语言翻译成目标语言
    """
    if not text or text.strip() == '':
        return text

    system_prompt = f"""
将输入的{LANGUAGE_CODES[source_language_code]}文本翻译成{target_language}，遵循以下规则：
1. 不要判断文本类型
2. 不要解释
3. 不要加标点符号
4. 只返回翻译结果
5. 如果输入已经是{target_language}就返回原文
6. 保持文本的本意，确保准确翻译
"""
    prompt = text
    
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model="doubao-1-5-pro-32k-250115",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ]
            )
            result = response.choices[0].message.content.strip()
            result = result.replace('"', '').replace("'", "").strip()
            result = ''.join(char for char in result if not (char in '.,!?;:，。！？；：'))
            return result
        except Exception as e:
            if attempt < max_retries - 1:
                wait_time = (attempt + 1) * 2
                print(f"翻译出错 ({text}): {e}，等待 {wait_time} 秒后重试...")
                time.sleep(wait_time)
            else:
                print(f"翻译出错 ({text}): {e}，已达到最大重试次数")
                return text

def read_source_file(file_path):
    """
    读取源CSV文件，返回语言列表
    """
    languages = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            # 读取所有非空行
            lines = f.readlines()
            # 处理每一行：去除空白字符和逗号
            processed_lines = []
            for line in lines:
                # 跳过第一行（标题行）
                if line.strip().lower() == 'source language,':
                    continue
                # 清理行内容
                cleaned_line = line.strip()
                if cleaned_line.endswith(','):
                    cleaned_line = cleaned_line[:-1]
                # 如果清理后不为空，添加到结果中
                if cleaned_line:
                    processed_lines.append(cleaned_line)
            languages = processed_lines
    except UnicodeDecodeError:
        # 如果UTF-8失败，尝试GBK编码
        with open(file_path, 'r', encoding='gbk') as f:
            lines = f.readlines()
            processed_lines = []
            for line in lines:
                if line.strip().lower() == 'source language,':
                    continue
                cleaned_line = line.strip()
                if cleaned_line.endswith(','):
                    cleaned_line = cleaned_line[:-1]
                if cleaned_line:
                    processed_lines.append(cleaned_line)
            languages = processed_lines

    if not languages:
        return []

    print(f"\n总共读取到 {len(languages)} 个待翻译文本")
    print()

    return languages

def write_translated_file(file_path, original_languages, translated_languages, source_language):
    """
    将翻译结果写入CSV文件，包含源语言信息
    """
    with open(file_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['Original Text', 'Source Language', 'Translated Text'])  # 更新标题行
        for orig, trans in zip(original_languages, translated_languages):
            writer.writerow([orig, source_language, trans])

def main():
    try:
        # 初始化OpenAI客户端
        client = OpenAI(
            base_url="https://ark.cn-beijing.volces.com/api/v3",
            api_key=API_KEY
        )
        
        # 读取源文件中的语言列表
        source_languages = read_source_file('language.csv')
        
        if not source_languages:
            print("错误：源文件为空或未找到有效的文本")
            return
        
        print(f"从language.csv中读取到 {len(source_languages)} 个待翻译文本")
        print("请指定源语言，所有文本将被视为同一种语言进行翻译\n")
        
        # 获取源语言和目标语言
        source_code, source_language = get_source_language()
        target_code, target_language = get_target_language()
        
        print(f"\n开始将{source_language}翻译为{target_language}...")
        translated_languages = []
        
        for i, text in enumerate(source_languages, 1):
            print(f"\n正在翻译第 {i}/{len(source_languages)} 个文本:")
            print(f"源文本: {text}")
            translated = translate_to_language(client, text, source_code, target_language)
            print(f"译文: {translated}")
            translated_languages.append(translated)
            
            # 每翻译5个文本暂停1秒，避免API限制
            if i % 5 == 0:
                time.sleep(1)
        
        # 将结果写入文件
        output_file = f'translated_{source_code}_to_{target_code}.csv'
        write_translated_file(output_file, source_languages, translated_languages, source_language)
        print(f"\n翻译完成！结果已保存到 {output_file}")
        
        # 等待用户按任意键后退出
        input("\n按任意键退出...")
        
    except Exception as e:
        print(f"发生错误: {e}")
        # 即使出现错误也等待用户按键
        input("\n按任意键退出...")
        
if __name__ == "__main__":
    main() 