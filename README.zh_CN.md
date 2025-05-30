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

## 使用步骤（推荐流程）

1. **配置 Transifex 组织名**  
   编辑 `config.yml`，填写你的 Transifex 组织名，例如：
   ```yaml
   transifex:
     organization: 'o:linuxdeepin'
   ```

2. **选择需要处理的项目**  
   编辑 `project-list.yml`，在 `projects:` 下填写你想处理的项目（格式为 `o:组织:p:项目名`）。  
   - 如果该文件为空或不存在，则会自动拉取组织下的所有项目。
   - 例如：
     ```yaml
     projects:
       - 'o:linuxdeepin:p:deepin-draw'
       # - 'o:linuxdeepin:p:deepin-terminal'
     ```

3. **用 tx push 推送项目配置**  
   根据前两步的配置，使用 `tx push` 命令将本地的项目配置推送到 Transifex 平台，确保平台上有最新的资源和配置。  
   这样后续所有操作都能与 Transifex 平台保持同步。

4. **启动自动翻译流程**  
   ```bash
   bun index.ts
   ```
   脚本会自动完成：  
   - 获取并同步 Transifex 项目资源
   - 克隆/更新本地仓库
   - 检查并处理 TS 文件
   - 自动翻译/转换/同步/推送等

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

### 运行脚本

直接运行以下命令启动翻译流程:
```shell
$ bun index.ts
```

脚本将自动执行以下步骤:
1. **读取配置**: 从`config.yml`读取Transifex组织信息
2. **获取项目列表**: 从`project-list.yml`读取指定项目列表，如果文件不存在则处理所有项目
3. **项目过滤**: 从Transifex获取组织的所有项目，并根据配置进行过滤
4. **资源获取**: 获取所有项目的关联资源信息
5. **仓库准备**: 克隆或更新本地`repo/`目录下的仓库
6. **翻译处理**: 使用`tx pull`同步最新翻译，检查并翻译未完成的内容
7. **结果上传**: 使用`tx push`将翻译结果上传到Transifex平台

### 获取项目列表

脚本会自动从Transifex获取项目列表，具体流程如下：

1. **读取配置文件**: 从`config.yml`读取Transifex组织信息
2. **读取项目列表**: 检查`project-list.yml`文件：
   - 如果文件存在，读取其中指定的项目列表
   - 如果文件不存在，将处理组织下的所有项目
3. **获取组织项目**: 从Transifex API获取指定组织的所有项目
4. **项目过滤**: 
   - 如果`project-list.yml`中指定了项目，则只处理匹配的项目
   - 如果未指定，则处理所有项目
5. **生成项目配置**: 将过滤后的项目列表写入`transifex-projects.yml`

#### 配置示例

**config.yml** (必须):
```yaml
transifex:
  organization: 'o:linuxdeepin'
```

**project-list.yml** (可选):
```yaml
projects:
  - 'o:linuxdeepin:p:deepin-draw'
  - 'o:linuxdeepin:p:deepin-terminal'
  - 'o:linuxdeepin:p:deepin-file-manager'
```

如果不创建`project-list.yml`文件，脚本将自动处理组织下的所有项目。

#### 手动项目管理

如果需要手动管理项目列表，可以参考以下代码片段（在index.ts中）：

```ts
// 读取配置和项目列表
const config = readConfig();
const projectList = readProjectList();
const transifexProjects = await Transifex.getAllProjects(config.transifex.organization);

// 项目过滤
let filteredProjects = transifexProjects;
if (projectList && projectList.length > 0) {
    filteredProjects = transifexProjects.filter(project => projectList.includes(project));
}

// 生成最终的项目配置文件
fs.writeFileSync('./transifex-projects.yml', YAML.dump(filteredProjects));
```

你也可以直接编辑生成的`transifex-projects.yml`文件来手动调整项目列表。

### 调试方法

执行如下命令开启调试模式:

```shell
$ bun --inspect index.ts
```

并在随后输出的地址中打开浏览器，即可进行调试。即便无计划断点调试也建议使用此方式查看日志，这可以使你可以更方便的查看部分标记为可折叠的日志。你也可以使用其他 v8 inspector 兼容的调试工具。

## 工作流程

### 前提条件：Transifex配置

在使用自动翻译工具之前，项目必须已经配置好Transifex集成。项目需要包含以下配置文件：

1. **`.tx/config` 文件**: Transifex CLI配置文件，定义了资源映射关系
   ```ini
   [main]
   host = https://www.transifex.com

   [o:linuxdeepin:p:project-name:r:resource-name]
   file_filter = translations/project_<lang>.ts
   source_file = translations/project_en.ts
   source_lang = en
   type = QT
   ```

2. **`.transifex.yml` 文件**: Transifex平台的配置文件，用于自动化workflow
   ```yaml
   git:
     filters:
       - filter_type: file
         file_format: QT
         source_file: translations/project_en.ts
         source_language: en
         translation_files_expression: 'translations/project_<lang>.ts'
   settings:
     pr_branch_name: 'transifex-translations'
   ```

**如何配置Transifex集成**：
- 参考文档：[文案国际化配置流程](https://wikidev.uniontech.com/%E6%96%87%E6%A1%88%E5%9B%BD%E9%99%85%E5%8C%96%E9%85%8D%E7%BD%AE%E6%B5%81%E7%A8%8B)
- 项目接入：[项目利用Transifex国际化](https://wikidev.uniontech.com/%E9%A1%B9%E7%9B%AE%E5%88%A9%E7%94%A8Transifex%E5%9B%BD%E9%99%85%E5%8C%96)
- 同步配置：[Transifex翻译同步配置指南](https://wikidev.uniontech.com/Transifex%E7%BF%BB%E8%AF%91%E5%90%8C%E6%AD%A5%E9%85%8D%E7%BD%AE%E6%8C%87%E5%8D%97)
- 工具使用：[Deepin-translation-utils使用说明](https://wikidev.uniontech.com/Deepin-translation-utils%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E) (可用于生成对应项目的config和transifex.yaml文件)

### 本地翻译流程

1. **同步最新翻译文件**  
   在开始翻译前，使用`tx pull`拉取Transifex最新翻译文件，避免冲突和覆盖翻译爱好者的贡献

2. **检查并处理翻译文件**  
   自动扫描并检查从Transifex获取的所有翻译文件，识别包含未翻译内容的文件

3. **智能分类处理**  
   对检测到的文件进行分类处理：
   - **繁体中文文件**(zh_HK, zh_TW): 使用规则库匹配方式处理，基于简体中文进行自动转换
   - **小语种文件**(如德语、日语、西班牙语等): 跳过不由脚本处理，保留人工翻译
   - **其他语种**: 使用AI大模型进行自动翻译

4. **上传翻译结果**  
   通过Transifex tx push 方式上传翻译后的ts文件到Transifex平台

5. **创建Pull Request**  
   Transifex平台检测到翻译更新后，自动创建Pull Request到对应的GitHub项目

6. **人工核查与合入**  
   开发者进行人工核查后，将翻译合入到主分支

### CI自动化翻译流程

我们还提供了一套部署在CI环境中的自动翻译流程：

1. **更新源文件**  
   首先需要在项目中更新在`.tx/config`和`.transifex.yml`中规定的源文件，增加翻译内容，提交到GitHub后合入主分支

2. **触发Transifex检测**  
   Transifex平台会检测到GitHub的翻译完成度发生变化，自动触发Pull Request到GitHub项目

3. **启动自动翻译**  
   在由Transifex触发的PR中(格式例如：`[deepin-draw] Updates for project Deepin Draw #150`)，使用以下命令触发自动翻译：
   ```
   /test deepin-auto-translation
   ```
   
   接下来在CI中执行的步骤参考脚本的实际流程：

   **3.1 读取配置和项目列表**  
   - 读取`config.yml`获取Transifex组织信息
   - 读取`project-list.yml`，如果不存在则处理所有项目
   - 从Transifex获取指定组织的所有项目列表

   **3.2 项目过滤和资源获取**  
   - 根据`project-list.yml`过滤项目（如果指定了的话）
   - 生成并更新`transifex-projects.yml`文件
   - 获取所有项目的关联资源

   **3.3 本地仓库准备**  
   - 克隆或更新本地仓库到`repo/`目录
   - 使用`tx pull`拉取Transifex最新翻译文件

   **3.4 翻译文件处理**  
   - 自动扫描并检查所有翻译文件，识别包含未翻译内容的文件
   - 智能分类处理：
     - **繁体中文文件**(zh_HK, zh_TW): 使用规则库匹配方式处理
     - **小语种文件**(如德语、日语等): 跳过不由脚本处理
     - **其他语种**: 使用AI大模型进行翻译

   **3.5 上传翻译结果**  
   - 通过`tx push`方式上传翻译后的ts文件到Transifex平台

4. **查看翻译结果**  
   可以在CI执行结果中查看具体的翻译细节和日志，例如：
   [CI执行示例](https://prow.cicd.getdeepin.org/view/s3/prow-logs/pr-logs/pull/linuxdeepin_deepin-draw/143/deepin-auto-translation/1927888385188302848)

### 注意事项

- **免费模型限制**: 由于使用的是免费模型，翻译效果相对一般，可能出现部分内容翻译不完整的情况。建议在生产环境中使用付费模型以获得更好的翻译质量
- **重试机制**: 某些语种可能会出现`tx push`失败的情况，这时可以多执行一次CI流程来解决
- **日志格式问题**: 在CI环境中可能会出现翻译日志包含较多空行的情况，这通常是由于JSON读取失败导致的。虽然不影响实际使用，但在本地环境中较少出现此问题
- **Transifex平台状态**: 偶尔会遇到Transifex平台响应缓慢的情况，这时API可能会报错，稍后重试即可

## 资源和链接

### 技术文档
- [Qt Linguist TS 文件格式 XSD](https://doc.qt.io/qt-6/linguist-ts-file-format.html)
- [OpenAI Completions API](https://platform.openai.com/docs/api-reference/chat)
  - [VolcEngine: ChatCompletions API](https://www.volcengine.com/docs/82379/1298454)
  - [vLLM: Structured Outputs](https://docs.vllm.ai/en/latest/usage/structured_outputs.html)
  - [OpenAI Chat Completions: Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs?api-mode=chat&example=chain-of-thought)
- [Ollama API#Structured outputs](https://github.com/ollama/ollama/blob/main/docs/api.md#request-structured-outputs)
- [Transifex OpenAPI](https://transifex.github.io/openapi/)

### Transifex配置参考文档
- [文案国际化配置流程](https://wikidev.uniontech.com/%E6%96%87%E6%A1%88%E5%9B%BD%E9%99%85%E5%8C%96%E9%85%8D%E7%BD%AE%E6%B5%81%E7%A8%8B)
- [项目利用Transifex国际化](https://wikidev.uniontech.com/%E9%A1%B9%E7%9B%AE%E5%88%A9%E7%94%A8Transifex%E5%9B%BD%E9%99%85%E5%8C%96)
- [Transifex翻译同步配置指南](https://wikidev.uniontech.com/Transifex%E7%BF%BB%E8%AF%91%E5%90%8C%E6%AD%A5%E9%85%8D%E7%BD%AE%E6%8C%87%E5%8D%97)
- [Transifex-cli使用指南](https://wikidev.uniontech.com/Transifex-cli)
- [Deepin-translation-utils使用说明](https://wikidev.uniontech.com/Deepin-translation-utils%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E) (项目配置文件自动生成工具)
