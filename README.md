# Arthyx: Autonomous Quantitative Financial Analyst

Arthyx is an advanced, industry-grade autonomous agent tailored for quantitative financial analysis. Its name is derived from the Sanskrit word "Arth", signifying Meaning, Wealth, and Finance, reflecting its core mission: to derive actionable financial intelligence from complex unstructured data.

Unlike standard retrieval-augmented generation (RAG) systems that function as simple document summarizers, Arthyx is engineered as a comprehensive analytical platform. It integrates semantic search, probabilistic reasoning, and rigid regulatory frameworks to perform work equivalent to a human quantitative analyst. It is designed to impress by handling the rigor of institutional finance, including Basel III norms, RBI regulations, and credit risk modeling.

## Unique Value Proposition

Arthyx stands apart through its hybrid architecture that combines the creative reasoning of Large Language Models with the deterministic accuracy of Knowledge Graphs and Quantitative Models.

### Deep Contextual Understanding
Most RAG systems retrieve small, fragmented snippets of text (200-500 characters), leading to hallucinated or incomplete answers. Arthyx employs a "Deep Context" engine that retrieves massive 3000-character chunks and aggregates the top-15 most relevant sections. This allows it to "read" approximately 15-20 full pages of text before generating an answer, ensuring that every response is synthesized from a comprehensive understanding of the document rather than isolated keywords.

### High-Fidelity Visual Analysis
Arthyx automatically detects numerical trends in financial data and generates precise, interactive visualizations. Whether it is a 5-year comparison of Non-Performing Assets (NPA) or a breakdown of Capital Adequacy Ratios (CRAR), the system visualizes the data instantly. These charts are dynamic and state-aware; editing a previous query automatically recalculates the underlying data and redraws the visualization to reflect the new context, ensuring perfect synchronization between conversation history and visual output.

### Knowledge Graph Auditing
Beyond simple text search, Arthyx maps entities (companies, directors, subsidiaries) into a Neo4j Knowledge Graph. This allows it to uncover hidden relationships, conflicts of interest, and risk contagion paths that purely vector-based systems would miss. It effectively performs a "Knowledge Audit" on every uploaded document.

### Quantitative Risk Modeling
The system includes a dedicated risk engine that extracts financial ratios from unstructured text and evaluates them against encoded regulatory standards (Basel III, RBI Master Directions). It calculates scores for Credit Risk, Market Risk, and Operational Risk, providing a structured quantitative assessment alongside the qualitative text analysis.

### Specialized Indian Language OCR
Recognizing the diverse landscape of Indian finance, Arthyx features a specialized OCR pipeline fine-tuned for Indian languages. It achieves high accuracy on Hindi, Tamil, Bengali, Gujrati, and Telugu scripts, making it the only open-source financial agent capable of auditing regional vernacular records with the same precision as English documents.

## Technical Architecture

The system is built on a production-ready stack designed for scale, speed, and type safety.

**Core Intelligence**
- **Google Gemini 2.0 Flash**: Selected for its massive context window and reasoning capabilities.
- **text-embedding-004**: High-dimensional vectorization for semantic nuance.

**Data Infrastructure**
- **Pinecone Serverless**: Low-latency vector retrieval (<50ms).
- **Neo4j AuraDB**: Graph database for entity relationship modeling.
- **Upstash Redis**: High-performance caching for session state and async job queues.

**Application Layer**
- **Next.js 15 (Turbopack)**: React Server Components and Edge handling.
- **Async Polling Architecture**: A robust job-queue system that handles massive 500+ page PDFs without HTTP timeouts, ensuring 100% reliability for large annual reports.

## Installation and Deployment

Arthyx is open-source and ready for deployment on any Node.js compatible environment.

### Prerequisites
- Node.js 18+
- Accounts for Google AI, Pinecone, Upstash, and Neo4j.

### Local Development

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/IndAlok/Arthyx.git
    cd Arthyx
    ```

2.  **Install Dependencies**
    ```bash
    npm install --legacy-peer-deps
    ```

3.  **Configure Environment**
    Create a `.env.local` file with your credentials:
    ```env
    GOOGLE_API_KEY=your_key
    PINECONE_API_KEY=your_key
    NEO4J_URI=your_uri
    NEO4J_USERNAME=your_username
    NEO4J_PASSWORD=your_password
    UPSTASH_REDIS_REST_URL=your_url
    UPSTASH_REDIS_REST_TOKEN=your_token
    ```

4.  **Launch Application**
    ```bash
    npm run dev
    ```

## Contributing

We welcome contributions from engineers passionate about quantitative finance and AI. To contribute:

1.  Fork the repository.
2.  Create a feature branch for your specific improvement.
3.  Commit your changes with clear, semantic messages.
4.  Submit a Pull Request detailing the technical implementation.

---

**Engineered by [IndAlok](https://github.com/IndAlok)** | *Algorithmic Financial Intelligence for the Specialist.*
