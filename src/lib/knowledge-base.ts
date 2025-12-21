export const SEBI_KNOWLEDGE = `
## SEBI (Securities and Exchange Board of India) Knowledge Base

### Key Regulations
- **SEBI Act, 1992**: Establishes SEBI as statutory body; powers to regulate securities markets
- **SEBI (LODR) Regulations, 2015**: Listing Obligations and Disclosure Requirements for listed entities
- **SEBI (Insider Trading) Regulations, 2015**: Prohibits trading on unpublished price-sensitive information (UPSI)
- **SEBI (Takeover) Regulations, 2011**: Governs substantial acquisition of shares and takeovers
- **SEBI (AIF) Regulations, 2012**: Alternative Investment Funds categories (I, II, III)
- **SEBI (PIT) Regulations, 2015**: Prohibition of Insider Trading guidelines

### Market Segments
- **Primary Market**: IPOs, FPOs, Rights Issues, OFS (Offer for Sale)
- **Secondary Market**: NSE, BSE trading; market makers, liquidity providers
- **Derivatives**: Futures, Options on indices and stocks; margin requirements

### Key Compliance Requirements
- Quarterly financial results within 45 days
- Annual report within 60 days of AGM
- Disclosure of shareholding pattern quarterly
- Board composition: minimum 1/3 independent directors
- Related party transaction approval thresholds

### Recent Circulars (2024-2025)
- ESG disclosure framework for top 1000 listed companies
- T+1 settlement implementation complete
- ASBA-only IPO applications mandatory
- Unified payment interface for direct IPO applications
`;

export const RBI_KNOWLEDGE = `
## RBI (Reserve Bank of India) Knowledge Base

### Key Regulations
- **Banking Regulation Act, 1949**: Licensing, regulation of banking companies
- **FEMA, 1999**: Foreign Exchange Management; cross-border transactions
- **RBI Act, 1934**: Central banking functions; monetary policy
- **Insolvency and Bankruptcy Code, 2016**: NPA resolution framework

### Banking Norms
- **Capital Adequacy (Basel III)**: Minimum CAR 9% (11.5% for SIBs)
- **NPA Classification**: 
  - Substandard: >90 days overdue
  - Doubtful: >12 months in substandard
  - Loss: certified by auditor/RBI
- **Provisioning Norms**: 15% substandard, 25-100% doubtful
- **LCR (Liquidity Coverage Ratio)**: Minimum 100%
- **Priority Sector Lending**: 40% of ANBC

### Key Rates
- Repo Rate: Policy rate for short-term lending
- Reverse Repo: Rate RBI pays for deposits
- CRR: Cash Reserve Ratio (4% of NDTL)
- SLR: Statutory Liquidity Ratio (18% of NDTL)

### Recent Guidelines
- Digital lending norms (RBI/2022-23/111)
- Account aggregator framework
- Payment aggregator regulations
- NBFC scale-based regulation
`;

export const QUANT_KNOWLEDGE = `
## Quantitative Finance Knowledge Base

### Risk Metrics
- **VaR (Value at Risk)**: Maximum loss at confidence level over horizon
  - Parametric VaR: σ × Z × √t × Portfolio Value
  - Historical VaR: Percentile of historical returns
  - Monte Carlo VaR: Simulation-based estimation
- **Expected Shortfall (ES/CVaR)**: Average loss beyond VaR
- **Sharpe Ratio**: (Return - Rf) / σ; measures risk-adjusted returns
- **Sortino Ratio**: Downside risk version of Sharpe
- **Maximum Drawdown**: Largest peak-to-trough decline

### Derivatives Pricing
- **Black-Scholes**: C = S×N(d1) - K×e^(-rT)×N(d2)
- **Greeks**: Delta (Δ), Gamma (Γ), Theta (Θ), Vega (ν), Rho (ρ)
- **Implied Volatility**: Market-derived volatility from option prices
- **Put-Call Parity**: C - P = S - K×e^(-rT)

### Indian Market Specifics
- **Nifty 50**: Top 50 NSE stocks by market cap
- **Bank Nifty**: Banking sector index (12 stocks)
- **F&O Lot Sizes**: Vary by stock; Nifty lot = 50
- **Circuit Breakers**: 10%, 15%, 20% for indices
- **FII/FPI Limits**: Sectoral caps apply

### Algorithmic Trading
- **SEBI Algo Framework**: Registration for algo providers
- **Co-location**: Exchange co-location for low latency
- **Smart Order Routing**: Best execution across exchanges
- **TWAP/VWAP**: Time/Volume weighted execution
`;

export const INDIAN_FINANCIAL_TERMS = `
## Indian Financial Terminology

### Banking Terms
- **CASA**: Current Account Savings Account (low-cost deposits)
- **NIM**: Net Interest Margin
- **GNPA/NNPA**: Gross/Net Non-Performing Assets
- **PCR**: Provision Coverage Ratio
- **CRAR**: Capital to Risk-weighted Assets Ratio
- **PSL**: Priority Sector Lending
- **DRT**: Debt Recovery Tribunal
- **SARFAESI**: Securitisation Act for NPA recovery

### Market Terms  
- **FII/FPI**: Foreign Institutional/Portfolio Investor
- **DII**: Domestic Institutional Investor
- **ASBA**: Application Supported by Blocked Amount
- **OFS**: Offer for Sale
- **QIP**: Qualified Institutional Placement
- **ESOP**: Employee Stock Option Plan
- **REIT/InvIT**: Real Estate/Infrastructure Investment Trust

### Regulatory Bodies
- **SEBI**: Securities markets regulator
- **RBI**: Central bank, banking regulator
- **IRDAI**: Insurance regulator
- **PFRDA**: Pension fund regulator
- **IFSCA**: GIFT City financial services regulator
- **NCLT/NCLAT**: Company law tribunals
`;

export const FULL_KNOWLEDGE_BASE = `
${SEBI_KNOWLEDGE}

${RBI_KNOWLEDGE}

${QUANT_KNOWLEDGE}

${INDIAN_FINANCIAL_TERMS}

---
This knowledge is current as of December 2024. For regulatory updates, refer to official SEBI/RBI circulars.
`;

export function getRelevantKnowledge(query: string): string {
  const lowerQuery = query.toLowerCase();
  const sections: string[] = [];

  if (lowerQuery.includes("sebi") || 
      lowerQuery.includes("listing") || 
      lowerQuery.includes("disclosure") ||
      lowerQuery.includes("insider") ||
      lowerQuery.includes("takeover") ||
      lowerQuery.includes("ipo") ||
      lowerQuery.includes("fpo")) {
    sections.push(SEBI_KNOWLEDGE);
  }

  if (lowerQuery.includes("rbi") || 
      lowerQuery.includes("bank") || 
      lowerQuery.includes("npa") ||
      lowerQuery.includes("capital adequacy") ||
      lowerQuery.includes("basel") ||
      lowerQuery.includes("liquidity") ||
      lowerQuery.includes("fema")) {
    sections.push(RBI_KNOWLEDGE);
  }

  if (lowerQuery.includes("var") || 
      lowerQuery.includes("risk") || 
      lowerQuery.includes("sharpe") ||
      lowerQuery.includes("derivative") ||
      lowerQuery.includes("option") ||
      lowerQuery.includes("volatility") ||
      lowerQuery.includes("greek") ||
      lowerQuery.includes("algo") ||
      lowerQuery.includes("quant")) {
    sections.push(QUANT_KNOWLEDGE);
  }

  if (lowerQuery.includes("casa") || 
      lowerQuery.includes("nim") || 
      lowerQuery.includes("fii") ||
      lowerQuery.includes("dii") ||
      lowerQuery.includes("indian") ||
      lowerQuery.includes("nifty")) {
    sections.push(INDIAN_FINANCIAL_TERMS);
  }

  if (sections.length === 0) {
    return FULL_KNOWLEDGE_BASE;
  }

  return sections.join("\n\n");
}
