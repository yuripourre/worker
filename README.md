# Worker Package

Worker client and runtime for executing jobs: device registration, job polling, execution engines, and category executors.

## Layout

- **execution/** – Execution engines and job executors
  - **engine/** – Sequential, direct, and unidirectional-forking engines; base and job lifecycle
  - **executor/** – Executor and category executors (LLM, image, script, HTTP, file-request, image-generation, information-request, model-management)
  - Add new **job categories** by implementing a category executor under `executor/category/` and wiring it in the executor.
- **lib/** – Tool and integration libraries (ComfyUI client, Google APIs, workflow parsing)
  - Add new **integrations or tool clients** here.
- **services/** – File transfer, tool availability checkers (ComfyUI, Ollama, internet), terminal service, Ollama client, resource service
  - Add new **background or cross-cutting services** here.
- **config/** – Constants and configuration.
- **utils/** – Specs analyzer, version utils, update handler, logger, etc.
- **extra/** – Optional helpers (e.g. Ollama manager, Docker manager).

## Usage

- For creating jobs and registering for work, use the server API (e.g. `POST /api/jobs`, `POST /api/jobs/register`) or a separate client package.
- **Worker** (ExecutorClient) is the main runtime: register with the server, long-poll for jobs, run the execution engine, report status and artifacts.

### Simulating an Ollama (LLM) job via the server

Create an LLM job so a worker picks it up and runs it through Ollama:

```bash
curl -X POST http://localhost:51111/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "category": "llm",
      "model": "llama3.2",
      "temperature": 0.7,
      "userPrompt": "What is 2 + 2? Reply in one short sentence."
    }
  }'
```

Optional fields in the LLM context: `systemPrompt`, `numCtx`, `numPredict`, `topP`, `topK`, `seed`. To use a different server base URL, replace `http://localhost:51111` with your API URL (e.g. `https://your-server.vercel.app`).
