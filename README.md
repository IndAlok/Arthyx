# Arthyx

Advanced financial document intelligence platform tailored for Indian markets. Comprehensive analysis of SEBI regulations, RBI guidelines, and quantitative finance with multilingual support for Indian languages including Hindi, Tamil, Bengali, Gujarati, and more.

## Core Capabilities

### Document Intelligence
- Multi-format support: PDF, Word, Excel, Images, Text files
- Accurate page detection with per-page chunking
- 95%+ OCR accuracy on Indian language documents via Gemini Vision
- Session-based document isolation with Pinecone vector search

### Pre-trained Financial Knowledge
Built-in expertise without requiring document uploads:
- SEBI regulations (LODR, Insider Trading, Takeover Code, AIF)
- RBI guidelines (Basel III, NPA classification, FEMA, priority sector lending)
- Quantitative finance (VaR, Greeks, Black-Scholes, risk metrics)
- Indian market specifics (Nifty 50, F&O, circuit breakers, FII/DII flows)

### Advanced Analytics
- Risk contagion simulation across entity networks
- Financial metrics extraction (amounts, percentages, ratios)
- Alpha signal generation from document analysis
- VaR and Sharpe ratio calculations
- Visual risk assessment with factor breakdown

### Knowledge Graph Integration
Neo4j-powered entity relationships:
- Automatic entity extraction (companies, regulations, amounts)
- Relationship mapping between entities
- Risk propagation path queries
- Session-scoped graph per user

## Technical Architecture

### Stack
- Next.js 16 with TypeScript
- Gemini 2.0 Flash for inference and embeddings
- Pinecone for vector search (session-filtered)
- Neo4j Aura for knowledge graphs
- Upstash Redis for caching and session management

### Performance Optimizations
- Redis caching for repeated queries and embeddings
- Session-based Pinecone filtering (no cross-session contamination)
- Smart chunking with per-page context preservation
- Server-Sent Events for real-time upload progress

### API Routes
- `/api/upload` - Streaming document processing with progress
- `/api/chat` - RAG-enhanced conversation with optional documents
- `/api/session` - Session management

## Unique Features

### Risk Contagion Simulator
Visualize how financial stress propagates through entity networks. Simulate NPA spillovers, sector exposure, and systemic risk scenarios using graph-based analysis.

### Vernacular Document Analysis
Process scanned documents in Hindi, Tamil, Bengali, Gujarati, Telugu, Marathi, Kannada, and Malayalam with high accuracy. Financial terminology preserved across languages.

### Editable Conversations
Modify previous questions to regenerate analysis. Enables iterative refinement of complex financial queries.

### Visual Analysis
Automatic chart generation for numerical data. Risk factors displayed with impact indicators. Contagion paths visualized with propagation metrics.

## Environment Setup

Required environment variables:
```
GOOGLE_API_KEY=your_gemini_api_key
PINECONE_API_KEY=your_pinecone_key
PINECONE_INDEX_HOST=your_pinecone_host
NEO4J_URI=your_neo4j_uri
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_neo4j_password
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
```

## Development

```bash
npm install
npm run dev
```

## Deployment

Optimized for Vercel free tier:
- Function timeout: 60s for uploads
- Chunk limits prevent bandwidth overages
- Edge-cached responses via Redis

```bash
vercel --prod
```

## Usage Examples

### Without Documents
- "Explain SEBI insider trading regulations"
- "What is the Basel III capital adequacy requirement?"
- "Calculate VaR for a portfolio with 15% annual volatility"

### With Documents
- Upload annual report, ask "What is the company's GNPA ratio?"
- Upload multiple filings, ask "Compare Q3 vs Q4 revenue growth"
- Upload Hindi ITR form, ask "Extract total income and tax paid"

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts      # RAG conversation
│   │   ├── upload/route.ts    # Document processing
│   │   └── session/route.ts   # Session management
│   ├── dashboard/page.tsx     # Main interface
│   └── page.tsx               # Landing page
├── components/
│   ├── ChatInterface.tsx      # Editable chat with sources
│   ├── ChartRenderer.tsx      # Financial visualizations
│   ├── RiskDisplay.tsx        # Risk assessment cards
│   ├── ContagionGraph.tsx     # Risk propagation visual
│   └── MetricsGrid.tsx        # Financial metrics display
└── lib/
    ├── gemini.ts              # LLM with knowledge base
    ├── pinecone.ts            # Vector search
    ├── neo4j.ts               # Knowledge graph
    ├── redis.ts               # Caching and sessions
    ├── risk-analyzer.ts       # Quant analytics
    ├── knowledge-base.ts      # Pre-trained knowledge
    └── document-processor.ts  # Multi-format extraction
```
