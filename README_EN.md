# Anchor Read

> **A local-first deep reading workbench: truly understand a document, and actually remember it**

Anchor Read (formerly smart-excalidraw-next) turns "reading a professional article" into a complete knowledge pipeline: **Read → Understand → Choose → Remember**. Your documents, explanations, diagrams, and learning records all stay in your browser — nothing is uploaded to the cloud; AI requests are only sent to the model service you configure yourself.

Read the Chinese version: [README.md](README.md)

## ✨ Core Features

### 📖 Source Reader: the original text is never modified
- Three reading modes: **Original** (clean source of truth) / **Comparison** (source side by side with derived explanations) / **Precision Replacement** (hard passages replaced with plain-language rewrites, with source-mapping markers preserved)
- Full Markdown rendering with tables and code blocks; reading progress saved automatically

### 🧠 Inline AI explanations & term recognition
- Select any sentence and "Explain this" — an explanation card unfolds inline, right next to the source line; mark it "Got it" or delete it
- Select a term and "Recognize terms" — term cards are created and can jump back to the exact source anchor
- Whole-document analysis: locate key points across the article in one pass

### 🗺️ Document relationship diagrams (Mermaid / Excalidraw)
- Anchor a diagram to a selection in the source; the diagram is **embedded inline right below the corresponding text** — no navigation away
- Switch between Mermaid and Excalidraw engines inside the card; collapsible source-code view; AI-powered diagram code optimization
- Diagram history for reuse and rollback

### 🎯 Aids on demand: you decide what the page shows
- Toolbar toggles for **Explanations / Diagrams** — enable them one by one, or all at once
- Every feature serves one goal: understanding this document faster. Nothing is dumped onto the page by force

### 🃏 Flashcard review (FSRS spaced repetition)
- Generate flashcards for the current document with one click, landing directly in the "Flashcard Review" tab of the knowledge panel
- FSRS-5 scheduling with flip-to-reveal rating (Again / Hard / Good / Easy) and skip support
- Per-document card library with deletion; live due-count badge

### 🔒 Local-first, data under your control
- Documents, explanations, terms, diagrams, and flashcards all live in the browser (IndexedDB / localStorage)
- Export / import `.anchorread` workspace files for backup
- Without a configured model, the app falls back to clearly labelled Demo content — no silent network calls

## 🚀 Quick Start

### Option 1: Use an Access Password

If the server administrator has configured an access password, you can use the server-side LLM configuration without providing your own API Key:

1. Click the **"Access Password"** button in the top right corner
2. Enter the access password provided by the administrator
3. Click **"Validate Password"** to test the connection
4. Check **"Enable Access Password"** and save

Once enabled, the application prioritizes the server-side configuration — you can start reading without configuring your own API Key!

### Option 2: Configure Your Own AI

1. Click the **"Config"** button in the top right corner
2. Select provider type (OpenAI or Anthropic)
3. Enter your API Key and model
4. Save the configuration

You can then generate explanations, terms, relationship diagrams, and flashcards while reading.

### Reading Workflow

1. **Import a document**: paste the content or upload a `.md/.txt` file, parse it, and enter the reader
2. **Read & understand**: select text to "Explain this", "Recognize terms", or anchor a diagram
3. **Choose**: use the toolbar toggles to decide which inline aids to show
4. **Remember**: click "Generate flashcards" and consolidate knowledge in the "Flashcard Review" tab

## 💻 Local Deployment

```bash
# Clone the project
git clone <your-repo-url>
cd AnchorRead

# Install dependencies
pnpm install

# Start development server
pnpm dev

# Run contract tests
pnpm test:reader-lab
```

Visit http://localhost:3000 to start.

### Configure Server-Side LLM (Optional)

To provide a unified LLM configuration so users don't need their own API Keys, configure the server-side access password feature:

1. Copy the environment variables example file:
```bash
cp .env.example .env
```

2. Configure the following variables in `.env`:
```bash
# Access password (users must enter this password to use the server-side LLM)
ACCESS_PASSWORD=your-secure-password

# LLM provider type (openai or anthropic)
SERVER_LLM_TYPE=anthropic

# API base URL
SERVER_LLM_BASE_URL=https://api.anthropic.com/v1

# API key
SERVER_LLM_API_KEY=sk-ant-your-key-here

# Model name
SERVER_LLM_MODEL=claude-sonnet-4-5-20250929
```

3. Restart the development server; users can then use the server-configured LLM via the access password.

**Benefits:**
- Users don't need to apply for and configure their own API Keys
- Centralized management of API usage and costs
- Suitable for team or organizational internal use

## ❓ Frequently Asked Questions

**Q: Is my data secure?**
A: All documents and learning records are stored only in your local browser and never uploaded to any server. Browser data can be cleared, so export your workspace regularly for backup.

**Q: Do explanations modify my source text?**
A: No. Explanations, terms, diagrams, and flashcards are all derived content — toggle or delete them anytime; the source document stays untouched. "Precision Replacement" mode only generates a replacement view and never rewrites the source.

**Q: What scheduling algorithm does flashcard review use?**
A: The FSRS-5 spaced repetition algorithm. Each rating (Again / Hard / Good / Easy) updates the card's stability and difficulty, automatically computing the next due date.

**Q: What is the access password feature?**
A: It allows server administrators to configure a unified LLM; users only need to enter the password to use it, without applying for their own API Key. When enabled, the server-side configuration takes priority over local configuration.

## 🛠️ Tech Stack

Next.js 16 · React 19 · Tiptap v3 (ProseMirror) · Excalidraw · Mermaid · Monaco Editor · Tailwind CSS 4 · FSRS-5 · IndexedDB

## 📄 License

MIT License (this project evolved from smart-excalidraw-next, which is also MIT licensed — thanks to the original author)

---

**Anchor Read** — turn every hard-to-read document into knowledge you actually remember
