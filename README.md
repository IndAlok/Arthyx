# Arthyx

Advanced financial document intelligence platform combining retrieval-augmented generation, knowledge graphs, and pre-trained regulatory expertise for comprehensive analysis of Indian market documents.

---

## What Makes Arthyx Different

### Not Another Chatbot
Arthyx is built specifically for financial document analysis with deep integration of Indian regulatory frameworks. Unlike general-purpose AI assistants, it understands the nuances of SEBI circulars, RBI guidelines, and quantitative finance concepts without requiring extensive context in every query.

### Pre-trained Knowledge Without Document Upload
Ask about SEBI insider trading rules, RBI NPA classification, Basel III capital requirements, or VaR calculations immediately. The system maintains comprehensive knowledge of:

- Securities and Exchange Board of India (SEBI) regulations including LODR, Takeover Code, and AIF guidelines
- Reserve Bank of India (RBI) frameworks including capital adequacy, priority sector lending, and FEMA
- Quantitative finance concepts including Greeks, Black-Scholes, and risk metrics
- Indian market mechanics including NSE/BSE operations, F&O margins, and circuit breakers

### 50MB File Support
Bank annual reports, regulatory filings, and comprehensive financial documents are fully supported through Vercel Blob storage integration. The 4MB serverless limit is bypassed through intelligent two-stage upload.

### Indian Language OCR
Scanned documents in Hindi, Tamil, Bengali, Gujarati, Telugu, Marathi, Kannada, and Malayalam are processed with 95%+ accuracy using Gemini Vision. Financial tables, handwritten annotations, and mixed-language content are handled natively.

---

## Core Technical Architecture

### Retrieval-Augmented Generation
Documents are processed into semantically-chunked vectors stored in Pinecone with session-based isolation. Each query retrieves the most relevant context using 768-dimensional embeddings, ensuring responses cite specific pages and sections.

**Session Isolation**: Every upload session maintains its own vector namespace. Queries never cross-contaminate between sessions, ensuring accurate citations.

**Smart Chunking**: Documents are split by actual page boundaries with overlapping context. Page numbers are preserved through the entire pipeline.

### Knowledge Graph Integration
Neo4j Aura powers entity extraction and relationship mapping:

- Automatic identification of companies, regulations, amounts, and dates
- Relationship inference between entities (Company REGULATED_BY Regulation)
- Risk contagion path queries across entity networks
- Session-scoped graphs cleaned on session expiry

### Performance Optimization
- Redis caching for response deduplication (repeated queries return instantly)
- Embedding cache with 24-hour TTL
- Batch processing for multi-file uploads
- Server-Sent Events for real-time progress streaming

---

## Quantitative Analysis Features

### Risk Assessment
Automatic extraction and analysis of financial health indicators:

- GNPA/NNPA ratios with RBI threshold comparison
- Capital adequacy ratio (CAR) vs Basel III minimums
- Provision coverage analysis
- Risk scoring from 0-100 with factor breakdown

### Financial Metrics Extraction
Pattern recognition for Indian financial data formats:

- Amounts in crores, lakhs, and standard notation
- Percentage identification with context
- Ratio extraction (P/E, ROE, NIM, D/E)
- Date and period recognition

### Visual Analysis
Responses include interactive visualizations when data warrants:

- Bar, line, pie, area, and scatter charts
- Risk assessment cards with animated scoring
- Financial metrics grids with change indicators
- Risk contagion graphs showing propagation paths

---

## Editable Conversations

Every user message can be edited in-place. Upon edit, the conversation regenerates from that point using the modified query. This enables iterative refinement of complex analysis requests without starting over.

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Frontend | Next.js 16, TypeScript, Framer Motion | Interactive UI with animations |
| LLM | Gemini 2.0 Flash | Inference and embeddings |
| Vector DB | Pinecone | Session-scoped semantic search |
| Graph DB | Neo4j Aura | Entity relationships and contagion |
| Cache | Upstash Redis | Response and embedding caching |
| Storage | Vercel Blob | Large file upload (50MB) |
| Deployment | Vercel | Serverless with 60s timeout |

---

## Environment Configuration

```
GOOGLE_API_KEY=your_gemini_api_key
PINECONE_API_KEY=your_pinecone_key
PINECONE_INDEX_HOST=your_pinecone_host
NEO4J_URI=your_neo4j_uri
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_neo4j_password
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
```

---

## Local Development

```bash
npm install
npm run dev
```

## Production Deployment

```bash
vercel --prod
```

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── blob/          # Large file upload via Vercel Blob
│   │   ├── chat/          # RAG-enhanced conversation
│   │   ├── upload/        # Document processing pipeline
│   │   └── session/       # Session management
│   ├── dashboard/         # Main analysis interface
│   └── page.tsx           # Landing page
├── components/
│   ├── ChatInterface.tsx  # Editable chat with source citations
│   ├── ChartRenderer.tsx  # Financial visualizations
│   ├── RiskDisplay.tsx    # Risk assessment cards
│   ├── MetricsGrid.tsx    # Financial metrics display
│   ├── ContagionGraph.tsx # Risk propagation visualization
│   ├── CursorGlow.tsx     # Mouse-following effects
│   └── ParticleField.tsx  # Interactive background
└── lib/
    ├── gemini.ts          # LLM with knowledge base integration
    ├── pinecone.ts        # Session-scoped vector search
    ├── neo4j.ts           # Knowledge graph operations
    ├── redis.ts           # Caching and session management
    ├── risk-analyzer.ts   # VaR, Sharpe, contagion simulation
    ├── knowledge-base.ts  # Pre-trained SEBI/RBI knowledge
    └── document-processor.ts  # Multi-format extraction
```

---

## Example Queries

### Without Documents
- "Explain the SEBI LODR quarterly disclosure requirements"
- "What are the Basel III capital buffers for systemically important banks?"
- "Calculate VaR for a portfolio with 20% annualized volatility at 99% confidence"

### With Documents
- "What is the company's gross NPA ratio and how does it compare to RBI thresholds?"
- "Extract all amounts mentioned in the director's report with their context"
- "Analyze the financial health of this bank based on the annual report"
- "Compare Q3 and Q4 revenue figures and visualize the trend"
