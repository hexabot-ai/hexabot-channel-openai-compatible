# Hexabot OpenAI-Compatible Channel

`hexabot-channel-openai-compatible` adds an OpenAI-**compatible** channel to Hexabot v3. The channel is installed as a standard npm package and is discovered by the API automatically.

Instead of letting end users on an external platform (Facebook, WhatsApp, …) message the bot, it lets *any OpenAI-compatible client* (the official `openai` SDKs, LangChain's `ChatOpenAI`, Open WebUI, LiteLLM, custom scripts, `curl`, …) talk to a Hexabot bot as if it were a model.

## Installation

Install the package in the same workspace or deployment that runs `@hexabot-ai/api`:

```sh
npm install hexabot-channel-openai-compatible
```

Restart the API after installation. The channel appears with the name `openai-compatible`.

## Prerequisites

Before configuring the channel, make sure you have:

- a Hexabot source created with the `openai-compatible` channel;
- a public HTTPS URL for your Hexabot API if the client runs elsewhere. For local testing, expose the API with a tunnel such as ngrok;
- optionally, a Hexabot credential holding a bearer token, if you want to require authentication.

## Configure the Hexabot Source

Each source exposes exactly one of OpenAI's two API surfaces, picked via the `api_type` setting:

- **Chat Completions** (default) — `POST .../chat/completions`, request/response built around `messages`/`choices`.
- **Responses** — `POST .../responses`, request/response built around `input`/`output`, including the Responses API's own SSE event sequence (`response.created` → … → `response.completed`) when streaming.

Both accept JSON (non-streaming) or SSE (`"stream": true`).

In Hexabot, open the `openai-compatible` source and set `api_type` to the surface your client expects, plus any of the [Source Settings](#source-settings) below. If you want to require authentication, create a credential holding the bearer token and reference it from `api_key`.

## How it works

A normal webhook channel (Facebook, WhatsApp, …) acknowledges the platform's HTTP request immediately and delivers the bot's reply asynchronously afterwards, because that's what those platforms expect. An OpenAI client instead expects the assistant's reply **in the same HTTP response** it made. `OpenAiChannelHandler.handle()` (in [src/index.channel.ts](src/index.channel.ts)) therefore does not follow the usual ack-then-async-process flow: it holds the request open, dispatches the message through the normal chatbot/workflow pipeline, and waits for the reply before responding. This is possible because `ChannelEventBus.emitMessage()` resolves only once the entire chatbot pipeline for that message — including any workflow/LLM run that produces the reply — has completed (NestJS `EventEmitter2` `emitAsync`/`promisify` semantics).

Because the underlying Hexabot pipeline can produce richer message types (quick replies, buttons, lists, carousels, attachments) than plain text, this channel renders them to markdown (see [src/outbound/index-encoder.ts](src/outbound/index-encoder.ts)) so they remain readable/clickable regardless of which endpoint suffix is active — the rendered text ends up in `choices[0].message.content` for Chat Completions or `output_text` for Responses.

## Endpoint

Every Hexabot channel is reachable at the standard webhook route once a `Source` of type `openai-compatible` is created in the admin UI:

```
POST /api/webhook/:sourceRef
```

The request/response body follows whichever suffix the source's `api_type` setting picks (see [Source Settings](#source-settings) below). A request sent to the endpoint that does *not* match the configured suffix gets a `404`.

### Chat Completions style (`api_type: "chat/completions"`, default)

Request body:

```json
{
  "model": "hexabot",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "stream": false
}
```

Response body (non-streaming):

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1730000000,
  "model": "hexabot",
  "choices": [
    { "index": 0, "message": { "role": "assistant", "content": "Hi there!" }, "finish_reason": "stop" }
  ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 3, "total_tokens": 3 }
}
```

Set `"stream": true` for a `text/event-stream` response using the same `chat.completion.chunk` shape as OpenAI, terminated with `data: [DONE]`.

### Responses style (`api_type: "responses"`)

Request body — `input` can be a plain string (shorthand for a single user turn) or an array of `{role, content}` items:

```json
{
  "model": "hexabot",
  "input": "Hello!",
  "stream": false
}
```

Response body (non-streaming):

```json
{
  "id": "resp_...",
  "object": "response",
  "created_at": 1730000000,
  "status": "completed",
  "model": "hexabot",
  "output": [
    {
      "type": "message",
      "id": "msg_...",
      "status": "completed",
      "role": "assistant",
      "content": [{ "type": "output_text", "text": "Hi there!", "annotations": [] }]
    }
  ],
  "output_text": "Hi there!",
  "usage": { "input_tokens": 0, "output_tokens": 3, "total_tokens": 3 }
}
```

Set `"stream": true` for the Responses API's own SSE event sequence (`response.created`, `response.output_item.added`, `response.content_part.added`, repeated `response.output_text.delta`, `response.output_text.done`, `response.content_part.done`, `response.output_item.done`, `response.completed`).

### Streaming caveat (both styles)

Streaming here is **message-level**, not token-level: the final reply text is chunked over SSE to emulate incremental delivery, since Hexabot's own pipeline returns a finished message rather than a token stream.

### Using official OpenAI client SDKs

The official `openai` SDKs (and many tools built on them, including Open WebUI) always POST to `{base_url}/chat/completions` or `{base_url}/responses`, and GET `{base_url}/models`. The channel therefore also registers all three on the Express instance at startup, via `HttpChannelHandler.registerCustomRoutes()` (core channel infrastructure from `@hexabot-ai/api` — any HTTP channel can use it, not just this one):

```
POST /api/webhook/:sourceRef/openai-compatible/chat/completions
POST /api/webhook/:sourceRef/openai-compatible/responses
GET  /api/webhook/:sourceRef/openai-compatible/models
```

For the two `POST` routes, whichever one doesn't match the source's `api_type` answers with a `404`. Point a client's `base_url`/`api_base` at `https://your-host/api/webhook/<sourceRef>/openai-compatible` — the SDK appends `/chat/completions`, `/responses`, or `/models` itself. No reverse-proxy rewrite is needed.

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-host/api/webhook/<sourceRef>/openai-compatible",
    api_key="YOUR_TOKEN",
)

# Chat Completions style
reply = client.chat.completions.create(
    model="hexabot",
    messages=[{"role": "user", "content": "Hello!"}],
    user="user-123",
)

# Responses style
reply = client.responses.create(
    model="hexabot",
    input="Hello!",
    user="user-123",
)
```

Tools and scripts that let you set an arbitrary full URL (curl, `fetch`, n8n/Zapier HTTP nodes, custom integrations) can also target `/api/webhook/:sourceRef` directly with the matching request body.

### Model listing (`GET .../models`)

Returns a single-entry OpenAI-style model list built from the source's `model_name` setting (`*` reports back as `hexabot`), so clients like Open WebUI can populate a model picker and validate the connection:

```json
{
  "object": "list",
  "data": [{ "id": "hexabot", "object": "model", "created": 0, "owned_by": "hexabot" }]
}
```

Like the `chat/completions`/`responses` routes, this checks the source's `api_key` (same `Authorization: Bearer <token>` rule).

## Source Settings

Configured per-`Source` in the Hexabot admin UI (see [src/settings.schema.ts](src/settings.schema.ts)):

Required settings: none — every setting has a usable default.

Optional settings:

- `api_key`: credential holding the bearer token clients must send as `Authorization: Bearer <token>`. Empty disables auth (local dev only).
- `model_name`: model id reported in responses. Set to `*` to accept any `"model"` in the request; otherwise a mismatching `model` gets a `404` like the real API.
- `api_type`: which OpenAI API surface this source responds on: `chat/completions` (default) or `responses`. Requests sent to the other one are rejected with a `404`.
- `identity_source`: how to derive a stable conversation identity across stateless calls: the request's `user` field, a custom header, or the caller's IP.
- `identity_header`: header name used when `identity_source` is `header`.
- `system_prompt_mode`: `ignore` (Hexabot flows own the behavior) or `prepend` (prepend the `system`-role text to the latest user message).
- `stream_chunk_size`: character chunk size used to emulate streaming over SSE.
- `response_timeout_ms`: max time to wait for the chatbot reply before responding with a timeout error.
- `thread_inactivity_hours`: same convention as other channels: starts a new thread after this many hours of inactivity.

Use one Hexabot source per OpenAI-compatible client integration. Each source owns its own credential references and settings.

## Conversation identity & threading

Both API styles are stateless — the caller resends the whole `messages`/`input` history every call. This channel does **not** replay that history into the bot; it only takes the latest user turn and relies on Hexabot's own per-subscriber thread/session memory for continuity. For that continuity to work across calls, the caller needs a stable identity, which is why `identity_source` exists: pass a stable `user` value (recommended, per OpenAI's own API contract for that field), a session header, or rely on IP (weakest — breaks under NAT/shared IPs).

### Open WebUI background calls

Open WebUI sends more than just real chat messages to a connected model: it also calls it for chat title, tags, and follow-up suggestions, with no `user` field, from the same IP as the real chat. Without a fix, those calls would share the same identity as the real chat and could hijack its suspended workflow run (e.g. one waiting on `await_reply`), sending it the wrong text and polluting Hexabot's inbox with turns the user never typed.

`isOpenWebUiTaskPrompt` (`src/index.channel.ts`) spots these calls (no `tools` array, text matches Open WebUI's `"### Task:\n..."` prompt) and replies with an empty message, without touching any subscriber/thread/workflow state. This only helps for Open WebUI's own known prompts — any other client sending unidentified background calls could hit the same problem. The real fix is still to send a stable `user` value or session header for real chat turns.
