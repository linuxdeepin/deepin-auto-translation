# deepin-auto-translation

在翻译者参与贡献之前，使用 LLM 预先填充 Qt Linguist TS 文件中未翻译的字符串。

预先填充的字符串可被标记为 `type="unfinished"`[^1]，以此让翻译者可以得知这些字符串需要被主动校对。

[^1]: Transifex 平台会忽略被标记为 `type="unfinished"` 的字符串，所以对于此平台上传需求，我们不能保留这个属性。

特别注意：本项目提供了一组脚本和实用函数，用于为基于 Qt 的项目预先填充翻译。由于 LLM 返回的结果并不总是正确和可靠，所以仍然建议在监督的情况下使用此工具。
## 功能特性

- 自动检测Git仓库中最新提交是否符合脚本的启动要求（支持检测提交标题包含"transfix"且包含源文件（xx_en.ts/xx_en_us.ts）的特定提交,如果不满足会根据当前ts文件针对特定文件做翻译处理)
- 自动从Transifex平台同步翻译文件更新
- 支持多种大模型翻译服务(DOUBAO, OPENAI等)
- 特别处理繁体中文(zh_HK, zh_TW)翻译，采用规则库匹配方式
- 支持自动创建缺失的语言翻译文件
- 提交翻译结果同步transfix平台（由于是本地模拟，也有一个git 提交的流程）

## 使用方法

### 环境准备

1. 安装 [bun](https://bun.sh/) 作为运行环境
2. 克隆本仓库并进入目录
3. 运行 `bun install` 安装所需依赖

### 配置文件

1. **secrets.ts**: 复制`secrets.sample.ts`为`secrets.ts`并填入必要的API密钥:
   ```ts
   export const doubao = {
       model: '你的豆包模型ID',
       accessKey: '你的豆包访问密钥'
   };

   export const openai = {
       accessKey: '你的OpenAI密钥'
   };

   export const transifex = {
       accessKey: '你的Transifex访问密钥'
   }
   ```

2. **transifex-projects.yml**: 包含需要处理的Transifex项目ID列表
   ```yaml
   - o:linuxdeepin:p:deepin-desktop-environment
   - o:linuxdeepin:p:deepin-file-manager
   ```

3. **language.yml**: 包含需要支持的语言代码列表，如果需要新增语种，则添加到该文件中即可。

### 运行脚本

直接运行以下命令启动翻译流程:
```shell
$ bun index.ts
```

脚本将自动:
1. 从`transifex-projects.yml`读取项目列表
2. 检查本地repo/目录下是否有对应的仓库
3. 检查最新提交中是否有需要翻译的TS文件
4. 使用配置的翻译服务进行翻译
5. 将翻译结果提交回Git仓库

### 获取项目列表
工作流是直接从 Transifex 获取所有与 Transifex GitHub 集成相关联的资源。

在index.ts中，如果是要对仓库内所有的项目进行处理,请使用以下接口

如注释中所示，获取项目列表是手动完成的:
```ts
/*
 // 步骤 1：获取 Transifex 组织的所有已知 Transifex 项目：
 const transifexProjects = await Transifex.getAllProjects('o:linuxdeepin');
 // 过滤掉一些已经失效的项目 
 const filteredProjects = transifexProjects.filter(project => 
   !['o:linuxdeepin:p:linyaps', 'o:linuxdeepin:p:other-products', 'o:linuxdeepin:p:scan-assistant'].includes(project)
 );
 fs.writeFileSync('./transifex-projects.yml', YAML.dump(filteredProjects));
// 步骤 2：从这些项目中获取所有关联的资源：
const allResources = await Transifex.getAllLinkedResourcesFromProjects(YAML.load(fs.readFileSync('./transifex-projects.yml', 'utf8')));
// 步骤 3：从 GitHub 或镜像克隆对应的项目
GitRepo.ensureLocalReposExist(allResources);
*/
```

你可以取消这段代码的注释，修改组织ID和过滤条件，然后临时运行一次来生成`transifex-projects.yml`文件，也可以直接将项目git clone到脚本的repo目录下(注意格式为repo/组织/项目),然后按照格式将项目填充到`transifex-projects.yml`文件中，例如- o:organization:p:project

### 调试方法

执行如下命令开启调试模式:

```shell
$ bun --inspect index.ts
```

并在随后输出的地址中打开浏览器，即可进行调试。即便无计划断点调试也建议使用此方式查看日志，这可以使你可以更方便的查看部分标记为可折叠的日志。你也可以使用其他 v8 inspector 兼容的调试工具。

## 工作流程

1. 检测最后一次的commmit提交（对应CI流程中transfix传过来的pr）是否包含xx_en.ts（或xx_en_US.ts）和transfix字段，用于启动脚本的触发
2. 在开始翻译前，使用tx pull拉取transfix最新翻译文件，避免冲突和翻译爱好者的翻译被覆盖
3. 将对应项目translations文件夹中的ts文件与language.yml文件中的ts文件中作匹配，检测是否出现translations中没有的语种
4. 如果出现了通过脚本获取将xx_en.ts文件中的translations字段全替换为“unfinished”后的内容（因为目前脚本检测当前文本是否需要翻译是通过检测是否包含unfinished进行的），生成对应语种的ts文件，再执行后续步骤；如果没出现，直接走后续步骤
5. 对检测到的文件进行分类:
   - 繁体中文文件(zh_HK, zh_TW): 使用规则库匹配方式处理
   - 小语种文件(如德语、日语等): 跳过不由脚本处理
   - 其他语种: 使用AI大模型进行翻译
6. 通过 API 方式上传翻译后的ts文件到 Transifex
7. Transifex平台 到翻译推送后创建给对应项目推送Pr
8. 人工核查
9. 翻译合入

## 资源和链接

- [Qt Linguist TS 文件格式 XSD](https://doc.qt.io/qt-6/linguist-ts-file-format.html)
- [OpenAI Completions API](https://platform.openai.com/docs/api-reference/chat)
  - [VolcEngine: ChatCompletions API](https://www.volcengine.com/docs/82379/1298454)
  - [vLLM: Structured Outputs](https://docs.vllm.ai/en/latest/usage/structured_outputs.html)
  - [OpenAI Chat Completions: Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs?api-mode=chat&example=chain-of-thought)
- [Ollama API#Structured outputs](https://github.com/ollama/ollama/blob/main/docs/api.md#request-structured-outputs)
- [Transifex OpenAPI](https://transifex.github.io/openapi/)
