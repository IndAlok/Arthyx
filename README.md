# Arthyx

Production-grade AI financial document assistant with multilingual OCR and intelligent analysis.

## Features

- **Universal Document Support** - PDF, scanned images, handwritten notes
- **Multilingual OCR** - Hindi, Tamil, Bengali, Gujarati, English (95%+ accuracy)
- **Advanced RAG Pipeline** - Context-aware retrieval with source citations
- **Visual Analytics** - Dynamic charts from document data
- **Conversation Memory** - Session-based context persistence

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, Framer Motion |
| AI/ML | Google Gemini 1.5 Flash, Gemini Embeddings |
| Vector DB | Pinecone Serverless |
| Memory | Upstash Redis |
| Deployment | Vercel Serverless |

## Quick Start

```bash
npm install
npm run dev
```

## Environment Variables

```env
GOOGLE_API_KEY=your_gemini_api_key
PINECONE_API_KEY=your_pinecone_key
PINECONE_INDEX_HOST=your_pinecone_index_url
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
```

## Architecture

```
Upload → OCR (Gemini Vision) → Chunking → Embeddings → Pinecone
Query → Embedding → Vector Search → Context Assembly → Gemini → Response
```

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/arthyx)

## License

MIT
