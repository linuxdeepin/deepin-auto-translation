# deepin-auto-translation

Pre-fill untranslated strings in Qt Linguist TS files using LLM, before translators get involved.

Pre-filled strings can be marked with an `type="unfinished"` attribute, so translators will know these strings need to be actively reviewed.[^1]

[^1]: Transifex platform will ignore strings marked with `type="unfinished"`, so for uploading purposes we cannot keep this attribute.

Important note: This project provides a set of scripts and utility functions for pre-filling translations for Qt-based projects. Since the results returned by LLMs are not always correct and reliable, it's still recommended to use this tool under supervision.

## Features

- Automatically detects if the latest commit in a Git repository meets the script's startup requirements (supports detecting specific commits that contain "transfix" in the title and include source files (xx_en.ts/xx_en_us.ts); if not met, it will perform translation processing for specific files based on current ts files)
- Automatically synchronizes translation file updates from the Transifex platform
- Supports multiple LLM translation services (DOUBAO, OPENAI, etc.)
- Special handling for Traditional Chinese (zh_HK, zh_TW) translations using rule-based matching
- Supports automatic creation of missing language translation files
- Submits translation results synchronized to the Transifex platform (due to local simulation, there's also a git commit process)

## Usage Steps (Recommended Workflow)

1. **Configure Transifex Organization Name**  
   Edit `config.yml` and fill in your Transifex organization name, for example:
   ```yaml
   transifex:
     organization: 'o:linuxdeepin'
   ```

2. **Select Projects to Process**  
   Edit `project-list.yml` and fill in the projects you want to process under `projects:` (format: `o:organization:p:project-name`).  
   - If this file is empty or doesn't exist, all projects under the organization will be automatically pulled.
   - Example:
     ```yaml
     projects:
       - 'o:linuxdeepin:p:deepin-draw'
       # - 'o:linuxdeepin:p:deepin-terminal'
     ```

3. **Push Project Configuration with tx push**  
   Based on the configuration from the previous two steps, use the `tx push` command to push the local project configuration to the Transifex platform, ensuring the platform has the latest resources and configuration.  
   This ensures all subsequent operations stay synchronized with the Transifex platform.

4. **Start Automatic Translation Process**  
   ```bash
   bun index.ts
   ```
   The script will automatically complete:  
   - Obtain and synchronize Transifex project resources
   - Clone/update local repositories
   - Check and process TS files
   - Automatic translation/conversion/synchronization/push etc.

## Usage Instructions

### Environment Setup

1. Install [bun](https://bun.sh/) as the runtime environment
2. Clone this repository and enter the directory
3. Run `bun install` to install the required dependencies

### Configuration Files

1. **secrets.ts**: Copy `secrets.sample.ts` to `secrets.ts` and fill in the necessary API keys:
   ```ts
   export const doubao = {
       model: 'your_doubao_model_id',
       accessKey: 'your_doubao_access_key'
   };

   export const openai = {
       accessKey: 'your_openai_key'
   };

   export const transifex = {
       accessKey: 'your_transifex_access_key'
   }
   ```

2. **transifex-projects.yml**: Contains a list of Transifex project IDs to be processed
   ```yaml
   - o:linuxdeepin:p:deepin-desktop-environment
   - o:linuxdeepin:p:deepin-file-manager
   ```

### Running the Script

Run the following command to start the translation process:
```shell
$ bun index.ts
```

The script will automatically execute the following steps:
1. **Read Configuration**: Read Transifex organization information from `config.yml`
2. **Get Project List**: Read specified project list from `project-list.yml`, if file doesn't exist, process all projects
3. **Project Filtering**: Get all projects from Transifex organization and filter according to configuration
4. **Resource Acquisition**: Get associated resource information for all projects
5. **Repository Preparation**: Clone or update local repositories in `repo/` directory
6. **Translation Processing**: Use `tx pull` to sync latest translations, check and translate unfinished content
7. **Result Upload**: Use `tx push` to upload translation results to Transifex platform

### Obtaining Project Lists

The script automatically obtains project lists from Transifex with the following workflow:

1. **Read Configuration File**: Read Transifex organization information from `config.yml`
2. **Read Project List**: Check `project-list.yml` file:
   - If file exists, read the specified project list
   - If file doesn't exist, process all projects under the organization
3. **Get Organization Projects**: Get all projects from Transifex API for the specified organization
4. **Project Filtering**: 
   - If projects are specified in `project-list.yml`, only process matching projects
   - If not specified, process all projects
5. **Generate Project Configuration**: Write filtered project list to `transifex-projects.yml`

#### Configuration Examples

**config.yml** (required):
```yaml
transifex:
  organization: 'o:linuxdeepin'
```

**project-list.yml** (optional):
```yaml
projects:
  - 'o:linuxdeepin:p:deepin-draw'
  - 'o:linuxdeepin:p:deepin-terminal'
  - 'o:linuxdeepin:p:deepin-file-manager'
```

If you don't create a `project-list.yml` file, the script will automatically process all projects under the organization.

#### Manual Project Management

If you need to manually manage the project list, you can refer to the following code snippet (in index.ts):

```ts
// Read configuration and project list
const config = readConfig();
const projectList = readProjectList();
const transifexProjects = await Transifex.getAllProjects(config.transifex.organization);

// Project filtering
let filteredProjects = transifexProjects;
if (projectList && projectList.length > 0) {
    filteredProjects = transifexProjects.filter(project => projectList.includes(project));
}

// Generate final project configuration file
fs.writeFileSync('./transifex-projects.yml', YAML.dump(filteredProjects));
```

You can also directly edit the generated `transifex-projects.yml` file to manually adjust the project list.

### Debugging Method

Execute the following command to enable debug mode:

```shell
$ bun --inspect index.ts
```

Then open the browser at the subsequently output address to debug. Even if you don't plan to use breakpoint debugging, it's still recommended to use this method to view logs, as it allows you to more conveniently view logs marked as collapsible. You can also use other v8 inspector compatible debugging tools.

## Workflow

### Prerequisites: Transifex Configuration

Before using the automatic translation tool, projects must have Transifex integration configured. Projects need to include the following configuration files:

1. **`.tx/config` file**: Transifex CLI configuration file that defines resource mappings
   ```ini
   [main]
   host = https://www.transifex.com

   [o:linuxdeepin:p:project-name:r:resource-name]
   file_filter = translations/project_<lang>.ts
   source_file = translations/project_en.ts
   source_lang = en
   type = QT
   ```

2. **`.transifex.yml` file**: Transifex platform configuration file for automated workflows
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

**How to configure Transifex integration**:
- Reference documentation: [Internationalization Configuration Process](https://wikidev.uniontech.com/%E6%96%87%E6%A1%88%E5%9B%BD%E9%99%85%E5%8C%96%E9%85%8D%E7%BD%AE%E6%B5%81%E7%A8%8B)
- Project integration: [Project Using Transifex Internationalization](https://wikidev.uniontech.com/%E9%A1%B9%E7%9B%AE%E5%88%A9%E7%94%A8Transifex%E5%9B%BD%E9%99%85%E5%8C%96)
- Sync configuration: [Transifex Translation Sync Configuration Guide](https://wikidev.uniontech.com/Transifex%E7%BF%BB%E8%AF%91%E5%90%8C%E6%AD%A5%E9%85%8D%E7%BD%AE%E6%8C%87%E5%8D%97)
- Tool usage: [Deepin-translation-utils Usage Guide](https://wikidev.uniontech.com/Deepin-translation-utils%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E) (can be used to generate corresponding project config and transifex.yaml files)

### Local Translation Process

1. **Sync Latest Translation Files**  
   Before starting translation, use `tx pull` to pull the latest translation files from Transifex to avoid conflicts and overwriting contributions from translation enthusiasts

2. **Check and Process Translation Files**  
   Automatically scan and check all translation files obtained from Transifex, identifying files containing untranslated content

3. **Intelligent Classification Processing**  
   Classify detected files for processing:
   - **Traditional Chinese files** (zh_HK, zh_TW): Process using rule-based matching, automatically convert from Simplified Chinese
   - **Minor language files** (such as German, Japanese, Spanish, etc.): Skip, not processed by script, preserve manual translations
   - **Other languages**: Use AI large language models for automatic translation

4. **Upload Translation Results**  
   Upload translated ts files to Transifex platform via `tx push` method

5. **Create Pull Request**  
   Transifex platform automatically creates Pull Request to corresponding GitHub project after detecting translation updates

6. **Manual Review and Merge**  
   Developers perform manual review and then merge translations into main branch

### CI Automated Translation Process

We also provide an automated translation process deployed in CI environment:

1. **Update Source Files**  
   First need to update source files specified in `.tx/config` and `.transifex.yml` in the project, add translation content, commit to GitHub and merge into main branch

2. **Trigger Transifex Detection**  
   Transifex platform will detect changes in GitHub translation completeness and automatically trigger Pull Request to GitHub project

3. **Start Automatic Translation**  
   In the PR triggered by Transifex (format example: `[deepin-draw] Updates for project Deepin Draw #150`), use the following command to trigger automatic translation:
   ```bash
   /test deepin-auto-translation
   ```
   
   The following steps are executed in CI referencing the actual script workflow:

   > **Note**: CI configuration is based on the [deepin-auto-translation/test](https://github.com/linuxdeepin/deepin-auto-translation/tree/develop/test) branch. Other projects that need to run CI should modify the corresponding yaml configuration files based on this branch.

   **3.1 Read Configuration and Project List**  
   - Read `config.yml` to get Transifex organization information
   - Read `project-list.yml`, if it doesn't exist, process all projects
   - Get all project lists from Transifex for the specified organization

   **3.2 Project Filtering and Resource Acquisition**  
   - Filter projects according to `project-list.yml` (if specified)
   - Generate and update `transifex-projects.yml` file
   - Get associated resource information for all projects

   **3.3 Local Repository Preparation**  
   - Clone or update local repositories in `repo/` directory
   - Use `tx pull` to pull latest translation files from Transifex

   **3.4 Translation File Processing**  
   - Automatically scan and check all translation files, identify files containing untranslated content
   - Intelligent classification processing:
     - **Traditional Chinese files** (zh_HK, zh_TW): Process using rule-based matching
     - **Minor language files** (such as German, Japanese, etc.): Skip, not processed by script
     - **Other languages**: Use AI large language models for translation

   **3.5 Upload Translation Results**  
   - Upload translated ts files to Transifex platform via `tx push` method

4. **View Translation Results**  
   You can view specific translation details and logs in CI execution results, for example:
   [CI Execution Example](https://prow.cicd.getdeepin.org/view/s3/prow-logs/pr-logs/pull/linuxdeepin_deepin-draw/143/deepin-auto-translation/1927888385188302848)

### Notes

- **Free Model Limitations**: Currently using free models for translation, the translation quality may not be ideal, and some content may appear incomplete. It's recommended to use paid models in production environments to improve translation quality.

- **Retry Mechanism**: Some languages may fail when executing `tx push`, in which case re-executing the CI process once can solve the issue.

- **Transifex Platform Status**: Transifex platform occasionally experiences slow response, causing API call failures. It's recommended to retry later.

- **CI Configuration Notes**: CI configuration is based on the [deepin-auto-translation/test](https://github.com/linuxdeepin/deepin-auto-translation/tree/develop/test) branch. Other projects that need to run CI should modify the corresponding yaml configuration files based on this branch.

- **CI Execution Recommendations**: During initial execution, due to the large amount of content, failures may occur when running multiple project CIs simultaneously. It's recommended to execute CI in the evening for higher success rates.

## Resources and Links

### Technical Documentation
- [Qt Linguist TS File Format XSD](https://doc.qt.io/qt-6/linguist-ts-file-format.html)
- [OpenAI Completions API](https://platform.openai.com/docs/api-reference/chat)
  - [VolcEngine: ChatCompletions API](https://www.volcengine.com/docs/82379/1298454)
  - [vLLM: Structured Outputs](https://docs.vllm.ai/en/latest/usage/structured_outputs.html)
  - [OpenAI Chat Completions: Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs?api-mode=chat&example=chain-of-thought)
- [Ollama API#Structured outputs](https://github.com/ollama/ollama/blob/main/docs/api.md#request-structured-outputs)
- [Transifex OpenAPI](https://transifex.github.io/openapi/)

### Transifex Configuration Reference Documentation
- [Internationalization Configuration Process](https://wikidev.uniontech.com/%E6%96%87%E6%A1%88%E5%9B%BD%E9%99%85%E5%8C%96%E9%85%8D%E7%BD%AE%E6%B5%81%E7%A8%8B)
- [Project Using Transifex Internationalization](https://wikidev.uniontech.com/%E9%A1%B9%E7%9B%AE%E5%88%A9%E7%94%A8Transifex%E5%9B%BD%E9%99%85%E5%8C%96)
- [Transifex Translation Sync Configuration Guide](https://wikidev.uniontech.com/Transifex%E7%BF%BB%E8%AF%91%E5%90%8C%E6%AD%A5%E9%85%8D%E7%BD%AE%E6%8C%87%E5%8D%97)
- [Transifex-cli Usage Guide](https://wikidev.uniontech.com/Transifex-cli)
- [Deepin-translation-utils Usage Guide](https://wikidev.uniontech.com/Deepin-translation-utils%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E) (Project configuration file automatic generation tool)
