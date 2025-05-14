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

3. **language.yml**: Contains a list of language codes to support. If you need to add a new language, simply add it to this file.

### Running the Script

Run the following command to start the translation process:
```shell
$ bun index.ts
```

The script will automatically:
1. Read the project list from `transifex-projects.yml`
2. Check if there are corresponding repositories in the local repo/ directory
3. Check if there are TS files that need translation in the latest commit
4. Use the configured translation service to perform translations
5. Commit the translation results back to the Git repository

### Obtaining Project Lists
The workflow directly obtains all resources associated with the Transifex GitHub integration from Transifex.

In index.ts, if you want to process all projects in the repository, use the following interface:

As shown in the comments, obtaining the project list is done manually:
```ts
/*
 // Step 1: Get all known Transifex projects for the Transifex organization:
 const transifexProjects = await Transifex.getAllProjects('o:linuxdeepin');
 // Filter out some invalid projects 
 const filteredProjects = transifexProjects.filter(project => 
   !['o:linuxdeepin:p:linyaps', 'o:linuxdeepin:p:other-products', 'o:linuxdeepin:p:scan-assistant'].includes(project)
 );
 fs.writeFileSync('./transifex-projects.yml', YAML.dump(filteredProjects));
// Step 2: Get all associated resources from these projects:
const allResources = await Transifex.getAllLinkedResourcesFromProjects(YAML.load(fs.readFileSync('./transifex-projects.yml', 'utf8')));
// Step 3: Clone the corresponding projects from GitHub or mirrors
GitRepo.ensureLocalReposExist(allResources);
*/
```

You can uncomment this code, modify the organization ID and filter conditions, and then run it once temporarily to generate the `transifex-projects.yml` file. Alternatively, you can directly git clone the projects to the script's repo directory (note the format is repo/organization/project), and then fill in the projects to the `transifex-projects.yml` file according to the format, for example - o:organization:p:project

### Debugging Method

Execute the following command to enable debug mode:

```shell
$ bun --inspect index.ts
```

Then open the browser at the subsequently output address to debug. Even if you don't plan to use breakpoint debugging, it's still recommended to use this method to view logs, as it allows you to more conveniently view logs marked as collapsible. You can also use other v8 inspector compatible debugging tools.

## Workflow

1. Detect whether the last commit (corresponding to the PR sent from the CI process in Transifex) contains xx_en.ts (or xx_en_US.ts) and the "transfix" field, used to trigger the script
2. Before starting translation, use tx pull to pull the latest translation files from Transifex to avoid conflicts and overwriting translations from translation enthusiasts
3. Match ts files in the project's translations folder with ts files in the language.yml file to detect if there are any languages missing from the translations
4. If there are missing languages, use the script to get the content from xx_en.ts with all translation fields replaced with "unfinished" (because the current script detects whether text needs translation by checking if it contains "unfinished"), generate the corresponding language ts file, and then proceed to the next steps; if not, directly proceed to the next steps
5. Classify the detected files:
   - Traditional Chinese files (zh_HK, zh_TW): Process using rule-based matching
   - Minor language files (such as German, Japanese, etc.): Skip, not processed by the script
   - Other languages: Use AI large language models for translation
6. Upload the translated ts files to Transifex via API
7. After the translation is pushed to the Transifex platform, create and push a PR to the corresponding project
8. Manual review
9. Translation merged

## Resources and Links

- [Qt Linguist TS File Format XSD](https://doc.qt.io/qt-6/linguist-ts-file-format.html)
- [OpenAI Completions API](https://platform.openai.com/docs/api-reference/chat)
  - [VolcEngine: ChatCompletions API](https://www.volcengine.com/docs/82379/1298454)
  - [vLLM: Structured Outputs](https://docs.vllm.ai/en/latest/usage/structured_outputs.html)
  - [OpenAI Chat Completions: Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs?api-mode=chat&example=chain-of-thought)
- [Ollama API#Structured outputs](https://github.com/ollama/ollama/blob/main/docs/api.md#request-structured-outputs)
- [Transifex OpenAPI](https://transifex.github.io/openapi/)
