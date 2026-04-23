# Expert Co-Pilot: Intelligent Slack Matchmaker

An intelligent Slack agent built with Node.js, `@slack/bolt`, and the Mistral AI API. The bot acts as an interactive co-pilot, engaging users to understand their technical or business hurdles before matching them with the right internal expert from a mock company directory.

## 🧠 Core Architecture

The application eschews a single, monolithic LLM call in favor of a **Two-Phase Heuristic Pipeline**. This separates conversational state management from the heavy analytical reasoning required for matching.

* **Phase 1: The Interviewer (Stateful Context Gathering)**
    * Maintains an in-memory session (tracked via Slack `userId`) to handle back-and-forth dialogue.
    * Acts as a semantic translator. It asks clarifying questions until it has enough domain context, then outputs a synthesized 2-sentence problem statement.
* **Phase 2: The Matchmaker (Stateless Resolution)**
    * Triggered by an internal `[CONTEXT_GATHERED]` flag.
    * Takes the distilled problem statement and the company directory (`contacts.json`) to perform a strict semantic match.
    * Returns a structured JSON payload mapped to a customized Slack Block Kit UI.

## ⚙️ How the Agent Reasons

The reasoning engine utilizes advanced prompt engineering techniques to ensure high precision and prevent AI hallucinations:

1.  **Chain of Thought (`internal_analysis`):** Before outputting matches, the Phase 2 agent is forced to write a brief internal analysis. By "thinking" through the required skills versus the directory's available skills, the agent's accuracy increases significantly, allowing it to successfully map adjacent skills (e.g., matching a "React" expert to a "Next.js" problem).
2.  **The Escape Hatch (Anti-Hallucination):** LLMs are inherently people-pleasers and will often force a bad match or invent a phantom employee to satisfy a JSON schema. The prompt includes a strict "Escape Hatch" directive: if no genuine skill match exists (e.g., asking for hardware engineering in a web-focused directory), the agent returns an empty array, triggering a graceful "No Match Found" fallback UI.
3.  **Defensive Prompting:** Phase 1 is instructed to reject vague inputs, single-word tests ("hello"), or rushed commands, forcing the user to actually describe their problem before the matchmaker is engaged.

## 🛡️ Resilience & Concurrency

Real-world Slack environments introduce race conditions. This prototype implements safety mechanisms to protect the LLM and the server:
* **Atomic Locking:** An `activeProcessingLocks` Set prevents the "double-text" race condition. If a user sends multiple messages rapidly, the lock halts subsequent executions until the initial Mistral API call resolves.
* **Slack Event Deduplication:** Slack's event delivery system will retry payloads if it detects a timeout. The bot uses the `client_msg_id` as an idempotency key to silently drop ghost retries, preventing the LLM's conversation history from becoming scrambled.
* **Session Garbage Collection:** A 15-minute `setInterval` routine sweeps the `userSessions` Map, deleting abandoned conversations (1-hour TTL) to prevent memory leaks.

## 🚀 What I'd Improve with More Time

While this heuristic pipeline works perfectly for a prototype, scaling it for an enterprise environment would require the following architectural shifts:

1.  **Distributed State Management:** Currently, user sessions are stored in Node's local memory. For a multi-instance production environment, I would migrate state management to a distributed cache like **Redis**. This prevents amnesia across load-balanced servers and allows for native TTL expiration on user sessions.
2.  **RAG (Retrieval-Augmented Generation):** Passing the entire `contacts.json` to the LLM works for 10 employees but fails for 10,000 due to token limits. I would implement a Vector Database (like pgvector or Pinecone) to store employee profiles as embeddings. The bot would perform a semantic similarity search to fetch the top 10 most relevant profiles *before* passing them to Phase 2 for the final decision.
3.  **Containerization & CI/CD:** To move beyond local Socket Mode, I would containerize the Node.js application using Docker. From there, I would implement a GitHub Actions pipeline to automate testing and handle zero-downtime deployments to a cloud infrastructure provider.

## 🛠️ Setup & Local Development

1. **Clone the repository and install dependencies:**
   ```bash
   npm install